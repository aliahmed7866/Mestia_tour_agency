"""Install researched route drafts once; never overwrite the owner's catalogue."""
import json
from pathlib import Path

PRESET_VERSION = '_researched_offerings_20261005_v1'
SHORT_BREAK_VERSION = '_short_break_offerings_20261005_v1'
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
    """Drafts need local review; prices, staff, capacity and availability are unset."""
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
        conn.commit()
    except Exception:
        conn.rollback()
        raise
