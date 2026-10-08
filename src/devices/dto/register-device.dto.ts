import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../device-token.entity';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token', maxLength: 512 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({ enum: DevicePlatform, example: DevicePlatform.Web })
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}
