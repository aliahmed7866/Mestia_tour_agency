"""Search output stays public, stable, and separate from guest operations."""
from html.parser import HTMLParser
import json
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

import pytest

from mestia import create_app, public_origin
from mestia.db import connect


class Head(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.metas, self.links, self.titles, self.schema = [], [], [], []
        self.active = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.metas.append(attrs)
        if tag == 'link':
            self.links.append(attrs)
        if tag == 'title':
            self.titles.append('')
            self.active = 'title'
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.schema.append({'text': '', 'nonce': attrs.get('nonce')})
            self.active = 'schema'

    def handle_data(self, value):
        if self.active == 'title':
            self.titles[-1] += value
        elif self.active == 'schema':
            self.schema[-1]['text'] += value

    def handle_endtag(self, tag):
        if tag in ('title', 'script'):
            self.active = None


@pytest.fixture
def site(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'seo-integration-test-secret-long-enough',
                      'DATABASE': str(tmp_path / 'seo.sqlite3'), 'MEDIA_DIR': str(tmp_path / 'media'),
                      'PUBLIC_URL': 'https://mestia.example', 'INDEXING_ENABLED': True})
    conn = connect(app.config['DATABASE'])
    yield app, app.test_client(), conn
    conn.close()


def test_public_heads_have_unique_metadata_safe_origins_and_valid_schema(site):
    app, guest, conn = site
    offer = dict(conn.execute('SELECT * FROM services WHERE published=1 LIMIT 1').fetchone())
    paths = ['/', '/services', '/services?kind=tour', '/services?kind=stay',
             '/services?kind=taxi', '/about', '/visit-svaneti', f'/services/{offer["id"]}/{offer["slug"]}']
    titles = set()
    for path in paths:
        response = guest.get(path, headers={'Host': 'injected.invalid', 'X-Forwarded-Host': 'injected.invalid'})
        assert response.status_code == 200
        head = Head(response.text)
        assert len(head.titles) == 1 and head.titles[0] and head.titles[0] not in titles
        titles.add(head.titles[0])
        descriptions = [m for m in head.metas if m.get('name') == 'description']
        assert len(descriptions) == 1 and descriptions[0]['content']
        canonicals = [l for l in head.links if l.get('rel') == 'canonical']
        assert len(canonicals) == 1 and canonicals[0]['href'].startswith('https://mestia.example/')
        assert 'injected.invalid' not in response.text
        assert len(head.schema) == 1
        graph = json.loads(head.schema[0]['text'])['@graph']
        assert graph and head.schema[0]['nonce']
        assert "'nonce-" + head.schema[0]['nonce'] + "'" in response.headers['Content-Security-Policy']


def test_language_is_stable_and_filters_have_one_canonical(site):
    _, guest, _ = site
    assert '<html lang="ka">' in guest.get('/?lang=ka').text
    assert '<html lang="en">' in guest.get('/').text
    response = guest.get('/services?kind=tour&month=7&region=Svaneti&utm_source=example')
    assert response.headers['X-Robots-Tag'] == 'noindex, follow'
    head = Head(response.text)
    assert [l['href'] for l in head.links if l.get('rel') == 'canonical'] == ['https://mestia.example/services?kind=tour']
    assert not [l for l in head.links if l.get('hreflang')]
    guide = Head(guest.get('/visit-svaneti?lang=ka').text)
    assert not [l for l in guide.links if l.get('hreflang') == 'ka']
    assert [l['href'] for l in guide.links if l.get('rel') == 'canonical'] == ['https://mestia.example/visit-svaneti']


def test_legacy_and_renamed_slugs_redirect_but_private_offers_do_not(site):
    _, guest, conn = site
    offer = dict(conn.execute('SELECT * FROM services WHERE published=1 LIMIT 1').fetchone())
    old = f'/services/{offer["id"]}/{offer["slug"]}'
    response = guest.get(f'/services/{offer["id"]}?lang=ka&utm_source=discard')
    assert response.status_code == 301 and response.location == old + '?lang=ka'
    conn.execute("UPDATE services SET slug='new-owner-route' WHERE id=?", (offer['id'],))
    response = guest.get(old)
    assert response.status_code == 301 and response.location.endswith('/new-owner-route')
    conn.execute('UPDATE services SET published=0 WHERE id=?', (offer['id'],))
    assert guest.get(old).status_code == 404
    assert guest.get(f'/services/{offer["id"]}').status_code == 404


