"""Search metadata must not leak private data or multiply canonical trip URLs."""
import json
import sqlite3

import pytest
from flask import Flask, g

from mestia.seo import build_metadata, public_origin, service_url, sitemap_entries


ORIGIN = 'https://mestia.example'
SETTINGS = {'business_name': 'Mestia Travel', 'whatsapp_number': '995593282478',
            'contact_email': 'hello@example.test', 'address': 'Owner supplied address',
            'guesthouse_instagram_url': 'https://www.instagram.com/riverside_svaneti/',
            'guide_instagram_url': 'https://www.instagram.com/guledaniakaki/'}
SERVICE = {'id': 42, 'slug': 'ushguli-day', 'kind': 'tour', 'published': 1,
           'archived_at': None, 'title_en': 'A day in Ushguli', 'description_en': 'A village day from Mestia, with time to stop along the valley.',
           'title_ka': '', 'description_ka': '', 'image_path': '',
           'operator_notes': 'PRIVATE supplier payment notes',
           'research_sources': 'PRIVATE research records', 'price_minor': 1234}


@pytest.fixture
def app():
    application = Flask(__name__)
    application.config.update(PUBLIC_URL=ORIGIN, INDEXING_ENABLED=True)
    for endpoint, path in [('home', '/'), ('services', '/services'),
                           ('service_detail', '/services/<int:service_id>/<slug>'),
                           ('travel_guide', '/visit-svaneti'), ('enquiry_request', '/request'),
                           ('admin_service_preview', '/admin/services/42/preview'),
                           ('status', '/booking/private-token'), ('health', '/health')]:
        application.add_url_rule(path, endpoint, lambda **kwargs: '')
    for path in ('/about', '/terms', '/privacy'):
        application.add_url_rule(path, 'info', lambda: '') if path == '/about' else application.add_url_rule(path, 'info')
    return application


def metadata(app, path='/', service=None, lang='en', **kwargs):
    with app.test_request_context(path, **kwargs):
        g.lang = lang
        return build_metadata(SETTINGS, service)


def test_canonical_origin_never_comes_from_untrusted_host_or_tracking(app):
    result = metadata(app, '/?utm_source=instagram&lang=en', base_url='https://attacker.example')
    assert result['canonical'] == ORIGIN + '/'
    assert result['og']['url'] == ORIGIN + '/'
    assert all(item['url'].startswith(ORIGIN + '/') for item in result['alternates'])
    assert 'attacker' not in json.dumps(result)
    assert result['indexable']


@pytest.mark.parametrize('origin', ['', 'http://mestia.example', '//mestia.example',
                                   'https://user:secret@mestia.example', 'https://mestia.example/subpath',
                                   'https://mestia.example?tracking=1', 'https://mestia.example/#fragment',
                                   'https://mestia.example:bad', 'https://mestia.example\\@evil.example'])
def test_missing_or_invalid_deployment_origin_cannot_create_indexable_urls(app, origin):
    app.config['PUBLIC_URL'] = origin
    result = metadata(app)
    assert result['robots'] == 'noindex, follow'
    assert result['canonical'] is None and result['structured_data'] is None
    assert not result['alternates'] and not result['og']
    with app.app_context():
        assert sitemap_entries(None) == []


def test_public_origin_normalizes_host_and_optional_slash(app):
    app.config['PUBLIC_URL'] = 'https://MESTIA.example:443/'
    with app.app_context():
        assert public_origin() == ORIGIN


def test_indexing_requires_explicit_launch_configuration(app):
    app.config.pop('INDEXING_ENABLED')
    result = metadata(app)
    assert result['robots'] == 'noindex, follow' and not result['alternates']
    assert result['canonical'] == ORIGIN + '/'
    with app.app_context():
        assert sitemap_entries(None) == []


@pytest.mark.parametrize('path', ['/request', '/booking/private-token?email=secret@example.test',
                                 '/admin/services/42/preview', '/health', '/unknown'])
