import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../notifications/notification.entity';
import { SuppressionsModule } from '../suppressions/suppressions.module';
import { SesEventProcessor } from './ses-event.processor';
import { SnsHttp } from './sns-http';
import { WebhookEvent } from './webhook-event.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent, Notification]),
    SuppressionsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, SnsHttp, SesEventProcessor],
  exports: [WebhooksService, SesEventProcessor, TypeOrmModule],
})
export class WebhooksModule {}
