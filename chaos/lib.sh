#!/usr/bin/env bash
# Shared helpers for the chaos scripts. Sourced, not run.
set -euo pipefail

CHAOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="http://localhost:13000"
# Throwaway value from compose.yml, not a secret.
ADMIN_KEY="chaos-admin-key-not-used-anywhere-else"
compose() { docker compose -f "$CHAOS_DIR/compose.yml" "$@"; }

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

sql() {
  compose exec -T mysql mysql -N -B -uchaos -pchaos-password chaos -e "$1" 2>/dev/null
}

# Waits until a command succeeds, up to $1 seconds.
wait_until() {
  local seconds=$1
  shift
  for _ in $(seq "$seconds"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "Timed out after ${seconds}s waiting for: $*" >&2
  return 1
}

api_ready() { curl -sf "$API/health/ready" >/dev/null; }

# Fresh stack: empty database and queues, current code.
start_stack() {
  log "Building and starting the chaos stack (np-chaos)"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  compose up -d --build --quiet-pull api worker >/dev/null 2>&1
  wait_until 180 api_ready
  API_KEY=$(compose exec -T api node dist/cli/create-api-client.js chaos \
    | sed -n 's/^X-API-Key: //p' | tr -d '\r')
  curl -sf -X POST "$API/admin/templates" -H 'Content-Type: application/json' \
    -H "X-Admin-Key: $ADMIN_KEY" \
    -d '{"key":"chaos","channel":"email","subject":"Chaos {{n}}","htmlBody":"<p>{{n}}</p>","textBody":"{{n}}","requiredVariables":["n"]}' \
    >/dev/null
  log "Stack ready"
}

# Accepts $1 notifications; prints how many got 202.
send_many() {
  local accepted=0
  for n in $(seq "$1"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/notifications" \
      -H "X-API-Key: $API_KEY" -H "Idempotency-Key: chaos-$RANDOM-$n-$(date +%s%N)" \
      -H 'Content-Type: application/json' \
      -d "{\"channel\":\"email\",\"category\":\"transactional\",\"templateKey\":\"chaos\",\"recipient\":{\"email\":\"user$n@example.com\"},\"variables\":{\"n\":\"$n\"}}")
    [ "$code" = 202 ] && accepted=$((accepted + 1))
  done
  echo "$accepted"
}

status_counts() {
  sql "SELECT status, COUNT(*) FROM notification GROUP BY status ORDER BY status" |
    awk '{printf "  %-10s %s\n", $1, $2}'
}

count_status() { sql "SELECT COUNT(*) FROM notification WHERE status = '$1'"; }

all_sent() {
  [ "$(sql "SELECT COUNT(*) FROM notification WHERE status <> 'SENT'")" = 0 ]
}

# Deliveries per notification, from the fake provider's log lines across
# every run of the worker container (docker keeps a stopped container's logs).
duplicate_deliveries() {
  compose logs --no-color worker 2>/dev/null |
    grep -o 'delivered notification=[0-9]*' | sort | uniq -c |
    awk '$1 > 1 {dup += $1 - 1; ids++} END {printf "%d %d\n", ids + 0, dup + 0}'
}

stalled_jobs() {
  compose logs --no-color worker 2>/dev/null | grep -c ' stalled' || true
}

finish() {
  if [ "${KEEP_STACK:-}" = 1 ]; then
    log "Leaving the stack running (KEEP_STACK=1). Stop it with: docker compose -f chaos/compose.yml down -v"
  else
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
