import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DispatchModule } from '../dispatch/dispatch.module';
import { Notification } from '../notifications/notification.entity';
import { NotificationTransitions } from '../queue/notification-transitions';
import { QueueModule } from '../queue/queue.module';
import { AdminKeyGuard } from './admin-key.guard';
import { DlqController } from './dlq/dlq.controller';
import { DlqService } from './dlq/dlq.service';
import { HistoryController } from './history/history.controller';
import { HistoryService } from './history/history.service';
import { ReadRatesController, ReadRatesService } from './stats/read-rates';
import { StatsSummaryController, StatsSummaryService } from './stats/summary';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    QueueModule,
    DispatchModule,
  ],
  controllers: [
    DlqController,
    HistoryController,
    ReadRatesController,
    StatsSummaryController,
  ],
  providers: [
    AdminKeyGuard,
    NotificationTransitions,
    DlqService,
    ReadRatesService,
    HistoryService,
    StatsSummaryService,
  ],
})
export class AdminModule {}
