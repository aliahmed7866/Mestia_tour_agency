"""HTML routes, validation, and server-side role enforcement."""
import csv
import hashlib
import hmac
import io
import json
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from flask import (abort, current_app, flash, g, make_response, redirect,
                   render_template, request, send_from_directory, session, url_for)
from . import get_db
from . import domain
from .business_content import instagram_profile, whatsapp_business_link, whatsapp_contact
from .destinations import get_destination_slides
from .catalogue import (MONTH_CHOICES, SERVICE_TEXT_FIELDS, research_checked,
                        research_sources, season_months)
from .security import csrf_token, validate_csrf, check_password, verify_totp, rate_limit

TBILISI = ZoneInfo('Asia/Tbilisi')
KINDS = {'tour', 'stay', 'taxi', 'combined'}


def rows(sql, args=()):
    return [dict(r) for r in get_db().execute(sql, args).fetchall()]


def row(sql, args=()):
    result = get_db().execute(sql, args).fetchone()
    return dict(result) if result else None


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def local(value):
    if not value:
        return ''
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(TBILISI).strftime('%Y-%m-%d %H:%M')
    except (ValueError, TypeError):
        return str(value)


def local_input(value):
    return local(value).replace(' ', 'T')


def required(value, label, limit=5000):
    value = str(value or '').strip()
    if not value or len(value) > limit:
        raise ValueError(f'{label} is required and must be at most {limit} characters.')
    return value


def integer(value, label='Number', minimum=1, maximum=10000):
    try:
        number = int(value)
    except (ValueError, TypeError):
        raise ValueError(f'{label} must be a whole number.')
    if not minimum <= number <= maximum:
        raise ValueError(f'{label} must be between {minimum} and {maximum}.')
    return number


def money(value, label='Amount'):
    try:
        amount = Decimal(str(value or '0'))
        if not amount.is_finite() or amount < 0 or amount > 10000000 or amount.quantize(Decimal('.01')) != amount:
            raise ValueError()
        return int(amount * 100)
    except (ValueError, InvalidOperation):
        raise ValueError(f'{label} must be a non-negative amount with at most two decimal places.')


def scheduled(value, label='Date and time'):
    value = required(value, label, 40)
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if date.tzinfo is None:
            date = date.replace(tzinfo=TBILISI)
        return date.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except ValueError:
        raise ValueError(f'{label} must be a valid date and time.')


def settings_data():
    data = {r['key']: r['value'] for r in get_db().execute('SELECT key,value FROM settings')}
    data.update(whatsapp=data.get('whatsapp_number', ''), email=data.get('contact_email', ''),
                hours=data.get('operating_hours', ''), terms=data.get('booking_terms', ''),
                privacy=data.get('privacy_notice', ''), intro_en=data.get('about_en', ''),
                intro_ka=data.get('about_ka', ''))
    data['whatsapp_url'] = whatsapp_contact(data)[0]
    for key in ('guesthouse_instagram_url', 'guide_instagram_url'):
        try:
            data[key] = instagram_profile(data.get(key, ''))
        except ValueError:
            data[key] = ''
    return data


def audit(action, kind, identifier, details=''):
    get_db().execute('INSERT INTO audit(actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?)',
                     (g.user['id'] if g.get('user') else None, action, kind, identifier, json.dumps({'note': details}), now_iso()))


def staff(owner=False):
    def decorate(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            if not g.get('user'):
                return redirect('/admin/login')
            if owner and g.user['role'] != 'owner':
                abort(403)
            return func(*args, **kwargs)
        return wrapped
    return decorate


def guest_enquiry(token):
    if len(token) > 160:
        abort(404)
    e = row('SELECT * FROM enquiries WHERE token_hash=? AND token_expires_at>?',
            (hashlib.sha256(token.encode()).hexdigest(), now_iso()))
    if not e:
        abort(404, description='This private link is invalid or has expired. Contact the host for a new link.')
    return e


def enquiry_input(form, source='website'):
    kind = form.get('kind', 'combined')
    if kind not in KINDS:
        raise ValueError('Choose a valid service type.')
    if kind == 'stay':
        start = scheduled(form.get('check_in'), 'Check-in date')
        end = scheduled(form.get('check_out'), 'Check-out date')
    else:
        start = scheduled(form.get('start_local'), 'Start time')
        end = scheduled(form.get('end_local'), 'End time')
    if end <= start:
        raise ValueError('End or check-out must be after the start or check-in.')
    if start < now_iso() and source == 'website':
        raise ValueError('Choose a future date for your request.')
    phone = required(form.get('contact'), 'Phone or WhatsApp number', 50)
    if len(re.sub(r'\D', '', phone)) < 7:
        raise ValueError('Enter a reachable phone number including the country code.')
    email = form.get('email', '').strip()
    if email and (len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email)):
        raise ValueError('Enter a valid email address.')
    ids = form.getlist('service_ids') if hasattr(form, 'getlist') else []
    selected = []
    for value in ids[:10]:
        service = row('SELECT id,title_en FROM services WHERE id=? AND published=1 AND archived_at IS NULL', (integer(value),))
        if not service:
            raise ValueError('A selected service is no longer available for requests.')
        selected.append(service)
    notes = form.get('notes', '').strip()
    if kind == 'combined' and (form.get('check_in') or form.get('check_out')):
        check_in = scheduled(form.get('check_in'), 'Check-in date')
        check_out = scheduled(form.get('check_out'), 'Check-out date')
        if check_out <= check_in:
            raise ValueError('Check-out must be after check-in.')
        notes = f"Stay requested: {local(check_in)[:10]} to {local(check_out)[:10]}.\n" + notes
    if selected:
        notes = 'Requested: ' + ', '.join(s['title_en'] for s in selected) + '\n' + notes
    data = dict(kind=kind, name=required(form.get('name'), 'Name', 150), phone=phone, email=email,
                starts_at=start, ends_at=end, party_size=integer(form.get('party_size'), 'Guests', 1, 100),
                pickup=form.get('pickup', '')[:500], destination=form.get('destination', '')[:500],
                luggage=form.get('luggage', '')[:500], notes=notes[:4000], source=source, language=g.lang,
                service_id=selected[0]['id'] if selected else None,
                idempotency_key=form.get('request_key') or secrets.token_urlsafe(24))
    if kind == 'taxi' and (not data['pickup'].strip() or not data['destination'].strip()):
        raise ValueError('Pickup and destination are required for a taxi.')
    return data


