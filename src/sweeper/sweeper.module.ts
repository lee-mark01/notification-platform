import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DispatchModule } from '../dispatch/dispatch.module';
import { Notification } from '../notifications/notification.entity';
import { QueueModule } from '../queue/queue.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { Sweeper } from './sweeper.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    QueueModule,
    DispatchModule,
    WebhooksModule,
  ],
  providers: [Sweeper],
})
export class SweeperModule {}
