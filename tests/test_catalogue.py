"""Catalogue lifecycle, owner editing, and preservation of booking history."""
import base64
import hashlib
from datetime import timedelta
from io import BytesIO

import pytest
from werkzeug.datastructures import MultiDict

from mestia import create_app, domain
from mestia.catalogue import SERVICE_COLUMNS, SERVICE_TEXT_FIELDS, migrate_catalogue
from mestia.db import connect, init_db


@pytest.fixture
def catalogue(tmp_path):
    app = create_app({'TESTING': True, 'SECRET_KEY': 'catalogue-test-secret-at-least-32-characters',
                      'DATABASE': str(tmp_path / 'catalogue.sqlite3'), 'MEDIA_DIR': str(tmp_path / 'media'),
                      'REQUIRE_TOTP': False, 'SESSION_COOKIE_SECURE': False})
    conn = connect(app.config['DATABASE'])
    for role in ('owner', 'dispatcher'):
        conn.execute('INSERT INTO users(email,password_hash,role) VALUES (?,?,?)',
                     (role + '@example.test', 'catalogue-test-hash', role))
    conn.execute("UPDATE settings SET value='Test privacy notice' WHERE key='privacy_notice'")
    yield app, conn
    conn.close()


def client_for(app, conn, role='owner'):
    client = app.test_client()
    user_id = conn.execute('SELECT id FROM users WHERE role=?', (role,)).fetchone()[0]
    with client.session_transaction() as session:
        session['user_id'] = user_id
        session['credential_fingerprint'] = hashlib.sha256(b'catalogue-test-hash').hexdigest()
        session['auth_factor'] = 'password'
        session['csrf_token'] = 'catalogue-csrf'
    return client


def post(client, data):
    # Keep uploaded (file, filename) tuples intact while supporting repeated months.
    data = MultiDict(data.items() if isinstance(data, dict) else data)
    client.get('/admin/services')
    with client.session_transaction() as session:
        data['csrf_token'] = session['csrf_token']
    return client.post('/admin/services', data=data)


def service(conn, title='A test mountain day', **changes):
    data = dict(provider_id=1, kind='tour', title_en=title, slug='test-mountain-day',
                season_months='6,7,8,9', region='Svaneti', activity='Walking', duration_days=1)
    data.update(changes)
    return conn.execute('INSERT INTO services(' + ','.join(data) + ') VALUES (' + ','.join('?' for _ in data) + ')',
                        tuple(data.values())).lastrowid


def get_service(conn, identifier):
    return dict(conn.execute('SELECT * FROM services WHERE id=?', (identifier,)).fetchone())


def test_owner_can_open_new_editor_and_every_researched_preview(catalogue):
    app, conn = catalogue
    owner = client_for(app, conn)
    page = owner.get('/admin/services/new')
    assert page.status_code == 200
    assert 'name="title_en"' in page.text and 'name="provider_id"' in page.text
    # New-record validation errors must render a usable editor as well.
    invalid = post(owner, {'title_en': '', 'kind': 'tour'})
    assert invalid.status_code == 400 and 'English title is required' in invalid.text
    for offer in conn.execute("SELECT id,title_en FROM services WHERE preset_key<>''"):
        assert owner.get(f'/admin/services/{offer["id"]}/edit').status_code == 200
        for lang in ('en', 'ka'):
            preview = owner.get(f'/admin/services/{offer["id"]}/preview?lang={lang}')
            assert preview.status_code == 200
            assert preview.headers['Cache-Control'] == 'no-store'


def test_draft_preview_publication_disable_delete_and_restore(catalogue):
    app, conn = catalogue
    owner, guest = client_for(app, conn), app.test_client()
    identifier = service(conn)
    url = f'/services/{identifier}'
    preview = f'/admin/services/{identifier}/preview'
    assert guest.get(url).status_code == 404
    assert guest.get(preview).status_code == 302
    response = owner.get(preview)
    assert response.status_code == 200 and response.headers['Cache-Control'] == 'no-store'
    assert f'/request?service_id={identifier}' not in response.text
    assert post(owner, {'id': str(identifier), 'action': 'publish'}).status_code == 302
    assert guest.get(url).status_code == 301
    assert guest.get(url, follow_redirects=True).status_code == 200
    assert post(owner, {'id': str(identifier), 'action': 'unpublish'}).status_code == 302
    assert guest.get(url).status_code == 404
    assert post(owner, {'id': str(identifier), 'action': 'delete'}).status_code == 400
    assert get_service(conn, identifier)['archived_at'] is None
    assert post(owner, {'id': str(identifier), 'action': 'delete', 'confirm_delete': 'on'}).status_code == 302
    assert get_service(conn, identifier)['archived_at'] is not None
    assert 'A test mountain day' in owner.get('/admin/services?status=deleted').text
    assert 'A test mountain day' not in owner.get('/admin/services?status=all').text
    assert post(owner, {'id': str(identifier), 'action': 'publish'}).status_code == 400
    init_db(conn)
    assert get_service(conn, identifier)['archived_at'] is not None
    assert post(owner, {'id': str(identifier), 'action': 'restore'}).status_code == 302
    restored = get_service(conn, identifier)
    assert restored['published'] == 0 and restored['archived_at'] is None
    assert guest.get(url).status_code == 404


