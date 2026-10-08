import { decide } from './idempotency-decision';
import { IdempotencyStatus } from './idempotency-key.entity';

const now = new Date('2026-10-08T12:00:00.000Z');
const later = (ms: number) => new Date(now.getTime() + ms);

const base = {
  requestHash: 'h1',
  status: IdempotencyStatus.InProgress,
  lockedUntil: later(10_000),
  expiresAt: later(86_400_000),
  responseStatus: null,
  responseBody: null,
};

describe('decide (idempotency key)', () => {
  it('replays a completed request with the same body', () => {
    expect(
      decide(
        {
          ...base,
          status: IdempotencyStatus.Completed,
          responseStatus: 202,
          responseBody: { id: 7 },
        },
        'h1',
        now,
      ),
    ).toEqual({ kind: 'replay', status: 202, body: { id: 7 } });
  });

  it('refuses a different body, whether completed or in progress', () => {
    expect(decide(base, 'h2', now)).toEqual({ kind: 'reused' });
    expect(
      decide({ ...base, status: IdempotencyStatus.Completed }, 'h2', now),
    ).toEqual({ kind: 'reused' });
  });

  it('reports in-progress with the seconds left on the lock, rounded up', () => {
    expect(decide({ ...base, lockedUntil: later(1_200) }, 'h1', now)).toEqual({
      kind: 'in-progress',
      retryAfterSeconds: 2,
    });
  });

  it('takes over an in-progress key whose lock has expired', () => {
    expect(decide({ ...base, lockedUntil: later(-1) }, 'h1', now)).toEqual({
      kind: 'take-over',
    });
  });

  it('treats an expired key as new, even with a different body', () => {
    expect(decide({ ...base, expiresAt: now }, 'other', now)).toEqual({
      kind: 'expired',
    });
  });
});
