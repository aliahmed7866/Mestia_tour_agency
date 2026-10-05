"""Date-only enquiry preferences must never become an invented booking schedule."""
from datetime import datetime, timedelta, timezone
import hashlib

import pytest

from mestia import create_app, domain, web
from mestia.db import connect, init_db, migrate_enquiry_preferences


@pytest.fixture
def setup(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'quick-requests-test-secret-32-characters',
                      'DATABASE': str(tmp_path / 'quick.sqlite3'), 'MEDIA_DIR': str(tmp_path / 'media'),
                      'REQUIRE_TOTP': False, 'SESSION_COOKIE_SECURE': False})
    conn = connect(app.config['DATABASE'])
    conn.execute("UPDATE settings SET value='Test privacy notice' WHERE key='privacy_notice'")
    yield app, conn
    conn.close()


def request_data(client, **overrides):
    assert client.get('/request').status_code == 200
    with client.session_transaction() as session:
        data = {'csrf_token': session['csrf_token'], 'request_key': session['request_key']}
    data.update(request_format='quick', kind='tour', service_ids='', request_date='2035-07-15',
                name='Mountain guest', contact='+995555123456', party_size='2', privacy_consent='on')
    data.update(overrides)
    return data


def latest(conn):
    return dict(conn.execute('SELECT * FROM enquiries ORDER BY id DESC').fetchone())


def staff_client(app, conn):
    user = conn.execute("INSERT INTO users(email,password_hash,role) VALUES ('owner@test.example','quick-hash','owner')").lastrowid
    client = app.test_client()
    with client.session_transaction() as session:
        session.update(user_id=user, credential_fingerprint=hashlib.sha256(b'quick-hash').hexdigest(),
                       auth_factor='password', csrf_token='staff-csrf')
    return client


def test_quick_tour_date_and_multiday_plan_remain_preferences(setup):
    app, conn = setup
    service = conn.execute("SELECT id FROM services WHERE preset_key<>'' AND duration_days=4 LIMIT 1").fetchone()[0]
    conn.execute('UPDATE services SET published=1 WHERE id=?', (service,))
    client = app.test_client()
    data = request_data(client, service_ids=str(service))
    response = client.post('/request', data=data)
    assert response.status_code == 302
    enquiry = latest(conn)
    assert enquiry['timing_pending'] == 1
    assert enquiry['requested_date'] == '2035-07-15'
    assert enquiry['requested_time'] == ''
    assert enquiry['service_id'] == service
    assert datetime.fromisoformat(enquiry['ends_at']) - datetime.fromisoformat(enquiry['starts_at']) == timedelta(days=4)
    assert conn.execute('SELECT count(*) FROM allocations').fetchone()[0] == 0
    assert conn.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    summary = client.get(response.location).text
    assert 'Times to agree' in summary
    assert '2035-07-15 00:00' not in summary
    assert '2035-07-19' not in summary
    assert client.post('/request', data=data).location == response.location
    assert conn.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 1
    init_db(conn)
    assert latest(conn)['requested_date'] == '2035-07-15'


@pytest.mark.parametrize('departure_time', ['', '09:30'])
def test_quick_taxi_keeps_optional_time_without_guessing_end(setup, departure_time):
    app, conn = setup
    client = app.test_client()
    response = client.post('/request', data=request_data(client, kind='taxi', pickup='Mestia',
                           destination='Kutaisi airport', departure_time=departure_time))
    assert response.status_code == 302
    enquiry = latest(conn)
    assert enquiry['requested_time'] == departure_time
    assert enquiry['timing_pending'] == 1
    page = client.get(response.location).text
    assert 'Times to agree' in page
    assert '2035-07-16' not in page
    if departure_time:
        assert departure_time in page


def test_quick_stay_keeps_whole_local_nights(setup):
    app, conn = setup
    client = app.test_client()
    response = client.post('/request', data=request_data(client, kind='stay', check_in='2035-07-15', check_out='2035-07-17'))
    assert response.status_code == 302
    enquiry = latest(conn)
    assert enquiry['timing_pending'] == 0
    assert enquiry['requested_date'] == ''
    assert enquiry['starts_at'] == '2035-07-14T20:00:00Z'
    assert enquiry['ends_at'] == '2035-07-16T20:00:00Z'


def test_today_uses_georgia_calendar_and_does_not_reject_date_only_midnight(setup, monkeypatch):
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2035, 7, 14, 22, 0, tzinfo=timezone.utc).astimezone(tz)

    monkeypatch.setattr(web, 'datetime', FixedDateTime)
    app, conn = setup
    client = app.test_client()
    response = client.post('/request', data=request_data(client, request_date='2035-07-15'))
    assert response.status_code == 302
    assert latest(conn)['requested_date'] == '2035-07-15'
    for updates in ({'request_date': '2035-07-14'},
                    {'kind': 'taxi', 'pickup': 'Mestia', 'destination': 'Kutaisi', 'departure_time': '01:30'}):
        result = client.post('/request', data=request_data(client, **updates))
        assert result.status_code == 400
    assert conn.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 1