def test_all_offering_fields_can_be_edited_and_partial_saves_preserve_them(catalogue):
    app, conn = catalogue
    owner = client_for(app, conn)
    identifier = service(conn)
    provider = conn.execute("INSERT INTO providers(name,approved) VALUES ('Edited provider',1)").lastrowid
    data = {key: 'Edited ' + key for key in SERVICE_TEXT_FIELDS}
    data.update(id=str(identifier), provider_id=str(provider), kind='taxi', slug='edited-georgia-route',
                price='125.75', currency='EUR', capacity='6', duration_days='3',
                season_months='9,6,9', research_sources='https://georgia.travel/\nhttps://meteo.gov.ge/',
                research_checked='2026-10-05', published='on')
    assert post(owner, data).status_code == 302
    saved = get_service(conn, identifier)
    for key in SERVICE_TEXT_FIELDS:
        assert saved[key] == data[key]
    assert saved['provider_id'] == provider and saved['kind'] == 'taxi'
    assert saved['price_minor'] == 12575 and saved['currency'] == 'EUR'
    assert saved['capacity'] == 6 and saved['duration_days'] == 3
    assert saved['season_months'] == '6,9' and saved['published'] == 1
    assert saved['research_sources'] == data['research_sources']
    assert saved['research_checked'] == '2026-10-05'
    assert post(owner, {'id': str(identifier), 'title_en': 'A later owner edit'}).status_code == 302
    later = get_service(conn, identifier)
    for key in saved:
        if key not in {'title_en', 'updated_at'}:
            assert later[key] == saved[key], key
    assert later['title_en'] == 'A later owner edit'
    # A full form can explicitly uncheck both visibility and seasonal filter months.
    assert post(owner, {'id': str(identifier), 'published_present': '1', 'season_months_present': '1'}).status_code == 302
    later = get_service(conn, identifier)
    assert later['published'] == 0 and later['season_months'] == ''
    assert post(owner, [('id', str(identifier)), ('season_months_present', '1'),
                        ('season_months', '7'), ('season_months', '8')]).status_code == 302
    assert get_service(conn, identifier)['season_months'] == '7,8'


@pytest.mark.parametrize('changes', [
    {'duration_days': '0'}, {'duration_days': '1.5'}, {'capacity': '-1'},
    {'season_months': '6,13'}, {'research_sources': 'javascript:alert(1)'},
    {'research_sources': 'https://user:secret@example.test/'},
    {'research_checked': '2026-02-30'}, {'slug': '../invalid'}, {'price': '-10'},
])
def test_invalid_offer_edits_are_rejected_without_losing_saved_content(catalogue, changes):
    app, conn = catalogue
    identifier = service(conn, itinerary_en='Owner route must survive')
    before = get_service(conn, identifier)
    response = post(client_for(app, conn), dict(id=str(identifier), title_en='Unsaved change', **changes))
    assert response.status_code == 400
    assert get_service(conn, identifier) == before


def test_photos_can_be_replaced_and_removed_without_deleting_history_assets(catalogue):
    app, conn = catalogue
    owner = client_for(app, conn)
    identifier = service(conn)
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=')
    assert post(owner, {'id': str(identifier), 'photo': (BytesIO(png), 'mountain.png')}).status_code == 302
    photo = get_service(conn, identifier)['image_path']
    assert app.test_client().get(photo).data == png
    assert post(owner, {'id': str(identifier), 'remove_photo': 'on'}).status_code == 302
    assert get_service(conn, identifier)['image_path'] == ''
    assert app.test_client().get(photo).data == png


