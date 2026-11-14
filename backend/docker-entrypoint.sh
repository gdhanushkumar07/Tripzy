#!/bin/sh
# Tripzy container start-up: run the Tripzy engine privately on 127.0.0.1:8000,
# then hand over to the platform's own entrypoint (which drops to the node user).
set -e

# Shared secret between the platform proxy and the engine. Both run in this
# container, so a random per-start key is fine when none is configured.
if [ -z "$TRIPZY_ENGINE_KEY" ]; then
  TRIPZY_ENGINE_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
export TRIPZY_ENGINE_KEY
export TRIPZY_ENGINE_URL="http://127.0.0.1:8000"
export TRIPZY_STORE="${TRIPZY_STORE:-/app/data/tripzy}"

mkdir -p "$TRIPZY_STORE"
[ -f "$TRIPZY_STORE/osrm_matrix_cache.json" ] || cp /app/engine/seed/osrm_matrix_cache.json "$TRIPZY_STORE/"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$TRIPZY_STORE"
  RUN_AS="gosu node"
else
  RUN_AS=""
fi

$RUN_AS /opt/tripzy-venv/bin/uvicorn app.main:app --app-dir /app/engine --host 127.0.0.1 --port 8000 &

# Wait (briefly) for the engine so the first requests don't race it.
i=0
while [ $i -lt 30 ] && ! wget -qO- http://127.0.0.1:8000/api/health >/dev/null 2>&1; do
  i=$((i + 1)); sleep 1
done

exec /usr/local/bin/trek-entrypoint