def save_image(upload):
    if not upload or not upload.filename:
        return None
    content = upload.read(6 * 1024 * 1024 + 1)
    if len(content) > 6 * 1024 * 1024:
        raise ValueError('Photos must be 6 MB or smaller; use a compressed image.')
    if content.startswith(b'\xff\xd8\xff'):
        suffix = '.jpg'
    elif content.startswith(b'\x89PNG\r\n\x1a\n'):
        suffix = '.png'
    elif content[:4] == b'RIFF' and content[8:12] == b'WEBP':
        suffix = '.webp'
    else:
        raise ValueError('Upload a JPEG, PNG or WebP photo.')
    name = secrets.token_hex(16) + suffix
    (Path(current_app.config['MEDIA_DIR']) / name).write_bytes(content)
    return '/media/' + name


def register_routes(app):
    app.jinja_env.filters['localtime'] = local
    app.jinja_env.filters['localinput'] = local_input
    app.jinja_env.filters['money'] = lambda n: f'{(n or 0) / 100:,.2f}'

    @app.before_request
    def prepare():
        g.lang = request.args.get('lang', session.get('lang', 'en'))
        if g.lang not in ('en', 'ka'):
            g.lang = 'en'
        session['lang'] = g.lang
        g.user = row('SELECT id,email,role,password_hash FROM users WHERE id=? AND active=1', (session.get('user_id'),)) if session.get('user_id') else None
        if g.user and not hmac.compare_digest(session.get('credential_fingerprint', ''), hashlib.sha256(g.user['password_hash'].encode()).hexdigest()):
            session.pop('user_id', None)
            g.user = None
        if g.user and app.config['REQUIRE_TOTP'] and session.get('auth_factor') != 'totp':
            session.pop('user_id', None)
            g.user = None
        if request.method == 'POST':
            validate_csrf()
        if request.endpoint != 'static' and not request.path.startswith('/media/'):
            domain.expire_holds(get_db())

    @app.context_processor
    def context():
        data = settings_data()
        return dict(settings=data, destination_slides=get_destination_slides(data),
                    lang=g.get('lang', 'en'), user=g.get('user'),
                    csrf_token=csrf_token, tr=lambda en, ka: ka if g.get('lang') == 'ka' else en)

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        if request.path.startswith(('/admin', '/booking')):
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        if request.is_secure:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(429)
    def handle_error(error):
        return render_template('error.html', code=error.code, message=error.description), error.code

    @app.errorhandler(500)
    def internal_error(error):
        return render_template('error.html', code=500, message='Something went wrong. Please try again or contact the host.'), 500

    @app.get('/health')
    def health():
        get_db().execute('SELECT 1')
        return {'status': 'ok'}

    @app.get('/media/<filename>')
    def media(filename):
        if not re.fullmatch(r'[a-f0-9]{32}\.(jpg|png|webp)', filename):
            abort(404)
        return send_from_directory(app.config['MEDIA_DIR'], filename, max_age=86400)

    @app.get('/')
    def home():
        return render_template('home.html', services=rows('SELECT * FROM services WHERE published=1 AND archived_at IS NULL ORDER BY id DESC LIMIT 6'))

    @app.get('/services')
    def services():
        kind = request.args.get('kind', '')
        if kind not in {'', 'tour', 'stay', 'taxi'}:
            abort(400, description='Choose a valid service type.')
        region = request.args.get('region', '').strip()
        activity = request.args.get('activity', '').strip()
        duration = request.args.get('duration', '')
        month = request.args.get('month', '')
        if len(region) > 150 or len(activity) > 100 or duration not in {'', 'day', 'multi'}:
            abort(400, description='Choose valid catalogue filters.')
        if month and not re.fullmatch(r'(?:[1-9]|1[0-2])', month):
            abort(400, description='Choose a month between 1 and 12.')
        query = 'SELECT * FROM services WHERE published=1 AND archived_at IS NULL'
        params = []
        if kind:
            query += ' AND kind=?'
            params.append(kind)
        for field, value in (('region', region), ('activity', activity)):
            if value:
                query += f' AND {field}=?'
                params.append(value)
        if duration:
            query += ' AND duration_days=1' if duration == 'day' else ' AND duration_days>1'
        if month:
            query += " AND instr(',' || season_months || ',',?)>0"
            params.append(',' + month + ',')
        data = rows(query + ' ORDER BY id DESC', params)
        regions = [record['region'] for record in rows("SELECT DISTINCT region FROM services WHERE published=1 AND archived_at IS NULL AND region<>'' ORDER BY region")]
        activities = [record['activity'] for record in rows("SELECT DISTINCT activity FROM services WHERE published=1 AND archived_at IS NULL AND activity<>'' ORDER BY activity")]
        return render_template('services.html', services=data, kind=kind,
                               selected_region=region, selected_activity=activity,
                               selected_duration=duration, selected_month=month,
                               regions=regions, activities=activities,
                               region_choices=regions, activity_choices=activities,
                               month_choices=MONTH_CHOICES)

    @app.get('/services/<int:service_id>')
    def service(service_id):
        item = row('SELECT * FROM services WHERE id=? AND published=1 AND archived_at IS NULL', (service_id,))
        if not item:
            abort(404)
        return render_template('service.html', service=item)

    @app.get('/about')
    @app.get('/privacy')
    @app.get('/terms')
    def info():
        return render_template('info.html', page=request.path[1:])

    @app.route('/request', methods=['GET', 'POST'])
    def enquiry_request():
        error = None
        if request.method == 'POST':
            try:
                key = request.form.get('request_key', '')
                previous = session.get('last_request', {})
                if previous.get('key') == key and previous.get('token'):
                    return redirect('/booking/' + previous['token'])
                if key != session.get('request_key'):
                    raise ValueError('This request form has expired. Refresh and try again.')
                if request.form.get('website'):
                    raise ValueError('The request could not be accepted.')
                if not rate_limit(get_db(), 'request:' + (request.remote_addr or ''), 8, 3600, app.secret_key):
                    abort(429, description='Too many requests. Please contact the host or try again later.')
                if request.form.get('privacy_consent') != 'on':
                    raise ValueError('Please acknowledge how your contact details will be used.')
                data = enquiry_input(request.form)
                token = hmac.new(app.secret_key.encode(), ('guest:' + key).encode(), hashlib.sha256).hexdigest()
                data['guest_token'] = token
                if not settings_data().get('privacy_notice', '').strip():
                    raise ValueError('Online requests are not open yet. The host needs to publish contact and privacy information.')
                result = domain.create_enquiry(get_db(), data)
                if result['token_hash'] != hashlib.sha256(token.encode()).hexdigest():
                    raise ValueError('This request was already received. Use your saved private link or contact the host.')
                session['last_request'] = {'key': key, 'token': token}
                session.pop('request_key', None)
                return redirect('/booking/' + token)
            except (ValueError, sqlite3.IntegrityError) as exc:
                error = str(exc) if isinstance(exc, ValueError) else 'This request was already received. Please use your saved private link.'
        session.setdefault('request_key', secrets.token_urlsafe(24))
        return render_template('request.html', services=rows('SELECT * FROM services WHERE published=1 AND archived_at IS NULL'),
                               selected_service_id=request.args.get('service_id', type=int),
                               request_key=session['request_key'], form=request.form, error=error), (400 if error else 200)

    @app.get('/booking/<token>')
    def status(token):
        e = guest_enquiry(token)
        q = row('SELECT * FROM quotes WHERE enquiry_id=? ORDER BY version DESC LIMIT 1', (e['id'],))
        b = row('SELECT * FROM bookings WHERE enquiry_id=? ORDER BY id DESC LIMIT 1', (e['id'],))
        items = rows('SELECT * FROM quote_items WHERE quote_id=?', (q['id'],)) if q else []
        payments = rows('SELECT * FROM payments WHERE quote_id=?', (q['id'],)) if q else []
        assignments = rows("SELECT a.status,a.note,r.name AS driver_name,v.name AS vehicle_name,v.details AS vehicle_details FROM assignments a JOIN resources r ON r.id=a.driver_resource_id JOIN resources v ON v.id=a.vehicle_resource_id WHERE a.quote_id=? ORDER BY a.id DESC", (q['id'],)) if q else []
        e.update(contact=e['phone'], start_local=local(e['starts_at']), end_local=local(e['ends_at']),
                 check_in=local(e['starts_at'])[:10], check_out=local(e['ends_at'])[:10])
        for item in items:
            item.update(amount_minor=item['total_minor'], start_local=local(item['starts_at']), end_local=local(item['ends_at']))
        if q:
            q.update(deposit_minor=q['deposit_required_minor'], policy_text=q['terms'])
        paid = sum((-1 if p['kind'] == 'refund' else 1) * p['amount_minor'] for p in payments if p['verified'] and not p.get('voided'))
        whatsapp_url, whatsapp_prefilled = whatsapp_contact(settings_data(),
            f"Hello, my request reference is {e['reference']}. Please help with my {e['kind']} request.")
        return render_template('status.html', enquiry=e, quote=q, items=items, booking=b, payments=payments,
                               assignments=assignments, balance_minor=max(0, (q['total_minor'] if q else 0) - paid),
                               paid_minor=paid, whatsapp_url=whatsapp_url, whatsapp_prefilled=whatsapp_prefilled, token=token)

    @app.post('/booking/<token>/accept')
    def accept(token):
        e = guest_enquiry(token)
        q = row('SELECT * FROM quotes WHERE enquiry_id=? ORDER BY version DESC LIMIT 1', (e['id'],))
        try:
            if not q or request.form.get('quote_id') != str(q['id']):
                raise ValueError('Your quote has changed. Please review the latest version before accepting.')
            if request.form.get('accepted_terms') != 'on':
                raise ValueError('Read and accept the quote terms before continuing.')
            domain.accept_quote(get_db(), q['id'], evidence='Accepted through private guest link')
            flash('Quote accepted. Your booking still needs the host’s final confirmation.', 'success')
        except ValueError as exc:
            flash(str(exc), 'error')
        return redirect('/booking/' + token)

    @app.post('/booking/<token>/message')
    def guest_message(token):
        e = guest_enquiry(token)
        try:
            if not rate_limit(get_db(), f"message:{e['id']}", 10, 3600, app.secret_key):
                abort(429)
            kind = 'cancellation' if request.form.get('kind') in ('cancel', 'cancellation') else 'change'
            domain.request_change(get_db(), e['id'], required(request.form.get('message'), 'Message', 2000), kind=kind)
            flash('Your request has been recorded for the host to review. Existing arrangements remain in place until the host responds.', 'success')
        except ValueError as exc:
            flash(str(exc), 'error')
        return redirect('/booking/' + token)

    @app.route('/admin/login', methods=['GET', 'POST'])
    def login():
        error = None
        if request.method == 'POST':
            email = request.form.get('email', '').strip().lower()[:254]
            allowed = rate_limit(get_db(), 'login-ip:' + (request.remote_addr or ''), 30, 900, app.secret_key)
            allowed = rate_limit(get_db(), 'login-user:' + email, 8, 900, app.secret_key) and allowed
            if not allowed:
                abort(429, description='Too many sign-in attempts. Try again in 15 minutes.')
            user = row('SELECT * FROM users WHERE email=? AND active=1', (email,))
            valid = user and check_password(user['password_hash'], request.form.get('password', ''))
            authenticated = bool(valid)
            if valid and app.config['REQUIRE_TOTP']:
                step = verify_totp(user['totp_secret'], request.form.get('otp', ''), user['totp_last_step']) if user['totp_secret'] else None
                authenticated = False
                if step is not None:
                    authenticated = bool(get_db().execute('UPDATE users SET totp_last_step=? WHERE id=? AND (totp_last_step IS NULL OR totp_last_step<?)', (step, user['id'], step)).rowcount)
            if authenticated:
                session.clear()
                session['user_id'] = user['id']
                session['credential_fingerprint'] = hashlib.sha256(user['password_hash'].encode()).hexdigest()
                session['auth_factor'] = 'totp' if app.config['REQUIRE_TOTP'] else 'password'
                session.permanent = True
                g.user = user
                audit('login', 'user', user['id'])
                return redirect('/admin')
            error = 'Email, password or authenticator code is incorrect.' if app.config['REQUIRE_TOTP'] else 'Email or password is incorrect.'
        return render_template('login.html', error=error), (401 if error else 200)

    @app.post('/admin/logout')
    @staff()
    def logout():
        session.clear()
        return redirect('/')

    register_admin(app)