def test_deleted_offering_preserves_enquiries_quotes_and_rejects_new_links(catalogue):
    app, conn = catalogue
    owner = client_for(app, conn)
    identifier = service(conn, published=1)
    enquiry_data = dict(kind='tour', service_id=identifier, name='History guest', email='guest@example.test',
                        starts_at=domain.timestamp(domain.now() + timedelta(days=10)),
                        ends_at=domain.timestamp(domain.now() + timedelta(days=11)), party_size=2)
    enquiry = domain.create_enquiry(conn, enquiry_data)
    quote_data = dict(items=[dict(service_id=identifier, title='Agreed route', quantity=1, unit_price_minor=30000)],
                      expires_at=domain.timestamp(domain.now() + timedelta(hours=2)),
                      terms='Agreed test terms', policy_version='test-1', currency='GEL')
    quote = domain.create_quote(conn, enquiry['id'], quote_data)
    assert post(owner, {'id': str(identifier), 'action': 'delete', 'confirm_delete': 'on'}).status_code == 302
    assert conn.execute('SELECT service_id FROM enquiries WHERE id=?', (enquiry['id'],)).fetchone()[0] == identifier
    item = conn.execute('SELECT * FROM quote_items WHERE quote_id=?', (quote['id'],)).fetchone()
    assert item['service_id'] == identifier and item['title'] == 'Agreed route' and item['total_minor'] == 30000
    assert domain.get_quote(conn, quote['id'])['status'] == 'offered'
    assert 'A test mountain day' not in owner.get(f"/admin/enquiries/{enquiry['id']}").text
    with pytest.raises(domain.DomainError, match='removed|deleted|catalogue'):
        domain.create_enquiry(conn, enquiry_data)
    with pytest.raises(domain.DomainError, match='removed|deleted|catalogue'):
        domain.create_enquiry(conn, enquiry_data, actor_id=1)
    other_enquiry = domain.create_enquiry(conn, dict(enquiry_data, service_id=None))
    with pytest.raises(domain.DomainError, match='removed|deleted|catalogue'):
        domain.create_quote(conn, other_enquiry['id'], quote_data)
    assert not conn.execute('PRAGMA foreign_key_check').fetchall()


def test_public_filters_do_not_leak_drafts_archived_or_private_research(catalogue):
    app, conn = catalogue
    guest = app.test_client()
    day = service(conn, title='Visible alpine walk', published=1, operator_notes='PRIVATE_OPERATOR_NOTE',
                  research_sources='https://example.test/private-research-link')
    service(conn, title='Visible longer journey', slug='longer', duration_days=3, published=1)
    service(conn, title='Secret route draft', slug='draft', published=0)
    service(conn, title='Archived published mistake', slug='archived', published=1, archived_at='2026-10-05T10:00:00Z')
    result = guest.get('/services?region=Svaneti&activity=Walking&duration=day&month=7').text
    assert 'Visible alpine walk' in result
    assert 'Visible longer journey' not in result
    assert 'Secret route draft' not in result and 'Archived published mistake' not in result
    assert 'Visible alpine walk' not in guest.get('/services?month=1').text
    result = guest.get(f'/services/{day}', follow_redirects=True).text
    assert 'PRIVATE_OPERATOR_NOTE' not in result and 'private-research-link' not in result
    for filters in ('month=13', 'duration=week', 'kind=invalid', 'month=7%27%20OR%201=1'):
        assert guest.get('/services?' + filters).status_code == 400


def test_owner_roles_csrf_and_draft_request_boundary(catalogue):
    app, conn = catalogue
    identifier = service(conn)
    guest, dispatcher = app.test_client(), client_for(app, conn, 'dispatcher')
    for path in ('/admin/services/new', f'/admin/services/{identifier}/edit', f'/admin/services/{identifier}/preview'):
        assert guest.get(path).status_code == 302
        assert dispatcher.get(path).status_code == 403
    for action in ('publish', 'unpublish', 'delete', 'restore'):
        assert post(dispatcher, {'id': str(identifier), 'action': action, 'confirm_delete': 'on'}).status_code == 403
    owner = client_for(app, conn)
    assert owner.post('/admin/services', data={'id': identifier, 'action': 'publish'}).status_code == 400
    guest.get('/request')
    with guest.session_transaction() as session:
        data = dict(csrf_token=session['csrf_token'], request_key=session['request_key'])
    data.update(kind='tour', service_ids=str(identifier), name='Draft route request', contact='+995555123456',
                party_size='2', start_local='2030-07-10T09:00', end_local='2030-07-10T18:00', privacy_consent='on')
    assert guest.post('/request', data=data).status_code == 400
    assert conn.execute('SELECT COUNT(*) FROM enquiries').fetchone()[0] == 0


def test_additive_migration_preserves_legacy_rows_and_is_repeatable(tmp_path):
    conn = connect(tmp_path / 'legacy.sqlite3')
    conn.execute('CREATE TABLE services(id INTEGER PRIMARY KEY,title_en TEXT,price_minor INTEGER,published INTEGER)')
    conn.execute("INSERT INTO services VALUES (7,'An owner-edited older offer',12345,1)")
    migrate_catalogue(conn)
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(services)')}
    assert set(SERVICE_COLUMNS) <= columns
    conn.execute("UPDATE services SET operator_notes='Keep this note',archived_at='2026-10-05T10:00:00Z' WHERE id=7")
    before = dict(conn.execute('SELECT * FROM services WHERE id=7').fetchone())
    migrate_catalogue(conn)
    assert dict(conn.execute('SELECT * FROM services WHERE id=7').fetchone()) == before
    assert before['title_en'] == 'An owner-edited older offer' and before['price_minor'] == 12345
    conn.close()
