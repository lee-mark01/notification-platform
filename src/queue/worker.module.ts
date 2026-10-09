import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryAttempt } from '../notifications/delivery-attempt.entity';
import { Notification } from '../notifications/notification.entity';
import { ProvidersModule } from '../providers/providers.module';
import { SuppressionsModule } from '../suppressions/suppressions.module';
import { AppUser } from '../users/app-user.entity';
import { NotificationTransitions } from './notification-transitions';
import { QueueModule } from './queue.module';
import { SendPolicy } from './send-policy';
import { SendProcessor } from './send.processor';
import { WorkersService } from './workers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeliveryAttempt, AppUser]),
    ProvidersModule,
    QueueModule,
    SuppressionsModule,
  ],
  providers: [
    NotificationTransitions,
    SendPolicy,
    SendProcessor,
    WorkersService,
  ],
})
export class WorkerModule {}
