"""Small, auditable security helpers with no native crypto dependency."""
import base64
import hashlib
import hmac
import secrets
import struct
import time

from flask import abort, request, session
from werkzeug.security import check_password_hash, generate_password_hash


def hash_password(value):
    if len(value) < 12:
        raise ValueError("Passwords must contain at least 12 characters.")
    if len(value) > 1024:
        raise ValueError("Password is too long.")
    return generate_password_hash(value, method="pbkdf2:sha256:600000", salt_length=16)


def check_password(stored_hash, value):
    if not isinstance(value, str) or len(value) > 1024:
        return False
    try:
        return check_password_hash(stored_hash, value)
    except (TypeError, ValueError):
        return False


def new_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_code(secret, step=None):
    """RFC 6238 SHA-1, six digits, 30-second periods; compatible with authenticators."""
    if step is None:
        step = int(time.time()) // 30
    padded = secret.upper() + "=" * (-len(secret) % 8)
    digest = hmac.new(base64.b32decode(padded), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 15
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff
    return f"{number % 1000000:06d}"


def verify_totp(secret, code, last_step=None, now=None):
    """Return accepted counter or None. Persist it atomically to prevent replay."""
    if not secret or not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdigit():
        return None
    current = int(time.time() if now is None else now) // 30
    try:
        for step in (current, current - 1, current + 1):
            if step < 0 or (last_step is not None and step <= last_step):
                continue
            if hmac.compare_digest(totp_code(secret, step), code):
                return step
    except (ValueError, TypeError, base64.binascii.Error):
        return None
    return None


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def validate_csrf():
    supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if not expected or not supplied or not hmac.compare_digest(str(expected).encode(), str(supplied).encode()):
        abort(400, description="This form expired. Reload the page and try again.")


def rate_limit(conn, key, limit, window_seconds, secret, now=None):
    """Consume one attempt in a persistent fixed window. Return True if allowed.

    Use separate namespaces for IP, contact and action. Keys are HMAC hashes so
    this table does not store raw guest contact information or IP addresses.
    """
    if limit < 1 or window_seconds < 1 or not secret:
        raise ValueError("A positive limit/window and a secret are required.")
    current = int(time.time() if now is None else now)
    window = current // window_seconds * window_seconds
    digest = hmac.new(str(secret).encode(), str(key).encode(), hashlib.sha256).hexdigest()
    conn.execute("""CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY, window_start INTEGER NOT NULL,
        attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)""")
    # One UPSERT is atomic, including with concurrent Waitress request threads.
    conn.execute("""INSERT INTO rate_limits(bucket,window_start,attempts,expires_at)
        VALUES (?,?,1,?) ON CONFLICT(bucket) DO UPDATE SET
        attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,
        window_start=excluded.window_start, expires_at=excluded.expires_at""",
        (digest, window, window + window_seconds))
    attempts = conn.execute("SELECT attempts FROM rate_limits WHERE bucket=?", (digest,)).fetchone()[0]
    # Bounded retention; expiring this window cannot erase attempts in its lifetime.
    conn.execute("DELETE FROM rate_limits WHERE expires_at < ?", (current - 86400,))
    return attempts <= limit
