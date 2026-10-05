"""Persistent cloud configuration and safe cross-host data movement."""
import importlib.util
from pathlib import Path
import runpy
import sqlite3
import stat
import zipfile

import pytest

from mestia.db import connect, init_db
from mestia.ops import backup, restore


ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('configure_cloud', ROOT / 'scripts/configure-cloud.py')
cloud_setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloud_setup)


def test_sqlite_journal_mode_is_validated_before_opening_database(tmp_path, monkeypatch):
    path = tmp_path / 'should-not-exist.sqlite3'
    monkeypatch.setenv('MESTIA_SQLITE_JOURNAL_MODE', 'WAL; DROP TABLE users')
    with pytest.raises(ValueError, match='must be WAL or DELETE'):
        connect(path)
    assert not path.exists()
    conn = connect(path, journal_mode='DELETE')
    assert conn.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
    assert conn.execute('PRAGMA foreign_keys').fetchone()[0] == 1
    conn.close()


def test_journal_mode_changes_preserve_existing_records(tmp_path, monkeypatch):
    path = tmp_path / 'database.sqlite3'
    monkeypatch.delenv('MESTIA_SQLITE_JOURNAL_MODE', raising=False)
    conn = connect(path)
    assert conn.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'
    conn.execute('CREATE TABLE sample (value TEXT)')
    conn.execute('INSERT INTO sample VALUES (?)', ('Owner content',))
    conn.close()
    monkeypatch.setenv('MESTIA_SQLITE_JOURNAL_MODE', 'DELETE')
    conn = connect(path)
    assert conn.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
    assert conn.execute('SELECT value FROM sample').fetchone()[0] == 'Owner content'
    conn.close()


def test_cloud_setup_repeat_preserves_private_secret_owner_config_and_data(tmp_path):
    env_path = tmp_path / '.env'
    database = tmp_path / 'mestia.sqlite3'
    conn = connect(database, journal_mode='DELETE')
    conn.execute('CREATE TABLE owner_data (note TEXT)')
    conn.execute("INSERT INTO owner_data VALUES ('Keep this')")
    conn.close()
    original_db = database.read_bytes()
    assert cloud_setup.configure(env_path, 'https://example.pythonanywhere.com/',
                                 'owner@example.test', environ={})
    settings = cloud_setup.read_settings(env_path)
    assert len(settings['SECRET_KEY']) == 64
    assert settings['MESTIA_SQLITE_JOURNAL_MODE'] == 'DELETE'
    assert settings['MESTIA_SECURE_COOKIES'] == '1'
    assert settings['MESTIA_INDEXING_ENABLED'] == '0'
    assert stat.S_IMODE(env_path.stat().st_mode) == 0o600
    env_path.write_text(env_path.read_text() + '# Owner note\nMESTIA_OWNER_CUSTOM=keep-me\n')
    original_env = env_path.read_bytes()
    assert not cloud_setup.configure(env_path, 'https://example.pythonanywhere.com',
                                     'owner@example.test', environ={})
    assert env_path.read_bytes() == original_env
    assert database.read_bytes() == original_db


@pytest.mark.parametrize('origin,email', [
    ('http://example.pythonanywhere.com', ''),
    ('https://example.pythonanywhere.com/path', ''),
    ('https://user:pass@example.pythonanywhere.com', ''),
    ('https://example.pythonanywhere.com?x=1', ''),
    ('https://example.pythonanywhere.com\nSECRET_KEY=oops', ''),
    ('https://example.pythonanywhere.com', 'invalid-email'),
])
def test_invalid_setup_input_does_not_create_configuration(tmp_path, origin, email):
    path = tmp_path / '.env'
    with pytest.raises(ValueError):
        cloud_setup.configure(path, origin, email, environ={})
    assert not path.exists()


