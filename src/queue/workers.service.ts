import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type { EnvironmentVariables } from '../config/env.validation';
import {
  QueueNames,
  type SendJobData,
  type SendQueueName,
} from './queue.constants';
import { SendProcessor } from './send.processor';

// Jobs processed at once per queue in this process. Transactional queues get
// more so a marketing burst cannot slow them; tuned by measurement in Phase 7.
export const CONCURRENCY: Record<SendQueueName, number> = {
  [QueueNames.EmailTransactional]: 10,
  [QueueNames.EmailMarketing]: 5,
  [QueueNames.PushTransactional]: 10,
  [QueueNames.PushMarketing]: 5,
};

// BullMQ's stall detection, written out because it pairs with the 60 s lease
// (docs/design/state-machine.md). A running job's lock is renewed every
// lockDuration / 2; if the worker dies, the lock expires and within
// stalledInterval another worker moves the job back to waiting. maxStalledCount
// 1: a job that stalls twice fails instead of crash-looping, and the sweeper
// picks the notification up later.
export const STALL_SETTINGS = {
  lockDuration: 30_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
} as const;

/**
 * Starts one BullMQ worker per send queue. Built here rather than with
 * @Processor because that decorator reuses the queue's connection, which is
 * tuned to fail fast for HTTP requests; a worker should instead wait out a
 * Redis outage and resume. It also lets WORKERS_ENABLED turn workers off.
 */
@Injectable()
export class WorkersService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorkersService.name);
  private readonly workers: Worker<SendJobData>[] = [];

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly processor: SendProcessor,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('WORKERS_ENABLED', { infer: true })) return;

    const connection = {
      host: this.config.get('REDIS_HOST', { infer: true }),
      port: this.config.get('REDIS_PORT', { infer: true }),
    };
    for (const [name, concurrency] of Object.entries(CONCURRENCY)) {
      const worker = new Worker<SendJobData>(
        name,
        (job, token) => this.processor.process(job, token),
        { connection, concurrency, ...STALL_SETTINGS },
      );
      let failing = false;
      worker.on('error', (error) => {
        if (!failing) this.logger.warn(`Worker ${name}: ${error.message}`);
        failing = true;
      });
      worker.on('ready', () => {
        failing = false;
      });
      worker.on('failed', (job, error) => {
        this.logger.warn(
          `Job ${job?.id ?? '?'} on ${name} failed: ${error.message}`,
        );
      });
      this.workers.push(worker);
    }
    this.logger.log(`Started workers for ${this.workers.length} queues`);
  }

  /** Resolves once every worker has connected (used by tests). */
  async ready(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.waitUntilReady()));
  }

  // A running job must still be able to record its result, so workers close
  // before the database and queues do. Nest already shuts modules down from
  // the dependents inward; beforeApplicationShutdown makes the order explicit
  // instead of relying on that. close() waits for running jobs (scenario 7).
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
