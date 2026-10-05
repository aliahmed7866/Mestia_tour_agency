#!/usr/bin/env bash
# PythonAnywhere pilot setup. Run only in the hosting account's Bash console.
set -euo pipefail
umask 077
project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if (( $# < 1 || $# > 2 )); then
    printf 'Usage: bash scripts/setup-cloud.sh https://YOURNAME.pythonanywhere.com [owner-email]\n' >&2
    exit 2
fi
cloud_python="${MESTIA_PYTHON:-python3}"
if ! command -v "$cloud_python" >/dev/null 2>&1; then
    printf 'Python 3.11+ is required. Set MESTIA_PYTHON to your hosting Python command.\n' >&2
    exit 1
fi
"$cloud_python" -c 'import sys; sys.exit("Python 3.11 or newer is required.") if sys.version_info < (3, 11) else None'
# Validate origin, email and existing settings before any setup mutation.
"$cloud_python" scripts/configure-cloud.py --check "$@"
if [[ ! -d .venv ]]; then
    "$cloud_python" -m venv .venv
fi
if [[ ! -x .venv/bin/python ]]; then
    printf 'The existing .venv is incomplete. Preserve .env and instance/, then recreate .venv.\n' >&2
    exit 1
fi
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/configure-cloud.py "$@"
.venv/bin/python -m mestia init-db

if (( $# == 2 )); then
    if .venv/bin/python - "$2" <<'PY'
import sys
from mestia import create_app, get_db
app = create_app()
with app.app_context():
    existing = get_db().execute('SELECT id FROM users WHERE email=?', (sys.argv[1].strip().lower(),)).fetchone()
sys.exit(0 if existing else 1)
PY
    then
        printf 'Existing staff account preserved. No password was changed.\n'
    else
        .venv/bin/python -m mestia create-user --email "$2"
    fi
else
    printf '\nCreate your owner account:\n  .venv/bin/python -m mestia create-user --email YOUR_EMAIL\n'
fi
printf '\nLocal setup is ready; this command did not create or publish a hosting account.\nConfigure the Web tab and WSGI entry point using docs/cloud-hosting.md.\nIndexing stays at the value in your .env (new installs start disabled).\n'
