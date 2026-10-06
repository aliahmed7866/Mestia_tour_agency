import json
import re
from urllib.parse import urlencode

import pytest

from mestia import create_app
from mestia.db import connect, init_db
from mestia.offers import apply_to_quote, current_offer
from test_quick_requests import request_data, staff_client


@pytest.fixture
def site(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'stay-offer-test-secret-long-enough',
                      'DATABASE': str(tmp_path / 'offers.sqlite3'), 'MEDIA_DIR': str(tmp_path / 'media'),
                      'REQUIRE_TOTP': False, 'SESSION_COOKIE_SECURE': False,
                      'PUBLIC_URL': 'https://mestia.example', 'INDEXING_ENABLED': True})
    conn = connect(app.config['DATABASE'])
    conn.execute("UPDATE settings SET value='Test privacy notice' WHERE key='privacy_notice'")
    tour = dict(conn.execute("SELECT * FROM services WHERE kind='tour' AND published=1 AND preset_key<>'' LIMIT 1").fetchone())
    stay = dict(conn.execute("SELECT * FROM services WHERE slug='riverside-svaneti-guesthouse'").fetchone())
    yield app, conn, tour, stay
    conn.close()


def send_bundle(app, tour, **changes):
    guest = app.test_client()
    updates = dict(service_ids=str(tour['id']), add_stay='on', bundle_check_in='2035-07-14', bundle_check_out='2035-07-17')
    updates.update(changes)
    data = request_data(guest, **updates)
    page = guest.get('/request?service_id=' + str(tour['id']))
    version = re.search(r'name="stay_offer_version" value="([^"]+)"', page.text)
    if version: data['stay_offer_version'] = version[1]
    response = guest.post('/request', data=data)
    return guest, response


def test_bundle_request_snapshots_offer_and_preserves_booking_boundary(site):
    app, conn, tour, stay = site
    guest, response = send_bundle(app, tour, stay_tour_percent='100')
    assert response.status_code == 302
    e = dict(conn.execute('SELECT * FROM enquiries').fetchone())
    saved = json.loads(e['bundle_request'])
    assert saved['percent'] == 10 and saved['stay_id'] == stay['id']
    assert 'Riverside stay 2035-07-14 to 2035-07-17' in e['notes']
    assert '10%' in guest.get(response.location).text
    for table in ('bookings', 'allocations', 'quotes'):
        assert conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
    conn.execute("UPDATE settings SET value='25' WHERE key='stay_tour_percent'")
    init_db(conn)
    assert json.loads(conn.execute('SELECT bundle_request FROM enquiries').fetchone()[0])['percent'] == 10
    owner = staff_client(app, conn)
    page = owner.get(f'/admin/enquiries/{e["id"]}').text
    assert 'requested · 10%' in page and 'name="apply_stay_offer"' in page
    assert f'value="{stay["id"]}" selected' in page


@pytest.mark.parametrize('changes', [
    {'bundle_check_in': ''}, {'bundle_check_out': 'bad'},
    {'bundle_check_out': '2035-07-14'}, {'bundle_check_in': '2035-07-16'},
    {'bundle_check_out': '2035-07-14'}, {'service_ids': ''},
])
def test_invalid_bundle_request_cannot_create_enquiry(site, changes):
    app, conn, tour, _ = site
    _, response = send_bundle(app, tour, **changes)
    assert response.status_code == 400
    assert conn.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 0


@pytest.mark.parametrize('disable', ['setting', 'stay'])
def test_disabled_offer_hides_and_rejects_stale_requests(site, disable):
    app, conn, tour, stay = site
    if disable == 'setting':
        conn.execute("UPDATE settings SET value='0' WHERE key='stay_tour_enabled'")
    else:
        conn.execute('UPDATE services SET published=0 WHERE id=?', (stay['id'],))
    init_db(conn)
    guest = app.test_client()
    assert 'class="wrap stay-offer"' not in guest.get('/').text
    assert 'name="add_stay"' not in guest.get('/request?service_id=' + str(tour['id'])).text
    assert send_bundle(app, tour)[1].status_code == 400


def quote_items(tour, stay):
    return [dict(kind='tour', service_id=tour['id'], unit_price_minor=20001, quantity=2,
                 starts_at='2035-07-15T06:00:00Z', ends_at='2035-07-15T14:00:00Z', inclusions='Guiding'),
            dict(kind='stay', service_id=stay['id'], unit_price_minor=9000, quantity=2,
                 starts_at='2035-07-13T20:00:00Z', ends_at='2035-07-16T20:00:00Z', inclusions='Room'),
            dict(kind='taxi', service_id=None, unit_price_minor=5000, quantity=1,
                 starts_at='2035-07-14T06:00:00Z', ends_at='2035-07-14T14:00:00Z', inclusions='Transfer')]


def test_discount_is_exact_per_unit_and_excludes_stay_and_transport(site):
    _, conn, tour, stay = site
    items = quote_items(tour, stay)
    terms = apply_to_quote(conn, items, dict(percent=10, stay_id=stay['id'], terms='Saved conditions'), 'GEL')
    assert [x['unit_price_minor'] for x in items] == [18001, 9000, 5000]
    assert 'Original unit price 200.01 GEL; saving 20.00 GEL per unit' in items[0]['inclusions']
    assert 'Saved conditions' in terms


