import { ProblemTypes } from '../common/problem/problem-types';
import { ProblemException } from '../common/problem/problem.exception';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PERIOD_DAYS = 7;
// Bounds every admin query over notifications to a range an index can serve.
export const MAX_PERIOD_DAYS = 92;

export interface Period {
  from: Date;
  to: Date;
}

/**
 * [from, to): defaults to the 7 days before now; at most 92 days, from
 * before to. Shared by the admin search and stats endpoints.
 */
export function resolvePeriod(
  query: { from?: Date; to?: Date },
  now = new Date(),
): Period {
  const to = query.to ?? now;
  const from =
    query.from ?? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS);
  if (from >= to || to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    throw new ProblemException(
      ProblemTypes.VALIDATION_FAILED,
      `from must be before to, at most ${MAX_PERIOD_DAYS} days apart.`,
      { errors: [{ field: 'from', message: 'invalid period' }] },
    );
  }
  return { from, to };
}
