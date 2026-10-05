"""Requestable route proposals must never invent inventory or overwrite owner edits."""
import pytest

from mestia.catalogue import migrate_catalogue, research_checked, research_sources, season_months
from mestia.db import SCHEMA, connect, init_db, seed_defaults
from mestia.offering_presets import (CATALOGUE_LAUNCH_VERSION, PRESET_BATCHES,
                                    PRESET_VERSION, REQUEST_CATALOGUE_KEYS, SHORT_BREAK_VERSION,
                                    apply_offering_presets, load_presets)


def test_selected_routes_accept_requests_without_inventing_inventory(tmp_path):
    conn = connect(str(tmp_path / 'presets.sqlite3'))
    init_db(conn)
    offers = conn.execute("SELECT * FROM services WHERE preset_key<>''").fetchall()
    assert len(offers) == len(load_presets()) == 19
    assert {offer['preset_key'] for offer in offers if offer['published']} == REQUEST_CATALOGUE_KEYS
    assert len(REQUEST_CATALOGUE_KEYS) == 8
    for offer in offers:
        assert offer['archived_at'] is None
        assert offer['price_minor'] is None and offer['capacity'] is None
        for field in ('title_en', 'description_en', 'itinerary_en', 'region', 'base_location',
                      'duration', 'difficulty', 'season_en', 'weather_en', 'requirements_en',
                      'inclusions_en', 'exclusions_en', 'meeting_point_en', 'walking_en',
                      'driving_en', 'operator_notes', 'research_sources'):
            assert offer[field].strip(), (offer['preset_key'], field)
        assert research_checked(offer['research_checked']) == '2026-10-05'
        assert research_sources(offer['research_sources']) == offer['research_sources']
        assert season_months(offer['season_months']) == offer['season_months']
        assert offer['duration_days'] >= 1
    for table in ('resources', 'bookings', 'quotes'):
        assert conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0] == 0
    conn.close()


def legacy_presets(tmp_path):
    """Build the pre-launch state: the original two draft batches already ran."""
    conn = connect(str(tmp_path / 'legacy.sqlite3'))
    conn.executescript(SCHEMA)
    migrate_catalogue(conn)
    seed_defaults(conn)
    for preset in load_presets():
        data = dict(preset, provider_id=1, published=0, price_minor=None, capacity=None)
        conn.execute('INSERT INTO services (' + ','.join(data) + ') VALUES (' +
                     ','.join('?' for _ in data) + ')', tuple(data.values()))
    for version, _ in PRESET_BATCHES:
        conn.execute('INSERT INTO settings(key,value) VALUES (?,?)', (version, 'applied'))
    return conn


def test_existing_untouched_drafts_launch_once_and_can_be_disabled(tmp_path):
    conn = legacy_presets(tmp_path)
    assert not conn.execute('SELECT 1 FROM services WHERE published=1').fetchone()
    apply_offering_presets(conn)
    assert {r[0] for r in conn.execute('SELECT preset_key FROM services WHERE published=1')} == REQUEST_CATALOGUE_KEYS
    target = conn.execute('SELECT id FROM services WHERE published=1 LIMIT 1').fetchone()[0]
    conn.execute('UPDATE services SET published=0 WHERE id=?', (target,))
    before = [dict(r) for r in conn.execute('SELECT * FROM services ORDER BY id')]
    apply_offering_presets(conn)
    assert [dict(r) for r in conn.execute('SELECT * FROM services ORDER BY id')] == before
    assert conn.execute('SELECT 1 FROM settings WHERE key=?', (CATALOGUE_LAUNCH_VERSION,)).fetchone()
    conn.close()


@pytest.mark.parametrize(('field', 'value'), [
    ('title_en', 'Our town walk'),
    ('title_ka', 'მესტია'),
    ('price_minor', 10000),
    ('capacity', 4),
    ('currency', 'USD'),
    ('image_path', 'owner-picture.webp'),
    ('photo_url', 'https://example.com/photo.jpg'),
    ('season_months', '7,8'),
    ('updated_at', '2026-10-05T14:00:00Z'),
])
def test_launch_preserves_any_changed_seed_field_even_without_audit(tmp_path, field, value):
    conn = legacy_presets(tmp_path)
    target = conn.execute('SELECT id FROM services WHERE preset_key=?',
                          ('svaneti-mestia-culture-v1',)).fetchone()[0]
    conn.execute(f'UPDATE services SET {field}=? WHERE id=?', (value, target))
    before = dict(conn.execute('SELECT * FROM services WHERE id=?', (target,)).fetchone())
    apply_offering_presets(conn)
    assert dict(conn.execute('SELECT * FROM services WHERE id=?', (target,)).fetchone()) == before
    assert conn.execute('SELECT count(*) FROM services WHERE published=1').fetchone()[0] == 7
    conn.close()


