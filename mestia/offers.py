"""Stay-and-tour offer: explicit eligibility and immutable request snapshots."""
import json
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

DEFAULT_TERMS = ('Book a Riverside Svaneti stay and an owner-operated tour together for the same guests. '
                 'The tour must take place between check-in and check-out. Discount applies to the tour service only; '
                 'rooms, transfers, meals, entrance tickets and third-party extras are excluded and must be priced separately. '
                 'Cannot be combined with another promotion. Availability and final prices are confirmed in your quote. '
                 'If the stay is removed before confirmation, the tour is requoted without this offer.')


def initialize_offer(conn):
    # Remember identity once. Renaming a slug later must not break the offer,
    # and deleting this stay must never silently switch it to another one.
    conn.execute("INSERT OR IGNORE INTO settings(key,value) SELECT 'stay_tour_service_id',CAST(id AS TEXT) FROM services WHERE slug='riverside-svaneti-guesthouse' AND kind='stay' AND provider_id=1 LIMIT 1")


def current_offer(conn, settings):
    stay = conn.execute("SELECT id,title_en FROM services WHERE id=? AND kind='stay' AND provider_id=1 AND published=1 AND archived_at IS NULL", (settings.get('stay_tour_service_id'),)).fetchone()
    try:
        percent = int(settings.get('stay_tour_percent', '10'))
    except (ValueError, TypeError):
        percent = 0
    terms = settings.get('stay_tour_terms', DEFAULT_TERMS).strip()
    return dict(enabled=settings.get('stay_tour_enabled', '1') == '1' and bool(stay) and 1 <= percent <= 100 and bool(terms),
                percent=percent, terms=terms, stay=dict(stay) if stay else None)


def snapshot(value):
    try:
        result = json.loads(value or '{}')
        return result if isinstance(result, dict) else {}
    except (ValueError, TypeError):
        return {}


def apply_to_quote(conn, items, offer, currency):
    """Discount only matched owner tours; keep original amount in saved inclusions."""
    percent = offer.get('percent', 0)
    if not isinstance(percent, int) or not 1 <= percent <= 100:
        raise ValueError('This request has no valid stay-and-tour offer.')
    stay = conn.execute("SELECT * FROM services WHERE id=? AND kind='stay' AND provider_id=1 AND archived_at IS NULL", (offer.get('stay_id'),)).fetchone()
    stays = [x for x in items if stay and x['kind'] == 'stay' and x['service_id'] == stay['id']]
    if not stays:
        raise ValueError('Add the Riverside stay to this quote to apply the tour saving, or uncheck the offer.')
    eligible = []
    for item in items:
        service = conn.execute("SELECT * FROM services WHERE id=? AND kind='tour' AND provider_id=1 AND archived_at IS NULL", (item['service_id'],)).fetchone()
        if item['kind'] == 'tour' and service:
            # UTC strings are normalized by the route parser. Compare local
            # calendar dates so checkout-day outings remain eligible.
            day = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(ZoneInfo('Asia/Tbilisi')).date()
            if any(day(s['starts_at']) <= day(item['starts_at']) <= day(item['ends_at']) <= day(s['ends_at']) for s in stays):
                eligible.append(item)
    if not eligible:
        raise ValueError('The offer needs an owner-operated tour within the Riverside stay dates.')
    for item in eligible:
        before = item['unit_price_minor']
        after = int((Decimal(before) * (100 - percent) / 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
        item['unit_price_minor'] = after
        item['inclusions'] += f'\nStay & explore: {percent}% off tour service. Original unit price {before / 100:.2f} {currency}; saving {(before-after) / 100:.2f} {currency} per unit. Rooms and extras excluded.'
    return '\n\nStay & explore offer: ' + str(percent) + '% off eligible tour services. ' + offer['terms']
