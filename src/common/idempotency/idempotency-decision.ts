import { IdempotencyKey, IdempotencyStatus } from './idempotency-key.entity';

export type IdempotencyDecision =
  /** Key record is past its retention: reuse it as if it were new. */
  | { kind: 'expired' }
  /** Same key, different request: refuse (422). */
  | { kind: 'reused' }
  /** Same request already completed: return the stored response. */
  | { kind: 'replay'; status: number; body: unknown }
  /** Same request still running elsewhere: ask the client to retry (409). */
  | { kind: 'in-progress'; retryAfterSeconds: number }
  /** Same request, but its holder's lock expired (it likely crashed): take over. */
  | { kind: 'take-over' };

type ExistingKey = Pick<
  IdempotencyKey,
  | 'requestHash'
  | 'status'
  | 'lockedUntil'
  | 'expiresAt'
  | 'responseStatus'
  | 'responseBody'
>;

/**
 * What to do when a request arrives with an Idempotency-Key that already has
 * a record. Pure, so every branch is unit-testable; the service applies the
 * decision with conditional updates.
 */
export function decide(
  existing: ExistingKey,
  requestHash: string,
  now: Date,
): IdempotencyDecision {
  if (existing.expiresAt <= now) return { kind: 'expired' };
  if (existing.requestHash !== requestHash) return { kind: 'reused' };

  if (existing.status === IdempotencyStatus.Completed) {
    return {
      kind: 'replay',
      status: existing.responseStatus ?? 200,
      body: existing.responseBody,
    };
  }
  if (existing.lockedUntil > now) {
    const ms = existing.lockedUntil.getTime() - now.getTime();
    return { kind: 'in-progress', retryAfterSeconds: Math.ceil(ms / 1000) };
  }
  return { kind: 'take-over' };
}
