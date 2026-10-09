import { QueueNames, QueueRouting } from './queue.constants';
import { rateLimits } from './rate-limits';

describe('rateLimits', () => {
  it('splits each channel budget between its two queues', () => {
    expect(
      rateLimits({
        emailPerSecond: 14,
        pushPerSecond: 1_000,
        transactionalShare: 0.3,
      }),
    ).toEqual({
      [QueueNames.EmailTransactional]: { max: 4, duration: 1_000 },
      [QueueNames.EmailMarketing]: { max: 10, duration: 1_000 },
      [QueueNames.PushTransactional]: { max: 300, duration: 1_000 },
      [QueueNames.PushMarketing]: { max: 700, duration: 1_000 },
    });
  });

  it('never exceeds the budget and leaves each queue at least 1 per second', () => {
    for (const share of [0, 0.01, 0.5, 0.99, 1]) {
      const limits = rateLimits({
        emailPerSecond: 2,
        pushPerSecond: 3,
        transactionalShare: share,
      });
      const email =
        limits[QueueNames.EmailTransactional].max +
        limits[QueueNames.EmailMarketing].max;
      expect(email).toBe(2);
      expect(limits[QueueNames.EmailTransactional].max).toBeGreaterThanOrEqual(
        1,
      );
      expect(limits[QueueNames.EmailMarketing].max).toBeGreaterThanOrEqual(1);
      expect(limits[QueueNames.PushMarketing].max).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives the single experiment queue the whole email budget', () => {
    const limits = rateLimits({
      emailPerSecond: 100,
      pushPerSecond: 1_000,
      transactionalShare: 0.3,
      routing: QueueRouting.Single,
    });
    expect(limits[QueueNames.EmailTransactional]).toEqual({
      max: 100,
      duration: 1_000,
    });
  });
});
