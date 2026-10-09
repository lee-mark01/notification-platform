// One run of the priority-isolation experiment (scenario 13) against a
// running stack: a 10,000-recipient marketing batch, then one verification
// email per second while the batch drains. Prints JSON with each
// verification email's time from acceptance to send.
//
// node measure.mjs <api-base-url> <api-key> <routing>
const [api, apiKey, routing] = process.argv.slice(2);
const MARKETING = Number(process.env.MARKETING ?? 10_000);
const VERIFICATIONS = Number(process.env.VERIFICATIONS ?? 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok)
    throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function until(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

const batchStartedAt = Date.now();
const { batchId } = await call('POST', '/notification-batches', {
  channel: 'email',
  category: 'marketing',
  templateKey: 'exp',
  // Users 1..MARKETING, seeded with marketing consent by run.sh.
  recipients: Array.from({ length: MARKETING }, (_, i) => ({
    userId: i + 1,
    variables: { n: String(i) },
  })),
});
await until(
  async () =>
    (await call('GET', `/notification-batches/${batchId}`)).status ===
    'ENQUEUED',
  60_000,
  'batch enqueued',
);

// Verification emails arrive while the marketing backlog is draining.
const verifications = [];
for (let i = 0; i < VERIFICATIONS; i += 1) {
  const { id } = await call('POST', '/notifications', {
    channel: 'email',
    category: 'transactional',
    templateKey: 'exp',
    recipient: { email: `v${i}@example.com` },
    variables: { n: `v${i}` },
  });
  verifications.push(id);
  await sleep(1_000);
}

const rows = [];
for (const id of verifications) {
  const n = await until(
    async () => {
      const r = await call('GET', `/notifications/${id}`);
      return r.sentAt ? r : null;
    },
    600_000,
    `verification ${id} sent`,
  );
  const created = Date.parse(n.createdAt);
  rows.push({
    id,
    acceptedAfterBatchMs: created - batchStartedAt,
    waitMs: Date.parse(n.sentAt) - created,
  });
}

const batch = await until(
  async () => {
    const b = await call('GET', `/notification-batches/${batchId}`);
    return (b.byStatus.SENT ?? 0) === MARKETING ? b : null;
  },
  900_000,
  'marketing batch sent',
);
// To within the 250 ms polling interval.
const marketingDrainMs = Date.now() - batchStartedAt;

console.log(
  JSON.stringify(
    {
      routing,
      marketing: MARKETING,
      marketingDrainMs,
      verifications: rows,
      batch,
    },
    null,
    2,
  ),
);
