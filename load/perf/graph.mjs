// Worker throughput by concurrency and DB pool size, from results/rows.jsonl
// (the last run of each setting wins). Writes docs/images/p7-worker-throughput.svg
// and results/summary.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const OUT_SVG = join(
  DIR,
  '..',
  '..',
  'docs',
  'images',
  'p7-worker-throughput.svg',
);

const rows = readFileSync(join(DIR, 'results', 'rows.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const last = new Map();
for (const r of rows) {
  last.set(
    r.kind === 'intake' ? `i${r.vus}` : `w${r.concurrency}-${r.pool}`,
    r,
  );
}
const worker = [...last.values()].filter((r) => r.kind === 'worker');
const intake = [...last.values()].filter((r) => r.kind === 'intake');
const byConcurrency = (a, b) => a.concurrency - b.concurrency;
// The default pool, and a pool at least as large as the concurrency.
const atDefault = worker.filter((r) => r.pool === 10).sort(byConcurrency);
const covered = [
  ...new Map(
    worker
      .filter((r) => r.pool >= r.concurrency || r.pool >= 50)
      .filter((r) => r.pool > 10)
      .sort((a, b) => a.pool - b.pool)
      .map((r) => [r.concurrency, r]),
  ).values(),
].sort(byConcurrency);

// Markdown
const md = [
  '### Worker (FakeProvider 100ms, 이메일 한 큐)',
  '',
  '| concurrency | DB pool | 처리량 (건/초) | 이론값 | 효율 | job p50 | job p95 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...worker
    .sort((a, b) => a.concurrency - b.concurrency || a.pool - b.pool)
    .map(
      (r) =>
        `| ${r.concurrency} | ${r.pool} | ${r.perSecond} | ${r.ideal} | ${r.efficiency} | ${r.jobP50}ms | ${r.jobP95}ms |`,
    ),
  '',
  '### 접수 (k6, POST /notifications, 30초)',
  '',
  '| 가상 사용자 | 처리량 (건/초) | p50 | p95 | p99 | 202 비율 |',
  '| --- | --- | --- | --- | --- | --- |',
  ...intake
    .sort((a, b) => a.vus - b.vus)
    .map(
      (r) =>
        `| ${r.vus} | ${r.rps} | ${r.p50}ms | ${r.p95}ms | ${r.p99}ms | ${(r.ok * 100).toFixed(1)}% |`,
    ),
  '',
].join('\n');
writeFileSync(join(DIR, 'results', 'summary.md'), md);
console.log(md);

// SVG: throughput against concurrency, log-scaled x.
const C = {
  ink: '#0F172A',
  muted: '#475569',
  grid: '#E2E8F0',
  p10: '#B45309',
  p50: '#0F766E',
  ideal: '#94A3B8',
};
const W = 960;
const H = 560;
const M = { left: 84, right: 96, top: 100, bottom: 120 };
const pw = W - M.left - M.right;
const ph = H - M.top - M.bottom;
const xs = [1, 5, 10, 20, 30, 50, 100];
const x = (c) => M.left + (Math.log(c) / Math.log(100)) * pw;
const yMax = 1000;
const y = (v) => M.top + ph - (Math.min(v, yMax) / yMax) * ph;
const t = (px, py, s, o = {}) =>
  `<text x="${px}" y="${py}" font-size="${o.size ?? 14}" font-weight="${o.weight ?? 400}" fill="${o.color ?? C.muted}" text-anchor="${o.anchor ?? 'start'}">${s}</text>`;
const parts = [
  t(M.left, 40, 'Worker 처리량: concurrency와 DB 커넥션 풀', {
    size: 22,
    weight: 700,
    color: C.ink,
  }),
  t(
    M.left,
    68,
    'FakeProvider 100ms 고정 · 이메일 큐 하나 · 5,000건(1~20은 2,000건) · 전용 Docker 스택',
    { size: 15 },
  ),
];
for (let v = 0; v <= yMax; v += 200) {
  parts.push(
    `<line x1="${M.left}" x2="${M.left + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>`,
    t(M.left - 10, y(v) + 5, String(v), { anchor: 'end' }),
  );
}
for (const c of xs)
  parts.push(t(x(c), M.top + ph + 24, String(c), { anchor: 'middle' }));
parts.push(
  t(
    M.left + pw / 2,
    M.top + ph + 52,
    'Worker concurrency (동시 처리 job 수, 로그 눈금)',
    { anchor: 'middle', color: C.ink, size: 15 },
  ),
  `<text transform="translate(26 ${M.top + ph / 2}) rotate(-90)" font-size="15" text-anchor="middle" fill="${C.ink}">처리량 (건/초)</text>`,
);
// Ideal: concurrency jobs per 100 ms.
parts.push(
  `<polyline fill="none" stroke="${C.ideal}" stroke-width="2" stroke-dasharray="6 6" points="${xs.map((c) => `${x(c)},${y(c * 10)}`).join(' ')}"/>`,
);
const line = (s, color, below) => {
  if (s.length === 0) return;
  parts.push(
    `<polyline fill="none" stroke="${color}" stroke-width="3" points="${s.map((r) => `${x(r.concurrency)},${y(r.perSecond)}`).join(' ')}"/>`,
    ...s.map(
      (r) =>
        `<circle cx="${x(r.concurrency)}" cy="${y(r.perSecond)}" r="4.5" fill="${color}"/>`,
    ),
    ...s
      .filter((r) => r.concurrency >= 30)
      .map((r) =>
        t(
          x(r.concurrency) + 8,
          y(r.perSecond) + (below ? 18 : -8),
          `${r.perSecond}/s`,
          { color, weight: 700 },
        ),
      ),
  );
};
line(atDefault, C.p10, true);
line(covered, C.p50, false);
const legend = [
  [C.p10, '풀 10 (mysql2 기본값)', false],
  [C.p50, '풀 ≥ concurrency (30·50·100)', false],
  [C.ideal, '이론값 = concurrency × 10/s', true],
];
legend.forEach(([color, label, dashed], i) => {
  const lx = M.left + i * 270;
  const ly = H - 34;
  parts.push(
    `<line x1="${lx}" x2="${lx + 28}" y1="${ly - 5}" y2="${ly - 5}" stroke="${color}" stroke-width="3" ${dashed ? 'stroke-dasharray="6 6"' : ''}/>`,
    t(lx + 38, ly, label, { color: C.ink }),
  );
});
writeFileSync(
  OUT_SVG,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${parts.join('\n')}
</svg>
`,
);