def test_private_pages_never_receive_public_service_or_social_metadata(app, path):
    result = metadata(app, path, SERVICE)
    assert result['robots'] == 'noindex, nofollow'
    assert result['canonical'] is None and result['structured_data'] is None
    assert not result['og'] and not result['alternates']
    assert SERVICE['title_en'] not in json.dumps(result)
    assert 'private-token' not in json.dumps(result)


def test_error_rendering_on_public_endpoint_is_not_indexable(app):
    with app.test_request_context('/services/42/ushguli-day'):
        g.seo_error = True
        assert build_metadata(SETTINGS, SERVICE)['canonical'] is None


@pytest.mark.parametrize('changes', [{'published': 0}, {'archived_at': '2026-01-01'}])
def test_draft_and_archived_metadata_cannot_be_exposed_by_caller_error(app, changes):
    result = metadata(app, '/services/42/ushguli-day', dict(SERVICE, **changes))
    assert not result['public']
    assert result['description'] == ''
    assert result['structured_data'] is None


@pytest.mark.parametrize('facet', ['region=Svaneti', 'activity=Walking', 'duration=multi', 'month=7'])
def test_facets_are_followable_but_not_independently_indexable(app, facet):
    result = metadata(app, f'/services?kind=tour&{facet}&utm_source=social&lang=ka', lang='ka')
    assert result['robots'] == 'noindex, follow'
    assert result['canonical'] == ORIGIN + '/services?kind=tour&lang=ka'
    assert not result['alternates']


def test_category_pages_have_distinct_localized_titles_and_reciprocal_alternates(app):
    pages = [metadata(app, '/services' + query) for query in ('', '?kind=tour', '?kind=stay', '?kind=taxi')]
    assert len({page['title'] for page in pages}) == 4
    assert len({page['description'] for page in pages}) == 4
    en = metadata(app, '/services?kind=tour')
    ka = metadata(app, '/services?kind=tour&lang=ka', lang='ka')
    assert en['alternates'] == ka['alternates']
    assert en['title'] != ka['title']
    assert ka['canonical'] == ORIGIN + '/services?kind=tour&lang=ka'


def test_service_canonical_has_stable_id_and_current_slug_not_request_slug(app):
    result = metadata(app, '/services/42/old-title?utm_campaign=summer', SERVICE)
    assert result['canonical'] == ORIGIN + '/services/42/ushguli-day'
    renamed = dict(SERVICE, slug='new-title')
    assert service_url(renamed) == '/services/42/new-title'
    assert service_url(dict(SERVICE, slug='a b?/#'), 'ka') == '/services/42/a%20b%3F%2F%23?lang=ka'


def test_untranslated_service_and_guide_do_not_claim_georgian_content(app):
    page = metadata(app, '/services/42/ushguli-day?lang=ka', SERVICE, 'ka')
    assert page['canonical'] == ORIGIN + '/services/42/ushguli-day'
    assert {alternate['lang'] for alternate in page['alternates']} == {'en', 'x-default'}
    assert page['og']['locale'] == 'en_GB'
    guide = metadata(app, '/visit-svaneti?lang=ka', lang='ka')
    assert guide['canonical'] == ORIGIN + '/visit-svaneti'
    assert {alternate['lang'] for alternate in guide['alternates']} == {'en', 'x-default'}


def test_translated_service_has_georgian_canonical_and_complete_alternates(app):
    service = dict(SERVICE, title_ka='ერთი დღე უშგულში', description_ka='სოფელში გასეირნება მესტიიდან.')
    page = metadata(app, '/services/42/ushguli-day?lang=ka', service, 'ka')
    assert page['canonical'].endswith('?lang=ka')
    assert page['title'].startswith(service['title_ka'])
    assert len(page['alternates']) == 3