@pytest.mark.parametrize('changes', [
    {'request_date': '2035-02-30'}, {'request_date': 'tomorrow'},
    {'kind': 'taxi', 'pickup': 'Mestia', 'destination': 'Kutaisi', 'departure_time': '25:30'},
    {'kind': 'taxi', 'pickup': '', 'destination': 'Kutaisi'},
    {'privacy_consent': ''}, {'website': 'spam'}, {'csrf_token': 'wrong'},
])
def test_quick_request_rejects_bad_details_and_preserves_security(setup, changes):
    app, conn = setup
    client = app.test_client()
    assert client.post('/request', data=request_data(client, **changes)).status_code == 400
    assert conn.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 0


def test_selected_service_controls_kind_and_rejects_private_or_mismatched_selection(setup):
    app, conn = setup
    taxi = conn.execute("SELECT id FROM services WHERE kind='taxi' AND published=1 LIMIT 1").fetchone()[0]
    private = conn.execute('SELECT id FROM services WHERE published=0 LIMIT 1').fetchone()[0]
    client = app.test_client()
    page = client.get(f'/request?kind=tour&service_id={taxi}')
    assert page.status_code == 200
    assert 'id="kind" name="kind" value="taxi"' in page.text
    for value in ('missing', '9999999', str(private)):
        assert client.get('/request?service_id=' + value).status_code == 404
    response = client.post('/request', data=request_data(client, service_ids=str(taxi)))
    assert response.status_code == 400
    assert 'matches your request type' in response.text
    assert conn.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 0


def test_pending_enquiry_requires_explicit_quote_schedule(setup):
    app, conn = setup
    guest = app.test_client()
    assert guest.post('/request', data=request_data(guest)).status_code == 302
    enquiry = latest(conn)
    owner = staff_client(app, conn)
    page = owner.get(f"/admin/enquiries/{enquiry['id']}").text
    assert 'Times to agree' in page
    assert 'name="item_start" value=""' in page
    assert 'name="allocation_start" value=""' in page
    assert 'Times to agree' in owner.get('/admin').text
    data = dict(csrf_token='staff-csrf', item_title='Agreed mountain day', item_kind='tour',
                item_quantity='1', item_price='100', expires_local=(datetime.now(timezone.utc)+timedelta(hours=12)).isoformat(),
                deposit='0', terms='Test cancellation terms', policy_version='test-1')
    response = owner.post(f"/admin/enquiries/{enquiry['id']}/quote", data=data, follow_redirects=True)
    assert 'enter a start and end' in response.text
    assert conn.execute('SELECT count(*) FROM quotes').fetchone()[0] == 0
    data.update(item_start='2035-07-15T09:00', item_end='2035-07-15T16:00')
    guide = conn.execute("INSERT INTO resources(provider_id,name,kind,capacity,approved,active) VALUES (1,'Test guide','guide',1,1,1)").lastrowid
    data.update(allocation_resource=str(guide), allocation_item='0', allocation_quantity='1')
    owner.post(f"/admin/enquiries/{enquiry['id']}/quote", data=data)
    item = conn.execute('SELECT * FROM quote_items').fetchone()
    assert item is not None
    assert item['starts_at'] == '2035-07-15T05:00:00Z'
    assert item['ends_at'] == '2035-07-15T12:00:00Z'
    domain.verify_contact(conn, enquiry['id'], 'Guest replied about the schedule')
    domain.accept_quote(conn, item['quote_id'])
    domain.confirm_booking(conn, item['quote_id'])
    exported = owner.get('/admin/export?kind=bookings').text
    assert item['starts_at'] in exported and item['ends_at'] in exported
    assert enquiry['starts_at'] not in exported and enquiry['ends_at'] not in exported


@pytest.mark.parametrize('item_times', [{}, {'starts_at': '2035-07-15T09:00'}, {'ends_at': '2035-07-15T16:00'}])
def test_domain_quote_cannot_fall_back_to_pending_enquiry_bounds(setup, item_times):
    app, conn = setup
    guest = app.test_client()
    assert guest.post('/request', data=request_data(guest)).status_code == 302
    data = dict(expires_at=(datetime.now(timezone.utc)+timedelta(hours=12)).isoformat(),
                terms='Test quote terms', policy_version='test-1',
                items=[dict(title='Mountain day', kind='tour', unit_price_minor=10000, **item_times)])
    with pytest.raises(domain.DomainError, match='agreed start and end'):
        domain.create_quote(conn, latest(conn)['id'], data)
    assert conn.execute('SELECT count(*) FROM quotes').fetchone()[0] == 0
    assert conn.execute('SELECT count(*) FROM allocations').fetchone()[0] == 0


def test_additive_migration_preserves_legacy_rows(tmp_path):
    conn = connect(tmp_path / 'old.sqlite3')
    conn.execute('CREATE TABLE enquiries(id INTEGER PRIMARY KEY, name TEXT, starts_at TEXT)')
    conn.execute("INSERT INTO enquiries VALUES (1,'Existing guest','2035-07-15T09:00:00Z')")
    migrate_enquiry_preferences(conn)
    migrate_enquiry_preferences(conn)
    enquiry = dict(conn.execute('SELECT * FROM enquiries').fetchone())
    assert enquiry == dict(id=1, name='Existing guest', starts_at='2035-07-15T09:00:00Z',
                           requested_date='', requested_time='', timing_pending=0, bundle_request='')
    conn.close()
