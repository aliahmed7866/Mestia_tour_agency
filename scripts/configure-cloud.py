#!/usr/bin/env python3
"""Create private PythonAnywhere configuration, without third-party imports.

Validation also runs before setup creates a virtual environment. Existing owner
configuration is never rewritten; incompatible settings require an explicit edit.
"""
import argparse
import os
from pathlib import Path
import re
import secrets
import sys
from urllib.parse import urlsplit


def public_origin(value):
    if any(character.isspace() for character in value):
        raise ValueError('Use an HTTPS origin without spaces.')
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError('Use a valid HTTPS origin.') from exc
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment or port not in (None, 443)
            or not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', parsed.hostname)
            or '.' not in parsed.hostname or '..' in parsed.hostname):
        raise ValueError('Use only the public HTTPS origin, for example https://YOURNAME.pythonanywhere.com.')
    return 'https://' + parsed.hostname.lower()


def read_settings(path):
    if path.is_symlink():
        raise ValueError('Refusing a linked .env. Configure the real file explicitly.')
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError('.env must be a regular file.')
    settings = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        settings.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return settings


def configure(path, origin, email='', *, check_only=False, environ=None):
    origin = public_origin(origin)
    if email and (len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email)):
        raise ValueError('Enter a valid owner email address.')
    path = Path(path)
    existing = read_settings(path)
    defaults = {
        'SECRET_KEY': secrets.token_hex(32),
        'MESTIA_DB': 'instance/mestia.sqlite3',
        'MESTIA_MEDIA_DIR': 'instance/uploads',
        'MESTIA_HOST': '127.0.0.1', 'PORT': '8095',
        'MESTIA_REQUIRE_TOTP': '0', 'MESTIA_SECURE_COOKIES': '1',
        'MESTIA_TRUST_PROXY': '0', 'MESTIA_SQLITE_JOURNAL_MODE': 'DELETE',
        'MESTIA_PUBLIC_URL': origin, 'MESTIA_INDEXING_ENABLED': '0',
    }
    effective = dict(existing if existing is not None else defaults)
    effective.update(dict(os.environ if environ is None else environ))
    required = {
        'MESTIA_SECURE_COOKIES': '1', 'MESTIA_TRUST_PROXY': '0',
        'MESTIA_SQLITE_JOURNAL_MODE': 'DELETE', 'MESTIA_PUBLIC_URL': origin,
    }
    incompatible = [key for key, value in required.items() if effective.get(key) != value]
    if len(effective.get('SECRET_KEY', '')) < 32:
        incompatible.append('SECRET_KEY')
    if effective.get('MESTIA_INDEXING_ENABLED') not in {'0', '1'}:
        incompatible.append('MESTIA_INDEXING_ENABLED')
    if incompatible:
        raise ValueError('Review these existing .env / exported settings for PythonAnywhere: '
                         + ', '.join(incompatible) + '. No configuration was changed.')
    if existing is not None or check_only:
        return False
    content = '# Private PythonAnywhere pilot configuration. Never commit this file.\n'
    content += '# Enable indexing only after reviewing the public site and launch checklist.\n'
    content += ''.join(f'{key}={value}\n' for key, value in defaults.items())
    # O_EXCL prevents a concurrent setup from replacing a newly created secret.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write(content)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('public_url')
    parser.add_argument('owner_email', nargs='?', default='')
    args = parser.parse_args()
    try:
        created = configure(Path(__file__).resolve().parent.parent / '.env',
                            args.public_url, args.owner_email, check_only=args.check)
    except (OSError, ValueError) as exc:
        print(f'Error: {exc}', file=sys.stderr)
        return 1
    if not args.check:
        print('Created private cloud .env.' if created else 'Kept existing .env and secret key.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