def test_cloud_setup_refuses_incompatible_existing_or_exported_settings(tmp_path):
    path = tmp_path / '.env'
    cloud_setup.configure(path, 'https://example.pythonanywhere.com', environ={})
    original = path.read_bytes()
    with pytest.raises(ValueError, match='MESTIA_SECURE_COOKIES'):
        cloud_setup.configure(path, 'https://example.pythonanywhere.com',
                              environ={'MESTIA_SECURE_COOKIES': '0'})
    with pytest.raises(ValueError, match='MESTIA_PUBLIC_URL'):
        cloud_setup.configure(path, 'https://other.pythonanywhere.com', environ={})
    assert path.read_bytes() == original
    assert not cloud_setup.configure(path, 'https://example.pythonanywhere.com', check_only=True, environ={})
    absent = tmp_path / 'validation-only.env'
    cloud_setup.configure(absent, 'https://example.pythonanywhere.com', check_only=True, environ={})
    assert not absent.exists()


def test_portable_wal_backup_restores_records_and_images_under_delete(tmp_path, monkeypatch):
    source_path, media = tmp_path / 'phone.sqlite3', tmp_path / 'phone-media'
    media.mkdir()
    (media / 'actual-photo.jpg').write_bytes(b'test-image-content')
    source = connect(source_path, journal_mode='WAL')
    init_db(source)
    source.execute("UPDATE settings SET value='Owner edited name' WHERE key='business_name'")
    source.execute("INSERT INTO users(email,password_hash,role) VALUES ('owner@example.test','preserved-hash','owner')")
    source.close()
    archive = backup(source_path, media, tmp_path / 'phone-backup.zip')
    with zipfile.ZipFile(archive) as bundle:
        snapshot_path = tmp_path / 'snapshot.sqlite3'
        snapshot_path.write_bytes(bundle.read('database.sqlite3'))
        assert '.env' not in bundle.namelist()
    snapshot = sqlite3.connect(snapshot_path)
    assert snapshot.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
    snapshot.close()
    restored_path, restored_media = tmp_path / 'cloud.sqlite3', tmp_path / 'cloud-media'
    restore(restored_path, restored_media, archive)
    monkeypatch.setenv('MESTIA_SQLITE_JOURNAL_MODE', 'DELETE')
    restored = connect(restored_path)
    init_db(restored)
    assert restored.execute('PRAGMA journal_mode').fetchone()[0] == 'delete'
    assert restored.execute("SELECT value FROM settings WHERE key='business_name'").fetchone()[0] == 'Owner edited name'
    assert restored.execute("SELECT password_hash FROM users WHERE email='owner@example.test'").fetchone()[0] == 'preserved-hash'
    assert restored.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    restored.close()
    assert (restored_media / 'actual-photo.jpg').read_bytes() == b'test-image-content'


def test_managed_wsgi_entrypoint_uses_factory_secure_config_and_delete_storage(tmp_path, monkeypatch):
    for key, value in {
        'SECRET_KEY': 'cloud-test-secret-never-use-live-1234567890',
        'MESTIA_DB': str(tmp_path / 'wsgi.sqlite3'),
        'MESTIA_MEDIA_DIR': str(tmp_path / 'uploads'),
        'MESTIA_SQLITE_JOURNAL_MODE': 'DELETE',
        'MESTIA_PUBLIC_URL': 'https://example.pythonanywhere.com',
        'MESTIA_INDEXING_ENABLED': '0',
        'MESTIA_SECURE_COOKIES': '1',
        'MESTIA_TRUST_PROXY': '0',
    }.items():
        monkeypatch.setenv(key, value)
    app = runpy.run_path(str(ROOT / 'wsgi.py'))['application']
    assert app.config['SESSION_COOKIE_SECURE'] is True
    assert app.config['TRUST_PROXY'] is False
    assert app.config['SQLITE_JOURNAL_MODE'] == 'DELETE'
    client = app.test_client()
    assert client.get('/health').status_code == 200
    response = client.get('/admin/login', base_url='https://example.pythonanywhere.com')
    assert response.status_code == 200
    assert 'Secure' in response.headers['Set-Cookie']
    with app.test_request_context('/', headers={'X-Forwarded-Proto': 'https'}):
        from flask import request
        assert not request.is_secure
