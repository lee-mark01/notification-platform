import { NotificationCategory } from '../notifications/notification.enums';
import { QueueNames, type SendQueueName } from '../queue/queue.constants';
import { TemplateChannel } from '../templates/template.entity';

// A lookup table rather than a class per channel: the choice depends only on
// two enums, and the compiler checks that every pair has a queue.
const ROUTES: Record<
  TemplateChannel,
  Record<NotificationCategory, SendQueueName>
> = {
  [TemplateChannel.Email]: {
    [NotificationCategory.Transactional]: QueueNames.EmailTransactional,
    [NotificationCategory.Marketing]: QueueNames.EmailMarketing,
  },
  [TemplateChannel.Push]: {
    [NotificationCategory.Transactional]: QueueNames.PushTransactional,
    [NotificationCategory.Marketing]: QueueNames.PushMarketing,
  },
};

export function queueFor(
  channel: TemplateChannel,
  category: NotificationCategory,
): SendQueueName {
  return ROUTES[channel][category];
}
