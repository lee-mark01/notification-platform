// Prints one result line and appends it to results/rows.jsonl.
//   node summarize.mjs intake <k6 summary json>
//   node summarize.mjs worker <tsv: started_ms sent_ms provider_ms> <concurrency> <pool>
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [kind, file, concurrency, pool] = process.argv.slice(2);
const rows = join(import.meta.dirname, 'results', 'rows.jsonl');

function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

let row;
if (kind === 'intake') {
  const m = JSON.parse(readFileSync(file, 'utf8')).metrics;
  const d = m.http_req_duration;
  row = {
    kind,
    vus: Number(/vus(\d+)/.exec(file)[1]),
    rps: Math.round(m.http_reqs.rate),
    p50: Math.round(d.med * 10) / 10,
    p95: Math.round(d['p(95)'] * 10) / 10,
    p99: Math.round(d['p(99)'] * 10) / 10,
    ok: m.checks.passes / (m.checks.passes + m.checks.fails),
  };
  console.log(
    `intake vus=${row.vus}: ${row.rps} req/s, p50 ${row.p50} ms, p95 ${row.p95} ms, p99 ${row.p99} ms, 202 ${(row.ok * 100).toFixed(1)}%`,
  );
} else {
  const lines = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split('\t').map(Number));
  const started = lines.map((l) => l[0]);
  const sent = lines.map((l) => l[1]);
  const job = lines.map((l) => l[1] - l[0]);
  // At a fixed provider delay, c jobs at a time cannot beat c * 1000 / delay.
  const providerMs = percentile(
    lines.map((l) => l[2]),
    0.5,
  );
  const seconds = (Math.max(...sent) - Math.min(...started)) / 1000;
  row = {
    kind,
    concurrency: Number(concurrency),
    pool: Number(pool),
    jobs: lines.length,
    seconds: Math.round(seconds * 10) / 10,
    perSecond: Math.round(lines.length / seconds),
    jobP50: percentile(job, 0.5),
    jobP95: percentile(job, 0.95),
    ideal: Math.round((Number(concurrency) * 1000) / providerMs),
  };
  row.efficiency = Math.round((row.perSecond / row.ideal) * 100) / 100;
  console.log(
    `worker c=${row.concurrency} pool=${row.pool}: ${row.perSecond} jobs/s (${row.jobs} in ${row.seconds} s), job p50 ${row.jobP50} ms p95 ${row.jobP95} ms, ideal ${row.ideal}/s, efficiency ${row.efficiency}`,
  );
}
appendFileSync(rows, `${JSON.stringify(row)}\n`);
