"""Mestia Travel: a small, server-rendered booking operations application."""
import os
import re
from pathlib import Path
from datetime import timedelta
from urllib.parse import urlsplit
from flask import Flask, g
from .db import connect, init_db

ROOT = Path(__file__).resolve().parent.parent


def public_origin(value):
    """Use a configured HTTPS origin, never a request's untrusted Host header."""
    value = str(value or '').strip()
    if not value:
        return ''
    try:
        parts = urlsplit(value)
        host = (parts.hostname or '').encode('idna').decode('ascii').lower()
        port = parts.port
        if (parts.scheme != 'https' or not host or parts.username is not None
                or parts.password is not None or parts.path not in ('', '/')
                or parts.query or parts.fragment or any(c.isspace() for c in value)
                or not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host)
                or port is not None and not 1 <= port <= 65535):
            raise ValueError()
        authority = f'[{host}]' if ':' in host else host
        return 'https://' + authority + (f':{port}' if port and port != 443 else '')
    except (ValueError, UnicodeError):
        raise ValueError('MESTIA_PUBLIC_URL must be an HTTPS origin, for example https://your-domain.com, without a path, credentials or query.') from None


def load_env():
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key.strip().replace('_', '').isalnum():
                os.environ.setdefault(key.strip(), value.strip().strip('\"').strip("'"))


def get_db():
    if 'db' not in g:
        from flask import current_app
        g.db = connect(current_app.config['DATABASE'], journal_mode=current_app.config.get('SQLITE_JOURNAL_MODE'))
    return g.db


def create_app(test_config=None):
    load_env()
    app = Flask(__name__, instance_path=str(ROOT / 'instance'))
    secret = os.environ.get('SECRET_KEY', '')
    app.config.update(
        SECRET_KEY=secret,
        DATABASE=str((ROOT / os.environ.get('MESTIA_DB', 'instance/mestia.sqlite3')).resolve()),
        MEDIA_DIR=str((ROOT / os.environ.get('MESTIA_MEDIA_DIR', 'instance/uploads')).resolve()),
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=os.environ.get('MESTIA_SECURE_COOKIES', '0') == '1',
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,
        TRUST_PROXY=os.environ.get('MESTIA_TRUST_PROXY', '0') == '1',
        REQUIRE_TOTP=os.environ.get('MESTIA_REQUIRE_TOTP', '0') == '1',
        PUBLIC_URL=os.environ.get('MESTIA_PUBLIC_URL', ''),
        INDEXING_ENABLED=os.environ.get('MESTIA_INDEXING_ENABLED', '0') == '1',
        SQLITE_JOURNAL_MODE=os.environ.get('MESTIA_SQLITE_JOURNAL_MODE', 'WAL'),
        SEND_FILE_MAX_AGE_DEFAULT=3600,
    )
    if test_config:
        app.config.update(test_config)
    app.config['PUBLIC_URL'] = public_origin(app.config['PUBLIC_URL'])
    if app.config['INDEXING_ENABLED'] and not app.config['PUBLIC_URL']:
        raise ValueError('Set MESTIA_PUBLIC_URL before enabling search indexing.')
    if len(app.config['SECRET_KEY']) < 32:
        raise RuntimeError('Set SECRET_KEY to a random value of at least 32 characters. Run bash scripts/setup-termux.sh first.')
    Path(app.config['DATABASE']).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    Path(app.config['MEDIA_DIR']).mkdir(parents=True, exist_ok=True, mode=0o700)
    # Waitress handles the exact trusted proxy chain in the serve command.
    @app.teardown_appcontext
    def close_db(error=None):
        conn = g.pop('db', None)
        if conn is not None:
            conn.close()
    with app.app_context():
        init_db(get_db())
    from .web import register_routes
    register_routes(app)
    return app
