import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Notification } from '../notifications/notification.entity';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [TypeOrmModule.forFeature([Notification]), AuthModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
