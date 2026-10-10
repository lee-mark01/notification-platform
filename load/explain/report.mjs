// Before/after table for issue #83 from results/1-before and results/8-final:
// writes results/summary.md and docs/images/p6-explain.svg. No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const OUT_SVG = join(DIR, '..', '..', 'docs', 'images', 'p6-explain.svg');

const CASES = [
  ['발송 이력 7일, 필터 없음', 'h1-history-7d.before', 'h1-history-7d.nojoin'],
  [
    '발송 이력 7일, email + FAILED',
    'h2-history-failed-email.before',
    'h2-history-failed-email.nojoin',
  ],
  [
    '발송 이력, 사용자 1명 30일',
    'h3-history-user-30d.before',
    'h3-history-user-30d.nojoin',
  ],
  ['통계 요약 7일', 's1-summary-7d', 's1-summary-7d'],
  ['템플릿별 읽음률 7일', 's2-read-rates-7d', 's2-read-rates-7d.nojoin'],
  // #107, measured separately: before and after the email index alone.
  [
    '수신 주소 검색 7일',
    'h4-history-email-7d',
    'h4-history-email-7d',
    '9-email-before',
    '10-email-after',
  ],
  [
    '수신 주소 검색 92일',
    'h5-history-email-92d',
    'h5-history-email-92d',
    '9-email-before',
    '10-email-after',
  ],
];

function measure(label, name) {
  const plan = readFileSync(
    join(DIR, 'results', label, `${name}.analyze.txt`),
    'utf8',
  );
  const ms = Number(/actual time=[\d.]+\.\.([\d.]+)/.exec(plan)[1]);
  // The access to notification: which index, and how many rows it read.
  const access = plan
    .split('\n')
    .find((l) =>
      / on n (using|\(|$)|Table scan on n|Index lookup on n|scan on n /.test(l),
    );
  const index = /using (\w+)/.exec(access ?? '')?.[1] ?? 'table scan';
  const rows = Number(
    /rows=(\d+) loops=(\d+)\)\s*$/
      .exec(access ?? '')
      ?.slice(1)
      .reduce((a, b) => a * b) ?? 0,
  );
  const how = [
    /\(reverse\)/.test(access ?? '') ? 'reverse' : null,
    /Covering index/.test(access ?? '') ? 'covering' : null,
    /hash join/i.test(plan) ? 'hash join' : null,
    /Temporary table with deduplication/.test(plan)
      ? 'DISTINCT 임시 테이블'
      : null,
    /Nested loop inner join/.test(plan) && /Index lookup on n/.test(plan)
      ? 'template부터 nested loop'
      : null,
  ].filter(Boolean);
  return { ms, index, rows, how };
}

const rows = CASES.map(
  ([title, before, after, beforeDir = '1-before', afterDir = '8-final']) => ({
    title,
    before: measure(beforeDir, before),
    after: measure(afterDir, after),
  }),
);
const fmt = (ms) =>
  ms >= 100 ? ms.toFixed(0) : ms >= 1 ? ms.toFixed(1) : ms.toFixed(2);
const factor = (r) => Math.round(r.before.ms / r.after.ms);

// Markdown
const md = [
  '| 쿼리 | 전 (ms) | 후 (ms) | 전: 접근 방식 | 후: 접근 방식 |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map(
    (r) =>
      `| ${r.title} | ${fmt(r.before.ms)} | ${fmt(r.after.ms)} | ${r.before.index}, ${r.before.rows.toLocaleString('en-US')}행 ${r.before.how.join(', ')} | ${r.after.index}, ${r.after.rows.toLocaleString('en-US')}행 ${r.after.how.join(', ')} |`,
  ),
  '',
].join('\n');
writeFileSync(join(DIR, 'results', 'summary.md'), md);
console.log(md);

// SVG
const C = {
  ink: '#0F172A',
  muted: '#475569',
  grid: '#E2E8F0',
  before: '#B45309',
  after: '#0F766E',
  soft: '#F1F5F9',
};
const W = 1200;
const rowH = 96;
const top = 150;
const H = top + rows.length * rowH + 70;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 16}" font-weight="${o.weight ?? 400}" fill="${o.color ?? C.ink}" text-anchor="${o.anchor ?? 'start'}">${esc(s)}</text>`;
const parts = [
  t(48, 52, '알림 100만 건에서 관리자 쿼리 전후 (EXPLAIN ANALYZE)', {
    size: 26,
    weight: 700,
  }),
  t(
    48,
    84,
    'MySQL 8.4 · 90일치 데이터 중 7일 = 77,825건 · 버퍼 풀을 데운 뒤 측정',
    { size: 16, color: C.muted },
  ),
  t(48, 128, '쿼리', { weight: 700, color: C.muted }),
  t(560, 128, '전', { weight: 700, color: C.before, anchor: 'end' }),
  t(700, 128, '후', { weight: 700, color: C.after, anchor: 'end' }),
  t(740, 128, '바꾼 것', { weight: 700, color: C.muted }),
];
const change = [
  'join 제거 + (created_at) 인덱스: 역순으로 읽다 51건에서 멈춤',
  '같은 인덱스를 역순으로 읽으며 거름: 읽는 행 20,000 → 3,732',
  '이미 (user_id, created_at) 인덱스 사용, 그대로',
  '통계용 커버링 인덱스: 행을 읽지 않음',
  '먼저 집계 후 키 매핑: 읽는 행 999,999 → 77,825, 커버링',
  '(recipient_email, created_at) 인덱스: 주소로 바로 찾음',
  '같은 인덱스. 전에는 92일치를 역순으로 다 읽어야 했음',
];
rows.forEach((r, i) => {
  const y = top + i * rowH;
  if (i % 2 === 0)
    parts.push(
      `<rect x="32" y="${y}" width="${W - 64}" height="${rowH}" fill="${C.soft}" rx="8"/>`,
    );
  parts.push(
    t(48, y + 38, r.title, { size: 18, weight: 700 }),
    t(48, y + 66, `전 ${r.before.index} → 후 ${r.after.index}`, {
      size: 13,
      color: C.muted,
    }),
    t(560, y + 50, `${fmt(r.before.ms)} ms`, {
      size: 20,
      weight: 700,
      color: C.before,
      anchor: 'end',
    }),
    t(700, y + 50, `${fmt(r.after.ms)} ms`, {
      size: 20,
      weight: 700,
      color: C.after,
      anchor: 'end',
    }),
    t(740, y + 38, change[i], { size: 15 }),
    // Under a millisecond either way, the difference is noise.
    t(
      740,
      y + 66,
      r.before.ms >= 1
        ? `약 ${factor(r).toLocaleString('en-US')}배`
        : '변화 없음 (둘 다 1ms 미만)',
      { size: 15, weight: 700, color: r.before.ms >= 1 ? C.after : C.muted },
    ),
  );
});
parts.push(
  t(
    48,
    H - 28,
    '재현: load/explain/run.sh setup → measure · 원자료 load/explain/results/',
    { size: 14, color: C.muted },
  ),
);
writeFileSync(
  OUT_SVG,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${parts.join('\n')}
</svg>
`,
);
