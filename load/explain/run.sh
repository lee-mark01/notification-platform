#!/usr/bin/env bash
# Index and query measurements on 1,000,000 notifications (issue #83), in an
# isolated MySQL that shares nothing with the development stack.
#
#   bash load/explain/run.sh setup                 # fresh MySQL, migrations, seed
#   bash load/explain/run.sh measure <label> <query files...>
#   bash load/explain/run.sh sql "<statement>"     # e.g. try an index
#   bash load/explain/run.sh down
#
# measure runs each query 3 times to warm the buffer pool, then saves
# EXPLAIN and EXPLAIN ANALYZE to results/<label>/ and prints the measured
# time of the whole statement (root of EXPLAIN ANALYZE, ms).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
compose() { docker compose -p np-explain -f "$ROOT/chaos/compose.yml" "$@"; }
mysql_() { compose exec -T mysql mysql -uchaos -pchaos-password chaos "$@" 2>/dev/null; }

case "${1:-}" in
  setup)
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    compose up -d --build --quiet-pull mysql >/dev/null 2>&1
    compose build --quiet migrate >/dev/null 2>&1
    compose run --rm migrate >/dev/null 2>&1
    echo "seeding 1,000,000 notifications..."
    start=$(date +%s)
    mysql_ <"$DIR/seed.sql" >/dev/null
    echo "seeded in $(($(date +%s) - start)) s"
    mysql_ -N -e "SELECT COUNT(*) FROM notification"
    ;;
  measure)
    label=$2
    shift 2
    out="$DIR/results/$label"
    mkdir -p "$out"
    for file in "$@"; do
      name=$(basename "$file" .sql)
      query=$(cat "$file")
      for _ in 1 2 3; do mysql_ -e "$query" >/dev/null; done
      mysql_ -t -e "EXPLAIN $query" >"$out/$name.explain.txt"
      mysql_ -N -r -e "EXPLAIN ANALYZE $query" >"$out/$name.analyze.txt"
      ms=$(head -1 "$out/$name.analyze.txt" | sed -n 's/.*actual time=[0-9.]*\.\.\([0-9.]*\).*/\1/p')
      printf '%-40s %10s ms\n' "$name" "$ms"
    done
    ;;
  sql)
    mysql_ -t -e "$2"
    ;;
  down)
    compose down -v --remove-orphans >/dev/null 2>&1
    ;;
  *)
    echo "usage: run.sh setup | measure <label> <files...> | sql <stmt> | down" >&2
    exit 1
    ;;
esac
