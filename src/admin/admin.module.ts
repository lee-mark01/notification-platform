import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DispatchModule } from '../dispatch/dispatch.module';
import { Notification } from '../notifications/notification.entity';
import { NotificationTransitions } from '../queue/notification-transitions';
import { QueueModule } from '../queue/queue.module';
import { AdminKeyGuard } from './admin-key.guard';
import { DlqController } from './dlq/dlq.controller';
import { DlqService } from './dlq/dlq.service';
import { ReadRatesController, ReadRatesService } from './stats/read-rates';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    QueueModule,
    DispatchModule,
  ],
  controllers: [DlqController, ReadRatesController],
  providers: [
    AdminKeyGuard,
    NotificationTransitions,
    DlqService,
    ReadRatesService,
  ],
})
export class AdminModule {}
