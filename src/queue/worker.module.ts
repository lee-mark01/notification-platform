import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryAttempt } from '../notifications/delivery-attempt.entity';
import { Notification } from '../notifications/notification.entity';
import { ProvidersModule } from '../providers/providers.module';
import { NotificationTransitions } from './notification-transitions';
import { QueueModule } from './queue.module';
import { SendProcessor } from './send.processor';
import { WorkersService } from './workers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeliveryAttempt]),
    ProvidersModule,
    QueueModule,
  ],
  providers: [NotificationTransitions, SendProcessor, WorkersService],
})
export class WorkerModule {}