def atomic_post(func):
    @wraps(func)
    def wrapped(*args, **kwargs):
        if request.method != 'POST':
            return func(*args, **kwargs)
        conn = get_db()
        conn.execute('BEGIN IMMEDIATE')
        try:
            result = func(*args, **kwargs)
            conn.commit()
            return result
        except Exception:
            conn.rollback()
            raise
    return wrapped


def quote_input(e):
    f = request.form
    items = []
    field = lambda key, i, default='': f.getlist(key)[i] if i < len(f.getlist(key)) else default
    index_map = {}
    for i, title in enumerate(f.getlist('item_title')[:30]):
        if not title.strip():
            continue
        kind = field('item_kind', i, e['kind'])
        if kind not in {'tour', 'stay', 'taxi'}:
            raise ValueError('Choose tour, stay or taxi for each quote item.')
        service_id = field('item_service_id', i)
        index_map[i] = len(items)
        items.append(dict(title=required(title, 'Item title', 200), kind=kind,
                          service_id=integer(service_id) if service_id else None,
                          quantity=integer(field('item_quantity', i, '1'), 'Quantity', 1, 1000),
                          unit_price_minor=money(field('item_price', i), 'Item price'),
                          starts_at=scheduled(field('item_start', i) or e['starts_at']),
                          ends_at=scheduled(field('item_end', i) or e['ends_at']),
                          inclusions=field('item_inclusions', i)[:4000]))
    allocations = []
    for i, value in enumerate(f.getlist('allocation_resource')[:50]):
        if not value.strip():
            continue
        original = integer(field('allocation_item', i, '0'), 'Item index', 0, 29)
        if original not in index_map:
            raise ValueError('Each resource allocation must refer to a filled quote item. The first item is 0.')
        item_index = index_map[original]
        allocations.append(dict(resource_id=integer(value), item_index=item_index,
                                starts_at=scheduled(field('allocation_start', i) or items[item_index]['starts_at']),
                                ends_at=scheduled(field('allocation_end', i) or items[item_index]['ends_at']),
                                quantity=integer(field('allocation_quantity', i, '1'), 'Resource units', 1, 1000)))
    currency = f.get('currency', 'GEL').strip().upper()
    if not re.fullmatch('[A-Z]{3}', currency):
        raise ValueError('Use a three-letter currency code, for example GEL.')
    return dict(items=items, allocations=allocations, currency=currency,
                expires_at=scheduled(f.get('expires_local'), 'Quote expiry'),
                deposit_required_minor=money(f.get('deposit'), 'Deposit'),
                terms=required(f.get('terms'), 'Quote and cancellation terms', 20000),
                policy_version=required(f.get('policy_version'), 'Policy version', 100))


