import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
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

/**
 * Starts one BullMQ worker per send queue. Built here rather than with
 * @Processor because that decorator reuses the queue's connection, which is
 * tuned to fail fast for HTTP requests; a worker should instead wait out a
 * Redis outage and resume. It also lets WORKERS_ENABLED turn workers off.
 */
@Injectable()
export class WorkersService
  implements OnApplicationBootstrap, OnApplicationShutdown
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
        (job) => this.processor.process(job),
        { connection, concurrency },
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

  // Waits for jobs in progress to finish before closing (scenario 7).
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
