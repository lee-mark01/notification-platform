// One queue per channel x category (ADR-0001), plus the dead-letter queue.
export const QueueNames = {
  EmailTransactional: 'email-transactional',
  EmailMarketing: 'email-marketing',
  PushTransactional: 'push-transactional',
  PushMarketing: 'push-marketing',
  Dlq: 'notification-dlq',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export type SendQueueName = Exclude<QueueName, typeof QueueNames.Dlq>;

export const SEND_QUEUES: readonly SendQueueName[] = [
  QueueNames.EmailTransactional,
  QueueNames.EmailMarketing,
  QueueNames.PushTransactional,
  QueueNames.PushMarketing,
];

export const SEND_JOB = 'send';

// The job carries only the id; the worker reads the rendered content from the
// database, so a job never holds stale or sensitive data.
export interface SendJobData {
  notificationId: number;
}

// BullMQ rejects integer-only custom ids, so the notification id is prefixed.
// The same notification always maps to the same job id, which makes a second
// add() a no-op while the first job is still kept in Redis.
export function jobIdFor(notificationId: number): string {
  return `notification-${notificationId}`;
}
