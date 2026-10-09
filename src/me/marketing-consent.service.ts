import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../users/app-user.entity';
import { MarketingConsentResponse } from './marketing-consent.dto';

@Injectable()
export class MarketingConsentService {
  constructor(
    @InjectRepository(AppUser) private readonly users: Repository<AppUser>,
  ) {}

  /**
   * Sets the final state rather than toggling, so repeating a request leaves
   * the same result. The update is conditional on a change, which keeps
   * marketing_opt_in_at at the moment consent was actually given.
   */
  async set(user: AppUser, optIn: boolean): Promise<MarketingConsentResponse> {
    await this.users.update(
      { id: user.id, marketingOptIn: !optIn },
      { marketingOptIn: optIn, marketingOptInAt: optIn ? new Date() : null },
    );
    const fresh = await this.users.findOneByOrFail({ id: user.id });
    return { optIn: fresh.marketingOptIn, updatedAt: fresh.updatedAt };
  }
}
