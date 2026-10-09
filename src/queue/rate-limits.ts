import { NotificationCategory } from '../notifications/notification.enums';
import { queueFor } from '../dispatch/queue-routing';
import { TemplateChannel } from '../templates/template.entity';
import type { SendQueueName } from './queue.constants';

export interface RateLimitSettings {
  emailPerSecond: number;
  pushPerSecond: number;
  transactionalShare: number;
}

export interface QueueRateLimit {
  max: number;
  duration: number;
}

/**
 * BullMQ worker limiters per send queue. A provider's limit is per account,
 * not per queue (SES: one send rate for the whole account), so a channel's
 * budget is split between its two queues and their sum never exceeds it.
 * Transactional gets its share even when idle: that headroom is what keeps a
 * verification email moving during a marketing burst. BullMQ's limiter is
 * shared by every worker of a queue, so the split holds across instances.
 */
export function rateLimits(
  settings: RateLimitSettings,
): Record<SendQueueName, QueueRateLimit> {
  const entries = [
    [TemplateChannel.Email, settings.emailPerSecond],
    [TemplateChannel.Push, settings.pushPerSecond],
  ] as const;
  const limits = {} as Record<SendQueueName, QueueRateLimit>;
  for (const [channel, perSecond] of entries) {
    // At least one job per second each, so neither queue stops entirely.
    const transactional = Math.min(
      perSecond - 1,
      Math.max(1, Math.round(perSecond * settings.transactionalShare)),
    );
    limits[queueFor(channel, NotificationCategory.Transactional)] = {
      max: transactional,
      duration: 1_000,
    };
    limits[queueFor(channel, NotificationCategory.Marketing)] = {
      max: perSecond - transactional,
      duration: 1_000,
    };
  }
  return limits;
}
