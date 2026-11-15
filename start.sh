#!/usr/bin/env bash
# Tripzy: Intelligence engine (:8000, loopback only) + platform (API :3001, web :5173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
# Your API keys (git-ignored). Exported so both the engine and the platform server see them.
if [ -f "$ROOT/api-keys.env" ]; then
  # Read as plain KEY=value lines (never executed). Empty values are skipped so
  # they cannot override anything the server .env sets.
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    val="${val%%#*}"; val="$(printf '%s' "$val" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -n "$val" ] && export "$key=$val"
  done < "$ROOT/api-keys.env"
fi
# The engine trusts only the platform proxy: both read the same key from the server .env.
export TRIPZY_ENGINE_KEY="$(grep -E '^TRIPZY_ENGINE_KEY=' "$ROOT/platform/server/.env" | cut -d= -f2-)"
trap 'kill 0' EXIT
( cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 ) &
( cd "$ROOT/travel" && npm run dev ) &
( cd "$ROOT/platform" && npm run dev ) &
echo "Tripzy starting… open http://localhost:5173"
wait
