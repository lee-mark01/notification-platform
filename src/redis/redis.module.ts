import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { EnvironmentVariables } from '../config/env.validation';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// General-purpose client for request-time Redis calls such as health checks.
// BullMQ will open its own connections with queue-specific settings.
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          // Fail commands immediately while disconnected instead of queueing
          // them until reconnection, so callers get a fast, clear error.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });

        // ioredis retries forever and emits an error on every attempt; log
        // only the transition into and out of the failing state.
        let failing = false;
        client.on('error', (error: Error) => {
          if (!failing) logger.warn(`Connection error: ${error.message}`);
          failing = true;
        });
        client.on('ready', () => {
          if (failing) logger.log('Connection restored');
          failing = false;
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() waits for pending replies; disconnect() if never connected.
    if (this.client.status === 'ready') {
      await this.client.quit();
    } else {
      this.client.disconnect();
    }
  }
}
