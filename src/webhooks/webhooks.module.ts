import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnsHttp } from './sns-http';
import { WebhookEvent } from './webhook-event.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookEvent])],
  controllers: [WebhooksController],
  providers: [WebhooksService, SnsHttp],
  exports: [WebhooksService, TypeOrmModule],
})
export class WebhooksModule {}
