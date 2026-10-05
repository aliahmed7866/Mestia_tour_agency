"""Mestia Travel: a small, server-rendered booking operations application."""
import os
from pathlib import Path
from datetime import timedelta
from flask import Flask, g
from .db import connect, init_db

ROOT = Path(__file__).resolve().parent.parent


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
        g.db = connect(current_app.config['DATABASE'])
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
    )
    if test_config:
        app.config.update(test_config)
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
