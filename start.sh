#!/usr/bin/env bash
# Startet den Dia-Assistenten und öffnet den Browser.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
exec .venv/bin/python -m dia_assistent "$@"
