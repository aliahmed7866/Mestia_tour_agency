"""Public search metadata, built without trusting the request Host header.

Only published catalogue fields enter this module's public output. Canonicals and
sitemaps share the same URL builder so filters, tracking and owner slug edits do
not create competing versions of a trip.
"""
from datetime import datetime, timezone
from html import unescape
import re
from urllib.parse import quote, urlencode, urlsplit

from flask import current_app, g, request


PUBLIC_ENDPOINTS = frozenset({'home', 'services', 'service_detail', 'info', 'travel_guide', 'faq'})
FACETS = frozenset({'region', 'activity', 'duration', 'month', 'difficulty'})
KINDS = frozenset({'tour', 'stay', 'taxi'})
SOCIAL_IMAGE = '/static/social-card.png'


def public_origin():
    """Return a configured HTTPS origin, never a value inferred from Host."""
    value = str(current_app.config.get('PUBLIC_URL') or '').strip()
    if not value or re.search(r'[\s\\]', value):
        return ''
    try:
        parts = urlsplit(value)
        if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
                or parts.path not in ('', '/') or parts.query or parts.fragment
                or parts.port is not None and not 1 <= parts.port <= 65535):
            return ''
        # Hostname syntax is intentionally stricter than a URL parser alone.
        host = parts.hostname.encode('idna').decode('ascii').lower()
        if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host):
            return ''
        port = f':{parts.port}' if parts.port and parts.port != 443 else ''
        return f'https://{host}{port}'
    except (ValueError, UnicodeError):
        return ''


def indexing_enabled():
    return bool(public_origin() and current_app.config.get('INDEXING_ENABLED', False))


def _plain(value, limit=None):
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '', unescape(str(value or '')))).strip()
    if limit and len(text) > limit:
        text = text[:limit - 1].rsplit(' ', 1)[0].rstrip(' ,;:') + '…'
    return text


def _localized(data, field, lang):
    return _plain(data.get(f'{field}_{lang}') or data.get(f'{field}_en') or '')


def _translated(service):
    return bool(_plain(service.get('title_ka')) and _plain(service.get('description_ka')))


def _path(path, lang='en', kind=''):
    params = {}
    if kind in KINDS:
        params['kind'] = kind
    if lang == 'ka':
        params['lang'] = 'ka'
    return path + ('?' + urlencode(params) if params else '')


def service_url(service, lang='en'):
    """Stable numeric identity plus readable, safely encoded current slug."""
    record = dict(service)
    return _path(f'/services/{int(record["id"])}/{quote(str(record["slug"]), safe="")}', lang)


def _alternates(origin, path, kind='', translated=True):
    result = [{'lang': 'en', 'url': origin + _path(path, kind=kind)}]
    if translated:
        result.append({'lang': 'ka', 'url': origin + _path(path, 'ka', kind)})
    result.append({'lang': 'x-default', 'url': origin + _path(path, kind=kind)})
    return result


def _image_url(origin, value):
    """Social metadata never loads owner-entered external or executable URLs."""
    value = str(value or '')
    if (re.fullmatch(r'/media/[a-f0-9]{32}\.(?:jpg|png|webp)', value)
            or re.fullmatch(r'/static/[A-Za-z0-9_/-]+\.(?:jpg|jpeg|png|webp)', value)):
        return origin + value
    return origin + SOCIAL_IMAGE


def _agency(settings, origin, brand):
    agency = {'@type': 'TravelAgency', '@id': origin + '/#organization',
              'name': brand, 'url': origin + '/'}
    phone = str(settings.get('whatsapp_number') or '').strip().lstrip('+')
    if re.fullmatch(r'[1-9][0-9]{6,14}', phone):
        agency['telephone'] = '+' + phone
    email = _plain(settings.get('contact_email') or settings.get('email'))
    if re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
        agency['email'] = email
    if _plain(settings.get('address')):
        agency['address'] = _plain(settings['address'])
    return agency


