import { NotificationCategory } from '../notifications/notification.enums';
import {
  QueueNames,
  QueueRouting,
  type SendQueueName,
} from '../queue/queue.constants';
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

export const SINGLE_QUEUE: SendQueueName = QueueNames.EmailTransactional;

export function queueFor(
  channel: TemplateChannel,
  category: NotificationCategory,
  routing: QueueRouting = QueueRouting.Split,
): SendQueueName {
  return routing === QueueRouting.Single
    ? SINGLE_QUEUE
    : ROUTES[channel][category];
}
