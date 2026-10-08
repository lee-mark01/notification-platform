import { ApiProperty } from '@nestjs/swagger';
import { DevicePlatform, DeviceToken } from '../device-token.entity';

// The token itself is not echoed back; the client already has it.
export class DeviceResponse {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ enum: DevicePlatform })
  platform: DevicePlatform;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  lastSeenAt: Date;

  static from(device: DeviceToken): DeviceResponse {
    return {
      id: device.id,
      platform: device.platform,
      active: device.active,
      lastSeenAt: device.lastSeenAt,
    };
  }
}