def register_admin(app):
    @app.get('/admin')
    @staff()
    def admin():
        query = '''SELECT e.*,q.status AS quote_status,b.status AS booking_status FROM enquiries e
        LEFT JOIN quotes q ON q.id=(SELECT id FROM quotes WHERE enquiry_id=e.id ORDER BY version DESC LIMIT 1)
        LEFT JOIN bookings b ON b.id=(SELECT id FROM bookings WHERE enquiry_id=e.id ORDER BY id DESC LIMIT 1)
        WHERE 1=1'''
        params = []
        search = request.args.get('q', '').strip()[:150]
        if search:
            query += ' AND (e.reference LIKE ? OR e.name LIKE ? OR e.phone LIKE ?)'
            params += ['%' + search + '%'] * 3
        state = request.args.get('status', '')
        if state in ('new', 'reviewed', 'closed'):
            query += ' AND e.status=?'
            params.append(state)
        date = request.args.get('date', '')
        if date:
            try:
                start = scheduled(date)
                end = scheduled((datetime.fromisoformat(date) + timedelta(days=1)).isoformat())
                query += ' AND e.starts_at<? AND e.ends_at>?'
                params += [end, start]
            except ValueError:
                flash('Use a valid calendar date.', 'error')
        enquiries = rows(query + ' ORDER BY e.created_at DESC LIMIT 200', params)
        stats = dict(new=row("SELECT COUNT(*) AS n FROM enquiries WHERE status='new'")['n'],
                     confirmed=row("SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed'")['n'],
                     expiring=row("SELECT COUNT(*) AS n FROM quotes WHERE status IN ('offered','accepted') AND expires_at<?", ((datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(timespec='seconds').replace('+00:00','Z'),))['n'],
                     due_minor=0)
        balances = rows('''SELECT q.currency,SUM(q.total_minor - COALESCE(p.paid,0)) AS amount_minor FROM quotes q
           JOIN bookings b ON b.quote_id=q.id AND b.status='confirmed'
           LEFT JOIN (SELECT quote_id,SUM(CASE WHEN kind='refund' THEN -amount_minor ELSE amount_minor END) AS paid
                      FROM payments WHERE verified=1 GROUP BY quote_id) p ON p.quote_id=q.id GROUP BY q.currency''')
        stats['due_minor'] = sum(b['amount_minor'] for b in balances if b['currency'] == 'GEL')
        reminders = rows("SELECT r.*,e.reference FROM reminders r JOIN enquiries e ON e.id=r.enquiry_id WHERE r.status='due' ORDER BY due_at LIMIT 100")
        changes = rows("SELECT c.*,e.reference FROM change_requests c JOIN enquiries e ON e.id=c.enquiry_id WHERE c.status='open' ORDER BY created_at")
        allocations = rows('''SELECT a.*,r.name AS resource_name,e.reference,e.id AS enquiry_id,q.status FROM allocations a
            JOIN resources r ON r.id=a.resource_id JOIN quotes q ON q.id=a.quote_id JOIN enquiries e ON e.id=q.enquiry_id
            LEFT JOIN bookings b ON b.quote_id=q.id
            WHERE ((q.status IN ('offered','accepted') AND q.expires_at>?) OR b.status='confirmed') AND a.ends_at>?
            ORDER BY a.starts_at LIMIT 100''', (now_iso(), now_iso()))
        return render_template('admin_dashboard.html', enquiries=enquiries, stats=stats, reminders=reminders,
                               change_requests=changes, allocations=allocations, balances=balances)

    @app.route('/admin/manual', methods=['GET','POST'])
    @staff()
    def manual():
        error = None
        if request.method == 'POST':
            try:
                source = request.form.get('source', 'phone')
                if source not in ('phone','whatsapp','walk_in'):
                    raise ValueError('Choose a valid request source.')
                e = domain.create_enquiry(get_db(), enquiry_input(request.form, source), actor_id=g.user['id'])
                if e.get('guest_token'):
                    session['share'] = {'enquiry_id':e['id'], 'token':e['guest_token']}
                return redirect(f"/admin/enquiries/{e['id']}")
            except ValueError as exc:
                error = str(exc)
        return render_template('admin_manual.html', error=error, form=request.form,
                               services=rows('SELECT * FROM services WHERE published=1 AND archived_at IS NULL'), request_key=secrets.token_urlsafe(24)), (400 if error else 200)

    @app.get('/admin/enquiries/<int:identifier>')
    @staff()
    def admin_enquiry(identifier):
        e = row('SELECT * FROM enquiries WHERE id=?', (identifier,))
        if not e:
            abort(404)
        quotes = rows('SELECT * FROM quotes WHERE enquiry_id=? ORDER BY version DESC', (identifier,))
        q = domain.get_quote(get_db(), quotes[0]['id']) if quotes else None
        bookings = rows('SELECT * FROM bookings WHERE enquiry_id=? ORDER BY id DESC', (identifier,))
        booking = bookings[0] if bookings else None
        items = rows('SELECT * FROM quote_items WHERE quote_id=?', (q['id'],)) if q else []
        allocations = rows('SELECT a.*,r.name AS resource_name FROM allocations a JOIN resources r ON r.id=a.resource_id WHERE a.quote_id=?', (q['id'],)) if q else []
        payments = rows('SELECT * FROM payments WHERE quote_id=? ORDER BY id DESC', (q['id'],)) if q else []
        assignments = rows('''SELECT a.*,r.name AS driver_name,v.name AS vehicle_name FROM assignments a
            JOIN resources r ON r.id=a.driver_resource_id JOIN resources v ON v.id=a.vehicle_resource_id
            WHERE a.quote_id=? ORDER BY a.id DESC''', (q['id'],)) if q else []
        share = session.get('share', {})
        share_url = url_for('status', token=share['token'], _external=True) if share.get('enquiry_id') == identifier else None
        history = rows("SELECT a.*,u.email AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE (entity_type='enquiry' AND entity_id=?) OR (entity_type='quote' AND entity_id IN (SELECT id FROM quotes WHERE enquiry_id=?)) OR (entity_type='booking' AND entity_id IN (SELECT id FROM bookings WHERE enquiry_id=?)) ORDER BY a.id DESC LIMIT 100", (identifier,identifier,identifier))
        duplicates = rows('SELECT id,reference,status,starts_at FROM enquiries WHERE phone=? AND id<>? ORDER BY created_at DESC LIMIT 10', (e['phone'],identifier))
        return render_template('admin_enquiry.html', e=e, duplicates=duplicates, quotes=quotes, quote=q, q=q, items=items,
                               allocations=allocations, bookings=bookings, booking=booking, payments=payments,
                               assignments=assignments, resources=rows('SELECT * FROM resources WHERE active=1 ORDER BY kind,name'),
                               services=rows('SELECT * FROM services WHERE archived_at IS NULL ORDER BY title_en'), history=history,
                               changes=rows('SELECT * FROM change_requests WHERE enquiry_id=? ORDER BY id DESC', (identifier,)),
                               share_url=share_url,
                               default_expiry=local_input((datetime.now(timezone.utc)+timedelta(hours=24)).isoformat()))

    @app.post('/admin/enquiries/<int:identifier>/<action>')
    @staff()
    def admin_action(identifier, action):
        e = row('SELECT * FROM enquiries WHERE id=?', (identifier,))
        if not e:
            abort(404)
        q = row('SELECT * FROM quotes WHERE enquiry_id=? ORDER BY version DESC LIMIT 1', (identifier,))
        b = row('SELECT * FROM bookings WHERE enquiry_id=? ORDER BY id DESC LIMIT 1', (identifier,))
        actor = g.user['id']
        f = request.form
        try:
            quote_actions = {'quote','accept','confirm','assign','accept-driver','assignment','payment','verify-payment','void-payment','cancel','outcome'}
            if action in quote_actions and q and f.get('quote_id') != str(q['id']):
                raise ValueError('This quote changed since you opened the page. Review the current version and try again.')
            if action == 'verify':
                domain.verify_contact(get_db(), identifier, required(f.get('evidence'), 'Two-way contact evidence', 2000), actor_id=actor)
            elif action == 'quote':
                data = quote_input(e)
                if q and q['status'] in ('offered','accepted'):
                    domain.replace_quote(get_db(), q['id'], data, actor_id=actor)
                else:
                    domain.create_quote(get_db(), identifier, data, actor_id=actor)
            elif action == 'link':
                token = secrets.token_urlsafe(32)
                expiry = (datetime.now(timezone.utc)+timedelta(days=180)).isoformat(timespec='seconds').replace('+00:00','Z')
                get_db().execute('UPDATE enquiries SET token_hash=?,token_expires_at=? WHERE id=?', (hashlib.sha256(token.encode()).hexdigest(),expiry,identifier))
                session['share'] = {'enquiry_id':identifier,'token':token}
                audit('guest_link_rotated', 'enquiry', identifier)
            elif action == 'reminder':
                get_db().execute('INSERT INTO reminders(enquiry_id,due_at,message) VALUES (?,?,?)', (identifier,scheduled(f.get('due_local')),required(f.get('message'),'Reminder',2000)))
                audit('reminder_added','enquiry',identifier)
            elif action == 'resolve-change':
                state = f.get('status')
                if state not in ('resolved','declined'):
                    raise ValueError('Choose a valid resolution.')
                get_db().execute('UPDATE change_requests SET status=?,resolved_at=? WHERE id=? AND enquiry_id=?', (state,now_iso(),integer(f.get('change_id')),identifier))
                audit('change_'+state,'enquiry',identifier)
            elif action == 'close':
                if (q and q['status'] in ('offered','accepted')) or (b and b['status'] == 'confirmed'):
                    raise ValueError('Resolve the active quote or booking before closing this enquiry.')
                get_db().execute("UPDATE enquiries SET status='closed',updated_at=? WHERE id=?", (now_iso(),identifier))
                audit('closed','enquiry',identifier)
            else:
                if not q:
                    raise ValueError('Create a quote first.')
                if action == 'accept':
                    domain.accept_quote(get_db(),q['id'],evidence=required(f.get('evidence'),'Guest acceptance evidence',2000),actor_id=actor)
                elif action == 'confirm':
                    domain.confirm_booking(get_db(),q['id'],actor_id=actor)
                elif action == 'assign':
                    domain.assign_driver(get_db(),q['id'],integer(f.get('driver_resource_id')),integer(f.get('vehicle_resource_id')),actor_id=actor)
                elif action in ('accept-driver','assignment'):
                    assignment_id=integer(f.get('assignment_id'))
                    if not row('SELECT id FROM assignments WHERE id=? AND quote_id=?',(assignment_id,q['id'])):
                        abort(404)
                    if action=='accept-driver':
                        domain.accept_assignment(get_db(),assignment_id,required(f.get('evidence'),'Driver acceptance evidence',2000),actor_id=actor)
                    else:
                        domain.mark_assignment(get_db(),assignment_id,f.get('status'),required(f.get('note'),'Dispatch update reason',2000),actor_id=actor)
                elif action=='payment':
                    if g.user['role']!='owner': abort(403)
                    kind=f.get('kind')
                    if kind not in ('deposit','balance','refund'): raise ValueError('Choose a valid payment kind.')
                    domain.record_payment(get_db(),q['id'],money(f.get('amount')),kind=kind,
                                          method=required(f.get('method'),'Payment method',100),
                                          reference=required(f.get('reference'),'Receipt or transaction reference',200),verified=False,actor_id=actor)
                elif action in ('verify-payment','void-payment'):
                    if g.user['role']!='owner': abort(403)
                    payment_id=integer(f.get('payment_id'))
                    if not row('SELECT id FROM payments WHERE id=? AND quote_id=?',(payment_id,q['id'])): abort(404)
                    operation = domain.verify_payment if action == 'verify-payment' else domain.void_payment
                    operation(get_db(),payment_id,required(f.get('evidence'),'Payment review evidence',2000),actor_id=actor)
                elif action=='cancel':
                    reason = required(f.get('reason'),'Cancellation reason',2000)
                    if b and b['status'] == 'confirmed':
                        domain.cancel_booking(get_db(),b['id'],reason,actor_id=actor)
                    else:
                        domain.cancel_quote(get_db(),q['id'],reason,actor_id=actor)
                elif action=='outcome':
                    if not b: raise ValueError('There is no booking to complete.')
                    domain.close_booking(get_db(),b['id'],f.get('status'),actor_id=actor)
                else:
                    abort(404)
            flash('Saved. Review the current status below.', 'success')
        except ValueError as exc:
            flash(str(exc),'error')
        return redirect(f'/admin/enquiries/{identifier}')

    @app.post('/admin/reminders/<int:identifier>/done')
    @staff()
    def reminder_done(identifier):
        get_db().execute("UPDATE reminders SET status='done',completed_at=? WHERE id=?", (now_iso(),identifier))
        audit('reminder_done','reminder',identifier)
        return redirect('/admin')

    @app.route('/admin/services', methods=['GET','POST'])
    @staff(owner=True)
    @atomic_post
    def admin_services():
        if request.method == 'POST':
            f = request.form
            identifier = None
            old = None
            try:
                identifier = integer(f.get('id')) if f.get('id') else None
                old = row('SELECT * FROM services WHERE id=?', (identifier,)) if identifier else None
                if identifier and not old:
                    abort(404)
                action = f.get('action', 'save')
                if action in {'publish', 'unpublish', 'delete', 'restore'}:
                    if not old:
                        raise ValueError('Choose an existing service first.')
                    if action == 'delete':
                        if f.get('confirm_delete') != 'on':
                            raise ValueError('Confirm deletion of this service. Existing enquiry and quote records will be kept.')
                        get_db().execute('UPDATE services SET archived_at=COALESCE(archived_at,?),published=0,updated_at=? WHERE id=?',
                                         (now_iso(), now_iso(), identifier))
                    elif action == 'restore':
                        get_db().execute('UPDATE services SET archived_at=NULL,published=0,updated_at=? WHERE id=?', (now_iso(), identifier))
                    else:
                        if old['archived_at']:
                            raise ValueError('Restore the deleted service before changing its publication status.')
                        get_db().execute('UPDATE services SET published=?,updated_at=? WHERE id=?',
                                         (int(action == 'publish'), now_iso(), identifier))
                    audit('service_' + action, 'service', identifier)
                    flash({'publish': 'Service published.', 'unpublish': 'Service disabled and saved as a draft.',
                           'delete': 'Service deleted from the catalogue. Enquiries and quotes are preserved.',
                           'restore': 'Service restored as a draft.'}[action], 'success')
                    return redirect('/admin/services?status=' + ('deleted' if action == 'delete' else 'all'))
                if action not in {'save', 'create', 'update'}:
                    raise ValueError('Choose a valid catalogue action.')
                if old and old['archived_at']:
                    raise ValueError('Restore the deleted service before editing it.')
                previous = old or {}
                # Partial submissions must never silently clear an owner's saved content.
                value = lambda key, default='': f.get(key, previous.get(key, default))
                kind = value('kind', 'tour')
                if kind not in ('tour', 'stay', 'taxi'):
                    raise ValueError('Choose a valid service kind.')
                provider = integer(value('provider_id', '1'))
                provider_row = row('SELECT id,active FROM providers WHERE id=?', (provider,))
                if not provider_row or (not provider_row['active'] and provider != previous.get('provider_id')):
                    raise ValueError('Choose an active provider.')
                currency = value('currency', 'GEL').strip().upper()
                if not re.fullmatch('[A-Z]{3}', currency):
                    raise ValueError('Use a three-letter currency code.')
                data = dict(provider_id=provider, kind=kind, currency=currency)
                for key, limit in SERVICE_TEXT_FIELDS.items():
                    text = str(value(key) or '').strip()
                    if len(text) > limit:
                        raise ValueError(f'{key.replace("_", " ").capitalize()} must be at most {limit} characters.')
                    data[key] = text
                data['title_en'] = required(data['title_en'], 'English title', 200)
                slug = str(value('slug') or '').strip()
                if not slug:
                    slug = (re.sub('[^a-z0-9]+', '-', data['title_en'].lower()).strip('-')[:70] or 'service') + '-' + secrets.token_hex(3)
                if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or len(slug) > 120:
                    raise ValueError('Slug must be at most 120 lowercase letters, numbers and separating hyphens.')
                if row('SELECT id FROM services WHERE slug=? AND id<>?', (slug, identifier or 0)):
                    raise ValueError('That slug is already used by another service.')
                data['slug'] = slug
                data['price_minor'] = (money(f.get('price')) if f.get('price', '').strip() else None) if 'price' in f else previous.get('price_minor')
                for key, label, maximum in (('capacity', 'Capacity', 1000), ('duration_days', 'Duration in days', 365)):
                    number = value(key)
                    data[key] = integer(number, label, 1, maximum) if number not in ('', None) else None
                data['season_months'] = season_months(f.getlist('season_months') if 'season_months' in f or 'season_months_present' in f else previous.get('season_months', ''))
                data['research_sources'] = research_sources(value('research_sources'))
                data['research_checked'] = research_checked(value('research_checked'))
                data['published'] = int(f.get('published') == 'on') if 'published' in f or 'published_present' in f else previous.get('published', 0)
                data['image_path'] = previous.get('image_path', '')
                data['photo_url'] = previous.get('photo_url', '')
                if f.get('remove_photo') == 'on':
                    data['image_path'] = data['photo_url'] = ''
                uploaded = save_image(request.files.get('photo'))
                if uploaded:
                    data['image_path'] = uploaded
                    data['photo_url'] = ''
                if identifier:
                    get_db().execute('UPDATE services SET ' + ','.join(k + '=?' for k in data) + ',updated_at=? WHERE id=?',
                                     (*data.values(), now_iso(), identifier))
                else:
                    identifier = get_db().execute('INSERT INTO services(' + ','.join(data) + ') VALUES (' + ','.join('?' for _ in data) + ')', tuple(data.values())).lastrowid
                audit('service_saved', 'service', identifier)
                flash('Service saved.', 'success')
                return redirect(f'/admin/services/{identifier}/edit')
            except ValueError as exc:
                submitted = dict(old or {})
                submitted.update(f.to_dict())
                if 'season_months_present' in f:
                    submitted['season_months'] = ','.join(f.getlist('season_months'))
                if 'published_present' in f:
                    submitted['published'] = int(f.get('published') == 'on')
                if identifier:
                    submitted['id'] = identifier
                return render_template('admin_service_edit.html', service=submitted,
                                       providers=rows('SELECT * FROM providers ORDER BY active DESC,name'),
                                       month_choices=MONTH_CHOICES, error=str(exc), form=f), 400
        status = request.args.get('status', 'all')
        conditions = {'all': 'archived_at IS NULL', 'published': 'archived_at IS NULL AND published=1',
                      'draft': 'archived_at IS NULL AND published=0', 'deleted': 'archived_at IS NOT NULL'}
        if status not in conditions:
            abort(400, description='Choose all, published, draft or deleted services.')
        return render_template('admin_services.html', services=rows('SELECT * FROM services WHERE ' + conditions[status] + ' ORDER BY id DESC'),
                               selected_status=status, providers=rows('SELECT * FROM providers WHERE active=1'))

    @app.get('/admin/services/new')
    @app.get('/admin/services/<int:identifier>/edit')
    @staff(owner=True)
    def admin_service_edit(identifier=None):
        item = row('SELECT * FROM services WHERE id=?', (identifier,)) if identifier else {}
        if identifier and not item:
            abort(404)
        return render_template('admin_service_edit.html', service=item,
                               providers=rows('SELECT * FROM providers ORDER BY active DESC,name'),
                               month_choices=MONTH_CHOICES, error=None, form={})

    @app.get('/admin/services/<int:identifier>/preview')
    @staff(owner=True)
    def admin_service_preview(identifier):
        item = row('SELECT * FROM services WHERE id=?', (identifier,))
        if not item:
            abort(404)
        return render_template('service.html', service=item, preview=True)

    @app.route('/admin/resources', methods=['GET','POST'])
    @staff()
    @atomic_post
    def admin_resources():
        if request.method=='POST':
            if g.user['role']!='owner': abort(403)
            try:
                f=request.form
                action=f.get('action','save')
                if action=='block':
                    domain.block_resource(get_db(),integer(f.get('resource_id')),scheduled(f.get('start_local')),scheduled(f.get('end_local')),required(f.get('reason'),'Block reason',2000),actor_id=g.user['id'])
                elif action=='unblock':
                    identifier=integer(f.get('block_id'))
                    get_db().execute('DELETE FROM availability_blocks WHERE id=?',(identifier,))
                    audit('availability_unblocked','resource_block',identifier)
                elif action=='save':
                    identifier=integer(f.get('id')) if f.get('id') else None
                    kind=f.get('kind')
                    if kind not in ('room','guide','driver','vehicle','departure'): raise ValueError('Choose a valid resource type.')
                    capacity=integer(f.get('capacity','1'),'Concurrent capacity',1,1000)
                    if kind in ('room','guide','driver','vehicle') and capacity!=1:
                        raise ValueError('Create each room, guide, driver and vehicle separately, with concurrent capacity 1.')
                    provider=integer(f.get('provider_id','1'))
                    if not row('SELECT id FROM providers WHERE id=? AND active=1',(provider,)): raise ValueError('Choose an active provider.')
                    data=dict(name=required(f.get('name'),'Name',200),provider_id=provider,kind=kind,capacity=capacity,
                              passenger_capacity=integer(f.get('passenger_capacity'),'Guest capacity',1,1000) if f.get('passenger_capacity') else None,
                              buffer_minutes=integer(f.get('buffer_minutes','0'),'Travel buffer',0,1440),
                              approved=int(f.get('approved')=='on'),active=int(f.get('active')=='on'),details=f.get('details','')[:2000])
                    data['buffer_before_minutes']=0
                    data['buffer_after_minutes']=0
                    if identifier:
                        old=row('SELECT * FROM resources WHERE id=?',(identifier,))
                        if not old: abort(404)
                        live=row("SELECT a.id FROM allocations a JOIN quotes q ON q.id=a.quote_id LEFT JOIN bookings b ON b.quote_id=q.id WHERE a.resource_id=? AND (q.status IN ('offered','accepted') OR b.status='confirmed') LIMIT 1",(identifier,))
                        protected=('kind','capacity','passenger_capacity','buffer_minutes','approved','active','provider_id')
                        if live and any(data[k]!=old[k] for k in protected):
                            raise ValueError('Resolve or replace this resource’s current holds and bookings before changing capacity, approval or availability settings.')
                        get_db().execute('UPDATE resources SET '+','.join(k+'=?' for k in data)+' WHERE id=?',(*data.values(),identifier))
                    else:
                        identifier=get_db().execute('INSERT INTO resources('+','.join(data)+') VALUES ('+','.join('?' for _ in data)+')',tuple(data.values())).lastrowid
                    audit('resource_saved','resource',identifier)
                else: raise ValueError('Unknown resource action.')
                flash('Availability updated.','success')
            except ValueError as exc:
                flash(str(exc),'error')
            return redirect('/admin/resources')
        return render_template('admin_resources.html',resources=rows('SELECT * FROM resources ORDER BY kind,name'),
                               providers=rows('SELECT * FROM providers WHERE active=1'),
                               blocks=rows('SELECT b.*,r.name AS resource_name FROM availability_blocks b JOIN resources r ON r.id=b.resource_id ORDER BY starts_at'))

    @app.route('/admin/providers',methods=['GET','POST'])
    @staff(owner=True)
    @atomic_post
    def admin_providers():
        if request.method=='POST':
            try:
                f=request.form
                identifier=integer(f.get('id')) if f.get('id') else None
                data=dict(name=required(f.get('name'),'Provider name',200),kind=f.get('kind','driver')[:40],
                          phone=f.get('phone','')[:50],notes=f.get('notes','')[:2000],approved=int(f.get('approved')=='on'),active=int(f.get('active')=='on'))
                if identifier:
                    if not row('SELECT id FROM providers WHERE id=?',(identifier,)): abort(404)
                    old=row('SELECT * FROM providers WHERE id=?',(identifier,))
                    if (old['active']!=data['active'] or old['approved']!=data['approved']) and row("SELECT a.id FROM allocations a JOIN resources r ON r.id=a.resource_id JOIN quotes q ON q.id=a.quote_id LEFT JOIN bookings b ON b.quote_id=q.id WHERE r.provider_id=? AND (q.status IN ('offered','accepted') OR b.status='confirmed') LIMIT 1",(identifier,)):
                        raise ValueError('Resolve this provider’s active commitments before changing approval or active status.')
                    get_db().execute('UPDATE providers SET '+','.join(k+'=?' for k in data)+' WHERE id=?',(*data.values(),identifier))
                else:
                    identifier=get_db().execute('INSERT INTO providers('+','.join(data)+') VALUES ('+','.join('?' for _ in data)+')',tuple(data.values())).lastrowid
                audit('provider_saved','provider',identifier)
                flash('Provider saved.','success')
            except ValueError as exc: flash(str(exc),'error')
            return redirect('/admin/providers')
        return render_template('admin_providers.html',providers=rows('SELECT * FROM providers ORDER BY id'))

    @app.route('/admin/settings',methods=['GET','POST'])
    @staff(owner=True)
    def admin_settings():
        if request.method=='POST':
            try:
                f=request.form
                allowed=['business_name','whatsapp_number','contact_email','address','operating_hours','response_note','about_en','about_ka','booking_terms','privacy_notice','policy_version','whatsapp_link','guesthouse_name','guesthouse_instagram_url','guide_instagram_url']
                current = settings_data()
                values={key:f.get(key,current.get(key,'')).strip()[:20000] for key in allowed}
                required(values['business_name'],'Business name',200)
                if values['whatsapp_number'] and not re.fullmatch(r'[1-9][0-9]{6,14}',values['whatsapp_number']):
                    raise ValueError('WhatsApp number must include country code and digits only, without + or spaces.')
                values['whatsapp_link'] = whatsapp_business_link(values['whatsapp_link'])
                for key in ('guesthouse_instagram_url', 'guide_instagram_url'):
                    values[key] = instagram_profile(values[key])
                for number in range(1, 4):
                    for field in ('title_en', 'title_ka', 'subtitle_en', 'subtitle_ka'):
                        key = f'destination_{field}_{number}'
                        limit = 100 if field.startswith('title') else 240
                        values[key] = f.get(key, current.get(key, '')).strip()[:limit]
                    upload = request.files.get(f'destination_photo_{number}')
                    reset = f.get(f'destination_reset_{number}') == 'on'
                    if reset and upload and upload.filename:
                        raise ValueError(f'Slide {number}: choose a new photo or restore the illustration, not both.')
                    photo = save_image(upload)
                    if photo or reset:
                        values[f'destination_image_{number}'] = photo or ''
                photo=save_image(request.files.get('hero_image'))
                if photo: values['hero_image']=photo
                get_db().execute('BEGIN IMMEDIATE')
                try:
                    get_db().executemany('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',values.items())
                    audit('settings_updated','settings',None)
                    get_db().commit()
                except Exception:
                    get_db().rollback()
                    raise
                flash('Business details saved.','success')
            except ValueError as exc: flash(str(exc),'error')
            return redirect('/admin/settings')
        return render_template('admin_settings.html')

    @app.get('/admin/export')
    @staff(owner=True)
    def export():
        kind=request.args.get('kind','bookings')
        if kind=='payments':
            data=rows('SELECT p.*,q.currency,e.reference AS enquiry_reference FROM payments p JOIN quotes q ON q.id=p.quote_id JOIN enquiries e ON e.id=q.enquiry_id ORDER BY p.id')
        else:
            data=rows('''SELECT b.reference,b.status,e.name,e.phone,e.starts_at,e.ends_at,q.total_minor,q.currency,q.deposit_required_minor,b.confirmed_at
               FROM bookings b JOIN enquiries e ON e.id=b.enquiry_id JOIN quotes q ON q.id=b.quote_id ORDER BY b.id''')
        stream=io.StringIO()
        if data:
            writer=csv.writer(stream)
            writer.writerow(data[0].keys())
            for record in data:
                writer.writerow([("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v) for v in record.values()])
        response=make_response(stream.getvalue())
        response.headers['Content-Type']='text/csv; charset=utf-8'
        response.headers['Content-Disposition']=f'attachment; filename="mestia-{kind if kind in ("payments","bookings") else "bookings"}.csv"'
        audit('exported',kind,None)
        return response
