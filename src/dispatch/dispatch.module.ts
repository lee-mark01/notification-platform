import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../notifications/notification.entity';
import { QueueModule } from '../queue/queue.module';
import { Dispatcher } from './dispatcher.service';

@Module({
  imports: [QueueModule, TypeOrmModule.forFeature([Notification])],
  providers: [Dispatcher],
  exports: [Dispatcher],
})
export class DispatchModule {}
