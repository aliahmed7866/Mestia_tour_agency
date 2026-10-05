"""Content upgrades preserve operator edits and keep external contact links safe."""
from datetime import timedelta

import pytest

from mestia import create_app, domain
from mestia.business_content import (GUIDE_INSTAGRAM, WHATSAPP_CARD_LINK,
                                    apply_owner_content,
                                    instagram_profile, whatsapp_business_link)
from mestia.db import SCHEMA, connect, init_db, seed_defaults


def test_existing_install_upgrade_preserves_owner_edits_and_is_applied_once(tmp_path):
    conn = connect(tmp_path / 'existing.sqlite3')
    conn.executescript(SCHEMA)
    seed_defaults(conn)
    conn.execute("INSERT INTO settings(key,value) VALUES ('guesthouse_name','Host chosen name')")
    conn.execute("UPDATE settings SET value='995555123456' WHERE key='whatsapp_number'")
    conn.execute("INSERT INTO services(provider_id,slug,kind,title_en,price_minor,published) VALUES (1,'mountain-tours','tour','Host edited tour',12345,0)")
    init_db(conn)
    assert conn.execute("SELECT value FROM settings WHERE key='guesthouse_name'").fetchone()[0] == 'Host chosen name'
    assert conn.execute("SELECT value FROM settings WHERE key='whatsapp_number'").fetchone()[0] == '995555123456'
    original = dict(conn.execute("SELECT * FROM services WHERE slug='mountain-tours'").fetchone())
    assert (original['title_en'], original['price_minor'], original['published']) == ('Host edited tour', 12345, 0)
    conn.execute("UPDATE settings SET value='' WHERE key='whatsapp_link'")
    conn.execute("UPDATE services SET published=0 WHERE slug='airport-pickup'")
    snapshot = [tuple(r) for r in conn.execute('SELECT * FROM services ORDER BY id')]
    init_db(conn)
    assert [tuple(r) for r in conn.execute('SELECT * FROM services ORDER BY id')] == snapshot
    assert conn.execute("SELECT value FROM settings WHERE key='whatsapp_link'").fetchone()[0] == ''
    assert conn.execute('SELECT count(*) FROM resources').fetchone()[0] == 0
    conn.close()


def test_contact_links_render_and_qr_does_not_claim_to_prefill_guest_reference(tmp_path):
    app = create_app({'TESTING':True, 'SECRET_KEY':'testing-key-for-content-verification-1234',
                      'DATABASE':str(tmp_path/'contact.sqlite3'), 'MEDIA_DIR':str(tmp_path/'uploads')})
    conn = connect(app.config['DATABASE'])
    e = domain.create_enquiry(conn, dict(kind='taxi',name='Contact test',phone='+995555123456',
        starts_at=domain.timestamp(domain.now()+timedelta(days=10)),
        ends_at=domain.timestamp(domain.now()+timedelta(days=11)),party_size=1))
    client = app.test_client()
    for path in ['/', '/services?kind=stay', '/services?kind=taxi', '/about']:
        page = client.get(path)
        assert page.status_code == 200
        assert WHATSAPP_CARD_LINK in page.text
        assert 'https://www.instagram.com/riverside_svaneti/' in page.text
        assert GUIDE_INSTAGRAM in page.text
    page = client.get('/booking/'+e['guest_token'])
    assert page.status_code == 200
    assert WHATSAPP_CARD_LINK in page.text
    assert e['reference'] in page.text
    assert 'WhatsApp will open with your reference' not in page.text
    conn.execute("UPDATE settings SET value='995555123456' WHERE key='whatsapp_number'")
    page = client.get('/booking/'+e['guest_token'])
    assert 'https://wa.me/995555123456?text=' in page.text
    assert 'WhatsApp will open with your reference' in page.text
    conn.close()


@pytest.mark.parametrize('previous_profile', [None, '', '   '])
def test_guide_profile_upgrades_existing_content_once(tmp_path, previous_profile):
    conn = connect(tmp_path / 'previous-content.sqlite3')
    conn.executescript(SCHEMA)
    seed_defaults(conn)
    apply_owner_content(conn)
    if previous_profile is None:
        conn.execute("DELETE FROM settings WHERE key='guide_instagram_url'")
    else:
        conn.execute("UPDATE settings SET value=? WHERE key='guide_instagram_url'", (previous_profile,))
    services = [tuple(row) for row in conn.execute('SELECT * FROM services ORDER BY id')]
    init_db(conn)
    assert conn.execute("SELECT value FROM settings WHERE key='guide_instagram_url'").fetchone()[0] == GUIDE_INSTAGRAM
    assert [tuple(row) for row in conn.execute('SELECT * FROM services ORDER BY id')] == services
    assert conn.execute('SELECT count(*) FROM resources').fetchone()[0] == 0
    conn.execute("UPDATE settings SET value='' WHERE key='guide_instagram_url'")
    init_db(conn)
    assert conn.execute("SELECT value FROM settings WHERE key='guide_instagram_url'").fetchone()[0] == ''
    conn.close()


def test_guide_profile_upgrade_preserves_owner_selected_profile(tmp_path):
    conn = connect(tmp_path / 'edited-profile.sqlite3')
    conn.executescript(SCHEMA)
    seed_defaults(conn)
    apply_owner_content(conn)
    chosen_profile = 'https://www.instagram.com/owner_selected_guide/'
    conn.execute("UPDATE settings SET value=? WHERE key='guide_instagram_url'", (chosen_profile,))
    init_db(conn)
    assert conn.execute("SELECT value FROM settings WHERE key='guide_instagram_url'").fetchone()[0] == chosen_profile
    conn.close()


def test_external_profile_and_qr_validation_blocks_untrusted_targets():
    assert instagram_profile('https://www.instagram.com/riverside_svaneti?stkn=tracking') == 'https://www.instagram.com/riverside_svaneti/'
    assert whatsapp_business_link(WHATSAPP_CARD_LINK) == WHATSAPP_CARD_LINK
    for value in ['javascript:alert(1)', 'https://instagram.com.evil.test/riverside_svaneti/',
                  'https://instagram.com@evil.test/riverside_svaneti/', 'https://www.instagram.com/p/post']:
        with pytest.raises(ValueError): instagram_profile(value)
    for value in ['javascript:alert(1)', 'https://wa.me.evil.test/995555123456', 'https://wa.me@evil.test/qr/EXAMPLE']:
        with pytest.raises(ValueError): whatsapp_business_link(value)
