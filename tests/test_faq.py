"""The public FAQ leads back to real listings and has honest language metadata."""
from html.parser import HTMLParser
import json
from xml.etree import ElementTree as ET

import pytest

from mestia import create_app


class FaqPage(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links, self.metas, self.article_links, self.schema = [], [], [], []
        self.in_article = self.in_schema = False
        self.article_language = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link':
            self.links.append(attrs)
        elif tag == 'meta':
            self.metas.append(attrs)
        elif tag == 'article':
            self.in_article = True
            self.article_language = attrs.get('lang')
        elif tag == 'a' and self.in_article:
            self.article_links.append(attrs['href'])
        elif tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.schema.append('')
            self.in_schema = True

    def handle_data(self, value):
        if self.in_schema:
            self.schema[-1] += value

    def handle_endtag(self, tag):
        if tag == 'article':
            self.in_article = False
        elif tag == 'script':
            self.in_schema = False


@pytest.fixture
def site(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'faq-integration-test-secret-long-enough',
                      'DATABASE': str(tmp_path / 'faq.sqlite3'), 'MEDIA_DIR': str(tmp_path / 'media'),
                      'PUBLIC_URL': 'https://mestia.example', 'INDEXING_ENABLED': True})
    return app, app.test_client()


@pytest.mark.parametrize('query', ['', '?lang=ka&utm_source=example'])
def test_faq_english_article_has_one_trusted_canonical_and_language(site, query):
    _, guest = site
    response = guest.get('/faq' + query, headers={'Host': 'injected.invalid'})
    assert response.status_code == 200
    page = FaqPage(response.text)
    assert [item['content'] for item in page.metas if item.get('name') == 'robots'] == ['index, follow, max-image-preview:large']
    assert page.article_language == 'en'
    assert [item['href'] for item in page.links if item.get('rel') == 'canonical'] == ['https://mestia.example/faq']
    assert {item['hreflang'] for item in page.links if item.get('hreflang')} == {'en', 'x-default'}
    assert 'injected.invalid' not in response.text
    graph = json.loads(page.schema[0])['@graph']
    webpage = next(node for node in graph if node['@type'] == 'WebPage')
    assert webpage['inLanguage'] == 'en'
    assert webpage['url'] == 'https://mestia.example/faq'
    assert not any(node['@type'] in {'Offer', 'AggregateRating'} for node in graph)


def test_faq_catalogue_first_then_specific_help_then_custom_contact(site):
    _, guest = site
    response = guest.get('/faq')
    page = FaqPage(response.text)
    assert page.article_links[0].startswith('/services')
    custom_index = next(i for i, href in enumerate(page.article_links) if href.startswith('/request'))
    assert 'kind=combined' in page.article_links[custom_index]
    assert any(href.startswith('/visit-svaneti') for href in page.article_links[:custom_index])
    assert any(href.startswith('/terms') for href in page.article_links[:custom_index])
    assert page.article_links[custom_index - 1].startswith('/services')
    for href in page.article_links:
        if href.startswith('/'):
            assert guest.get(href).status_code == 200
    assert 'Your place is confirmed only after' in response.text
    assert 'Opening a link does not send a message.' in response.text


def test_faq_sitemap_tracks_launch_setting_and_does_not_claim_georgian_article(site):
    app, guest = site
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    sitemap = ET.fromstring(guest.get('/sitemap.xml').data)
    locations = [node.text for node in sitemap.findall('s:url/s:loc', ns)]
    assert locations.count('https://mestia.example/faq') == 1
    assert 'https://mestia.example/faq?lang=ka' not in locations
    app.config['INDEXING_ENABLED'] = False
    assert 'noindex' in guest.get('/faq').headers['X-Robots-Tag']
    assert guest.get('/sitemap.xml').status_code == 404
    app.config['PUBLIC_URL'] = ''
    page = FaqPage(guest.get('/faq').text)
    assert not any(link.get('rel') == 'canonical' for link in page.links)
    assert not page.schema
