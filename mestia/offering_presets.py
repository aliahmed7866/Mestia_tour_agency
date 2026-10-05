"""Install route proposals once and preserve every subsequent owner decision."""
import json
from pathlib import Path

PRESET_VERSION = '_researched_offerings_20261005_v1'
SHORT_BREAK_VERSION = '_short_break_offerings_20261005_v1'
CATALOGUE_LAUNCH_VERSION = '_request_catalogue_launch_20261005_v1'
REQUEST_CATALOGUE_KEYS = frozenset({
    'svaneti-mestia-culture-v1',
    'svaneti-hatsvali-views-v1',
    'svaneti-chalaadi-v1',
    'svaneti-koruldi-hike-v1',
    'svaneti-koruldi-4x4-v1',
    'svaneti-ushguli-day-v1',
    'svaneti-shdugra-lower-viewpoint-v1',
    'svaneti-heshkili-short-outing-v1',
})
PRESET_BATCHES = (
    (PRESET_VERSION, ('svaneti_offerings.json', 'georgia_offerings.json')),
    (SHORT_BREAK_VERSION, ('short_break_offerings.json',)),
)
DATA_DIR = Path(__file__).with_name('data')


def load_presets(filenames=None):
    presets = []
    if filenames is None:
        filenames = [name for _, names in PRESET_BATCHES for name in names]
    for filename in filenames:
        presets.extend(json.loads((DATA_DIR / filename).read_text(encoding='utf-8')))
    return presets


def apply_offering_presets(conn):
    """Install drafts, then open the selected untouched proposals to requests once."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        columns = {r['name'] for r in conn.execute('PRAGMA table_info(services)')}
        for version, filenames in PRESET_BATCHES:
            if conn.execute('SELECT 1 FROM settings WHERE key=?', (version,)).fetchone():
                continue
            for preset in load_presets(filenames):
                if set(preset) - columns:
                    raise ValueError('Offering preset contains unsupported fields.')
                data = dict(preset, provider_id=1, published=0, price_minor=None, capacity=None)
                # A slug or preset already owned by the operator must stay untouched.
                if conn.execute('SELECT 1 FROM services WHERE slug=? OR preset_key=?',
                                (data['slug'], data['preset_key'])).fetchone():
                    continue
                conn.execute('INSERT INTO services (' + ','.join(data) + ') VALUES (' +
                             ','.join('?' for _ in data) + ')', tuple(data.values()))
            conn.execute('INSERT INTO settings(key,value) VALUES (?,?)', (version, 'applied'))
        _launch_request_catalogue(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def _launch_request_catalogue(conn):
    """One-time launch, not a recurring instruction to republish the catalogue.

    These eight local outings accept requests, never guarantee a departure or
    create inventory. Their existing route, season and quote conditions remain.
    Packages needing accommodation or additional partners remain drafts.
    """
    if conn.execute('SELECT 1 FROM settings WHERE key=?', (CATALOGUE_LAUNCH_VERSION,)).fetchone():
        return
    # Compare every stored field with the original seed, including untranslated
    # copy, media and prices. New schema defaults participate automatically; a
    # value changed directly in SQLite must be respected just like an admin edit.
    defaults = {}
    for column in conn.execute('PRAGMA table_info(services)').fetchall():
        name = column['name']
        if name in {'id', 'created_at', 'updated_at'}:
            continue
        default = column['dflt_value']
        # SQL expressions here come from our table schema, never form input.
        defaults[name] = conn.execute('SELECT ' + default).fetchone()[0] if default is not None else None
    for preset in load_presets():
        if preset['preset_key'] not in REQUEST_CATALOGUE_KEYS:
            continue
        candidates = conn.execute('SELECT * FROM services WHERE preset_key=?',
                                  (preset['preset_key'],)).fetchall()
        # Duplicates or a missing original are ambiguous: never restore or guess.
        if len(candidates) != 1:
            continue
        service = candidates[0]
        if service['created_at'] != service['updated_at']:
            continue
        if conn.execute("SELECT 1 FROM audit WHERE entity_type='service' AND entity_id=? LIMIT 1",
                        (service['id'],)).fetchone():
            continue
        expected = dict(defaults, **preset, provider_id=1, published=0,
                        price_minor=None, capacity=None)
        if any(service[name] != value for name, value in expected.items()):
            continue
        conn.execute('UPDATE services SET published=1,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                     (service['id'],))
    # Record completion even when every row was edited or removed by its owner.
    conn.execute('INSERT INTO settings(key,value) VALUES (?,?)', (CATALOGUE_LAUNCH_VERSION, 'applied'))
