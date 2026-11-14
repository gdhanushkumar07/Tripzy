#!/usr/bin/env bash
# Tripzy: Intelligence engine (:8000, loopback only) + platform (API :3001, web :5173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# Your API keys (git-ignored). Exported so both the engine and the platform server see them.
if [ -f "$ROOT/api-keys.env" ]; then
  set -a; . "$ROOT/api-keys.env"; set +a
  # Empty values must not override anything the server .env sets.
  for v in $(grep -oE '^[A-Z_]+=$' "$ROOT/api-keys.env" | tr -d '='); do unset "$v"; done
fi
# The engine trusts only the platform proxy: both read the same key from the server .env.
export TRIPZY_ENGINE_KEY="$(grep -E '^TRIPZY_ENGINE_KEY=' "$ROOT/platform/server/.env" | cut -d= -f2-)"
trap 'kill 0' EXIT
( cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 ) &
( cd "$ROOT/platform" && npm run dev ) &
echo "Tripzy starting… open http://localhost:5173"
wait
