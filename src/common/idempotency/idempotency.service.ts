import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { isDuplicateEntryError } from '../database/mysql-errors';
import { ProblemTypes } from '../problem/problem-types';
import { ProblemException } from '../problem/problem.exception';
import { decide } from './idempotency-decision';
import { IdempotencyKey, IdempotencyStatus } from './idempotency-key.entity';

// How long a request may hold its key before another request with the same
// key may assume it crashed and take over.
export const LOCK_MS = 30_000;
// How long a key is remembered.
export const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TRIES = 3;
const LOST_OWNERSHIP =
  'This request lost its Idempotency-Key lock to a retry. Retry later to get its response.';

export type BeginResult =
  | { kind: 'acquired'; recordId: number; lockToken: string }
  | { kind: 'replay'; status: number; body: Record<string, unknown> };

/**
 * Request-level idempotency in two steps (ADR-0002):
 *
 * 1. begin(): record the key as IN_PROGRESS in its own short transaction. The
 *    (client, key) unique index lets exactly one concurrent request in; the
 *    others are told to replay, wait (409), or stop (422).
 * 2. complete(): inside the caller's transaction that creates the resource,
 *    store the response, so the resource and the stored response commit
 *    together.
 *
 * If the work fails before completion, abandon() deletes the key so the
 * client can retry. If the process dies instead, the lock expires and the
 * next request with the same key takes over.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly keys: Repository<IdempotencyKey>,
  ) {}

  async begin(
    clientId: number,
    idemKey: string,
    requestHash: string,
  ): Promise<BeginResult> {
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
      const now = new Date();
      const lockToken = randomUUID();
      const inserted = await this.tryInsert(
        clientId,
        idemKey,
        requestHash,
        lockToken,
        now,
      );
      if (inserted !== null) {
        return { kind: 'acquired', recordId: inserted, lockToken };
      }

      const existing = await this.keys.findOneBy({ clientId, idemKey });
      // Deleted by abandon() between our insert and read: try again.
      if (!existing) continue;

      const decision = decide(existing, requestHash, now);
      switch (decision.kind) {
        case 'replay':
          return {
            kind: 'replay',
            status: decision.status,
            body: decision.body ?? {},
          };
        case 'reused':
          throw new ProblemException(
            ProblemTypes.IDEMPOTENCY_KEY_REUSED,
            'This Idempotency-Key was already used with a different request body.',
          );
        case 'in-progress':
          throw this.inProgress(decision.retryAfterSeconds);
        case 'take-over':
        case 'expired': {
          // Conditional update: if two requests try to take over at once,
          // only the one that still sees the old state wins.
          const won = await this.reclaim(
            existing.id,
            requestHash,
            lockToken,
            now,
            decision.kind,
          );
          if (won) {
            return { kind: 'acquired', recordId: existing.id, lockToken };
          }
          continue;
        }
      }
    }
    throw this.inProgress(1);
  }

  /**
   * Stores the response; call inside the transaction that creates the
   * resource. The update is fenced by the lock token: if the lock expired and
   * another request took the key over, this holder no longer owns it, the
   * update matches no row, and the error rolls back the caller's transaction
   * so the resource is not created twice.
   */
  async complete(
    manager: EntityManager,
    recordId: number,
    lockToken: string,
    response: {
      status: number;
      body: Record<string, unknown>;
      // Absent for a batch: the body carries the batch id.
      notificationId?: number;
    },
  ): Promise<void> {
    const result = await manager.update(
      IdempotencyKey,
      { id: recordId, status: IdempotencyStatus.InProgress, lockToken },
      {
        status: IdempotencyStatus.Completed,
        responseStatus: response.status,
        // JSON column: TypeORM types it as a partial entity, not a plain record.
        responseBody: response.body as QueryDeepPartialEntity<
          Record<string, unknown>
        >,
        notificationId: response.notificationId ?? null,
      },
    );
    if (result.affected !== 1) throw this.lostOwnership();
  }

  /**
   * Releases a key whose request failed before completing. Fenced like
   * complete(): a holder that lost the key must not delete the new holder's.
   */
  async abandon(recordId: number, lockToken: string): Promise<void> {
    await this.keys.delete({
      id: recordId,
      status: IdempotencyStatus.InProgress,
      lockToken,
    });
  }

  /** True when the error means this request lost its key to a takeover. */
  static isLostOwnership(error: unknown): boolean {
    return (
      error instanceof ProblemException &&
      error.problem === ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS &&
      error.detail === LOST_OWNERSHIP
    );
  }

  private async tryInsert(
    clientId: number,
    idemKey: string,
    requestHash: string,
    lockToken: string,
    now: Date,
  ): Promise<number | null> {
    try {
      const result = await this.keys.insert({
        clientId,
        idemKey,
        requestHash,
        status: IdempotencyStatus.InProgress,
        lockToken,
        lockedUntil: new Date(now.getTime() + LOCK_MS),
        expiresAt: new Date(now.getTime() + RETENTION_MS),
      });
      return Number(result.identifiers[0].id);
    } catch (error) {
      if (isDuplicateEntryError(error)) return null;
      throw error;
    }
  }

  private async reclaim(
    id: number,
    requestHash: string,
    lockToken: string,
    now: Date,
    reason: 'take-over' | 'expired',
  ): Promise<boolean> {
    const condition =
      reason === 'expired'
        ? { id, expiresAt: LessThanOrEqual(now) }
        : {
            id,
            status: IdempotencyStatus.InProgress,
            lockedUntil: LessThanOrEqual(now),
          };
    const result = await this.keys.update(condition, {
      requestHash,
      status: IdempotencyStatus.InProgress,
      lockToken,
      lockedUntil: new Date(now.getTime() + LOCK_MS),
      expiresAt: new Date(now.getTime() + RETENTION_MS),
      responseStatus: null,
      responseBody: null,
      notificationId: null,
    });
    return result.affected === 1;
  }

  // The other holder will finish; telling this client to retry later lets it
  // receive that holder's stored response.
  private lostOwnership(): ProblemException {
    return new ProblemException(
      ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS,
      LOST_OWNERSHIP,
      {},
      { 'Retry-After': '1' },
    );
  }

  private inProgress(retryAfterSeconds: number): ProblemException {
    return new ProblemException(
      ProblemTypes.IDEMPOTENCY_KEY_IN_PROGRESS,
      'A request with this Idempotency-Key is still being processed. Retry later.',
      {},
      { 'Retry-After': String(retryAfterSeconds) },
    );
  }
}
