import { InjectQueue } from '@nestjs/bullmq';
import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { type Queue, Worker } from 'bullmq';
import { In, Raw, Repository } from 'typeorm';
import { BatchesService } from '../batches/batches.service';
import {
  BatchStatus,
  NotificationBatch,
} from '../batches/notification-batch.entity';
import type { EnvironmentVariables } from '../config/env.validation';
import { Dispatcher } from '../dispatch/dispatcher.service';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';
import { QueueNames } from '../queue/queue.constants';
import { SesEventProcessor } from '../webhooks/ses-event.processor';

const SCHEDULER_ID = 'sweep';
// Rows checked per status group per run; the oldest first, so a backlog is
// worked through over several runs instead of in one long query.
export const SWEEP_BATCH = 500;
// Batches resumed per run; each one re-adds up to all of its rows.
const BATCHES_PER_SWEEP = 10;

// Statuses that should always have a live job; past the stuck threshold the
// job may be gone (Redis data loss, a redrive that could not re-add it, a
// worker that died on its last attempt while holding the lease).
const IN_PROGRESS = [
  NotificationStatus.Queued,
  NotificationStatus.Retrying,
  NotificationStatus.Sending,
];

export interface SweepOptions {
  pendingAfterMs: number;
  stuckAfterMs: number;
}

export interface SweepResult {
  checked: number;
  added: number;
  stoppedEarly: boolean;
}

/**
 * Closes the gap left by "commit, then enqueue" (ADR-0003, D5): finds
 * notifications that should be on a queue but may not be, and adds their job
 * again. Safe to repeat and to run from several instances: a job that still
 * exists is left alone, the job id is the notification id, and the worker's
 * conditional claim stops a second send.
 *
 * It runs as a BullMQ job scheduler on the maintenance queue, so one sweep
 * happens per tick however many instances are up.
 */
@Injectable()
export class Sweeper
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(Sweeper.name);
  private worker: Worker | null = null;

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly dispatcher: Dispatcher,
    @InjectQueue(QueueNames.Maintenance) private readonly maintenance: Queue,
    private readonly sesEvents: SesEventProcessor,
    @InjectRepository(NotificationBatch)
    private readonly batchRows: Repository<NotificationBatch>,
    private readonly batches: BatchesService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('WORKERS_ENABLED', { infer: true })) return;

    const connection = {
      host: this.config.get('REDIS_HOST', { infer: true }),
      port: this.config.get('REDIS_PORT', { infer: true }),
    };
    this.worker = new Worker(
      QueueNames.Maintenance,
      async () => {
        await this.sweep();
        // SES events that arrived before their notification was SENT.
        await this.sesEvents.reprocessPending();
      },
      { connection, concurrency: 1 },
    );
    this.worker.on('error', (error) =>
      this.logger.warn(`Maintenance worker: ${error.message}`),
    );
    // Not awaited: with Redis down at startup this would wait until it is
    // back, and the app must still start and accept requests.
    this.maintenance
      .upsertJobScheduler(
        SCHEDULER_ID,
        { every: this.config.get('SWEEP_INTERVAL_MS', { infer: true }) },
        {
          name: SCHEDULER_ID,
          opts: { removeOnComplete: true, removeOnFail: 100 },
        },
      )
      .catch((error: Error) =>
        this.logger.warn(`Sweep schedule not set: ${error.message}`),
      );
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async sweep(
    options: SweepOptions = {
      pendingAfterMs: this.config.get('SWEEP_PENDING_AFTER_MS', {
        infer: true,
      }),
      stuckAfterMs: this.config.get('SWEEP_STUCK_AFTER_MS', { infer: true }),
    },
  ): Promise<SweepResult> {
    const result: SweepResult = { checked: 0, added: 0, stoppedEarly: false };
    // First, so a resumed batch's rows are QUEUED in bulk instead of checked
    // one by one below.
    if (!(await this.resumeBatches(options.pendingAfterMs))) {
      result.stoppedEarly = true;
      return this.report(result);
    }
    const groups: [NotificationStatus[], number][] = [
      [[NotificationStatus.Pending], options.pendingAfterMs],
      [IN_PROGRESS, options.stuckAfterMs],
    ];

    // A PENDING row moved to QUEUED below can match the second group too.
    const seen = new Set<number>();
    for (const [statuses, afterMs] of groups) {
      for (const row of await this.stale(statuses, afterMs)) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        result.checked += 1;
        const outcome = await this.dispatcher.ensureJob(row);
        // Redis is unreachable; the next run will pick these up again.
        if (outcome === 'failed') {
          result.stoppedEarly = true;
          return this.report(result);
        }
        if (outcome === 'added') result.added += 1;
        if (row.status === NotificationStatus.Pending) {
          await this.dispatcher.markQueued(row.id);
        }
      }
    }
    return this.report(result);
  }

  // A batch whose enqueuing stopped part way: the request's process died or
  // Redis went away. Returns false if Redis is still unreachable.
  private async resumeBatches(afterMs: number): Promise<boolean> {
    const stalled = await this.batchRows.find({
      select: { id: true },
      where: {
        status: In([BatchStatus.Accepted, BatchStatus.Enqueuing]),
        updatedAt: olderThan(afterMs),
      },
      order: { updatedAt: 'ASC' },
      take: BATCHES_PER_SWEEP,
    });
    for (const { id } of stalled) {
      this.logger.log(`Resuming batch ${id}`);
      if (!(await this.batches.enqueue(id))) return false;
    }
    return true;
  }

  // Uses ix_notification_status_updated_at. Compared on the database clock,
  // the same clock that wrote updated_at.
  private stale(
    statuses: NotificationStatus[],
    afterMs: number,
  ): Promise<Notification[]> {
    return this.notifications.find({
      select: { id: true, channel: true, category: true, status: true },
      where: {
        status: In(statuses),
        updatedAt: olderThan(afterMs),
      },
      order: { updatedAt: 'ASC' },
      take: SWEEP_BATCH,
    });
  }

  private report(result: SweepResult): SweepResult {
    if (result.added > 0 || result.stoppedEarly) {
      this.logger.log(
        `Sweep: checked ${result.checked}, re-added ${result.added}${result.stoppedEarly ? ', stopped early (queue unreachable)' : ''}`,
      );
    }
    return result;
  }
}

function olderThan(ms: number) {
  return Raw(
    (column) =>
      `${column} < CURRENT_TIMESTAMP(3) - INTERVAL :micros MICROSECOND`,
    { micros: ms * 1000 },
  );
}
