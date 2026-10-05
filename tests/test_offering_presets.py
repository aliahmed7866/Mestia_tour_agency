"""Research drafts must never advertise invented inventory or overwrite owner edits."""
from mestia.catalogue import migrate_catalogue, research_checked, research_sources, season_months
from mestia.db import SCHEMA, connect, init_db, seed_defaults
from mestia.offering_presets import (PRESET_VERSION, SHORT_BREAK_VERSION,
                                    apply_offering_presets, load_presets)


def test_researched_offers_start_as_complete_unpriced_drafts(tmp_path):
    conn = connect(str(tmp_path / 'presets.sqlite3'))
    init_db(conn)
    offers = conn.execute("SELECT * FROM services WHERE preset_key<>''").fetchall()
    assert len(offers) == len(load_presets()) == 19
    for offer in offers:
        assert offer['published'] == 0 and offer['archived_at'] is None
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
