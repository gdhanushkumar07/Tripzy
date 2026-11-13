#!/usr/bin/env bash
# Tripzy: start the intelligence engine (:8000) and the platform (API :3001, web :5173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
trap 'kill 0' EXIT
( cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 ) &
( cd "$ROOT/platform" && npm run dev ) &
echo "Tripzy starting… open http://localhost:5173  (demo login: demo@tripzy.app / Tripzy@2026)"
wait