def test_launch_respects_owner_disabled_archived_and_deleted_routes(tmp_path):
    conn = legacy_presets(tmp_path)
    ids = [r[0] for r in conn.execute('SELECT id FROM services WHERE preset_key IN (?,?,?) ORDER BY id',
                                     ('svaneti-mestia-culture-v1', 'svaneti-hatsvali-views-v1', 'svaneti-chalaadi-v1'))]
    # An unchanged draft may have been deliberately disabled or saved unchanged.
    # Audit history protects that choice even if timestamps happen to be equal.
    conn.execute("INSERT INTO audit(action,entity_type,entity_id,created_at) VALUES ('service_unpublish','service',?,'2026-10-05T14:00:00Z')",
                 (ids[0],))
    conn.execute("UPDATE services SET archived_at='2026-10-05T14:00:00Z' WHERE id=?", (ids[1],))
    conn.execute('DELETE FROM services WHERE id=?', (ids[2],))
    before = {r['id']: dict(r) for r in conn.execute('SELECT * FROM services WHERE id IN (?,?)', ids[:2])}
    apply_offering_presets(conn)
    for identifier, original in before.items():
        assert dict(conn.execute('SELECT * FROM services WHERE id=?', (identifier,)).fetchone()) == original
    assert not conn.execute('SELECT 1 FROM services WHERE id=?', (ids[2],)).fetchone()
    assert conn.execute('SELECT count(*) FROM services WHERE published=1').fetchone()[0] == 5
    conn.close()


def test_restart_preserves_offer_edits_publication_and_deletions(tmp_path):
    conn = connect(str(tmp_path / 'presets.sqlite3'))
    init_db(conn)
    ids = [r[0] for r in conn.execute("SELECT id FROM services WHERE preset_key<>'' ORDER BY id")]
    conn.execute("UPDATE services SET title_en='Our actual route',price_minor=25000,season_months='8',published=1 WHERE id=?", (ids[0],))
    conn.execute("UPDATE services SET published=0,archived_at='2026-10-05T12:00:00Z' WHERE id=?", (ids[1],))
    before = [dict(r) for r in conn.execute('SELECT * FROM services ORDER BY id')]
    init_db(conn)
    assert [dict(r) for r in conn.execute('SELECT * FROM services ORDER BY id')] == before
    conn.close()


def test_matching_owner_slug_is_not_overwritten_by_preset(tmp_path):
    conn = connect(str(tmp_path / 'old.sqlite3'))
    conn.executescript(SCHEMA)
    migrate_catalogue(conn)
    seed_defaults(conn)
    first = load_presets()[0]
    conn.execute("INSERT INTO services(provider_id,slug,kind,title_en,published) VALUES (1,?,'tour','Existing operator route',1)", (first['slug'],))
    apply_offering_presets(conn)
    offer = conn.execute('SELECT * FROM services WHERE slug=?', (first['slug'],)).fetchone()
    assert offer['title_en'] == 'Existing operator route' and offer['published'] == 1
    assert offer['preset_key'] == ''
    assert conn.execute("SELECT count(*) FROM services WHERE preset_key<>''").fetchone()[0] == 18
    conn.close()


def test_short_break_upgrade_adds_only_new_batch_and_preserves_old_choices(tmp_path):
    conn = connect(str(tmp_path / 'upgrade.sqlite3'))
    init_db(conn)
    new_keys = [p['preset_key'] for p in load_presets(('short_break_offerings.json',))]
    for key in new_keys:
        conn.execute('DELETE FROM services WHERE preset_key=?', (key,))
    conn.execute('DELETE FROM settings WHERE key=?', (SHORT_BREAK_VERSION,))
    assert conn.execute('SELECT 1 FROM settings WHERE key=?', (PRESET_VERSION,)).fetchone()
    old = conn.execute("SELECT id FROM services WHERE preset_key<>'' ORDER BY id").fetchall()
    conn.execute("UPDATE services SET title_en='Our own route',published=1,price_minor=30000 WHERE id=?", (old[0][0],))
    conn.execute("UPDATE services SET archived_at='2026-10-05T12:00:00Z' WHERE id=?", (old[1][0],))
    conn.execute('DELETE FROM services WHERE id=?', (old[2][0],))
    before = {r['id']: dict(r) for r in conn.execute('SELECT * FROM services')}
    init_db(conn)
    after = {r['id']: dict(r) for r in conn.execute('SELECT * FROM services')}
    assert all(after[record_id] == record for record_id, record in before.items())
    assert old[2][0] not in after
    assert len(after) == len(before) + 2
    for key in new_keys:
        row = conn.execute('SELECT * FROM services WHERE preset_key=?', (key,)).fetchone()
        assert row['published'] == 0 and row['price_minor'] is None
        conn.execute('DELETE FROM services WHERE id=?', (row['id'],))
    init_db(conn)
    assert conn.execute('SELECT count(*) FROM services').fetchone()[0] == len(before)
    conn.close()
