#!/usr/bin/env bash
# Save a new local port without replacing any other .env settings.
set -euo pipefail
umask 077
project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
if (( $# != 1 )); then
    printf 'Usage: bash scripts/set-port.sh PORT\nExample: bash scripts/set-port.sh 8095\n' >&2
    exit 2
fi
if [[ ! -x .venv/bin/python || ! -f .env ]]; then
    printf 'First run: bash scripts/setup-termux.sh\n' >&2
    exit 1
fi
exec .venv/bin/python -m mestia set-port "$1"
