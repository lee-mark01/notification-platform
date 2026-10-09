import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchesModule } from '../batches/batches.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { NotificationBatch } from '../batches/notification-batch.entity';
import { Notification } from '../notifications/notification.entity';
import { QueueModule } from '../queue/queue.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { Sweeper } from './sweeper.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, NotificationBatch]),
    QueueModule,
    DispatchModule,
    BatchesModule,
    WebhooksModule,
  ],
  providers: [Sweeper],
})
export class SweeperModule {}