@pytest.mark.parametrize('bad', ['missing_stay', 'outside_dates', 'partner_tour', 'no_catalogue', 'invalid_percent'])
def test_discount_requires_real_eligible_items(site, bad):
    _, conn, tour, stay = site
    items = quote_items(tour, stay)
    offer = dict(percent=10, stay_id=stay['id'], terms='Saved conditions')
    if bad == 'missing_stay': items.pop(1)
    if bad == 'outside_dates': items[0]['starts_at'] = items[0]['ends_at'] = '2035-07-20T06:00:00Z'
    if bad == 'partner_tour':
        conn.execute("INSERT INTO providers(id,name,kind,approved) VALUES (2,'Partner','guide',1)")
        conn.execute('UPDATE services SET provider_id=2 WHERE id=?', (tour['id'],))
    if bad == 'no_catalogue': items[0]['service_id'] = None
    if bad == 'invalid_percent': offer['percent'] = 150
    with pytest.raises(ValueError): apply_to_quote(conn, items, offer, 'GEL')


def test_admin_quote_records_actual_discount_and_settings_cannot_rewrite_it(site):
    app, conn, tour, stay = site
    assert send_bundle(app, tour)[1].status_code == 302
    e = dict(conn.execute('SELECT * FROM enquiries').fetchone())
    owner = staff_client(app, conn)
    payload = dict(csrf_token='staff-csrf', item_title=['Mountain day', 'Riverside stay'],
                   item_kind=['tour', 'tour'], item_service_id=[str(tour['id']), str(stay['id'])],
                   item_quantity=['1', '2'], item_price=['200', '90'],
                   item_start=['2035-07-15T09:00', '2035-07-14T00:00'],
                   item_end=['2035-07-15T17:00', '2035-07-17T00:00'],
                   expires_local='2035-06-01T12:00', deposit='0', terms='Agreed terms', policy_version='offer-v1',
                   apply_stay_offer='on')
    response = owner.post(f'/admin/enquiries/{e["id"]}/quote', data=payload, follow_redirects=True)
    assert response.status_code == 200
    quote = dict(conn.execute('SELECT * FROM quotes').fetchone())
    assert quote['total_minor'] == 36000  # 180 tour + two units at 90 for stay
    assert '10% off eligible' in quote['terms']
    conn.execute("UPDATE settings SET value='30' WHERE key='stay_tour_percent'")
    assert dict(conn.execute('SELECT * FROM quotes').fetchone()) == quote


def test_effort_filter_is_public_only_and_noindex(site):
    app, conn, tour, stay = site
    guest = app.test_client()
    conn.execute("UPDATE services SET difficulty='Distinct effort value' WHERE id=?", (tour['id'],))
    path = '/services?' + urlencode({'difficulty': 'Distinct effort value'})
    page = guest.get(path)
    assert page.status_code == 200 and 'noindex' in page.headers['X-Robots-Tag']
    assert tour['title_en'] in page.text
    conn.execute('UPDATE services SET published=0 WHERE id=?', (tour['id'],))
    assert '0 options to explore' in guest.get(path).text
    legacy = guest.get('/services?q=old+search&kind=tour&bundle=1&lang=ka')
    assert legacy.status_code == 302 and 'q=' not in legacy.location and 'bundle=1' in legacy.location
    assert guest.get(legacy.location).status_code == 200


def test_owner_controls_offer_and_stay_identity_survives_slug_edit(site):
    app, conn, tour, stay = site
    owner = staff_client(app, conn)
    conn.execute("UPDATE services SET slug='our-riverside-home' WHERE id=?", (stay['id'],))
    init_db(conn)
    assert 'class="wrap stay-offer"' in app.test_client().get('/').text
    owner.post('/admin/settings', data=dict(csrf_token='staff-csrf', stay_tour_percent='101'))
    assert conn.execute("SELECT value FROM settings WHERE key='stay_tour_percent'").fetchone()[0] == '10'
    owner.post('/admin/settings', data=dict(csrf_token='staff-csrf', stay_tour_enabled='0', stay_tour_percent='15', stay_tour_terms='Owner terms'))
    init_db(conn)
    assert conn.execute("SELECT value FROM settings WHERE key='stay_tour_percent'").fetchone()[0] == '15'
    assert conn.execute("SELECT value FROM settings WHERE key='stay_tour_enabled'").fetchone()[0] == '0'
    assert 'class="wrap stay-offer"' not in app.test_client().get('/').text


def test_home_quick_choices_follow_current_owner_content_and_publication(site):
    app, conn, _, _ = site
    conn.execute("UPDATE services SET title_en='Our revised village day' WHERE preset_key='svaneti-ushguli-day-v1'")
    page = app.test_client().get('/')
    assert page.status_code == 200 and 'Our revised village day' in page.text
    conn.execute("UPDATE services SET published=0 WHERE preset_key IN ('svaneti-ushguli-day-v1','svaneti-koruldi-4x4-v1','svaneti-chalaadi-v1')")
    home = app.test_client().get('/').text
    assert 'Our revised village day' not in home
    assert home.count('class="trip-card"') == 3
