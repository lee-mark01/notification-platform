import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvironmentVariables, validate } from './config/env.validation';
import { buildDataSourceOptions } from './database/database.options';
import { AdminModule } from './admin/admin.module';
import { DevicesModule } from './devices/devices.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WorkerModule } from './queue/worker.module';
import { RedisModule } from './redis/redis.module';
import { SweeperModule } from './sweeper/sweeper.module';
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
    RedisModule,
    HealthModule,
    TemplatesModule,
    NotificationsModule,
    DevicesModule,
    MeModule,
    AdminModule,
    SweeperModule,
    WorkerModule,
  ],
})
export class AppModule {}
