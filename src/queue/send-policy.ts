import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../notifications/notification.entity';
import { NotificationCategory } from '../notifications/notification.enums';
import { SuppressionsService } from '../suppressions/suppressions.service';
import { TemplateChannel } from '../templates/template.entity';
import { AppUser } from '../users/app-user.entity';

export enum BlockReason {
  /** The address is on the suppression list (bounce, complaint, invalid). */
  SuppressedAddress = 'SUPPRESSED_ADDRESS',
  /** Marketing without the user's opt-in, or to a recipient with no user. */
  NoMarketingConsent = 'NO_MARKETING_CONSENT',
}

/**
 * Checked right before each send, not at intake: a user may opt out, or an
 * address may bounce, between the two (docs/design/state-machine.md, T7).
 */
@Injectable()
export class SendPolicy {
  constructor(
    private readonly suppressions: SuppressionsService,
    @InjectRepository(AppUser) private readonly users: Repository<AppUser>,
  ) {}

  async blockReason(n: Notification): Promise<BlockReason | null> {
    if (
      n.channel === TemplateChannel.Email &&
      n.recipientEmail !== null &&
      (await this.suppressions.isSuppressed(n.recipientEmail))
    ) {
      return BlockReason.SuppressedAddress;
    }
    if (n.category === NotificationCategory.Marketing) {
      // Advertising needs prior consent; an address with no user record has
      // none to show, so it is not sent.
      if (n.userId === null) return BlockReason.NoMarketingConsent;
      const user = await this.users.findOne({
        select: { id: true, marketingOptIn: true },
        where: { id: n.userId },
      });
      if (!user?.marketingOptIn) return BlockReason.NoMarketingConsent;
    }
    return null;
  }
}
