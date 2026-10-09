// Turns results/{split,single}.json into docs/images/p5-priority-isolation.svg
// and results/summary.md. Re-run after run.sh; no dependencies.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const OUT_SVG = join(
  DIR,
  '..',
  '..',
  'docs',
  'images',
  'p5-priority-isolation.svg',
);
const OUT_MD = join(DIR, 'results', 'summary.md');

const C = {
  ink: '#0F172A',
  muted: '#475569',
  grid: '#E2E8F0',
  split: '#0F766E',
  single: '#B45309',
  font: '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
};
const LABEL = { split: '큐 분리 (현재 구조)', single: '단일 큐 (비교용)' };

const runs = ['split', 'single']
  .map((r) => join(DIR, 'results', `${r}.json`))
  .filter((f) => existsSync(f))
  .map((f) => JSON.parse(readFileSync(f, 'utf8')));
if (runs.length === 0) throw new Error('no results; run run.sh first');

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, i)];
}
const stats = runs.map((run) => {
  const waits = run.verifications.map((v) => v.waitMs);
  return {
    routing: run.routing,
    n: waits.length,
    p50: percentile(waits, 50),
    p95: percentile(waits, 95),
    max: Math.max(...waits),
    drain: run.marketingDrainMs,
    marketing: run.marketing,
  };
});
const sec = (ms) =>
  ms >= 10_000 ? (ms / 1000).toFixed(0) : (ms / 1000).toFixed(2);

// Chart geometry
const W = 960;
const H = 580;
const M = { left: 84, right: 32, top: 96, bottom: 140 };
const pw = W - M.left - M.right;
const ph = H - M.top - M.bottom;
const xMax =
  Math.max(
    ...runs.flatMap((r) => r.verifications.map((v) => v.acceptedAfterBatchMs)),
  ) / 1000;
const yMaxRaw =
  Math.max(...runs.flatMap((r) => r.verifications.map((v) => v.waitMs))) / 1000;
const step = niceStep(yMaxRaw / 5);
const yMax = Math.max(step, Math.ceil(yMaxRaw / step) * step);
const xStep = niceStep(xMax / 6);
const xTop = Math.ceil(xMax / xStep) * xStep;
const x = (s) => M.left + (s / xTop) * pw;
const y = (s) => M.top + ph - (s / yMax) * ph;

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
}

const parts = [];
parts.push(
  `<text x="${M.left}" y="40" font-size="22" font-weight="700" fill="${C.ink}">마케팅 1만 건이 밀려 있을 때 인증 메일 대기 시간</text>`,
  `<text x="${M.left}" y="68" font-size="15" fill="${C.muted}">이메일 초당 100건 한도, FakeProvider 50ms. 배치 큐 등록 직후부터 1초마다 인증 메일 1건 접수 → 발송까지 걸린 시간</text>`,
);
for (let v = 0; v <= yMax + 1e-9; v += step) {
  parts.push(
    `<line x1="${M.left}" x2="${M.left + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>`,
    `<text x="${M.left - 10}" y="${y(v) + 5}" font-size="14" text-anchor="end" fill="${C.muted}">${+v.toFixed(2)}</text>`,
  );
}
for (let v = 0; v <= xTop + 1e-9; v += xStep) {
  parts.push(
    `<text x="${x(v)}" y="${M.top + ph + 24}" font-size="14" text-anchor="middle" fill="${C.muted}">${+v.toFixed(1)}</text>`,
  );
}
parts.push(
  `<line x1="${M.left}" x2="${M.left + pw}" y1="${M.top + ph}" y2="${M.top + ph}" stroke="${C.muted}"/>`,
  `<text x="${M.left + pw / 2}" y="${M.top + ph + 52}" font-size="15" text-anchor="middle" fill="${C.ink}">인증 메일 접수 시각 (배치 접수 후 초)</text>`,
  `<text transform="translate(26 ${M.top + ph / 2}) rotate(-90)" font-size="15" text-anchor="middle" fill="${C.ink}">접수 → 발송 대기 (초)</text>`,
);
for (const run of runs) {
  const color = C[run.routing];
  const pts = run.verifications.map((v) => [
    x(v.acceptedAfterBatchMs / 1000),
    y(v.waitMs / 1000),
  ]);
  parts.push(
    `<polyline fill="none" stroke="${color}" stroke-width="3" points="${pts.map((p) => p.join(',')).join(' ')}"/>`,
    ...pts.map(
      ([px, py]) => `<circle cx="${px}" cy="${py}" r="3.5" fill="${color}"/>`,
    ),
  );
}
// Legend with the numbers that matter.
stats.forEach((s, i) => {
  const ly = H - 40 - (stats.length - 1 - i) * 26;
  const lx = M.left;
  parts.push(
    `<rect x="${lx}" y="${ly - 12}" width="18" height="6" fill="${C[s.routing]}"/>`,
    `<text x="${lx + 28}" y="${ly - 4}" font-size="15" fill="${C.ink}"><tspan font-weight="700">${LABEL[s.routing]}</tspan>  인증 메일 p50 ${sec(s.p50)}초 · p95 ${sec(s.p95)}초 · 최대 ${sec(s.max)}초  |  마케팅 ${s.marketing.toLocaleString('en-US')}건 소진 ${sec(s.drain)}초</text>`,
  );
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${C.font}'>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${parts.join('\n')}
</svg>
`;
writeFileSync(OUT_SVG, svg);

const md = [
  '| 구성 | 인증 메일 p50 | p95 | 최대 | 마케팅 소진 |',
  '| --- | --- | --- | --- | --- |',
  ...stats.map(
    (s) =>
      `| ${LABEL[s.routing]} | ${sec(s.p50)}초 | ${sec(s.p95)}초 | ${sec(s.max)}초 | ${s.marketing.toLocaleString('en-US')}건 ${sec(s.drain)}초 |`,
  ),
  '',
].join('\n');
writeFileSync(OUT_MD, md);
console.log(md);
