import { setTimeout as sleep } from 'node:timers/promises';

// Polls until check() returns a value other than undefined, for asserting on
// work done asynchronously by queue workers.
export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  // Generous for CI: a fresh app's first job also pays for first queries and
  // loading BullMQ's Lua scripts.
  { timeoutMs = 10_000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs} ms`);
    }
    await sleep(intervalMs);
  }
}
