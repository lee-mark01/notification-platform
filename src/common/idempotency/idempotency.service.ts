import { Injectable } from '@nestjs/common';
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

export type BeginResult =
  | { kind: 'acquired'; recordId: number }
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
      const inserted = await this.tryInsert(
        clientId,
        idemKey,
        requestHash,
        now,
      );
      if (inserted !== null) return { kind: 'acquired', recordId: inserted };

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
            now,
            decision.kind,
          );
          if (won) return { kind: 'acquired', recordId: existing.id };
          continue;
        }
      }
    }
    throw this.inProgress(1);
  }

  /** Stores the response; call inside the transaction that creates the resource. */
  async complete(
    manager: EntityManager,
    recordId: number,
    response: {
      status: number;
      body: Record<string, unknown>;
      notificationId: number;
    },
  ): Promise<void> {
    await manager.update(
      IdempotencyKey,
      { id: recordId, status: IdempotencyStatus.InProgress },
      {
        status: IdempotencyStatus.Completed,
        responseStatus: response.status,
        // JSON column: TypeORM types it as a partial entity, not a plain record.
        responseBody: response.body as QueryDeepPartialEntity<
          Record<string, unknown>
        >,
        notificationId: response.notificationId,
      },
    );
  }

  /** Releases a key whose request failed before completing. */
  async abandon(recordId: number): Promise<void> {
    await this.keys.delete({
      id: recordId,
      status: IdempotencyStatus.InProgress,
    });
  }

  private async tryInsert(
    clientId: number,
    idemKey: string,
    requestHash: string,
    now: Date,
  ): Promise<number | null> {
    try {
      const result = await this.keys.insert({
        clientId,
        idemKey,
        requestHash,
        status: IdempotencyStatus.InProgress,
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
      lockedUntil: new Date(now.getTime() + LOCK_MS),
      expiresAt: new Date(now.getTime() + RETENTION_MS),
      responseStatus: null,
      responseBody: null,
      notificationId: null,
    });
    return result.affected === 1;
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
