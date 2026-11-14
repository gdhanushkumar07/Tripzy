#!/usr/bin/env bash
# Tripzy: Intelligence engine (:8000, loopback only) + platform (API :3001, web :5173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# The engine trusts only the platform proxy: both read the same key from the server .env.
export TRIPZY_ENGINE_KEY="$(grep -E '^TRIPZY_ENGINE_KEY=' "$ROOT/platform/server/.env" | cut -d= -f2-)"
trap 'kill 0' EXIT
( cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 ) &
( cd "$ROOT/platform" && npm run dev ) &
echo "Tripzy starting… open http://localhost:5173"
wait
