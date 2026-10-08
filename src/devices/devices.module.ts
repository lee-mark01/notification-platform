import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DeviceToken } from './device-token.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceToken]), AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [TypeOrmModule],
})
export class DevicesModule {}
