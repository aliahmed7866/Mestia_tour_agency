"""Booking rules independent of HTTP and templates.

Amounts are integer minor currency units. Naive local inputs use Asia/Tbilisi;
stored schedules use UTC. Quotes are immutable snapshots: revisions create rows.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import re
import secrets
import sqlite3
from zoneinfo import ZoneInfo


class DomainError(ValueError):
    pass


LOCAL_TZ = ZoneInfo('Asia/Tbilisi')


def now():
    return datetime.now(timezone.utc).replace(microsecond=0)


def timestamp(value=None):
    if value is None:
        value = now()
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
        except ValueError:
            raise DomainError('Enter a valid date and time.') from None
    if not isinstance(value, datetime):
        raise DomainError('Enter a valid date and time.')
    if value.tzinfo is None:
        value = value.replace(tzinfo=LOCAL_TZ)
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def _date(value):
    return datetime.fromisoformat(timestamp(value).replace('Z', '+00:00'))


def _interval(start, end):
    if not start or not end:
        raise DomainError('Both start and end dates are required.')
    start, end = timestamp(start), timestamp(end)
    if start >= end:
        raise DomainError('The end must be after the start.')
    return start, end


def _stay_interval(start, end):
    """A stay owns whole local nights, regardless of entered check-in hours."""
    if not start or not end:
        raise DomainError('Both check-in and check-out dates are required.')
    start_date = _date(start).astimezone(LOCAL_TZ).date()
    end_date = _date(end).astimezone(LOCAL_TZ).date()
    return _interval(str(start_date), str(end_date))


def _int(value, name, minimum=0, maximum=1000000000):
    try:
        if isinstance(value, bool) or str(value).strip() != str(int(value)):
            raise ValueError()
        value = int(value)
    except (ValueError, TypeError):
        raise DomainError(f'{name} must be a whole number.') from None
    if not minimum <= value <= maximum:
        raise DomainError(f'{name} must be between {minimum} and {maximum}.')
    return value


def _text(value, name, limit=4000, required=False):
    value = str(value or '').strip()
    if required and not value:
        raise DomainError(f'{name} is required.')
    if len(value) > limit:
        raise DomainError(f'{name} is too long (maximum {limit} characters).')
    return value


def _row(conn, table, identity):
    # table is internal, never user input.
    row = conn.execute(f'SELECT * FROM {table} WHERE id=?', (identity,)).fetchone()
    if row is None:
        raise DomainError(f'{table.rstrip("s").capitalize()} was not found.')
    return dict(row)


@contextmanager
def _transaction(conn):
    nested = conn.in_transaction
    conn.execute('SAVEPOINT domain_operation' if nested else 'BEGIN IMMEDIATE')
    try:
        yield
        conn.execute('RELEASE SAVEPOINT domain_operation' if nested else 'COMMIT')
    except Exception:
        if nested:
            conn.execute('ROLLBACK TO SAVEPOINT domain_operation')
            conn.execute('RELEASE SAVEPOINT domain_operation')
        else:
            conn.execute('ROLLBACK')
        raise


def audit(conn, action, entity_type, entity_id=None, details=None, actor_id=None):
    conn.execute('INSERT INTO audit(actor_id,action,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?)',
                 (actor_id, action, entity_type, entity_id, json.dumps(details or {}, ensure_ascii=False), timestamp()))


def _expire(conn):
    stamp = timestamp()
    expired_quotes = conn.execute("SELECT id FROM quotes WHERE status IN ('offered','accepted') AND expires_at<=?", (stamp,)).fetchall()
    conn.execute("UPDATE quotes SET status='expired' WHERE status IN ('offered','accepted') AND expires_at<=?", (stamp,))
    for quote in expired_quotes:
        audit(conn, 'quote.expired', 'quote', quote['id'])
    stale = conn.execute("SELECT id,quote_id FROM assignments WHERE status='offered' AND expires_at<=?", (stamp,)).fetchall()
    for assignment in stale:
        conn.execute("UPDATE assignments SET status='expired' WHERE id=?", (assignment['id'],))
        conn.execute("DELETE FROM allocations WHERE quote_id=? AND origin='dispatch'", (assignment['quote_id'],))
        conn.execute("UPDATE bookings SET operational_status='needs_attention' WHERE quote_id=? AND status='confirmed'", (assignment['quote_id'],))
        audit(conn, 'assignment.expired', 'assignment', assignment['id'])


def expire_holds(conn):
    with _transaction(conn):
        _expire(conn)


def create_enquiry(conn, data, actor_id=None):
    kind = data.get('kind', 'tour')
    if kind not in ('tour', 'stay', 'taxi', 'combined'):
        raise DomainError('Choose a valid service type.')
    name = _text(data.get('name'), 'Name', 160, True)
    phone = _text(data.get('phone'), 'Phone', 80)
    email = _text(data.get('email'), 'Email', 254)
    if not phone and not email:
        raise DomainError('Provide a phone number or email address.')
    if email and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        raise DomainError('Enter a valid email address.')
    interval = _stay_interval if kind == 'stay' else _interval
    start, end = interval(data.get('starts_at'), data.get('ends_at'))
    party = _int(data.get('party_size', 1), 'Party size', 1, 200)
    service_id = data.get('service_id') or None
    key = _text(data.get('idempotency_key'), 'Submission key', 128) or None
    with _transaction(conn):
        if key:
            existing = conn.execute('SELECT * FROM enquiries WHERE idempotency_key=?', (key,)).fetchone()
            if existing:
                return dict(existing)
        if service_id:
            service = _row(conn, 'services', service_id)
            if not actor_id and not service['published']:
                raise DomainError('This service is not accepting public requests.')
            if kind != 'combined' and service['kind'] != kind:
                raise DomainError('The selected service does not match this request.')
        token = data.get('guest_token') or secrets.token_urlsafe(32)
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
            raise DomainError('The internal guest access token is invalid.')
        reference = 'MT-' + secrets.token_hex(5).upper()
        stamp = timestamp()
        fields = (reference, sha256(token.encode()).hexdigest(), timestamp(now() + timedelta(days=180)), key,
                  kind, service_id, name, email, phone, start, end, party,
                  _text(data.get('pickup'), 'Pickup', 400), _text(data.get('destination'), 'Destination', 400),
                  _text(data.get('luggage'), 'Luggage', 400), _text(data.get('notes'), 'Notes', 4000),
                  _text(data.get('source', 'website'), 'Source', 80), 'ka' if data.get('language') == 'ka' else 'en', stamp, stamp)
        cursor = conn.execute('''INSERT INTO enquiries(reference,token_hash,token_expires_at,idempotency_key,
            kind,service_id,name,email,phone,starts_at,ends_at,party_size,pickup,destination,luggage,notes,source,language,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', fields)
        audit(conn, 'enquiry.created', 'enquiry', cursor.lastrowid, {'source': fields[16]}, actor_id)
        result = _row(conn, 'enquiries', cursor.lastrowid)
        result['guest_token'] = token
        return result


def find_guest_enquiry(conn, token):
    if not isinstance(token, str) or not 20 <= len(token) <= 128:
        return None
    row = conn.execute('SELECT * FROM enquiries WHERE token_hash=? AND token_expires_at>?',
                       (sha256(token.encode()).hexdigest(), timestamp())).fetchone()
    return dict(row) if row else None


def verify_contact(conn, enquiry_id, evidence, actor_id=None):
    evidence = _text(evidence, 'Two-way contact evidence', 2000, True)
    with _transaction(conn):
        _row(conn, 'enquiries', enquiry_id)
        conn.execute('UPDATE enquiries SET contact_verified_at=?,contact_evidence=?,updated_at=? WHERE id=?',
                     (timestamp(), evidence, timestamp(), enquiry_id))
        audit(conn, 'contact.verified', 'enquiry', enquiry_id, {'evidence': evidence}, actor_id)
        return _row(conn, 'enquiries', enquiry_id)


def _resource(conn, resource_id):
    resource = _row(conn, 'resources', resource_id)
    provider = _row(conn, 'providers', resource['provider_id'])
    if not resource['active'] or not resource['approved'] or not provider['active'] or not provider['approved']:
        raise DomainError(f'{resource["name"]} is not active and approved.')
    if resource['kind'] in ('guide', 'driver', 'vehicle') and resource['capacity'] != 1:
        raise DomainError('Guides, drivers and vehicles must each have inventory capacity 1.')
    return resource


def _allocation_intervals(conn, resource_id, exclude_quote_ids=()):
    records = conn.execute('''SELECT a.* FROM allocations a JOIN quotes q ON q.id=a.quote_id
       WHERE a.resource_id=? AND (
       (q.status IN ('offered','accepted') AND q.expires_at>?) OR
       EXISTS(SELECT 1 FROM bookings b WHERE b.quote_id=q.id AND b.status IN ('confirmed','completed','no_show')))
       ''', (resource_id, timestamp())).fetchall()
    return [dict(row) for row in records if row['quote_id'] not in exclude_quote_ids]


def _check_capacity(conn, candidates, exclude_quote_ids=()):
    by_resource = {}
    for allocation in candidates:
        by_resource.setdefault(allocation['resource_id'], []).append(allocation)
    for resource_id, additions in by_resource.items():
        resource = _resource(conn, resource_id)
        before = timedelta(minutes=max(resource['buffer_before_minutes'], resource['buffer_minutes']))
        after = timedelta(minutes=max(resource['buffer_after_minutes'], resource['buffer_minutes']))
        existing = _allocation_intervals(conn, resource_id, exclude_quote_ids)
        blocks = conn.execute('SELECT * FROM availability_blocks WHERE resource_id=?', (resource_id,)).fetchall()
        # Evaluate only the requested windows; pre-existing historical conflicts
        # do not prevent unrelated new work. End events precede start events.
        for addition in additions:
            left, right = _date(addition['starts_at']) - before, _date(addition['ends_at']) + after
            for block in blocks:
                if _date(block['starts_at']) < right and _date(block['ends_at']) > left:
                    raise DomainError(f'{resource["name"]} is blocked during this time.')
            events = []
            for row in existing + additions:
                start, end = _date(row['starts_at']) - before, _date(row['ends_at']) + after
                if start < right and end > left:
                    events.extend(((max(start, left), row['quantity']), (min(end, right), -row['quantity'])))
            count = 0
            for _, delta in sorted(events, key=lambda event: (event[0], event[1])):
                count += delta
                if count > resource['capacity']:
                    raise DomainError(f'{resource["name"]} has insufficient availability, including travel buffers.')


def _quote(conn, enquiry_id, data, actor_id):
    enquiry = _row(conn, 'enquiries', enquiry_id)
    if conn.execute("SELECT 1 FROM bookings WHERE enquiry_id=? AND status IN ('confirmed','completed','no_show')", (enquiry_id,)).fetchone():
        raise DomainError('This enquiry has a booking. Record a change request before arranging any replacement.')
    for previous in conn.execute('SELECT id FROM quotes WHERE enquiry_id=?', (enquiry_id,)).fetchall():
        paid = get_quote(conn, previous['id'])
        if paid['paid_minor'] != 0 or any(not payment['verified'] and not payment['voided'] for payment in paid['payments']):
            raise DomainError('Reconcile all pending payments and refund any collected funds before replacing this enquiry’s quote. Payments are not transferred automatically.')
    currency = _text(data.get('currency', 'GEL'), 'Currency', 3, True).upper()
    if not re.fullmatch('[A-Z]{3}', currency):
        raise DomainError('Use a three-letter currency code.')
    expiry = timestamp(data.get('expires_at'))
    if expiry <= timestamp():
        raise DomainError('The quote expiry must be in the future.')
    terms = _text(data.get('terms'), 'Quote terms', 20000, True)
    policy = _text(data.get('policy_version'), 'Policy version', 100, True)
    raw_items = data.get('items', [])
    if not raw_items or len(raw_items) > 30:
        raise DomainError('A quote requires between 1 and 30 service items.')
    items = []
    for item in raw_items:
        service = _row(conn, 'services', item['service_id']) if item.get('service_id') else None
        kind = service['kind'] if service else item.get('kind', enquiry['kind'])
        if kind not in ('tour', 'stay', 'taxi'):
            raise DomainError('Choose a service type for each quote item.')
        if service:
            provider = _row(conn, 'providers', service['provider_id'])
            if not provider['active'] or not provider['approved']:
                raise DomainError('The service provider is not approved and active.')
            if service['capacity'] and service['capacity'] < enquiry['party_size']:
                raise DomainError('The party exceeds the service capacity.')
        interval = _stay_interval if kind == 'stay' else _interval
        start, end = interval(item.get('starts_at', enquiry['starts_at']), item.get('ends_at', enquiry['ends_at']))
        quantity = _int(item.get('quantity', 1), 'Item quantity', 1, 10000)
        price = _int(item.get('unit_price_minor'), 'Unit price', 0, 100000000)
        items.append({'service_id': service['id'] if service else None, 'kind': kind,
                      'title': _text(item.get('title') or (service['title_en'] if service else ''), 'Item title', 300, True),
                      'quantity': quantity, 'unit_price_minor': price, 'total_minor': quantity * price,
                      'inclusions': _text(item.get('inclusions'), 'Inclusions', 10000), 'starts_at': start, 'ends_at': end})
    total = sum(item['total_minor'] for item in items)
    deposit = _int(data.get('deposit_required_minor', 0), 'Required deposit', 0, total)
    previous = [r['id'] for r in conn.execute("SELECT id FROM quotes WHERE enquiry_id=? AND status IN ('offered','accepted')", (enquiry_id,))]
    allocations = []
    for allocation in data.get('allocations', []):
        if allocation.get('shared_key'):
            raise DomainError('Shared tour departures are not enabled. Reserve a private guide for each group.')
        index = _int(allocation.get('item_index', 0), 'Item index', 0, len(items) - 1)
        item = items[index]
        resource = _resource(conn, allocation.get('resource_id'))
        start, end = _interval(allocation.get('starts_at', item['starts_at']), allocation.get('ends_at', item['ends_at']))
        if start > item['starts_at'] or end < item['ends_at']:
            raise DomainError('A resource reservation must cover the entire service time.')
        allocations.append({'resource_id': resource['id'], 'starts_at': start, 'ends_at': end,
                            'quantity': _int(allocation.get('quantity', 1), 'Resource quantity', 1, resource['capacity']),
                            'item_index': index, 'service_id': item['service_id']})
    _check_capacity(conn, allocations, previous)
    version = conn.execute('SELECT COALESCE(MAX(version),0)+1 FROM quotes WHERE enquiry_id=?', (enquiry_id,)).fetchone()[0]
    cursor = conn.execute('''INSERT INTO quotes(enquiry_id,version,currency,total_minor,deposit_required_minor,expires_at,terms,policy_version,created_at)
                VALUES (?,?,?,?,?,?,?,?,?)''', (enquiry_id, version, currency, total, deposit, expiry, terms, policy, timestamp()))
    quote_id = cursor.lastrowid
    item_ids = []
    for item in items:
        item_ids.append(conn.execute('''INSERT INTO quote_items(quote_id,service_id,kind,title,quantity,unit_price_minor,total_minor,inclusions,starts_at,ends_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)''', (quote_id, item['service_id'], item['kind'], item['title'], item['quantity'], item['unit_price_minor'],
                         item['total_minor'], item['inclusions'], item['starts_at'], item['ends_at'])).lastrowid)
    for allocation in allocations:
        conn.execute('''INSERT INTO allocations(quote_id,resource_id,item_id,starts_at,ends_at,quantity,service_id) VALUES (?,?,?,?,?,?,?)''',
                     (quote_id, allocation['resource_id'], item_ids[allocation['item_index']], allocation['starts_at'], allocation['ends_at'], allocation['quantity'], allocation['service_id']))
    conn.execute("UPDATE quotes SET status='superseded' WHERE enquiry_id=? AND id<>? AND status IN ('offered','accepted')", (enquiry_id, quote_id))
    conn.execute("UPDATE assignments SET status='cancelled',note='Quote replaced' WHERE quote_id IN (SELECT id FROM quotes WHERE enquiry_id=? AND status='superseded') AND status IN ('offered','accepted')", (enquiry_id,))
    conn.execute("UPDATE enquiries SET status='reviewed',updated_at=? WHERE id=?", (timestamp(), enquiry_id))
    audit(conn, 'quote.created', 'quote', quote_id, {'version': version, 'superseded': previous}, actor_id)
    return get_quote(conn, quote_id)


def create_quote(conn, enquiry_id, data, actor_id=None):
    with _transaction(conn):
        _expire(conn)
        return _quote(conn, enquiry_id, data, actor_id)


def replace_quote(conn, quote_id, data, actor_id=None):
    with _transaction(conn):
        _expire(conn)
        quote = _row(conn, 'quotes', quote_id)
        if quote['status'] not in ('offered', 'accepted', 'expired'):
            raise DomainError('Only an unconfirmed current quote can be revised.')
        return _quote(conn, quote['enquiry_id'], data, actor_id)


def get_quote(conn, quote_id):
    quote = _row(conn, 'quotes', quote_id)
    quote['items'] = [dict(row) for row in conn.execute('SELECT * FROM quote_items WHERE quote_id=? ORDER BY id', (quote_id,))]
    quote['allocations'] = [dict(row) for row in conn.execute('SELECT a.*,r.name resource_name,r.kind resource_kind FROM allocations a JOIN resources r ON r.id=a.resource_id WHERE quote_id=? ORDER BY a.id', (quote_id,))]
    quote['payments'] = [dict(row) for row in conn.execute('SELECT * FROM payments WHERE quote_id=? ORDER BY id', (quote_id,))]
    quote['paid_minor'] = sum(row['amount_minor'] * (-1 if row['kind'] == 'refund' else 1) for row in quote['payments'] if row['verified'] and not row['voided'])
    quote['pending_minor'] = sum(row['amount_minor'] for row in quote['payments'] if not row['verified'] and not row['voided'] and row['kind'] != 'refund')
    quote['balance_minor'] = quote['total_minor'] - quote['paid_minor']
    quote['deposit_outstanding_minor'] = max(0, quote['deposit_required_minor'] - quote['paid_minor'])
    if quote['paid_minor'] >= quote['total_minor'] and quote['total_minor'] > 0:
        quote['payment_status'] = 'paid'
    elif quote['paid_minor'] > 0:
        quote['payment_status'] = 'partially_paid'
    elif any(p['verified'] and not p['voided'] and p['kind'] == 'refund' for p in quote['payments']):
        quote['payment_status'] = 'refunded'
    elif quote['pending_minor']:
        quote['payment_status'] = 'pending_verification'
    else:
        quote['payment_status'] = 'due' if quote['total_minor'] else 'not_required'
    booking = conn.execute('SELECT * FROM bookings WHERE quote_id=?', (quote_id,)).fetchone()
    quote['booking'] = dict(booking) if booking else None
    quote['assignments'] = [dict(row) for row in conn.execute('SELECT * FROM assignments WHERE quote_id=? ORDER BY id DESC', (quote_id,))]
    return quote


def accept_quote(conn, quote_id, actor_id=None, evidence='Guest accepted through secure link'):
    with _transaction(conn):
        _expire(conn)
        quote = _row(conn, 'quotes', quote_id)
        if quote['status'] == 'accepted':
            return get_quote(conn, quote_id)
        if quote['status'] != 'offered' or quote['expires_at'] <= timestamp():
            raise DomainError('This quote is no longer available for acceptance. Please request a new quote.')
        evidence = _text(evidence, 'Acceptance evidence', 2000, True)
        conn.execute("UPDATE quotes SET status='accepted',accepted_at=?,acceptance_evidence=? WHERE id=?", (timestamp(), evidence, quote_id))
        audit(conn, 'quote.accepted', 'quote', quote_id, {'policy_version': quote['policy_version'], 'evidence': evidence}, actor_id)
        return get_quote(conn, quote_id)


def record_payment(conn, quote_id, amount_minor, kind='deposit', method='cash', reference='', actor_id=None, verified=False):
    amount = _int(amount_minor, 'Payment amount', 1)
    if kind not in ('deposit', 'balance', 'refund'):
        raise DomainError('Choose deposit, balance or refund.')
    method = _text(method, 'Payment method', 100, True)
    reference = _text(reference, 'Receipt or settlement reference', 1000, True)
    with _transaction(conn):
        quote = get_quote(conn, quote_id)
        if kind == 'refund' and amount > quote['paid_minor']:
            raise DomainError('The refund exceeds the verified amount collected.')
        if verified and kind != 'refund' and quote['paid_minor'] + amount > quote['total_minor']:
            raise DomainError('The payment exceeds the quoted total. Review the amount first.')
        cursor = conn.execute('''INSERT INTO payments(quote_id,amount_minor,kind,method,reference,verified,recorded_at,actor_id,verified_at,verification_evidence)
                    VALUES (?,?,?,?,?,?,?,?,?,?)''', (quote_id, amount, kind, method, reference, int(bool(verified)), timestamp(), actor_id,
                                                     timestamp() if verified else None, reference if verified else ''))
        audit(conn, 'payment.recorded', 'payment', cursor.lastrowid, {'verified': bool(verified), 'kind': kind, 'amount_minor': amount}, actor_id)
        if verified and kind == 'refund' and quote['booking'] and quote['booking']['status'] == 'confirmed':
            conn.execute("UPDATE bookings SET operational_status='needs_attention' WHERE quote_id=?", (quote_id,))
        return _row(conn, 'payments', cursor.lastrowid)


def verify_payment(conn, payment_id, evidence, actor_id=None):
    evidence = _text(evidence, 'Verified settlement evidence', 2000, True)
    with _transaction(conn):
        payment = _row(conn, 'payments', payment_id)
        if payment['voided']:
            raise DomainError('A voided pending payment cannot be verified. Record a new payment if funds later settle.')
        if payment['verified']:
            return payment
        quote = get_quote(conn, payment['quote_id'])
        if payment['kind'] == 'refund' and payment['amount_minor'] > quote['paid_minor']:
            raise DomainError('The refund exceeds verified collections.')
        if payment['kind'] != 'refund' and quote['paid_minor'] + payment['amount_minor'] > quote['total_minor']:
            raise DomainError('Verified payments would exceed the quoted total.')
        conn.execute('UPDATE payments SET verified=1,verified_at=?,verification_evidence=? WHERE id=?', (timestamp(), evidence, payment_id))
        if payment['kind'] == 'refund' and quote['booking'] and quote['booking']['status'] == 'confirmed':
            conn.execute("UPDATE bookings SET operational_status='needs_attention' WHERE quote_id=?", (payment['quote_id'],))
        audit(conn, 'payment.verified', 'payment', payment_id, {'evidence': evidence}, actor_id)
        return _row(conn, 'payments', payment_id)


def void_payment(conn, payment_id, evidence, actor_id=None):
    """Reject an unsettled claim without deleting the financial history."""
    evidence = _text(evidence, 'Reason for rejecting pending payment', 2000, True)
    with _transaction(conn):
        payment = _row(conn, 'payments', payment_id)
        if payment['verified']:
            raise DomainError('Verified funds cannot be voided. Record a verified refund when money is returned.')
        if payment['voided']:
            return payment
        conn.execute('UPDATE payments SET voided=1,voided_at=?,void_evidence=? WHERE id=?', (timestamp(), evidence, payment_id))
        audit(conn, 'payment.voided', 'payment', payment_id, {'evidence': evidence}, actor_id)
        return _row(conn, 'payments', payment_id)


def _taxi_item(conn, quote_id):
    items = conn.execute("SELECT * FROM quote_items WHERE quote_id=? AND kind='taxi'", (quote_id,)).fetchall()
    if len(items) != 1:
        raise DomainError('Dispatch supports one taxi leg per quote. Quote separate legs separately.')
    return dict(items[0])


def assign_driver(conn, quote_id, driver_resource_id, vehicle_resource_id, fare_minor=None, actor_id=None, expires_at=None, note=''):
    with _transaction(conn):
        _expire(conn)
        quote = _row(conn, 'quotes', quote_id)
        if quote['status'] not in ('accepted', 'confirmed'):
            raise DomainError('The guest must accept the fare and terms before driver dispatch.')
        item = _taxi_item(conn, quote_id)
        fare = item['total_minor'] if fare_minor is None else _int(fare_minor, 'Fare', 0)
        if fare != item['total_minor']:
            raise DomainError('The dispatch fare must match the guest-accepted taxi quote.')
        driver, vehicle = _resource(conn, driver_resource_id), _resource(conn, vehicle_resource_id)
        if driver['kind'] not in ('driver', 'guide') or vehicle['kind'] != 'vehicle':
            raise DomainError('Select an approved driver and vehicle.')
        enquiry = _row(conn, 'enquiries', quote['enquiry_id'])
        if not vehicle['passenger_capacity'] or vehicle['passenger_capacity'] < enquiry['party_size']:
            raise DomainError('The vehicle must have enough recorded passenger capacity.')
        expiry = timestamp(expires_at or (now() + timedelta(minutes=30)))
        if expiry <= timestamp():
            raise DomainError('The driver offer timeout must be in the future.')
        if quote['status'] != 'confirmed' and expiry > quote['expires_at']:
            expiry = quote['expires_at']
        allocations = [{'resource_id': r['id'], 'starts_at': item['starts_at'], 'ends_at': item['ends_at'], 'quantity': 1} for r in (driver, vehicle)]
        # Include this quote's unrelated reservations when considering replacement.
        existing = [dict(r) for r in conn.execute("SELECT * FROM allocations WHERE quote_id=? AND origin<>'dispatch'", (quote_id,))]
        _check_capacity(conn, existing + allocations, (quote_id,))
        conn.execute("UPDATE assignments SET status='cancelled',note='Reassigned: ' || ? WHERE quote_id=? AND status IN ('offered','accepted','en_route')", (_text(note, 'Reassignment note', 2000), quote_id))
        conn.execute("DELETE FROM allocations WHERE quote_id=? AND origin='dispatch'", (quote_id,))
        for allocation in allocations:
            conn.execute("INSERT INTO allocations(quote_id,resource_id,item_id,starts_at,ends_at,quantity,service_id,origin) VALUES (?,?,?,?,?,1,?,'dispatch')",
                         (quote_id, allocation['resource_id'], item['id'], item['starts_at'], item['ends_at'], item['service_id']))
        cursor = conn.execute('''INSERT INTO assignments(quote_id,driver_resource_id,vehicle_resource_id,fare_minor,offered_at,expires_at,note)
                      VALUES (?,?,?,?,?,?,?)''', (quote_id, driver['id'], vehicle['id'], fare, timestamp(), expiry, _text(note, 'Note', 2000)))
        conn.execute("UPDATE bookings SET operational_status='needs_attention' WHERE quote_id=? AND status='confirmed'", (quote_id,))
        audit(conn, 'assignment.offered', 'assignment', cursor.lastrowid, {'quote_id': quote_id, 'driver': driver['id'], 'vehicle': vehicle['id']}, actor_id)
        return _row(conn, 'assignments', cursor.lastrowid)


def accept_assignment(conn, assignment_id, evidence, actor_id=None):
    evidence = _text(evidence, 'Driver acceptance evidence', 2000, True)
    with _transaction(conn):
        _expire(conn)
        assignment = _row(conn, 'assignments', assignment_id)
        if assignment['status'] == 'accepted':
            return assignment
        if assignment['status'] != 'offered' or assignment['expires_at'] <= timestamp():
            raise DomainError('This driver offer is no longer current.')
        quote = _row(conn, 'quotes', assignment['quote_id'])
        if quote['status'] not in ('accepted', 'confirmed'):
            raise DomainError('The accepted guest quote is no longer current.')
        allocations = [dict(r) for r in conn.execute('SELECT * FROM allocations WHERE quote_id=?', (quote['id'],))]
        _check_capacity(conn, allocations, (quote['id'],))
        conn.execute("UPDATE assignments SET status='accepted',accepted_at=?,acceptance_evidence=? WHERE id=?", (timestamp(), evidence, assignment_id))
        conn.execute("UPDATE bookings SET operational_status='ready' WHERE quote_id=? AND status='confirmed'", (quote['id'],))
        audit(conn, 'assignment.accepted', 'assignment', assignment_id, {'evidence': evidence}, actor_id)
        return _row(conn, 'assignments', assignment_id)


def mark_assignment(conn, assignment_id, status, note='', actor_id=None):
    transitions = {'offered': ('unavailable', 'cancelled'), 'accepted': ('en_route', 'unavailable', 'cancelled'), 'en_route': ('completed', 'unavailable', 'cancelled')}
    with _transaction(conn):
        assignment = _row(conn, 'assignments', assignment_id)
        if status not in transitions.get(assignment['status'], ()):
            raise DomainError('This dispatch status transition is not allowed.')
        if status in ('en_route', 'completed') and not conn.execute("SELECT 1 FROM bookings WHERE quote_id=? AND status='confirmed' AND operational_status='ready'", (assignment['quote_id'],)).fetchone():
            raise DomainError('Confirm the booking with a ready accepted driver before starting or completing the trip.')
        conn.execute('UPDATE assignments SET status=?,note=? WHERE id=?', (status, _text(note, 'Dispatch note', 2000), assignment_id))
        if status in ('unavailable', 'cancelled'):
            conn.execute("DELETE FROM allocations WHERE quote_id=? AND origin='dispatch'", (assignment['quote_id'],))
            conn.execute("UPDATE bookings SET operational_status='needs_attention' WHERE quote_id=? AND status='confirmed'", (assignment['quote_id'],))
        audit(conn, 'assignment.' + status, 'assignment', assignment_id, {'note': note}, actor_id)
        return _row(conn, 'assignments', assignment_id)


def _check_required_resources(conn, quote):
    enquiry = _row(conn, 'enquiries', quote['enquiry_id'])
    for item in quote['items']:
        rows = [allocation for allocation in quote['allocations'] if allocation['item_id'] == item['id']]
        kinds = {allocation['resource_kind'] for allocation in rows}
        if item['kind'] == 'stay' and 'room' not in kinds:
            raise DomainError('A stay needs a reserved room for every night.')
        if item['kind'] == 'tour' and not {'guide', 'driver'} & kinds:
            raise DomainError('A private tour needs a reserved guide.')
        if item['kind'] == 'taxi':
            assignment = conn.execute("SELECT * FROM assignments WHERE quote_id=? AND status IN ('accepted','en_route')", (quote['id'],)).fetchone()
            if not assignment:
                raise DomainError('A taxi needs acceptance from the current assigned driver.')
            if not {'driver', 'guide'} & kinds or 'vehicle' not in kinds:
                raise DomainError('A taxi needs reserved driver and vehicle time.')
            vehicle = _resource(conn, assignment['vehicle_resource_id'])
            if not vehicle['passenger_capacity'] or vehicle['passenger_capacity'] < enquiry['party_size']:
                raise DomainError('The assigned vehicle does not have enough passenger capacity.')
        if item['kind'] == 'stay':
            rooms = [(_resource(conn, row['resource_id']), row['quantity']) for row in rows if row['resource_kind'] == 'room']
            if any(not resource['passenger_capacity'] for resource, quantity in rooms):
                raise DomainError('Record room occupancy capacity before confirming a stay.')
            if sum(resource['passenger_capacity'] * quantity for resource, quantity in rooms) < enquiry['party_size']:
                raise DomainError('The reserved rooms do not accommodate the whole party.')
        if item['service_id']:
            service = _row(conn, 'services', item['service_id'])
            if service['capacity'] and service['capacity'] < enquiry['party_size']:
                raise DomainError('The service capacity is smaller than the party.')


def confirm_booking(conn, quote_id, actor_id=None):
    with _transaction(conn):
        _expire(conn)
        quote = get_quote(conn, quote_id)
        if quote['booking'] and quote['booking']['status'] == 'confirmed':
            return quote['booking']
        if quote['status'] != 'accepted' or quote['expires_at'] <= timestamp():
            raise DomainError('A current guest-accepted quote is required before confirmation.')
        enquiry = _row(conn, 'enquiries', quote['enquiry_id'])
        if not enquiry['contact_verified_at']:
            raise DomainError('Verify contact through a two-way exchange before confirming.')
        if quote['paid_minor'] < quote['deposit_required_minor']:
            raise DomainError('Verify the required deposit before confirming.')
        if conn.execute("SELECT 1 FROM bookings WHERE enquiry_id=? AND status IN ('confirmed','completed','no_show')", (quote['enquiry_id'],)).fetchone():
            raise DomainError('This enquiry already has a booking.')
        _check_required_resources(conn, quote)
        _check_capacity(conn, quote['allocations'], (quote_id,))
        cursor = conn.execute('INSERT INTO bookings(quote_id,enquiry_id,reference,confirmed_at) VALUES (?,?,?,?)',
                              (quote_id, quote['enquiry_id'], enquiry['reference'] + '-B' + str(quote['version']), timestamp()))
        conn.execute("UPDATE quotes SET status='confirmed' WHERE id=?", (quote_id,))
        audit(conn, 'booking.confirmed', 'booking', cursor.lastrowid, {'quote_id': quote_id, 'total_minor': quote['total_minor'], 'currency': quote['currency']}, actor_id)
        return _row(conn, 'bookings', cursor.lastrowid)


def cancel_booking(conn, booking_id, reason, actor_id=None):
    reason = _text(reason, 'Cancellation reason', 2000, True)
    with _transaction(conn):
        booking = _row(conn, 'bookings', booking_id)
        if booking['status'] == 'cancelled':
            return booking
        if booking['status'] != 'confirmed':
            raise DomainError('Only a confirmed booking can be cancelled.')
        conn.execute("UPDATE bookings SET status='cancelled',cancelled_at=?,cancellation_reason=? WHERE id=?", (timestamp(), reason, booking_id))
        conn.execute("UPDATE quotes SET status='cancelled' WHERE id=?", (booking['quote_id'],))
        conn.execute("UPDATE assignments SET status='cancelled',note=? WHERE quote_id=? AND status IN ('offered','accepted','en_route')", (reason, booking['quote_id']))
        audit(conn, 'booking.cancelled', 'booking', booking_id, {'reason': reason, 'refund_automatic': False}, actor_id)
        return _row(conn, 'bookings', booking_id)


def close_booking(conn, booking_id, status, actor_id=None):
    if status not in ('completed', 'no_show'):
        raise DomainError('Choose completed or no-show.')
    with _transaction(conn):
        booking = _row(conn, 'bookings', booking_id)
        if booking['status'] != 'confirmed':
            raise DomainError('Only confirmed bookings can be closed.')
        conn.execute('UPDATE bookings SET status=?,completed_at=? WHERE id=?', (status, timestamp(), booking_id))
        if status == 'completed':
            conn.execute("UPDATE assignments SET status='completed' WHERE quote_id=? AND status IN ('accepted','en_route')", (booking['quote_id'],))
        audit(conn, 'booking.' + status, 'booking', booking_id, actor_id=actor_id)
        return _row(conn, 'bookings', booking_id)


finish_booking = close_booking


def request_change(conn, enquiry_id, message, kind='change', actor_id=None):
    if kind not in ('change', 'cancellation'):
        raise DomainError('Choose change or cancellation.')
    message = _text(message, 'Change request', 4000, True)
    with _transaction(conn):
        _row(conn, 'enquiries', enquiry_id)
        booking = conn.execute("SELECT id FROM bookings WHERE enquiry_id=? AND status='confirmed'", (enquiry_id,)).fetchone()
        cursor = conn.execute('INSERT INTO change_requests(enquiry_id,booking_id,kind,message,created_at) VALUES (?,?,?,?,?)',
                              (enquiry_id, booking['id'] if booking else None, kind, message, timestamp()))
        audit(conn, 'request.' + kind, 'change_request', cursor.lastrowid, actor_id=actor_id)
        return _row(conn, 'change_requests', cursor.lastrowid)


def block_resource(conn, resource_id, starts_at, ends_at, reason, actor_id=None):
    start, end = _interval(starts_at, ends_at)
    reason = _text(reason, 'Block reason', 2000, True)
    with _transaction(conn):
        _expire(conn)
        resource = _resource(conn, resource_id)
        _check_capacity(conn, [{'resource_id': resource_id, 'starts_at': start, 'ends_at': end, 'quantity': resource['capacity']}])
        cursor = conn.execute('INSERT INTO availability_blocks(resource_id,starts_at,ends_at,reason,created_at) VALUES (?,?,?,?,?)', (resource_id, start, end, reason, timestamp()))
        audit(conn, 'resource.blocked', 'availability_block', cursor.lastrowid, {'resource_id': resource_id}, actor_id)
        return _row(conn, 'availability_blocks', cursor.lastrowid)


def remove_block(conn, block_id, actor_id=None):
    with _transaction(conn):
        block = _row(conn, 'availability_blocks', block_id)
        conn.execute('DELETE FROM availability_blocks WHERE id=?', (block_id,))
        audit(conn, 'resource.unblocked', 'availability_block', block_id, {'resource_id': block['resource_id']}, actor_id)


def cancel_quote(conn, quote_id, reason, actor_id=None):
    with _transaction(conn):
        quote = _row(conn, 'quotes', quote_id)
        if quote['status'] not in ('offered', 'accepted', 'expired'):
            raise DomainError('This quote cannot be cancelled; manage its booking instead.')
        reason = _text(reason, 'Cancellation reason', 2000, True)
        conn.execute("UPDATE quotes SET status='cancelled' WHERE id=?", (quote_id,))
        conn.execute("UPDATE assignments SET status='cancelled',note=? WHERE quote_id=? AND status IN ('offered','accepted')", (reason, quote_id))
        audit(conn, 'quote.cancelled', 'quote', quote_id, {'reason': reason}, actor_id)
        return get_quote(conn, quote_id)