def test_structured_data_is_truthful_public_content_without_offers_or_notes(app):
    page = metadata(app, '/services/42/ushguli-day', SERVICE)
    data = page['structured_data']
    graph = {node['@type']: node for node in data['@graph']}
    assert graph['TouristTrip']['name'] == SERVICE['title_en']
    assert [item['position'] for item in graph['BreadcrumbList']['itemListElement']] == [1, 2, 3]
    serialized = json.dumps(data)
    for excluded in ('PRIVATE', 'operator_notes', 'research_sources', '1234', 'Offer', 'AggregateRating', 'availability'):
        assert excluded not in serialized
    agency = next(node for node in metadata(app)['structured_data']['@graph'] if node['@type'] == 'TravelAgency')
    assert agency['telephone'] == '+995593282478'
    assert agency['address'] == SETTINGS['address']
    assert 'sameAs' not in agency


def test_stay_uses_service_schema_not_unverified_hotel_inventory(app):
    page = metadata(app, '/services/42/ushguli-day', dict(SERVICE, kind='stay'))
    types = [node['@type'] for node in page['structured_data']['@graph']]
    assert 'Service' in types and 'TouristTrip' not in types and 'Hotel' not in types


@pytest.mark.parametrize('image', ['https://evil.example/photo.jpg', '//evil.example/photo.jpg',
                                  'javascript:alert(1)', '/media/../../admin/photo.jpg',
                                  '/static/../media/private.png', '/media/not-an-upload.jpg'])
def test_external_or_unsafe_social_images_use_local_brand_art(app, image):
    result = metadata(app, '/services/42/ushguli-day', dict(SERVICE, image_path=image))
    assert result['og']['image'] == ORIGIN + '/static/social-card.png'


def test_real_uploaded_image_can_be_shared(app):
    image = '/media/' + 'a' * 32 + '.webp'
    result = metadata(app, '/services/42/ushguli-day', dict(SERVICE, image_path=image))
    assert result['og']['image'] == ORIGIN + image
    assert result['twitter']['image'] == ORIGIN + image


def test_sitemap_only_published_current_records_and_genuine_lastmod(app):
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute('CREATE TABLE services(id INTEGER, slug TEXT, title_ka TEXT, description_ka TEXT, updated_at TEXT, published INTEGER, archived_at TEXT)')
    conn.executemany('INSERT INTO services VALUES (?,?,?,?,?,?,?)', [
        (1, 'published', '', '', '2025-06-01 12:00:00', 1, None),
        (2, 'draft', '', '', '2025-06-01', 0, None),
        (3, 'deleted', '', '', '2025-06-01', 1, '2025-06-01'),
        (4, 'translated', 'ქართული', 'აღწერა', '2025-06-01T23:30:00-02:00', 1, None),
        (5, 'invalid-date', '', '', 'not-a-date', 1, None),
        (6, 'future-date', '', '', '2999-01-01', 1, None),
    ])
    with app.app_context():
        entries = sitemap_entries(conn)
    conn.close()
    urls = {entry['loc'] for entry in entries}
    assert len(urls) == len(entries)
    assert ORIGIN + '/services/1/published' in urls
    assert ORIGIN + '/services/1/published?lang=ka' not in urls
    assert ORIGIN + '/services/4/translated?lang=ka' in urls
    assert not any('draft' in url or 'deleted' in url or '/request' in url for url in urls)
    assert ORIGIN + '/visit-svaneti?lang=ka' not in urls
    by_url = {entry['loc']: entry for entry in entries}
    assert by_url[ORIGIN + '/services/1/published']['lastmod'] == '2025-06-01'
    assert by_url[ORIGIN + '/services/4/translated']['lastmod'] == '2025-06-02'
    assert by_url[ORIGIN + '/']['lastmod'] is None
    assert by_url[ORIGIN + '/services/5/invalid-date']['lastmod'] is None
    assert by_url[ORIGIN + '/services/6/future-date']['lastmod'] is None