def test_sitemap_tracks_publication_and_robots_allows_reading_noindex(site):
    _, guest, conn = site
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    def locations():
        response = guest.get('/sitemap.xml', headers={'Host': 'spoof.invalid'})
        assert response.status_code == 200 and response.mimetype == 'application/xml'
        assert 'Set-Cookie' not in response.headers
        return [node.text for node in ET.fromstring(response.data).findall('s:url/s:loc', ns)]
    urls = locations()
    assert len(urls) == len(set(urls))
    for url in urls:
        parsed = urlsplit(url)
        assert parsed.netloc == 'mestia.example'
        assert guest.get(parsed.path + ('?' + parsed.query if parsed.query else '')).status_code == 200
        assert not any(part in url for part in ('/booking', '/admin', '/request', '/health', 'month='))
    draft = dict(conn.execute('SELECT * FROM services WHERE published=0 LIMIT 1').fetchone())
    fragment = f'/services/{draft["id"]}/'
    assert not any(fragment in url for url in urls)
    conn.execute('UPDATE services SET published=1 WHERE id=?', (draft['id'],))
    assert any(fragment in url for url in locations())
    conn.execute("UPDATE services SET archived_at='2026-10-05T18:00:00Z' WHERE id=?", (draft['id'],))
    assert not any(fragment in url for url in locations())
    robots = guest.get('/robots.txt')
    assert 'Allow: /' in robots.text and 'Disallow:' not in robots.text
    assert 'Sitemap: https://mestia.example/sitemap.xml' in robots.text
    assert 'Set-Cookie' not in robots.headers


@pytest.mark.parametrize('path', ['/request', '/admin/login', '/booking/not-a-real-token', '/health', '/does-not-exist'])
def test_private_operational_and_error_responses_are_not_indexable(site, path):
    _, guest, _ = site
    response = guest.get(path)
    assert 'noindex' in response.headers['X-Robots-Tag']
    head = Head(response.text)
    assert not head.schema and not [l for l in head.links if l.get('rel') == 'canonical']
    if path.startswith(('/request', '/admin', '/booking')):
        assert response.headers['Cache-Control'] == 'no-store'


def test_jsonld_cannot_break_out_or_leak_research(site):
    _, guest, conn = site
    offer = dict(conn.execute('SELECT * FROM services WHERE published=1 LIMIT 1').fetchone())
    conn.execute("UPDATE services SET title_en=?,operator_notes='PRIVATE-RESEARCH' WHERE id=?",
                 ('A route </script><script>alert(1)</script>', offer['id']))
    response = guest.get(f'/services/{offer["id"]}/{offer["slug"]}')
    assert '<script>alert(1)</script>' not in response.text and 'PRIVATE-RESEARCH' not in response.text
    data = json.loads(Head(response.text).schema[0]['text'])
    assert not any(item['@type'] == 'Offer' for item in data['@graph'])


def test_preview_config_and_static_assets_are_safe(site):
    app, guest, _ = site
    asset = guest.get('/static/style.css')
    assert 'Set-Cookie' not in asset.headers and 'Cookie' not in asset.headers.get('Vary', '')
    assert 'max-age=3600' in asset.headers['Cache-Control']
    app.config.update(PUBLIC_URL='', INDEXING_ENABLED=False)
    assert guest.get('/sitemap.xml').status_code == 404
    assert 'Disallow: /' in guest.get('/robots.txt').text
    page = guest.get('/')
    assert 'noindex' in page.headers['X-Robots-Tag']
    assert not [l for l in Head(page.text).links if l.get('rel') == 'canonical']


@pytest.mark.parametrize('value', ['http://example.com', 'https://user:pass@example.com',
                                  'https://example.com/path', 'https://example.com?x=1',
                                  'https://example.com\nHEADER=oops', 'https://example.com:0'])
def test_invalid_public_origin_is_rejected(value):
    with pytest.raises(ValueError):
        public_origin(value)
