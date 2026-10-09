import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation';
import { QueueNames, SEND_QUEUES } from './queue.constants';

// Connection settings for queues used while handling HTTP requests. Kept apart
// from the default connection that workers will use (#30).
export const PRODUCER_CONFIG = 'producer';

const HOUR_S = 60 * 60;

function connectionFrom(config: ConfigService<EnvironmentVariables, true>) {
  return {
    host: config.get('REDIS_HOST', { infer: true }),
    port: config.get('REDIS_PORT', { infer: true }),
  };
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        connection: connectionFrom(config),
      }),
    }),
    BullModule.forRootAsync(PRODUCER_CONFIG, {
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        connection: {
          ...connectionFrom(config),
          // While Redis is unreachable, fail add() at once instead of
          // buffering it in memory; the notification stays PENDING and the
          // sweeper re-adds it later (ADR-0003).
          enableOfflineQueue: false,
        },
      }),
    }),
    BullModule.registerQueueAsync(
      ...[...SEND_QUEUES, QueueNames.Dlq].map((name) => ({
        name,
        configKey: PRODUCER_CONFIG,
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
          defaultJobOptions: {
            attempts: config.get('SEND_MAX_ATTEMPTS', { infer: true }),
            // BullMQ's built-in exponential backoff; jitter 0.5 spreads each
            // delay over 50-100% of its value so retries after an outage do
            // not all arrive at once.
            backoff: {
              type: 'exponential',
              delay: config.get('RETRY_BASE_DELAY_MS', { infer: true }),
              jitter: 0.5,
            },
            // Finished jobs are kept for a while so a duplicate add() with the
            // same job id is still ignored. After removal a duplicate could be
            // added again; the worker's conditional status update stops it.
            removeOnComplete: { age: 24 * HOUR_S, count: 10_000 },
            removeOnFail: { age: 7 * 24 * HOUR_S },
          },
        }),
      })),
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
