"""Owner-supplied contact and service content, applied once without replacing edits.

Sources: service card, Riverside Svaneti profile screenshot and guide profile link
supplied 2026-10-05.
No prices, room inventory, schedules, credentials or policies are inferred.
"""
import re
from urllib.parse import urlencode, urlsplit

CONTENT_VERSION = '_owner_content_20261005_v1'
GUIDE_PROFILE_VERSION = '_guide_profile_20261005_v1'
WHATSAPP_CARD_LINK = 'https://wa.me/qr/DWVZTCF73QY5L1'
GUESTHOUSE_INSTAGRAM = 'https://www.instagram.com/riverside_svaneti/'
GUIDE_INSTAGRAM = 'https://www.instagram.com/guledaniakaki/'


def instagram_profile(value):
    """Accept a profile URL only; discard Instagram sharing/tracking parameters."""
    value = str(value or '').strip()
    if not value:
        return ''
    parts = urlsplit(value)
    if (parts.scheme != 'https' or parts.netloc.lower() not in ('instagram.com', 'www.instagram.com')
            or not re.fullmatch(r'/[A-Za-z0-9_.]{1,30}/?', parts.path)):
        raise ValueError('Use an HTTPS Instagram profile URL, for example https://www.instagram.com/riverside_svaneti/.')
    username = parts.path.strip('/')
    if username.lower() in ('p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'):
        raise ValueError('Use an Instagram profile link rather than a post or account-management page.')
    return f'https://www.instagram.com/{username}/'


def whatsapp_business_link(value):
    value = str(value or '').strip()
    if not value:
        return ''
    parts = urlsplit(value)
    if (parts.scheme != 'https' or parts.netloc.lower() != 'wa.me'
            or not re.fullmatch(r'/(?:[1-9][0-9]{6,14}|(?:qr|message)/[A-Za-z0-9_-]{5,128})/?', parts.path)):
        raise ValueError('Use an HTTPS wa.me number, QR or business short link.')
    return 'https://wa.me' + parts.path.rstrip('/')


def whatsapp_contact(settings, message=None):
    """Return (URL, whether a message was prefilled). A QR link does not prefill."""
    number = settings.get('whatsapp_number', '')
    if re.fullmatch(r'[1-9][0-9]{6,14}', number or ''):
        url = 'https://wa.me/' + number
        return (url + '?' + urlencode({'text': message}), True) if message else (url, False)
    try:
        return whatsapp_business_link(settings.get('whatsapp_link', '')), False
    except ValueError:
        return '', False


SERVICES = [
    ('private-transfers', 'taxi', 'Private Transfers', 'კერძო ტრანსფერები',
     'A private transfer arranged around your pickup point and destination.',
     'Tell us your route, date, local pickup time, passengers and luggage. We will check a suitable driver and vehicle and agree the fare before confirming.'),
    ('mountain-tours', 'tour', 'Mountain Tours', 'მთის ტურები',
     'Plan a mountain tour in Svaneti around your interests and dates.',
     'Ask about routes, conditions and the right trip for your group. Your quote will set out the itinerary, guide, requirements and inclusions. The final route and availability are confirmed with the operator.'),
    ('city-trips', 'taxi', 'City Trips', 'ქალაქში მგზავრობა',
     'Arrange transport for your city trip through one local contact.',
     'Share the city, stops you have in mind, pickup time and group size. We will agree the route, vehicle and fare with you. Entry tickets and guiding are included only when stated in your quote.'),
    ('airport-pickup', 'taxi', 'Airport Pickup', 'აეროპორტში დახვედრა',
     'Request a pickup from your arrival airport.',
     'Send the airport, flight details, arrival date, passengers, luggage and destination. Pickup arrangements, the fare and a suitable driver are agreed before the trip is confirmed.'),
    ('4x4-off-road-adventures', 'tour', '4x4 Off-Road Adventures', '4x4 თავგადასავლები',
     'Ask about a 4x4 trip into the landscapes of Svaneti.',
     'Tell us where you would like to go and who is travelling. The operator will discuss the route, weather and road conditions, vehicle, requirements and price before confirming a trip.'),
    ('riverside-svaneti-guesthouse', 'stay', 'Riverside Svaneti Guest House', 'Riverside Svaneti — საოჯახო სასტუმრო',
     'A guesthouse in Svaneti with river and mountain views.',
     'Ask about your stay, breakfast and dinner, camps or events. The guesthouse offers free pickup from Mestia; arrange the pickup with the host before travelling. Room details, meal inclusions, rates and availability are agreed in your quote. See the guesthouse Instagram for its own photos and updates.'),
]


def apply_owner_content(conn):
    """One transactional content update, safe for new and existing installations."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        if conn.execute('SELECT 1 FROM settings WHERE key=?', (CONTENT_VERSION,)).fetchone():
            conn.commit()
            return
        defaults = {
            'whatsapp_link': WHATSAPP_CARD_LINK,
            'guesthouse_name': 'Riverside Svaneti',
            'guesthouse_instagram_url': GUESTHOUSE_INSTAGRAM,
            'guide_instagram_url': '',
        }
        for key, value in defaults.items():
            conn.execute('''INSERT INTO settings(key,value) VALUES (?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE trim(settings.value)='' ''', (key, value))
        for slug, kind, title, title_ka, description, details in SERVICES:
            # A matching owner-created offer is kept as-is, including its publication state.
            if conn.execute('SELECT 1 FROM services WHERE slug=? OR (title_en=? COLLATE NOCASE AND kind=?)',
                            (slug, title, kind)).fetchone():
                continue
            conn.execute('''INSERT INTO services(provider_id,slug,kind,title_en,title_ka,
                description_en,details_en,price_minor,currency,published)
                VALUES(1,?,?,?,?,?,?,NULL,'GEL',1)''', (slug, kind, title, title_ka, description, details))
        conn.execute('INSERT INTO settings(key,value) VALUES (?,?)', (CONTENT_VERSION, 'applied'))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def apply_guide_profile(conn):
    """Add the supplied guide profile once, preserving existing and later edits."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        if conn.execute('SELECT 1 FROM settings WHERE key=?', (GUIDE_PROFILE_VERSION,)).fetchone():
            conn.commit()
            return
        conn.execute('''INSERT INTO settings(key,value) VALUES ('guide_instagram_url',?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE trim(settings.value)='' ''',
            (GUIDE_INSTAGRAM,))
        conn.execute('INSERT INTO settings(key,value) VALUES (?,?)', (GUIDE_PROFILE_VERSION, 'applied'))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
