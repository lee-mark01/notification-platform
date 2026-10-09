#!/usr/bin/env bash
# Scenario 7: the worker is stopped gracefully (SIGTERM). Expected: sends in
# progress finish and are recorded before it exits, nothing is left SENDING,
# no job stalls, and after a restart the rest are sent once each.
# Usage: bash chaos/worker-sigterm.sh [count]
source "$(dirname "$0")/lib.sh"
COUNT=${1:-40}
trap finish EXIT

start_stack

log "Sending $COUNT notifications (each fake send takes 2 s)"
accepted=$(send_many "$COUNT")
echo "  accepted (202): $accepted / $COUNT"

log "Waiting until some are being sent"
wait_until 60 test "$(count_status SENDING)" -gt 0
in_flight=$(count_status SENDING)
status_counts

log "SIGTERM to the worker (docker compose stop)"
started=$(date +%s)
compose stop worker >/dev/null 2>&1
echo "  stopped after $(($(date +%s) - started)) s"
left_sending=$(count_status SENDING)
status_counts

log "Restarting the worker"
compose start worker >/dev/null 2>&1
wait_until 120 all_sent || true
status_counts

read -r dup_ids _ <<<"$(duplicate_deliveries)"
stalled=$(stalled_jobs)
log "Result"
echo "  in flight at SIGTERM:      $in_flight"
echo "  left SENDING after stop:   $left_sending"
echo "  stalled jobs:              $stalled"
echo "  delivered more than once:  $dup_ids"
echo "  sent:                      $(count_status SENT) / $accepted"
[ "$left_sending" = 0 ] && [ "$stalled" = 0 ] && [ "$dup_ids" = 0 ] && all_sent
