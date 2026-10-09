#!/usr/bin/env bash
# Performance runs for issue #91, each on a fresh isolated stack (np-perf,
# chaos/compose.yml + compose.yml here). Results go to results/.
#
#   bash load/perf/run.sh intake <vus>                   # k6 against POST /notifications
#   bash load/perf/run.sh worker <concurrency> [pool]    # drain 2,000 queued jobs
#
# worker: the jobs are queued with the worker stopped, then the worker starts
# with WORKER_CONCURRENCY=<concurrency> and DB_POOL_SIZE=<pool> (default 10)
# and the run ends when all are SENT. Throughput and per-job times come from
# the database: delivery_attempt.started_at and notification.sent_at.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
API="http://localhost:13000"
# Throwaway value from chaos/compose.yml, not a secret.
ADMIN_KEY="chaos-admin-key-not-used-anywhere-else"
JOBS=${JOBS:-2000}
compose() {
  docker compose -p np-perf -f "$ROOT/chaos/compose.yml" -f "$DIR/compose.yml" "$@"
}
sql() {
  compose exec -T mysql mysql -N -B -uchaos -pchaos-password chaos -e "$1" 2>/dev/null
}
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

start() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  compose up -d --build --quiet-pull "$@" >/dev/null 2>&1
  for _ in $(seq 180); do
    curl -sf "$API/health/ready" >/dev/null 2>&1 && break
    sleep 1
  done
  API_KEY=$(compose exec -T api node dist/cli/create-api-client.js perf |
    sed -n 's/^X-API-Key: //p' | tr -d '\r')
  curl -sf -X POST "$API/admin/templates" -H 'Content-Type: application/json' \
    -H "X-Admin-Key: $ADMIN_KEY" \
    -d '{"key":"exp","channel":"email","subject":"Code {{n}}","htmlBody":"<p>{{n}}</p>","textBody":"{{n}}","requiredVariables":["n"]}' \
    >/dev/null
}

case "${1:-}" in
  intake)
    vus=${2:-20}
    log "intake with $vus virtual users"
    start api worker
    network=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' np-perf-api-1)
    results=$(cd "$DIR/results" && (pwd -W 2>/dev/null || pwd))
    MSYS_NO_PATHCONV=1 docker run --rm -i --network "$network" -v "$results:/out" \
      -e API=http://api:3000 -e API_KEY="$API_KEY" -e VUS="$vus" grafana/k6:2.2.0 \
      run --quiet --summary-export="/out/intake-vus$vus.json" - <"$DIR/intake.js" >/dev/null 2>&1
    node "$DIR/summarize.mjs" intake "$DIR/results/intake-vus$vus.json"
    ;;
  worker)
    concurrency=$2
    pool=${3:-10}
    log "worker: concurrency $concurrency, pool $pool, $JOBS jobs"
    start api
    # Through a file: 2,000 recipients are too long for a command line.
    body=$(mktemp)
    node -e "
      const n = Number(process.argv[1]);
      console.log(JSON.stringify({ channel: 'email', category: 'transactional', templateKey: 'exp',
        recipients: Array.from({ length: n }, (_, i) => ({ email: 'p' + i + '@example.com', variables: { n: String(i) } })) }));
    " "$JOBS" >"$body"
    curl -sf -X POST "$API/notification-batches" -H 'Content-Type: application/json' \
      -H "X-API-Key: $API_KEY" -H "Idempotency-Key: perf-$(date +%s%N)" --data-binary "@$body" >/dev/null
    rm -f "$body"
    until [ "$(sql "SELECT COUNT(*) FROM notification WHERE status = 'QUEUED'")" = "$JOBS" ]; do sleep 1; done
    WORKER_CONCURRENCY=$concurrency DB_POOL_SIZE=$pool compose up -d worker >/dev/null 2>&1
    until [ "$(sql "SELECT COUNT(*) FROM notification WHERE status = 'SENT'")" = "$JOBS" ]; do sleep 1; done
    out="$DIR/results/worker-c$concurrency-p$pool.tsv"
    # started (ms), sent (ms), provider duration (ms) per notification
    sql "SELECT ROUND(UNIX_TIMESTAMP(a.started_at) * 1000), ROUND(UNIX_TIMESTAMP(n.sent_at) * 1000), a.duration_ms
         FROM notification n JOIN delivery_attempt a ON a.notification_id = n.id" >"$out"
    node "$DIR/summarize.mjs" worker "$out" "$concurrency" "$pool"
    ;;
  down)
    compose down -v --remove-orphans >/dev/null 2>&1
    ;;
  *)
    echo "usage: run.sh intake <vus> | worker <concurrency> [pool] | down" >&2
    exit 1
    ;;
esac
