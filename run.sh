#!/usr/bin/env bash
# Startet Studo+ lokal. Vorher: python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
cd backend
exec uvicorn app.main:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}" --proxy-headers
