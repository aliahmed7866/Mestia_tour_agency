"""HTTP integration coverage for staff security and the request-to-booking flow.

These tests use SQLite and rendered form contracts, without external integrations.
"""
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

import pytest

from mestia import create_app
from mestia.db import connect
from mestia.security import hash_password, totp_code

PASSWORD = 'a-real-length-testing-password'
TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'


class Controls(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.controls = []
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        data = dict(attributes)
        if tag in {'input', 'select', 'textarea', 'button'} and data.get('name'):
            self.controls.append(data)

    def value(self, name):
        return next(item.get('value', 'on') for item in self.controls if item['name'] == name)

    @property
    def names(self):
        return {item['name'] for item in self.controls}


@pytest.fixture(scope='module')
def password_hash():
    return hash_password(PASSWORD)


@pytest.fixture
def app(tmp_path, password_hash):
    app = create_app({
        'TESTING': True,
        'SECRET_KEY': 'test-secret-not-for-production-1234567890',
        'DATABASE': str(tmp_path / 'web.sqlite3'),
        'MEDIA_DIR': str(tmp_path / 'media'),
        'SESSION_COOKIE_SECURE': False,
        'TRUST_PROXY': False,
    })
    conn = connect(app.config['DATABASE'])
    for role in ('owner', 'dispatcher'):
        conn.execute('INSERT INTO users(email,password_hash,role,totp_secret) VALUES (?,?,?,?)',
                     (role + '@example.test', password_hash, role, TOTP_SECRET))
    conn.execute("UPDATE settings SET value=? WHERE key='privacy_notice'",
                 ('Testing notice: contact details are used to answer this enquiry.',))
    conn.close()
    return app


@pytest.fixture
def db(app):
    conn = connect(app.config['DATABASE'])
    yield conn
    conn.close()


def login(app, role='owner', code=None, password=PASSWORD):
    client = app.test_client()
    page = client.get('/admin/login')
    assert page.status_code == 200
    response = client.post('/admin/login', data={
        'csrf_token': Controls(page.text).value('csrf_token'),
        'email': role + '@example.test', 'password': password,
        'otp': totp_code(TOTP_SECRET) if code is None else code,
    })
    return client, response


@pytest.fixture
def owner(app):
    client, response = login(app)
    assert response.status_code == 302
    assert response.location == '/admin'
    assert client.get('/admin').status_code == 200
    return client


def post(client, path, data=None, follow_redirects=False):
    payload = dict(data or {})
    if 'quote_id' not in payload and (path.startswith('/admin/enquiries/') or
                                        (path.startswith('/booking/') and path.endswith('/accept'))):
        parent_page = client.get(path.rsplit('/', 1)[0])
        controls = Controls(parent_page.text)
        if 'quote_id' in controls.names:
            payload['quote_id'] = controls.value('quote_id')
    with client.session_transaction() as session:
        payload['csrf_token'] = session['csrf_token']
    return client.post(path, data=payload, follow_redirects=follow_redirects)


def public_request(app, *, name='Integration guest', kind='stay'):
    client = app.test_client()
    page = client.get('/request')
    assert page.status_code == 200
    controls = Controls(page.text)
    start = datetime.now(timezone.utc) + timedelta(days=20)
    end = start + timedelta(days=2)
    data = {
        'csrf_token': controls.value('csrf_token'),
        'request_key': controls.value('request_key'),
        'privacy_consent': controls.value('privacy_consent'),
        'name': name, 'contact': '+995555123456', 'email': 'guest@example.test',
        'kind': kind, 'party_size': '2', 'check_in': start.date().isoformat(),
        'check_out': end.date().isoformat(),
        'start_local': start.strftime('%Y-%m-%dT10:00'),
        'end_local': end.strftime('%Y-%m-%dT10:00'),
        'pickup': 'Mestia', 'destination': 'Requested destination',
    }
    response = client.post('/request', data=data)
    assert response.status_code == 302, response.text
    assert response.location.startswith('/booking/')
    return client, response.location, data


def resource(db, kind='room', name='Test room', occupancy=2):
    return db.execute('''INSERT INTO resources
        (provider_id,name,kind,capacity,passenger_capacity,approved,active)
        VALUES (1,?,?,1,?,1,1)''', (name, kind, occupancy)).lastrowid


def quote(owner, db, enquiry_id, resource_id, *, deposit='20.00', title='Two nights', kind='stay'):
    page = owner.get(f'/admin/enquiries/{enquiry_id}')
    assert page.status_code == 200
    controls = Controls(page.text)
    fields = {'item_title', 'item_kind', 'item_quantity', 'item_price', 'allocation_resource',
              'allocation_item', 'allocation_quantity', 'expires_local', 'terms', 'policy_version'}
    assert fields <= controls.names
    response = post(owner, f'/admin/enquiries/{enquiry_id}/quote', {
        'item_title': title, 'item_kind': kind, 'item_quantity': '1', 'item_price': '100.00',
        'allocation_resource': str(resource_id) if resource_id else '',
        'allocation_item': '0', 'allocation_quantity': '1',
        'expires_local': (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(),
        'deposit': deposit, 'currency': 'GEL', 'terms': 'Test quote and cancellation terms.',
        'policy_version': 'test-1',
    })
    assert response.status_code == 302
    result = db.execute('SELECT * FROM quotes WHERE enquiry_id=? ORDER BY id DESC', (enquiry_id,)).fetchone()
    assert result is not None, owner.get(response.location).text
    return dict(result)


def enquiry_id(db):
    return db.execute('SELECT id FROM enquiries ORDER BY id DESC').fetchone()[0]


def test_sign_in_requires_csrf_password_and_unreplayed_totp(app, db):
    client = app.test_client()
    assert client.post('/admin/login', data={'email': 'owner@example.test'}).status_code == 400
    assert client.post('/request').status_code == 400
    _, response = login(app, code='bad-code')
    assert response.status_code == 401
    code = totp_code(TOTP_SECRET)
    client, response = login(app, code=code)
    assert response.status_code == 302
    assert client.get('/admin').status_code == 200
    _, replay = login(app, code=code)
    assert replay.status_code == 401
    # Existing sessions stop working after credentials are reset.
    db.execute("UPDATE users SET password_hash='changed' WHERE role='owner'")
    assert client.get('/admin').status_code == 302
    assert client.get('/admin').location == '/admin/login'


def test_guest_and_dispatcher_cannot_write_owner_configuration_or_payments(app, owner, db):
    guest, _, _ = public_request(app)
    identifier = enquiry_id(db)
    q = quote(owner, db, identifier, resource(db))
    for path in ('/admin', '/admin/services', '/admin/providers', '/admin/settings', '/admin/export'):
        assert guest.get(path).status_code == 302
    denied = post(guest, f'/admin/enquiries/{identifier}/confirm')
    assert denied.status_code == 302 and denied.location == '/admin/login'
    dispatcher, response = login(app, 'dispatcher')
    assert response.status_code == 302
    assert dispatcher.get('/admin').status_code == 200
    assert dispatcher.get(f'/admin/enquiries/{identifier}').status_code == 200
    assert dispatcher.get('/admin/resources').status_code == 200
    for path in ('/admin/services', '/admin/providers', '/admin/settings', '/admin/export'):
        assert dispatcher.get(path).status_code == 403
    for path in ('/admin/services', '/admin/providers', '/admin/settings', '/admin/resources',
                 f'/admin/enquiries/{identifier}/payment', f'/admin/enquiries/{identifier}/verify-payment'):
        assert post(dispatcher, path).status_code == 403
    assert db.execute('SELECT count(*) FROM payments WHERE quote_id=?', (q['id'],)).fetchone()[0] == 0


def test_public_enquiry_quote_deposit_confirmation_and_guest_cancellation_request(app, owner, db):
    guest, private_url, original_data = public_request(app)
    identifier = enquiry_id(db)
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    # A retry of the same browser submission does not create a duplicate request.
    repeat = guest.post('/request', data=original_data)
    assert repeat.location == private_url
    assert db.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 1
    status = guest.get(private_url)
    assert status.status_code == 200
    assert status.headers['Cache-Control'] == 'no-store'
    assert status.headers['Referrer-Policy'] == 'no-referrer'
    assert 'frame-ancestors' in status.headers['Content-Security-Policy']
    injected_title = '<script>alert("quote")</script>'
    q = quote(owner, db, identifier, resource(db), title=injected_title)
    status = guest.get(private_url)
    assert injected_title not in status.text
    assert '&lt;script&gt;' in status.text
    post(guest, private_url + '/accept')
    assert db.execute('SELECT status FROM quotes WHERE id=?', (q['id'],)).fetchone()[0] == 'offered'
    assert post(guest, private_url + '/accept', {'accepted_terms': 'on'}).status_code == 302
    assert db.execute('SELECT status FROM quotes WHERE id=?', (q['id'],)).fetchone()[0] == 'accepted'
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    post(owner, f'/admin/enquiries/{identifier}/verify', {'evidence': 'Guest replied and confirmed requested dates.'})
    post(owner, f'/admin/enquiries/{identifier}/payment', {
        'amount': '20.00', 'kind': 'deposit', 'method': 'bank transfer', 'reference': 'TEST-RECEIPT-1',
    })
    payment = db.execute('SELECT * FROM payments WHERE quote_id=?', (q['id'],)).fetchone()
    assert payment is not None and payment['verified'] == 0
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    post(owner, f'/admin/enquiries/{identifier}/verify-payment', {
        'payment_id': str(payment['id']), 'evidence': 'Deposit settled, checked against account record.',
    })
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    assert db.execute("SELECT count(*) FROM bookings WHERE status='confirmed'").fetchone()[0] == 1
    assert guest.get(private_url).status_code == 200
    post(guest, private_url + '/message', {'kind': 'cancel', 'message': 'Please review cancellation of this visit.'})
    change = db.execute('SELECT * FROM change_requests WHERE enquiry_id=?', (identifier,)).fetchone()
    assert change is not None
    assert change['kind'] == 'cancellation' and change['message'] == 'Please review cancellation of this visit.'
    assert db.execute('SELECT status FROM bookings').fetchone()[0] == 'confirmed'


def test_private_links_reject_wrong_tokens_and_rotation_revokes_previous_link(app, owner, db):
    guest, private_url, _ = public_request(app, name='Private Guest Name')
    identifier = enquiry_id(db)
    invalid_url = '/booking/not-the-private-token'
    for path in (invalid_url, '/booking/' + 'x' * 200):
        response = guest.get(path)
        assert response.status_code == 404
        assert 'Private Guest Name' not in response.text
    assert post(guest, invalid_url + '/accept', {'accepted_terms': 'on'}).status_code == 404
    assert post(guest, invalid_url + '/message', {'message': 'Not authorized'}).status_code == 404
    post(owner, f'/admin/enquiries/{identifier}/link')
    assert guest.get(private_url).status_code == 404
    with owner.session_transaction() as session:
        replacement = session['share']['token']
    assert guest.get('/booking/' + replacement).status_code == 200
    assert db.execute('SELECT count(*) FROM change_requests').fetchone()[0] == 0


def test_cancelled_quote_cannot_be_accepted_from_old_guest_page(app, owner, db):
    guest, private_url, _ = public_request(app)
    identifier = enquiry_id(db)
    q = quote(owner, db, identifier, resource(db))
    assert guest.get(private_url).status_code == 200
    post(owner, f'/admin/enquiries/{identifier}/cancel', {'reason': 'Requested dates cannot be accommodated.'})
    assert db.execute('SELECT status FROM quotes WHERE id=?', (q['id'],)).fetchone()[0] == 'cancelled'
    post(guest, private_url + '/accept', {'accepted_terms': 'on'})
    assert db.execute('SELECT status FROM quotes WHERE id=?', (q['id'],)).fetchone()[0] == 'cancelled'
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0


def test_manual_enquiry_rendered_fields_save_contact_source_and_local_dates(owner, db):
    page = owner.get('/admin/manual')
    assert page.status_code == 200
    controls = Controls(page.text)
    assert {'name', 'contact', 'kind', 'source', 'check_in', 'check_out'} <= controls.names
    start = (datetime.now(timezone.utc) + timedelta(days=30)).date()
    response = post(owner, '/admin/manual', {
        'name': 'Walk-in guest', 'contact': '+995555987654', 'kind': 'stay', 'party_size': '2',
        'source': 'walk_in', 'check_in': start.isoformat(),
        'check_out': (start + timedelta(days=1)).isoformat(),
        'request_key': controls.value('request_key'), 'notes': 'Recorded from an in-person enquiry.',
    })
    assert response.status_code == 302, response.text
    e = db.execute('SELECT * FROM enquiries').fetchone()
    assert e['phone'] == '+995555987654' and e['source'] == 'walk_in'
    assert e['starts_at'].endswith('20:00:00Z')
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    assert owner.get(response.location).status_code == 200


def test_owner_can_manage_catalogue_settings_and_availability_without_changing_quotes(app, owner, db):
    for path in ('/admin/services', '/admin/resources', '/admin/providers', '/admin/settings'):
        assert owner.get(path).status_code == 200
    post(owner, '/admin/providers', {'name': 'Test provider', 'kind': 'guide', 'approved': 'on', 'active': 'on'})
    provider_id = db.execute("SELECT id FROM providers WHERE name='Test provider'").fetchone()[0]
    service_data = {
        'provider_id': str(provider_id), 'kind': 'stay', 'title_en': 'Testing stay',
        'title_ka': 'სატესტო ოთახი', 'description_en': 'Owner entered service.', 'price': '100.00',
        'currency': 'GEL', 'published': 'on', 'capacity': '2',
    }
    post(owner, '/admin/services', service_data)
    service_id = db.execute("SELECT id FROM services WHERE title_en='Testing stay'").fetchone()[0]
    assert 'Testing stay' in app.test_client().get(f'/services/{service_id}').text
    post(owner, '/admin/resources', {
        'name': 'Owner room', 'provider_id': str(provider_id), 'kind': 'room',
        'capacity': '1', 'passenger_capacity': '2', 'buffer_minutes': '0',
        'approved': 'on', 'active': 'on',
    })
    room_id = db.execute("SELECT id FROM resources WHERE name='Owner room'").fetchone()[0]
    guest, private_url, _ = public_request(app)
    identifier = enquiry_id(db)
    q = quote(owner, db, identifier, room_id, deposit='0.00')
    guest.get(private_url)
    post(guest, private_url + '/accept', {'accepted_terms': 'on'})
    post(owner, f'/admin/enquiries/{identifier}/verify', {'evidence': 'Guest responded.'})
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    assert db.execute('SELECT status FROM bookings').fetchone()[0] == 'confirmed'
    post(owner, '/admin/services', dict(service_data, id=str(service_id), price='950.00'))
    assert db.execute('SELECT price_minor FROM services WHERE id=?', (service_id,)).fetchone()[0] == 95000
    assert db.execute('SELECT total_minor FROM quotes WHERE id=?', (q['id'],)).fetchone()[0] == 10000
    # A live booking protects inventory semantics from routine owner edits.
    post(owner, '/admin/resources', {
        'id': str(room_id), 'name': 'Owner room', 'provider_id': str(provider_id),
        'kind': 'room', 'capacity': '1', 'passenger_capacity': '1', 'buffer_minutes': '30',
        'approved': 'on', 'active': 'on',
    })
    room = db.execute('SELECT * FROM resources WHERE id=?', (room_id,)).fetchone()
    assert room['passenger_capacity'] == 2 and room['buffer_minutes'] == 0
    post(owner, '/admin/providers', {'id': str(provider_id), 'name': 'Test provider', 'kind': 'guide'})
    provider = db.execute('SELECT * FROM providers WHERE id=?', (provider_id,)).fetchone()
    assert provider['active'] == 1 and provider['approved'] == 1
    e = db.execute('SELECT * FROM enquiries WHERE id=?', (identifier,)).fetchone()
    post(owner, '/admin/resources', {'action': 'block', 'resource_id': str(room_id),
        'start_local': e['starts_at'], 'end_local': e['ends_at'], 'reason': 'Conflict must reject this block.'})
    assert db.execute('SELECT count(*) FROM availability_blocks').fetchone()[0] == 0
    post(owner, '/admin/settings', {'business_name': 'Test Mestia host', 'whatsapp_number': '995555123456',
         'privacy_notice': 'This is an owner-configured test privacy notice.'})
    assert db.execute("SELECT value FROM settings WHERE key='business_name'").fetchone()[0] == 'Test Mestia host'
    assert 'Test Mestia host' in app.test_client().get('/').text


def test_stale_guest_acceptance_and_staff_payment_cannot_apply_to_revised_quote(app, owner, db):
    guest, private_url, _ = public_request(app)
    identifier = enquiry_id(db)
    room = resource(db)
    first = quote(owner, db, identifier, room)
    old_page = guest.get(private_url)
    old_quote_id = Controls(old_page.text).value('quote_id')
    latest = quote(owner, db, identifier, room, title='Revised service and terms')
    assert latest['id'] != first['id']
    post(guest, private_url + '/accept', {'accepted_terms': 'on', 'quote_id': old_quote_id})
    assert db.execute('SELECT status FROM quotes WHERE id=?', (latest['id'],)).fetchone()[0] == 'offered'
    post(owner, f'/admin/enquiries/{identifier}/payment', {
        'quote_id': str(first['id']), 'kind': 'deposit', 'amount': '20.00',
        'method': 'cash', 'reference': 'Stale page receipt',
    })
    assert db.execute('SELECT count(*) FROM payments').fetchone()[0] == 0
    post(guest, private_url + '/accept', {'accepted_terms': 'on'})
    assert db.execute('SELECT status FROM quotes WHERE id=?', (latest['id'],)).fetchone()[0] == 'accepted'


def test_taxi_confirmation_needs_guest_and_driver_acceptance_then_supports_reassignment(app, owner, db):
    guest, private_url, _ = public_request(app, kind='taxi')
    identifier = enquiry_id(db)
    q = quote(owner, db, identifier, None, deposit='0.00', kind='taxi', title='Quoted private transfer')
    driver = resource(db, 'driver', 'First driver', occupancy=None)
    replacement_driver = resource(db, 'driver', 'Replacement driver', occupancy=None)
    vehicle = resource(db, 'vehicle', 'Four passenger vehicle', occupancy=4)
    post(owner, f'/admin/enquiries/{identifier}/verify', {'evidence': 'Guest confirmed pickup and contact.'})
    post(owner, f'/admin/enquiries/{identifier}/assign', {
        'driver_resource_id': str(driver), 'vehicle_resource_id': str(vehicle),
    })
    assert db.execute('SELECT count(*) FROM assignments').fetchone()[0] == 0
    guest.get(private_url)
    post(guest, private_url + '/accept', {'accepted_terms': 'on'})
    post(owner, f'/admin/enquiries/{identifier}/assign', {
        'driver_resource_id': str(driver), 'vehicle_resource_id': str(vehicle),
    })
    assignment = db.execute('SELECT * FROM assignments').fetchone()
    assert assignment is not None and assignment['status'] == 'offered'
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    post(owner, f'/admin/enquiries/{identifier}/accept-driver', {
        'assignment_id': str(assignment['id']), 'evidence': 'Driver accepted time, pickup and fare by phone.',
    })
    post(owner, f'/admin/enquiries/{identifier}/confirm')
    booking = db.execute('SELECT * FROM bookings').fetchone()
    assert booking['status'] == 'confirmed' and booking['operational_status'] == 'ready'
    post(owner, f'/admin/enquiries/{identifier}/assignment', {
        'assignment_id': str(assignment['id']), 'status': 'unavailable', 'note': 'Driver reported vehicle issue.',
    })
    assert db.execute('SELECT operational_status FROM bookings').fetchone()[0] == 'needs_attention'
    post(owner, f'/admin/enquiries/{identifier}/assign', {
        'driver_resource_id': str(replacement_driver), 'vehicle_resource_id': str(vehicle),
    })
    replacement = db.execute('SELECT * FROM assignments ORDER BY id DESC').fetchone()
    assert replacement['id'] != assignment['id'] and replacement['status'] == 'offered'
    post(owner, f'/admin/enquiries/{identifier}/accept-driver', {
        'assignment_id': str(replacement['id']), 'evidence': 'Replacement driver accepted all trip details.',
    })
    assert db.execute('SELECT operational_status FROM bookings').fetchone()[0] == 'ready'
    assert db.execute('SELECT count(*) FROM bookings').fetchone()[0] == 1
    assert guest.get(private_url).status_code == 200
