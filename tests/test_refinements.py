"""Catalogue simplicity and continuity through validation and navigation."""
import json
from urllib.parse import parse_qs, urlsplit

from test_catalogue_booking import Page
from test_quick_requests import request_data
from test_stay_offer import site, send_bundle
from mestia.offers import snapshot


def test_public_catalogue_has_choices_not_free_text_search(site):
    app, conn, tour, stay = site
    client = app.test_client()
    for path in ('/', '/?lang=ka', '/services', '/services?kind=tour', '/services?kind=taxi'):
        response = client.get(path)
        assert response.status_code == 200
        assert not any(tag == 'input' and (a.get('type') == 'search' or a.get('name') == 'q')
                       for tag, a in Page(response.text).elements)
    home = client.get('/').text
    assert home.count('class="trip-card"') == 3
    assert 'mood-section' not in home and 'hero-postcard' not in home
    assert 'data-destination-showcase' in home
    assert '10% off your tour' in home


def test_filters_are_optional_and_scoped_to_service_category(site):
    app, conn, tour, stay = site
    conn.execute("UPDATE services SET activity='Transfer-only choice',difficulty='Road ride only' WHERE kind='taxi'")
    guest = app.test_client()
    page = guest.get('/services?kind=tour')
    panel = next(a for tag, a in Page(page.text).elements if a.get('class') == 'catalogue-filter-panel')
    assert 'open' not in panel
    assert 'Transfer-only choice' not in page.text and 'Road ride only' not in page.text
    active = guest.get('/services?kind=tour&month=7')
    panel = next(a for tag, a in Page(active.text).elements if a.get('class') == 'catalogue-filter-panel')
    assert 'open' in panel
    assert 'Transfer-only choice' in guest.get('/services?kind=taxi').text


def test_bundle_survives_tabs_clear_back_change_and_slug_redirect(site):
    app, _, tour, _ = site
    guest = app.test_client()
    catalogue = guest.get('/services?kind=tour&month=7&bundle=1')
    for link in Page(catalogue.text).links():
        href = link.get('href', '')
        if href.startswith('/services?') and not link.get('class') and 'bundle=1' in href:
            assert guest.get(href).status_code == 200
    for path in [f'/services/{tour["id"]}', f'/services/{tour["id"]}/old-slug']:
        response = guest.get(path + '?bundle=1&lang=ka')
        assert response.status_code == 301
        assert parse_qs(urlsplit(response.location).query) == {'lang': ['ka'], 'bundle': ['1']}
    request = guest.get(f'/request?service_id={tour["id"]}&bundle=1')
    links = [a['href'] for a in Page(request.text).links() if a.get('href', '').startswith('/services?')]
    assert any('bundle=1' in href and 'kind=tour' in href for href in links)


def test_changed_promotion_requires_review_instead_of_silent_rate_change(site):
    app, conn, tour, _ = site
    guest = app.test_client()
    data = request_data(guest, service_ids=str(tour['id']), add_stay='on',
                        bundle_check_in='2035-07-14', bundle_check_out='2035-07-17')
    page = guest.get(f'/request?service_id={tour["id"]}&bundle=1')
    data['stay_offer_version'] = next(a['value'] for _, a in Page(page.text).elements if a.get('name') == 'stay_offer_version')
    conn.execute("UPDATE settings SET value='5' WHERE key='stay_tour_percent'")
    response = guest.post('/request', data=data)
    assert response.status_code == 400 and 'offer has changed' in response.text
    assert conn.execute('SELECT count(*) FROM enquiries').fetchone()[0] == 0
    assert '2035-07-14' in response.text
    data['stay_offer_version'] = next(a['value'] for _, a in Page(response.text).elements if a.get('name') == 'stay_offer_version')
    assert guest.post('/request', data=data).status_code == 302
    assert json.loads(conn.execute('SELECT bundle_request FROM enquiries').fetchone()[0])['percent'] == 5


def test_unopened_booking_form_explains_why_before_submission(site):
    app, conn, tour, _ = site
    conn.execute("UPDATE settings SET value='' WHERE key='privacy_notice'")
    response = app.test_client().get(f'/request?service_id={tour["id"]}')
    assert 'Online requests are not open yet.' in response.text
    button = next(a for tag, a in Page(response.text).elements if tag == 'button' and a.get('type') == 'submit')
    assert 'disabled' in button and button['aria-describedby'] == 'request-opening-note'


def test_malformed_offer_snapshots_are_not_advertised_as_valid():
    for value in ('[]', '{', '{"percent":10}', json.dumps(dict(percent=True, stay_id=1, terms='terms', check_in='2035-01-01', check_out='2035-01-02'))):
        assert snapshot(value) == {}


def test_long_georgian_terms_fit_the_offer_snapshot(site):
    app, conn, tour, _ = site
    terms = 'პირობები ' * 400
    conn.execute("UPDATE settings SET value=? WHERE key='stay_tour_terms'", (terms,))
    assert send_bundle(app, tour)[1].status_code == 302
    saved = conn.execute('SELECT bundle_request FROM enquiries').fetchone()[0]
    assert len(saved) < 10000
    assert json.loads(saved)['terms'] == terms.strip()
