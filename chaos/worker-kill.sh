#!/usr/bin/env bash
# Scenario 6: the worker is killed (SIGKILL) mid-send. Expected: BullMQ
# detects the stalled jobs, the lease (60 s) runs out, another run sends them,
# and every notification ends SENT. Duplicate deliveries are measured, not
# prevented: a send that finished just before the kill is sent again
# (at-least-once, ADR-0002).
# Usage: bash chaos/worker-kill.sh [count]
source "$(dirname "$0")/lib.sh"
COUNT=${1:-20}
trap finish EXIT

start_stack

log "Sending $COUNT notifications (each fake send takes 2 s)"
accepted=$(send_many "$COUNT")
echo "  accepted (202): $accepted / $COUNT"

log "Waiting until some are being sent"
wait_until 60 test "$(count_status SENDING)" -gt 0
status_counts

log "kill -9 the worker"
compose kill -s SIGKILL worker >/dev/null 2>&1
sleep 1
status_counts

log "Restarting the worker; recovery waits for stall detection and the lease"
compose start worker >/dev/null 2>&1
wait_until 300 all_sent || true
status_counts

read -r dup_ids dup_extra <<<"$(duplicate_deliveries)"
reclaimed=$(sql "SELECT COUNT(*) FROM notification WHERE attempt_count > 1")
log "Result"
echo "  sent:                               $(count_status SENT) / $accepted"
echo "  stalled jobs detected:              $(stalled_jobs)"
echo "  re-claimed after the kill:          $reclaimed"
echo "  delivered more than once:           $dup_ids notification(s), $dup_extra extra"
all_sent
