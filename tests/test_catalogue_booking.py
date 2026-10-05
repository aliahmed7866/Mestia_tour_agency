"""The public catalogue should hand a chosen activity directly to a request."""
from html import unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import pytest

from mestia import create_app
from mestia.business_content import WHATSAPP_CARD_LINK, whatsapp_contact
from mestia.db import connect


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.elements = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

    def links(self):
        return [attrs for tag, attrs in self.elements if tag == 'a']


@pytest.fixture
def site(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'catalogue-booking-test-key-32-characters',
                      'DATABASE': str(tmp_path / 'site.sqlite3'), 'MEDIA_DIR': str(tmp_path / 'media'),
                      'PUBLIC_URL': 'https://mestia.example', 'INDEXING_ENABLED': True})
    conn = connect(app.config['DATABASE'])
    conn.execute("UPDATE settings SET value='Test privacy notice' WHERE key='privacy_notice'")
    service = dict(conn.execute("SELECT * FROM services WHERE published=1 AND preset_key<>'' ORDER BY id LIMIT 1").fetchone())
    yield app.test_client(), conn, service
    conn.close()


def test_catalogue_to_short_booking_request_retains_selection_and_does_not_confirm(site):
    client, conn, service = site
    catalogue = Page(client.get('/services?kind=tour').text)
    booking = next(link['href'] for link in catalogue.links()
                   if link.get('class') == 'trip-request' and f'service_id={service["id"]}&' in link['href'])
    page = client.get(booking)
    assert page.status_code == 200
    controls = Page(page.text).elements
    assert any(tag == 'input' and attrs.get('name') == 'service_ids'
               and attrs.get('type') == 'hidden' and attrs['value'] == str(service['id'])
               for tag, attrs in controls)
    assert not any('data-kind-choice' in attrs or 'data-service-select' in attrs for _, attrs in controls)
    assert 'Send booking request' in page.text
    with client.session_transaction() as session:
        data = {'csrf_token': session['csrf_token'], 'request_key': session['request_key']}
    data.update(request_format='quick', kind=service['kind'], service_ids=str(service['id']),
                request_date='2035-08-15', party_size='3', name='Maya', contact='+995555123456',
                privacy_consent='on', notes='We can travel a day later too.')
    invalid = client.post('/request', data=dict(data, contact='bad'))
    assert invalid.status_code == 400
    assert f'name="service_ids" value="{service["id"]}"' in invalid.text
    assert 'We can travel a day later too.' in invalid.text
    sent = client.post('/request', data=data)
    assert sent.status_code == 302 and '/booking/' in sent.location
    enquiry = conn.execute('SELECT * FROM enquiries').fetchone()
    assert enquiry['service_id'] == service['id']
    assert enquiry['requested_date'] == '2035-08-15' and enquiry['party_size'] == 3
    assert service['title_en'] in enquiry['notes']
    assert conn.execute('SELECT count(*) FROM bookings').fetchone()[0] == 0
    assert conn.execute('SELECT count(*) FROM allocations').fetchone()[0] == 0


def test_activity_whatsapp_prefills_title_public_link_and_editable_fields(site):
    client, conn, service = site
    title = 'Ushguli & towers — a "slow" day?'
    conn.execute('UPDATE services SET title_en=? WHERE id=?', (title, service['id']))
    conn.execute("UPDATE settings SET value='995555123456' WHERE key='whatsapp_number'")
    response = client.get(f'/services/{service["id"]}/{service["slug"]}', headers={'Host': 'untrusted.example'})
    assert response.status_code == 200
    links = [link['href'] for link in Page(response.text).links() if '?text=' in link.get('href', '')]
    assert links
    for link in links:
        parts = urlsplit(link)
        assert parts.netloc == 'wa.me' and parts.path == '/995555123456'
        text = parse_qs(parts.query)['text'][0]
        assert title in text and 'Preferred date:' in text and 'Guests:' in text
        assert f'https://mestia.example/services/{service["id"]}/{service["slug"]}' in text
        assert 'untrusted.example' not in text
    assert 'data-activity-message-text' not in response.text


def test_qr_only_shows_editable_copy_fallback_without_claiming_prefill(site):
    client, conn, service = site
    response = client.get(f'/services/{service["id"]}/{service["slug"]}')
    assert response.status_code == 200
    page = Page(response.text)
    assert any(tag == 'textarea' and 'data-activity-message-text' in attrs and 'readonly' not in attrs
               for tag, attrs in page.elements)
    assert any(link.get('href') == WHATSAPP_CARD_LINK for link in page.links())
    assert WHATSAPP_CARD_LINK + '?text=' not in response.text
    assert service['title_en'] in unescape(response.text)


def test_local_termux_draft_uses_reference_instead_of_unusable_local_link(site):
    client, conn, service = site
    client.application.config['PUBLIC_URL'] = ''
    response = client.get(f'/services/{service["id"]}/{service["slug"]}')
    assert f'Activity reference: {service["id"]}' in response.text
    assert 'http://localhost/services/' not in response.text


def test_direct_number_link_supports_prefill_but_qr_does_not():
    message = 'Interested in: Lakes & mountains?\nGuests: 2'
    url, prefilled = whatsapp_contact({'whatsapp_link': 'https://wa.me/995555123456'}, message)
    assert prefilled and parse_qs(urlsplit(url).query)['text'] == [message]
    assert whatsapp_contact({'whatsapp_link': WHATSAPP_CARD_LINK}, message) == (WHATSAPP_CARD_LINK, False)
