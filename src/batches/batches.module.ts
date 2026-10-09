import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '../clients/clients.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { Notification } from '../notifications/notification.entity';
import { TemplatesModule } from '../templates/templates.module';
import { UsersModule } from '../users/users.module';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { NotificationBatch } from './notification-batch.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationBatch, Notification]),
    ClientsModule,
    UsersModule,
    TemplatesModule,
    IdempotencyModule,
    DispatchModule,
  ],
  controllers: [BatchesController],
  providers: [BatchesService],
  exports: [BatchesService],
})
export class BatchesModule {}
