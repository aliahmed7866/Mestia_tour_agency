#!/usr/bin/env bash
set -euo pipefail
umask 077
project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
if [[ ! -x .venv/bin/python || ! -f .env ]]; then
    printf 'First run: bash scripts/setup-termux.sh\n' >&2
    exit 1
fi
exec .venv/bin/python -m mestia serve "$@"
