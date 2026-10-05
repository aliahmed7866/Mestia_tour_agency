"""Research drafts must never advertise invented inventory or overwrite owner edits."""
from mestia.catalogue import migrate_catalogue, research_checked, research_sources, season_months
from mestia.db import SCHEMA, connect, init_db, seed_defaults
from mestia.offering_presets import apply_offering_presets, load_presets


def test_researched_offers_start_as_complete_unpriced_drafts(tmp_path):
    conn = connect(str(tmp_path / 'presets.sqlite3'))
    init_db(conn)
    offers = conn.execute("SELECT * FROM services WHERE preset_key<>''").fetchall()
    assert len(offers) == len(load_presets()) == 17
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
    assert conn.execute("SELECT count(*) FROM services WHERE preset_key<>''").fetchone()[0] == 16
    conn.close()
