import sqlite3
from types import SimpleNamespace
import zipfile

import pytest
from flask import Flask

from mestia.db import connect, init_db
from mestia.ops import backup, restore, runtime_lock
from mestia.security import check_password, csrf_token, hash_password, new_totp_secret, rate_limit, totp_code, validate_csrf, verify_totp


def test_password_hash_and_wrong_password():
    hashed = hash_password("mountain-fireplace-12")
    assert hashed.startswith("pbkdf2:sha256:600000$")
    assert check_password(hashed, "mountain-fireplace-12")
    assert not check_password(hashed, "wrong-password")
    assert not check_password(hashed, "x" * 1025)
    with pytest.raises(ValueError):
        hash_password("short")


def test_rfc_totp_and_replay():
    # RFC 6238 SHA1 vector at timestamp 59, truncated to six digits.
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp_code(secret, 1) == "287082"
    assert verify_totp(secret, "287082", now=59) == 1
    assert verify_totp(secret, "287082", now=59, last_step=1) is None
    assert verify_totp(secret, "287082", now=59 + 60) is None
    assert verify_totp(secret, "１２３４５６", now=59) is None
    assert verify_totp("not a secret", "123456", now=59) is None
    assert len(new_totp_secret()) == 32


def test_csrf_requires_session_and_matching_form_token():
    app = Flask(__name__)
    app.secret_key = "testing-only-secret-32-characters"

    @app.route("/form", methods=["GET", "POST"])
    def form():
        from flask import request
        if request.method == "POST":
            validate_csrf()
            return "ok"
        return csrf_token()

    client = app.test_client()
    assert client.post("/form").status_code == 400
    token = client.get("/form").text
    assert client.post("/form", data={"csrf_token": "wrong"}).status_code == 400
    assert client.post("/form", data={"csrf_token": "არასწორი"}).status_code == 400
    assert client.post("/form", data={"csrf_token": token}).status_code == 200
    assert app.test_client().post("/form", data={"csrf_token": token}).status_code == 400


def test_rate_limit_survives_new_connection_and_hashes_contact(tmp_path):
    db = tmp_path / "limits.sqlite3"
    first = connect(db)
    assert rate_limit(first, "contact:guest@example.org", 2, 60, "secret", now=121)
    assert rate_limit(first, "contact:guest@example.org", 2, 60, "secret", now=122)
    first.close()
    second = connect(db)
    assert not rate_limit(second, "contact:guest@example.org", 2, 60, "secret", now=123)
    assert rate_limit(second, "contact:guest@example.org", 2, 60, "secret", now=181)
    assert "guest" not in second.execute("SELECT bucket FROM rate_limits").fetchone()[0]
    second.close()


def test_backup_restore_preserves_media_and_database(tmp_path):
    db, media, archive = tmp_path / "app.sqlite3", tmp_path / "uploads", tmp_path / "backup.zip"
    conn = connect(db)
    init_db(conn)
    conn.execute("UPDATE settings SET value='Original name' WHERE key='business_name'")
    conn.close()
    media.mkdir()
    (media / "photo.jpg").write_bytes(b"photo")
    backup(db, media, archive)
    with zipfile.ZipFile(archive) as opened:
        assert set(opened.namelist()) == {"database.sqlite3", "manifest.json", "media/photo.jpg"}
    conn = connect(db)
    conn.execute("UPDATE settings SET value='Changed name' WHERE key='business_name'")
    conn.close()
    (media / "photo.jpg").write_bytes(b"changed")
    restore(db, media, archive)
    conn = connect(db)
    assert conn.execute("SELECT value FROM settings WHERE key='business_name'").fetchone()[0] == "Original name"
    conn.close()
    assert (media / "photo.jpg").read_bytes() == b"photo"
    assert db.with_name("app.sqlite3.pre-restore").exists()


def test_backup_requires_server_stopped(tmp_path):
    db = tmp_path / "app.sqlite3"
    sqlite3.connect(db).close()
    with runtime_lock(db):
        with pytest.raises(RuntimeError, match="Server is running"):
            backup(db, tmp_path / "media", tmp_path / "backup.zip")


def test_restore_rejects_archive_path_traversal(tmp_path):
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as archive:
        archive.writestr("../escaped.txt", "bad")
    with pytest.raises(ValueError, match="unsafe"):
        restore(tmp_path / "app.sqlite3", tmp_path / "media", bad)
    assert not (tmp_path / "escaped.txt").exists()


def test_cli_enrollment_must_finish_before_account_is_saved(tmp_path, monkeypatch):
    from mestia import __main__ as cli
    conn = connect(tmp_path / "app.sqlite3")
    init_db(conn)
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0
    inputs = iter(["strong-password-for-owner", "strong-password-for-owner", "not-an-otp"])
    monkeypatch.setattr(cli, "getpass", lambda prompt: next(inputs))
    with pytest.raises(ValueError, match="Authenticator code"):
        cli._manage_user(conn, SimpleNamespace(command="create-user", email="owner@example.org", role=None))
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 0
    conn.close()


def test_create_user_never_silently_resets_existing_credentials(tmp_path):
    from mestia import __main__ as cli
    conn = connect(tmp_path / "app.sqlite3")
    init_db(conn)
    conn.execute("INSERT INTO users(email,password_hash) VALUES (?,?)", ("owner@example.org", "original"))
    with pytest.raises(ValueError, match="reset-user"):
        cli._manage_user(conn, SimpleNamespace(command="create-user", email="owner@example.org", role=None))
    assert conn.execute("SELECT password_hash FROM users").fetchone()[0] == "original"
    conn.close()


def test_disable_staff_preserves_last_owner(tmp_path):
    from mestia import __main__ as cli
    conn = connect(tmp_path / "app.sqlite3")
    init_db(conn)
    conn.execute("INSERT INTO users(email,password_hash,role) VALUES (?,?,?)", ("owner@example.org", "original", "owner"))
    conn.execute("INSERT INTO users(email,password_hash,role) VALUES (?,?,?)", ("dispatcher@example.org", "other", "dispatcher"))
    cli._disable_user(conn, "dispatcher@example.org")
    assert conn.execute("SELECT active FROM users WHERE role='dispatcher'").fetchone()[0] == 0
    with pytest.raises(ValueError, match="last owner"):
        cli._disable_user(conn, "owner@example.org")
    assert conn.execute("SELECT active FROM users WHERE role='owner'").fetchone()[0] == 1
    conn.close()
