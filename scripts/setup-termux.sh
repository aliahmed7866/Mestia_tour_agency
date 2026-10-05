#!/usr/bin/env bash
# Run with: bash scripts/setup-termux.sh [owner-email]
set -euo pipefail
umask 077

project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if (( $# > 1 )); then
    printf 'Usage: bash scripts/setup-termux.sh [owner-email]\n' >&2
    exit 2
fi

if ! command -v python >/dev/null 2>&1; then
    printf 'Python is required. In Termux run: pkg install python python-pip git\n' >&2
    exit 1
fi
python -c 'import sys; sys.exit("Python 3.11 or newer is required.") if sys.version_info < (3, 11) else None'

if [[ ! -d .venv ]]; then
    python -m venv .venv
fi
if [[ ! -x .venv/bin/python ]]; then
    printf 'The existing .venv is incomplete. Preserve .env and instance/, then recreate .venv.\n' >&2
    exit 1
fi

# Do not upgrade Termux's package-managed pip or install global Python packages.
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python - <<'PY'
from pathlib import Path
import os
import secrets

path = Path('.env')
if path.exists():
    print('Keeping existing .env and secret key.')
else:
    content = Path('.env.example').read_text(encoding='utf-8')
    content = content.replace('GENERATE_WITH_SETUP_SCRIPT', secrets.token_hex(32), 1)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        output.write(content)
    print('Created private .env with a random secret key.')
Path('instance').mkdir(mode=0o700, exist_ok=True)
PY

.venv/bin/python -m mestia init-db
if (( $# == 1 )); then
    .venv/bin/python -m mestia create-user --email "$1"
else
    printf '\nCreate the owner account with your email and password:\n  .venv/bin/python -m mestia create-user --email YOUR_EMAIL\n'
fi
printf '\nStart the app:\n  bash scripts/start.sh\nOpen the address printed at startup on this phone (new installs use port 8095).\nTo change an existing port first: bash scripts/set-port.sh 8095\n'
