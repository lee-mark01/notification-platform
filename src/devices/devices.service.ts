import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { AppUser } from '../users/app-user.entity';
import { DeviceToken } from './device-token.entity';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceToken)
    private readonly devices: Repository<DeviceToken>,
  ) {}

  /**
   * Registers a token for the user (upsert). Insert first and fall back to
   * an update on the unique index, so two concurrent registrations of the
   * same token cannot both insert.
   *
   * A token identifies a browser, not a person: if another user signs in on
   * the same browser, the token moves to them so the previous user's
   * notifications stop appearing there. Re-registering also reactivates a
   * token that FCM had reported as unregistered.
   */
  async register(
    user: AppUser,
    dto: RegisterDeviceDto,
  ): Promise<{ created: boolean; device: DeviceToken }> {
    const values = {
      userId: user.id,
      platform: dto.platform,
      active: true,
      deactivationReason: null,
      lastSeenAt: new Date(),
    };
    try {
      await this.devices.insert({ token: dto.token, ...values });
      return { created: true, device: await this.byToken(dto.token) };
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
    }
    await this.devices.update({ token: dto.token }, values);
    return { created: false, device: await this.byToken(dto.token) };
  }

  private byToken(token: string): Promise<DeviceToken> {
    return this.devices.findOneByOrFail({ token });
  }
}
