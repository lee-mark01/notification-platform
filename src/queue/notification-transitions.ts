import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';

// Long enough for one provider call plus margin. A worker that dies mid-send
// blocks a re-claim only this long (docs/design/state-machine.md).
export const LEASE_SECONDS = 60;

const CLAIMABLE = [
  NotificationStatus.Pending,
  NotificationStatus.Queued,
  NotificationStatus.Retrying,
];

/**
 * The worker's state transitions, each a single conditional UPDATE (T2-T6 in
 * docs/design/state-machine.md). An update that matches no row means another
 * worker or request got there first; callers act on the affected count, never
 * on a status read earlier.
 *
 * Lease times use the database clock so workers on different hosts agree.
 */
@Injectable()
export class NotificationTransitions {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  /**
   * T2 / T2': takes the notification for sending. Returns this attempt's
   * number, or null if it is not claimable (already sent, or another worker
   * holds a live lease).
   */
  async claim(id: number): Promise<number | null> {
    const result = await this.notifications
      .createQueryBuilder()
      .update(Notification)
      .set({
        status: NotificationStatus.Sending,
        leaseUntil: () => `UTC_TIMESTAMP(3) + INTERVAL ${LEASE_SECONDS} SECOND`,
        attemptCount: () => 'attempt_count + 1',
      })
      .where('id = :id', { id })
      .andWhere(
        new Brackets((qb) =>
          qb
            .where('status IN (:...claimable)', { claimable: CLAIMABLE })
            .orWhere('(status = :sending AND lease_until < UTC_TIMESTAMP(3))', {
              sending: NotificationStatus.Sending,
            }),
        ),
      )
      .execute();
    if (result.affected !== 1) return null;

    // Safe to read back: this worker now holds the lease.
    const { attemptCount } = await this.notifications.findOneOrFail({
      select: { id: true, attemptCount: true },
      where: { id },
    });
    return attemptCount;
  }

  /**
   * T3. Conditioned on SENDING only, not on the attempt: if a worker lost its
   * lease but its send went through, the message was delivered, so recording
   * SENT is still true.
   */
  async markSent(
    manager: EntityManager,
    id: number,
    providerMessageId: string,
  ): Promise<boolean> {
    const result = await manager.update(
      Notification,
      { id, status: NotificationStatus.Sending },
      {
        status: NotificationStatus.Sent,
        providerMessageId,
        sentAt: () => 'UTC_TIMESTAMP(3)',
        leaseUntil: null,
        lastErrorCode: null,
      },
    );
    return result.affected === 1;
  }

  /**
   * T4 RETRYING, T5 DEAD or T6 FAILED. Fenced by the attempt number: a worker
   * that lost its lease must not mark a failure over the new holder's send.
   */
  async markFailed(
    manager: EntityManager,
    id: number,
    attemptNo: number,
    to:
      | NotificationStatus.Retrying
      | NotificationStatus.Dead
      | NotificationStatus.Failed,
    errorCode: string,
  ): Promise<boolean> {
    const result = await manager.update(
      Notification,
      { id, status: NotificationStatus.Sending, attemptCount: attemptNo },
      { status: to, lastErrorCode: errorCode, leaseUntil: null },
    );
    return result.affected === 1;
  }

  /**
   * T8: DEAD -> QUEUED by an operator. attempt_count is kept, not reset: it
   * numbers delivery_attempt rows (unique per notification) and fences
   * result writes, so it must only grow. The new job brings a fresh retry
   * budget on its own.
   */
  async redrive(id: number): Promise<boolean> {
    const result = await this.notifications.update(
      { id, status: NotificationStatus.Dead },
      { status: NotificationStatus.Queued, queuedAt: new Date() },
    );
    return result.affected === 1;
  }

  async statusOf(id: number): Promise<NotificationStatus | null> {
    const row = await this.notifications.findOne({
      select: { id: true, status: true },
      where: { id },
    });
    return row?.status ?? null;
  }
}
