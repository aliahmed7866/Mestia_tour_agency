#!/usr/bin/env bash
set -euo pipefail
umask 077
project_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
if (( $# > 1 )); then
    printf 'Usage: bash scripts/backup.sh [output.zip]\n' >&2
    exit 2
fi
if [[ ! -x .venv/bin/python ]]; then
    printf 'First run: bash scripts/setup-termux.sh\n' >&2
    exit 1
fi
if (( $# == 1 )); then
    backup_path="$1"
else
    mkdir -p backups
    backup_path="backups/mestia-$(date -u '+%Y%m%dT%H%M%SZ').zip"
fi
.venv/bin/python -m mestia backup --output "$backup_path"
