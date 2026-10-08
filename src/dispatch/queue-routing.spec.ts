import { NotificationCategory } from '../notifications/notification.enums';
import { TemplateChannel } from '../templates/template.entity';
import { queueFor } from './queue-routing';

describe('queueFor', () => {
  it.each([
    [
      TemplateChannel.Email,
      NotificationCategory.Transactional,
      'email-transactional',
    ],
    [TemplateChannel.Email, NotificationCategory.Marketing, 'email-marketing'],
    [
      TemplateChannel.Push,
      NotificationCategory.Transactional,
      'push-transactional',
    ],
    [TemplateChannel.Push, NotificationCategory.Marketing, 'push-marketing'],
  ])('routes %s/%s to %s', (channel, category, queue) => {
    expect(queueFor(channel, category)).toBe(queue);
  });
});
