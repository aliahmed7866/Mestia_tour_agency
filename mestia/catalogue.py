"""Editable catalogue fields and additive migrations for existing installations."""
import re
from datetime import date
from urllib.parse import urlsplit


MONTH_CHOICES = (
    (1, 'January', 'იანვარი'), (2, 'February', 'თებერვალი'),
    (3, 'March', 'მარტი'), (4, 'April', 'აპრილი'),
    (5, 'May', 'მაისი'), (6, 'June', 'ივნისი'),
    (7, 'July', 'ივლისი'), (8, 'August', 'აგვისტო'),
    (9, 'September', 'სექტემბერი'), (10, 'October', 'ოქტომბერი'),
    (11, 'November', 'ნოემბერი'), (12, 'December', 'დეკემბერი'),
)

SERVICE_TEXT_FIELDS = {
    'title_en': 200, 'title_ka': 200,
    'description_en': 5000, 'description_ka': 5000,
    'details_en': 20000, 'details_ka': 20000,
    'itinerary_en': 20000, 'itinerary_ka': 20000,
    'inclusions_en': 10000, 'inclusions_ka': 10000,
    'requirements_en': 10000, 'requirements_ka': 10000,
    'price_basis': 150, 'duration': 150, 'difficulty': 100,
    'region': 150, 'base_location': 200, 'activity': 100,
    'season_en': 2000, 'season_ka': 2000,
    'meeting_point_en': 2000, 'meeting_point_ka': 2000,
    'exclusions_en': 10000, 'exclusions_ka': 10000,
    'weather_en': 10000, 'weather_ka': 10000,
    'walking_en': 2000, 'walking_ka': 2000,
    'driving_en': 2000, 'driving_ka': 2000,
    'operator_notes': 20000,
}

SERVICE_COLUMNS = {
    **{name: "TEXT NOT NULL DEFAULT ''" for name in (
        'region', 'base_location', 'activity', 'season_en', 'season_ka',
        'meeting_point_en', 'meeting_point_ka', 'exclusions_en', 'exclusions_ka',
        'weather_en', 'weather_ka', 'walking_en', 'walking_ka', 'driving_en',
        'driving_ka', 'operator_notes', 'research_sources', 'research_checked',
        'season_months', 'preset_key')},
    'duration_days': 'INTEGER CHECK(duration_days >= 1)',
    'archived_at': 'TEXT',
}


def migrate_catalogue(conn):
    """Add fields without rebuilding the services table or touching owner content."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        existing = {record['name'] for record in conn.execute('PRAGMA table_info(services)')}
        for name, definition in SERVICE_COLUMNS.items():
            if name not in existing:
                conn.execute(f'ALTER TABLE services ADD COLUMN {name} {definition}')
        conn.execute('CREATE INDEX IF NOT EXISTS services_visibility ON services(archived_at,published)')
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def season_months(value):
    """Normalize calendar filter months, accepting either CSV or checkbox values."""
    if isinstance(value, (list, tuple)):
        value = ','.join(str(part) for part in value)
    text = str(value or '').strip()
    if not text:
        return ''
    parts = [part.strip() for part in text.split(',')]
    if any(not re.fullmatch(r'(?:[1-9]|1[0-2])', part) for part in parts):
        raise ValueError('Season months must be comma-separated numbers from 1 to 12.')
    return ','.join(str(month) for month in sorted({int(part) for part in parts}))


def research_sources(value):
    text = str(value or '').strip()
    if len(text) > 16000:
        raise ValueError('Research sources must be at most 16,000 characters.')
    urls = []
    for line in text.splitlines():
        url = line.strip()
        if not url:
            continue
        try:
            parsed = urlsplit(url)
            valid = (parsed.scheme == 'https' and parsed.hostname and
                     not parsed.username and not parsed.password and
                     not any(character.isspace() or ord(character) < 32 for character in url))
            parsed.port  # Validate malformed ports as well as the scheme.
        except ValueError:
            valid = False
        if not valid or len(url) > 2000:
            raise ValueError('Use one complete HTTPS research source URL per line.')
        if url not in urls:
            urls.append(url)
    return '\n'.join(urls)


def research_checked(value):
    value = str(value or '').strip()
    if value:
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError()
            date.fromisoformat(value)
        except ValueError:
            raise ValueError('Research checked must be a valid date in YYYY-MM-DD format.')
    return value
