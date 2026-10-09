import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  LessThan,
  Repository,
} from 'typeorm';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';
import { SuppressionReason } from '../suppressions/suppression.entity';
import { SuppressionsService } from '../suppressions/suppressions.service';
import { WebhookEvent } from './webhook-event.entity';

// An event whose notification is still unknown after this long is closed
// without a match.
export const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPROCESS_BATCH = 100;

interface SesEvent {
  mail?: { messageId?: unknown };
  delivery?: { timestamp?: unknown };
  bounce?: {
    bounceType?: unknown;
    bouncedRecipients?: { emailAddress?: unknown }[];
  };
  complaint?: { complainedRecipients?: { emailAddress?: unknown }[] };
  open?: { timestamp?: unknown };
}

/**
 * Applies SES events to notifications (T9-T11 and read_at). Every change is a
 * conditional UPDATE, so a late or repeated event that would move a
 * notification backwards matches nothing and is ignored: a Delivery after a
 * Bounce leaves it BOUNCED, a second Open keeps the first read time.
 *
 * SES can report an event before we have recorded SENT with its message id.
 * Such an event stays unprocessed and is matched again on later sweeps.
 */
@Injectable()
export class SesEventProcessor {
  private readonly logger = new Logger(SesEventProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
    private readonly suppressions: SuppressionsService,
  ) {}

  /**
   * Applies an event that was just stored. Suppressions take effect at once,
   * matched or not: a hard bounce or complaint is about the address.
   */
  async receive(event: WebhookEvent): Promise<void> {
    await this.applySuppressions(event, event.payload);
    await this.process(event);
  }

  /**
   * Applies the event to its notification. Returns true once processed (now
   * or before); false if the notification is not known yet.
   */
  async process(event: WebhookEvent, now = new Date()): Promise<boolean> {
    if (event.processedAt) return true;
    const payload = event.payload as SesEvent;
    const messageId = payload.mail?.messageId;

    const notification =
      typeof messageId === 'string'
        ? await this.notifications.findOne({
            select: { id: true },
            where: { providerMessageId: messageId },
          })
        : null;
    const expired =
      now.getTime() - event.receivedAt.getTime() > MATCH_WINDOW_MS;
    if (!notification && typeof messageId === 'string' && !expired) {
      return false;
    }

    await this.dataSource.transaction(async (manager) => {
      if (notification) {
        await this.applyToNotification(
          manager,
          event,
          payload,
          notification.id,
        );
      }
      await manager.update(
        WebhookEvent,
        { id: event.id, processedAt: IsNull() },
        { processedAt: now, notificationId: notification?.id ?? null },
      );
    });
    if (!notification) {
      this.logger.warn(
        `SES event ${event.snsMessageId} (${event.eventType}) matched no notification`,
      );
    }
    return true;
  }

  /** Called by the sweeper: retries events that matched nothing yet. */
  async reprocessPending(now = new Date()): Promise<number> {
    const pending = await this.events.find({
      where: { processedAt: IsNull(), receivedAt: LessThan(now) },
      order: { receivedAt: 'ASC' },
      take: REPROCESS_BATCH,
    });
    let done = 0;
    for (const event of pending) {
      if (await this.process(event, now)) done += 1;
    }
    return done;
  }

  private async applyToNotification(
    manager: EntityManager,
    event: WebhookEvent,
    payload: SesEvent,
    id: number,
  ): Promise<void> {
    const delivered = [NotificationStatus.Sent, NotificationStatus.Delivered];
    switch (event.eventType) {
      case 'Delivery':
        // T9
        await manager.update(
          Notification,
          { id, status: NotificationStatus.Sent },
          {
            status: NotificationStatus.Delivered,
            deliveredAt: dateOr(payload.delivery?.timestamp, event.receivedAt),
          },
        );
        return;
      case 'Bounce':
        // T10, permanent bounces only: a transient one (mailbox full) may
        // still be delivered on SES's own retry.
        if (payload.bounce?.bounceType === 'Permanent') {
          await manager.update(
            Notification,
            { id, status: In(delivered) },
            { status: NotificationStatus.Bounced },
          );
        }
        return;
      case 'Complaint':
        // T11
        await manager.update(
          Notification,
          { id, status: In(delivered) },
          { status: NotificationStatus.Complained },
        );
        return;
      case 'Open':
        // Read, not a status. Only the first open counts.
        await manager.update(
          Notification,
          { id, readAt: IsNull() },
          { readAt: dateOr(payload.open?.timestamp, event.receivedAt) },
        );
        return;
    }
  }

  // Hard bounces and complaints block the address for every future
  // notification: sending to it again hurts SES reputation.
  private async applySuppressions(
    event: WebhookEvent,
    payload: SesEvent,
  ): Promise<void> {
    let reason: SuppressionReason | null = null;
    let recipients: { emailAddress?: unknown }[] = [];
    if (
      event.eventType === 'Bounce' &&
      payload.bounce?.bounceType === 'Permanent'
    ) {
      reason = SuppressionReason.HardBounce;
      recipients = payload.bounce.bouncedRecipients ?? [];
    } else if (event.eventType === 'Complaint') {
      reason = SuppressionReason.Complaint;
      recipients = payload.complaint?.complainedRecipients ?? [];
    }
    if (!reason) return;
    for (const { emailAddress } of recipients) {
      if (typeof emailAddress === 'string') {
        await this.suppressions.suppress(
          emailAddress,
          reason,
          `sns:${event.snsMessageId}`.slice(0, 100),
        );
      }
    }
  }
}

function dateOr(value: unknown, fallback: Date): Date {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return fallback;
}
