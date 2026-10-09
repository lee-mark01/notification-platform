#!/usr/bin/env bash
# Scenario 2: Redis goes down right after commits. Expected: requests are
# still accepted (202, PENDING), and after Redis returns the sweeper queues
# them again with nothing lost.
# Usage: bash chaos/redis-down.sh [count]
source "$(dirname "$0")/lib.sh"
COUNT=${1:-20}
trap finish EXIT

start_stack

log "Stopping Redis"
compose stop redis >/dev/null 2>&1

log "Sending $COUNT notifications while Redis is down"
accepted=$(send_many "$COUNT")
echo "  accepted (202): $accepted / $COUNT"
status_counts

log "Starting Redis again"
compose start redis >/dev/null 2>&1

log "Waiting for the sweeper to queue them and the worker to send them"
wait_until 180 all_sent || true
status_counts

sent=$(count_status SENT)
lost=$((accepted - sent))
log "Result"
echo "  accepted while Redis was down: $accepted"
echo "  sent after recovery:           $sent"
echo "  lost:                          $lost"
[ "$accepted" = "$COUNT" ] && [ "$lost" = 0 ]
