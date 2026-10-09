import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { loggerParams } from './common/logging/logger.options';
import { EnvironmentVariables, validate } from './config/env.validation';
import { buildDataSourceOptions } from './database/database.options';
import { AdminModule } from './admin/admin.module';
import { BatchesModule } from './batches/batches.module';
import { DevicesModule } from './devices/devices.module';
import { HealthModule } from './health/health.module';
import { InboxModule } from './inbox/inbox.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WorkerModule } from './queue/worker.module';
import { RedisModule } from './redis/redis.module';
import { SweeperModule } from './sweeper/sweeper.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { TemplatesModule } from './templates/templates.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        ...buildDataSourceOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_DATABASE: config.get('DB_DATABASE', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
        }),
        autoLoadEntities: true,
      }),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        loggerParams({
          level: config.get('LOG_LEVEL', { infer: true }),
          nodeEnv: config.get('NODE_ENV', { infer: true }),
        }),
    }),
    RedisModule,
    HealthModule,
    TemplatesModule,
    NotificationsModule,
    BatchesModule,
    DevicesModule,
    MeModule,
    InboxModule,
    AdminModule,
    SweeperModule,
    WebhooksModule,
    WorkerModule,
  ],
})
export class AppModule {}
