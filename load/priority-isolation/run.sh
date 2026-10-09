#!/usr/bin/env bash
# Priority-isolation experiment (scenario 13): the same load with split
# queues and with one shared queue, each on a fresh isolated stack.
# Writes results/<routing>.json; graph.mjs turns them into a chart.
#
#   bash load/priority-isolation/run.sh            # both routings
#   bash load/priority-isolation/run.sh single     # one of them
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
API="http://localhost:13000"
# Throwaway value from chaos/compose.yml, not a secret.
ADMIN_KEY="chaos-admin-key-not-used-anywhere-else"
compose() {
  docker compose -p np-exp -f "$ROOT/chaos/compose.yml" -f "$DIR/compose.yml" "$@"
}
log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

wait_ready() {
  for _ in $(seq 180); do
    curl -sf "$API/health/ready" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "API did not become ready" >&2
  return 1
}

run() {
  local routing=$1
  log "[$routing] fresh stack"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  QUEUE_ROUTING=$routing compose up -d --build --quiet-pull api worker >/dev/null 2>&1
  wait_ready
  local key
  key=$(compose exec -T api node dist/cli/create-api-client.js experiment |
    sed -n 's/^X-API-Key: //p' | tr -d '\r')
  curl -sf -X POST "$API/admin/templates" -H 'Content-Type: application/json' \
    -H "X-Admin-Key: $ADMIN_KEY" \
    -d '{"key":"exp","channel":"email","subject":"Code {{n}}","htmlBody":"<p>{{n}}</p>","textBody":"{{n}}","requiredVariables":["n"]}' \
    >/dev/null

  # Marketing goes only to users who opted in (checked again at send time),
  # so the batch is addressed to 10,000 consenting users, ids 1..10000.
  compose exec -T mysql mysql -uchaos -pchaos-password chaos -e "
    SET SESSION cte_max_recursion_depth = 20000;
    INSERT INTO app_user (email, marketing_opt_in, marketing_opt_in_at)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000)
    SELECT CONCAT('m', i, '@example.com'), 1, NOW(3) FROM n;" 2>/dev/null

  log "[$routing] 10,000 marketing + 1 verification email per second"
  node "$DIR/measure.mjs" "$API" "$key" "$routing" >"$DIR/results/$routing.json"
  log "[$routing] done: results/$routing.json"
  compose down -v --remove-orphans >/dev/null 2>&1
}

mkdir -p "$DIR/results"
for routing in "${@:-split single}"; do
  for r in $routing; do run "$r"; done
done
node "$DIR/graph.mjs"
