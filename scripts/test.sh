#!/usr/bin/env bash
set -euo pipefail
project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
if [[ ! -x .venv/bin/python ]] || ! .venv/bin/python -c 'import pytest' >/dev/null 2>&1; then
    printf 'Install test dependencies first:\n  .venv/bin/python -m pip install -r requirements-dev.txt\n' >&2
    exit 1
fi
exec .venv/bin/python -m pytest "$@"
