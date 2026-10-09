import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import type { EnvironmentVariables } from '../config/env.validation';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';
import {
  jobIdFor,
  QueueNames,
  QueueRouting,
  SEND_JOB,
  type SendJobData,
  type SendQueueName,
} from '../queue/queue.constants';
import { queueFor } from './queue-routing';

// add() normally takes about a millisecond. Before BullMQ has ever connected
// it waits for Redis indefinitely, so the request must not wait with it.
export const DISPATCH_TIMEOUT_MS = 1_000;

// addBulk() of one chunk is a single round trip, but a larger one.
export const BULK_DISPATCH_TIMEOUT_MS = 5_000;

export type DispatchTarget = Pick<Notification, 'id' | 'channel' | 'category'>;

export type EnsureJobResult = 'in-flight' | 'added' | 'failed';

// Job states after which a new job with the same id may be added.
const REPLACEABLE = new Set(['missing', 'completed', 'failed', 'unknown']);

/**
 * Puts a committed notification on the queue for its channel and category,
 * then marks it QUEUED. Called after the intake transaction commits, never
 * inside it (ADR-0003): a failure here leaves the notification PENDING for
 * the sweeper instead of failing the request.
 */
@Injectable()
export class Dispatcher implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(Dispatcher.name);
  private readonly queues: Record<SendQueueName, Queue<SendJobData>>;
  private failing = false;
  private readonly routing: QueueRouting;

  constructor(
    @InjectQueue(QueueNames.EmailTransactional) emailTransactional: Queue,
    @InjectQueue(QueueNames.EmailMarketing) emailMarketing: Queue,
    @InjectQueue(QueueNames.PushTransactional) pushTransactional: Queue,
    @InjectQueue(QueueNames.PushMarketing) pushMarketing: Queue,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.routing = config.get('QUEUE_ROUTING', { infer: true });
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

  // Connect now rather than on the first request: the first add() would
  // otherwise also pay for connecting and the version check, and could hit
  // DISPATCH_TIMEOUT_MS on a busy host. Not awaited, so startup does not wait
  // for Redis.
  onApplicationBootstrap(): void {
    for (const queue of Object.values(this.queues)) {
      queue.waitUntilReady().catch(() => undefined);
    }
  }

  /** Returns true if the job was added; false leaves it for the sweeper. */
  async dispatch(
    notification: DispatchTarget,
    correlationId?: string,
  ): Promise<boolean> {
    const queue = this.queueOf(notification);
    try {
      await withTimeout(
        queue.add(
          SEND_JOB,
          { notificationId: notification.id, correlationId },
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

    await this.markQueued(notification.id);
    return true;
  }

  /**
   * dispatch() for many notifications: one addBulk() per queue and one UPDATE
   * for all of them. Returns false if any add failed; the caller stops and the
   * rest stay PENDING for the sweeper. A job id that already exists is left as
   * it is, so calling this again for the same notifications is safe.
   */
  async dispatchMany(
    targets: DispatchTarget[],
    correlationId?: string,
  ): Promise<boolean> {
    if (targets.length === 0) return true;
    const byQueue = new Map<SendQueueName, DispatchTarget[]>();
    for (const target of targets) {
      const name = queueFor(target.channel, target.category, this.routing);
      byQueue.set(name, [...(byQueue.get(name) ?? []), target]);
    }
    try {
      for (const [name, group] of byQueue) {
        await withTimeout(
          this.queues[name].addBulk(
            group.map((t) => ({
              name: SEND_JOB,
              data: { notificationId: t.id, correlationId },
              opts: { jobId: jobIdFor(t.id) },
            })),
          ),
          BULK_DISPATCH_TIMEOUT_MS,
        );
      }
    } catch (error) {
      this.logger.warn(
        `${targets.length} notifications left PENDING: ${(error as Error).message}`,
      );
      this.failing = true;
      return false;
    }
    this.failing = false;

    await this.notifications.update(
      { id: In(targets.map((t) => t.id)), status: NotificationStatus.Pending },
      { status: NotificationStatus.Queued, queuedAt: new Date() },
    );
    return true;
  }

  private queueOf(target: DispatchTarget): Queue<SendJobData> {
    return this.queues[queueFor(target.channel, target.category, this.routing)];
  }

  /** T1. Conditional: a worker may already have moved it to SENDING. */
  async markQueued(id: number): Promise<void> {
    await this.notifications.update(
      { id, status: NotificationStatus.Pending },
      { status: NotificationStatus.Queued, queuedAt: new Date() },
    );
  }

  /**
   * For the sweeper: makes sure a job exists for the notification. A job
   * still waiting, delayed or running is left alone (re-adding would move it
   * to the back of the queue); a missing or finished one is replaced.
   */
  async ensureJob(notification: DispatchTarget): Promise<EnsureJobResult> {
    const queue = this.queueOf(notification);
    const jobId = jobIdFor(notification.id);
    try {
      return await withTimeout(
        (async () => {
          const job = await queue.getJob(jobId);
          const state = job ? await job.getState() : 'missing';
          if (!REPLACEABLE.has(state)) return 'in-flight';
          if (job) await queue.remove(jobId);
          await queue.add(
            SEND_JOB,
            { notificationId: notification.id },
            { jobId },
          );
          return 'added';
        })(),
        DISPATCH_TIMEOUT_MS,
      );
    } catch (error) {
      this.logger.warn(
        `Notification ${notification.id} not checked: ${(error as Error).message}`,
      );
      return 'failed';
    }
  }

  /**
   * Adds a new job for a notification whose earlier job already finished
   * (redrive). The failed job stays in Redis for days and would turn add()
   * with the same id into a no-op, so it is removed first. The caller has
   * already moved the status; on failure the sweeper re-adds it later.
   */
  async requeue(notification: DispatchTarget): Promise<boolean> {
    const queue = this.queueOf(notification);
    const jobId = jobIdFor(notification.id);
    try {
      await withTimeout(
        (async () => {
          await queue.remove(jobId);
          await queue.add(
            SEND_JOB,
            { notificationId: notification.id },
            { jobId },
          );
        })(),
        DISPATCH_TIMEOUT_MS,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Notification ${notification.id} not requeued: ${(error as Error).message}`,
      );
      return false;
    }
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