def build_metadata(settings, service=None):
    """Return safe template-ready metadata for the current public response.

    Error handlers must set ``g.seo_error`` before rendering: an aborted public
    route retains its endpoint name. The response layer also applies noindex to
    non-success status codes. Jinja must serialize structured_data with tojson.
    """
    settings = dict(settings)
    record = dict(service) if service is not None else {}
    lang = 'ka' if g.get('lang') == 'ka' else 'en'
    choose = lambda en, ka: ka if lang == 'ka' else en
    brand = _localized(settings, 'business_name', lang) or _plain(settings.get('business_name')) or 'Mestia Travel'
    endpoint = request.endpoint
    private = (endpoint not in PUBLIC_ENDPOINTS or g.get('seo_error')
               or request.method not in {'GET', 'HEAD'})
    if endpoint == 'service_detail' and (not record or not record.get('published') or record.get('archived_at')):
        private = True
    metadata = {'title': brand, 'description': '', 'robots': 'noindex, nofollow',
                'canonical': None, 'alternates': [], 'og': {}, 'twitter': {},
                'structured_data': None, 'public': False, 'indexable': False}
    if private:
        return metadata

    path, kind, translated, allow_index = request.path, '', True, True
    if endpoint == 'home':
        path = '/'
        title = choose('Mestia tours, Svaneti stays & transfers', 'მესტიის ტურები, განთავსება და ტრანსფერები')
        description = choose('Browse mountain tours from Mestia, guesthouse stays and private transfers. Compare routes and seasons, choose your activity and request a booking.',
                             'დაათვალიერეთ მთის ტურები მესტიიდან, განთავსება და კერძო ტრანსფერები. შეადარეთ მარშრუტები და სეზონები, აირჩიეთ აქტივობა და გაგზავნეთ დაჯავშნის მოთხოვნა.')
    elif endpoint == 'services':
        path = '/services'
        kind = request.args.get('kind', '')
        if kind not in KINDS:
            kind = ''
        titles = {'tour': choose('Mestia & Svaneti tours', 'მესტიისა და სვანეთის ტურები'),
                  'stay': choose('Guesthouse stays in Svaneti', 'განთავსება სვანეთის საოჯახო სასტუმროში'),
                  'taxi': choose('Mestia transfers & Georgia transport', 'მესტიის ტრანსფერები და მგზავრობა საქართველოში'),
                  '': choose('Explore Svaneti: tours, stays & transfers', 'აღმოაჩინეთ სვანეთი: ტურები, განთავსება და ტრანსფერები')}
        descriptions = {
            'tour': choose('Choose a mountain day or a longer journey from Mestia. Compare routes, walking, seasons and practical details, then request your preferred dates.',
                           'აირჩიეთ ერთდღიანი ან მრავალდღიანი მოგზაურობა მესტიიდან. შეადარეთ მარშრუტები, სეზონები და სირთულე; გაგზავნეთ მოთხოვნა სასურველ თარიღებზე.'),
            'stay': choose('Find a base for your Svaneti visit. Read the guesthouse details, choose your dates and send a booking request for your stay.',
                           'იპოვეთ დასარჩენი ადგილი სვანეთში. გაეცანით საოჯახო სასტუმროს, აირჩიეთ თარიღები და გაგზავნეთ დაჯავშნის მოთხოვნა.'),
            'taxi': choose('Browse private transfers, airport pickup and local transport around Mestia and Georgia. Choose your ride and send your dates and group size.',
                           'დაათვალიერეთ კერძო ტრანსფერები, აეროპორტიდან დახვედრა და ადგილობრივი მგზავრობა. აირჩიეთ მგზავრობა და გაგზავნეთ თარიღები და მგზავრთა რაოდენობა.'),
            '': choose('Browse tours, guesthouse stays and transfers in Svaneti and across Georgia. Compare the details, choose an activity and send a booking request.',
                       'დაათვალიერეთ ტურები, განთავსება და ტრანსფერები სვანეთსა და საქართველოში. შეადარეთ დეტალები, აირჩიეთ აქტივობა და გაგზავნეთ დაჯავშნის მოთხოვნა.')}
        title, description = titles[kind], descriptions[kind]
        allow_index = not any(request.args.get(key) for key in FACETS)
    elif endpoint == 'service_detail':
        path = service_url(record)
        translated = _translated(record)
        if lang == 'ka' and not translated:
            # The translated navigation does not make English trip copy Georgian.
            lang = 'en'
        title = _localized(record, 'title', lang)
        description = _localized(record, 'description', lang) or _localized(record, 'details', lang)
        if not description:
            description = choose(f'Explore {title}. See the practical details and request a booking for your preferred dates.',
                                 f'გაეცანით შეთავაზებას: {title}. გაგზავნეთ დაჯავშნის მოთხოვნა სასურველ თარიღებზე.')
    elif endpoint == 'faq':
        path = '/faq'
        # Navigation is translated; the FAQ article is English until reviewed.
        translated = False
        lang = 'en'
        title = 'Booking questions: tours, stays & transfers'
        description = 'How to request a Svaneti trip, check prices and inclusions, plan around the weather, and follow your booking. Practical answers before you choose.'
    elif endpoint == 'travel_guide':
        path = '/visit-svaneti'
        # The researched article is English until its Georgian body is reviewed.
        translated = False
        lang = 'en'
        title = choose('Visit Svaneti: seasons, routes & getting to Mestia', 'ეწვიეთ სვანეთს: სეზონები, მარშრუტები და მგზავრობა')
        description = choose('Plan a Svaneti trip with practical notes on when to visit, getting to Mestia, mountain walking and routes around Ushguli. Leave room for the weather.',
                             'დაგეგმეთ სვანეთში მოგზაურობა: როდის ეწვიოთ, როგორ ჩახვიდეთ მესტიაში და რა გაითვალისწინოთ მთაში სიარულისა და უშგულის მონახულებისას.')
    else:
        if path == '/about':
            title = choose('A local welcome in Mestia, Svaneti', 'ადგილობრივი მასპინძლობა მესტიაში, სვანეთში')
            description = (_localized(settings, 'about', lang) or _localized(settings, 'intro', lang)
                           or choose('Meet your local contact for tours, guesthouse stays and transport in Mestia. Plan your Svaneti visit together and agree the details before booking.',
                                     'გაიცანით თქვენი ადგილობრივი მასპინძელი მესტიაში. ერთად დაგეგმეთ სვანეთის ტურები, განთავსება და მგზავრობა; დაჯავშნამდე შეათანხმეთ დეტალები.'))
        elif path == '/privacy':
            title = choose('Privacy notice', 'კონფიდენციალურობის ინფორმაცია')
            description = choose('How your contact details and booking information are handled when you enquire about a visit.', 'როგორ მუშავდება თქვენი საკონტაქტო და დაჯავშნის ინფორმაცია მოთხოვნის გაგზავნისას.')
            allow_index = bool(_plain(settings.get('privacy_notice') or settings.get('privacy')))
        elif path == '/terms':
            title = choose('Booking terms', 'დაჯავშნის პირობები')
            description = choose('Read how quotes, booking confirmation, changes and cancellation terms work before arranging your visit.', 'გაეცანით შეთავაზების, ჯავშნის დადასტურების, ცვლილებისა და გაუქმების პირობებს.')
        else:
            return metadata

    metadata.update(title=f'{_plain(title)} | {brand}', description=_plain(description, 165),
                    public=True, robots='noindex, follow')
    origin = public_origin()
    if not origin:
        return metadata
    canonical = origin + _path(path, lang, kind)
    indexable = indexing_enabled() and allow_index
    metadata.update(canonical=canonical, indexable=indexable,
                    robots='index, follow, max-image-preview:large' if indexable else 'noindex, follow')
    if indexable:
        metadata['alternates'] = _alternates(origin, path, kind, translated)
    image = _image_url(origin, record.get('image_path') or settings.get('destination_image_1'))
    metadata['og'] = {'title': metadata['title'], 'description': metadata['description'],
                      'url': canonical, 'type': 'website', 'locale': 'ka_GE' if lang == 'ka' else 'en_GB',
                      'image': image, 'image_alt': _localized(record, 'title', lang) if record.get('image_path') else brand}
    metadata['twitter'] = {'card': 'summary_large_image', 'title': metadata['title'],
                           'description': metadata['description'], 'image': image}
    website = {'@type': 'WebSite', '@id': origin + '/#website', 'url': origin + '/',
               'name': _plain(settings.get('business_name')) or 'Mestia Travel', 'inLanguage': ['en', 'ka']}
    webpage = {'@type': 'WebPage', '@id': canonical + '#webpage', 'url': canonical,
               'name': metadata['title'], 'description': metadata['description'], 'inLanguage': lang,
               'isPartOf': {'@id': origin + '/#website'}}
    graph = [website, webpage]
    if endpoint == 'home' or path == '/about':
        graph.append(_agency(settings, origin, brand))
    if endpoint == 'service_detail':
        offering = {'@type': 'TouristTrip' if record['kind'] == 'tour' else 'Service',
                    '@id': canonical + '#offering', 'name': _localized(record, 'title', lang),
                    'description': metadata['description'], 'url': canonical,
                    'provider': {'@type': 'TravelAgency', '@id': origin + '/#organization',
                                 'name': _plain(settings.get('business_name')) or 'Mestia Travel'}}
        if record.get('image_path') and image != origin + SOCIAL_IMAGE:
            offering['image'] = image
        graph.append(offering)
        webpage['mainEntity'] = {'@id': offering['@id']}
        catalogue = choose('Trips & stays', 'ტურები და განთავსება')
        graph.append({'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': choose('Home', 'მთავარი'), 'item': origin + _path('/', lang)},
            {'@type': 'ListItem', 'position': 2, 'name': catalogue, 'item': origin + _path('/services', lang)},
            {'@type': 'ListItem', 'position': 3, 'name': offering['name'], 'item': canonical},
        ]})
    metadata['structured_data'] = {'@context': 'https://schema.org', '@graph': graph}
    return metadata


def _lastmod(value):
    """SQLite timestamps are UTC; reject malformed/future dates, never use now."""
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        parsed = parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
        if parsed <= datetime.now(timezone.utc):
            return parsed.date().isoformat()
    except (TypeError, ValueError):
        pass
    return None


def sitemap_entries(conn):
    """Canonical public URLs only; no drafts, deleted rows or private tokens."""
    if not indexing_enabled():
        return []
    origin = public_origin()
    entries = []

    def add(path, kind='', translated=True, lastmod=None):
        alternates = _alternates(origin, path, kind, translated)
        for alternate in alternates:
            if alternate['lang'] != 'x-default':
                entries.append({'loc': alternate['url'], 'alternates': alternates, 'lastmod': lastmod})

    for path in ('/', '/services', '/about'):
        add(path)
    add('/visit-svaneti', translated=False)
    add('/faq', translated=False)
    for kind in ('tour', 'stay', 'taxi'):
        add('/services', kind)
    for row in conn.execute('SELECT id,slug,title_ka,description_ka,updated_at FROM services WHERE published=1 AND archived_at IS NULL ORDER BY id'):
        record = dict(row)
        add(service_url(record), translated=_translated(record), lastmod=_lastmod(record['updated_at']))
    return entries
