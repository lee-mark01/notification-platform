import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';
import {
  jobIdFor,
  QueueNames,
  SEND_JOB,
  type SendJobData,
  type SendQueueName,
} from '../queue/queue.constants';
import { queueFor } from './queue-routing';

// add() normally takes about a millisecond. Before BullMQ has ever connected
// it waits for Redis indefinitely, so the request must not wait with it.
export const DISPATCH_TIMEOUT_MS = 1_000;

export type DispatchTarget = Pick<Notification, 'id' | 'channel' | 'category'>;

/**
 * Puts a committed notification on the queue for its channel and category,
 * then marks it QUEUED. Called after the intake transaction commits, never
 * inside it (ADR-0003): a failure here leaves the notification PENDING for
 * the sweeper instead of failing the request.
 */
@Injectable()
export class Dispatcher implements OnModuleInit {
  private readonly logger = new Logger(Dispatcher.name);
  private readonly queues: Record<SendQueueName, Queue<SendJobData>>;
  private failing = false;

  constructor(
    @InjectQueue(QueueNames.EmailTransactional) emailTransactional: Queue,
    @InjectQueue(QueueNames.EmailMarketing) emailMarketing: Queue,
    @InjectQueue(QueueNames.PushTransactional) pushTransactional: Queue,
    @InjectQueue(QueueNames.PushMarketing) pushMarketing: Queue,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {
    this.queues = {
      [QueueNames.EmailTransactional]: emailTransactional,
      [QueueNames.EmailMarketing]: emailMarketing,
      [QueueNames.PushTransactional]: pushTransactional,
      [QueueNames.PushMarketing]: pushMarketing,
    };
  }

  onModuleInit(): void {
    // Each queue re-emits every reconnect failure; without a listener BullMQ
    // prints them all. Log the first one until a dispatch succeeds again.
    for (const queue of Object.values(this.queues)) {
      queue.on('error', (error: Error) => {
        if (!this.failing) {
          this.logger.warn(`Queue ${queue.name}: ${error.message}`);
        }
        this.failing = true;
      });
    }
  }

  /** Returns true if the job was added; false leaves it for the sweeper. */
  async dispatch(notification: DispatchTarget): Promise<boolean> {
    const queue =
      this.queues[queueFor(notification.channel, notification.category)];
    try {
      await withTimeout(
        queue.add(
          SEND_JOB,
          { notificationId: notification.id },
          { jobId: jobIdFor(notification.id) },
        ),
        DISPATCH_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Notification ${notification.id} left PENDING: ${(error as Error).message}`,
      );
      this.failing = true;
      return false;
    }
    this.failing = false;

    // Conditional: a worker may already have moved it to SENDING.
    await this.notifications.update(
      { id: notification.id, status: NotificationStatus.Pending },
      { status: NotificationStatus.Queued, queuedAt: new Date() },
    );
    return true;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`queue add timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
