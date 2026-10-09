// One queue per channel x category (ADR-0001), plus the dead-letter queue.
export const QueueNames = {
  EmailTransactional: 'email-transactional',
  EmailMarketing: 'email-marketing',
  PushTransactional: 'push-transactional',
  PushMarketing: 'push-marketing',
  Dlq: 'notification-dlq',
  // Periodic upkeep such as the sweeper; one job per tick across instances.
  Maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export type SendQueueName = Exclude<
  QueueName,
  typeof QueueNames.Dlq | typeof QueueNames.Maintenance
>;

export const SEND_QUEUES: readonly SendQueueName[] = [
  QueueNames.EmailTransactional,
  QueueNames.EmailMarketing,
  QueueNames.PushTransactional,
  QueueNames.PushMarketing,
];

export enum QueueRouting {
  Split = 'split',
  // Experiment only (scenario 13): every notification shares one FIFO queue,
  // to measure what the split buys. Never meant for production.
  Single = 'single',
}

export const SEND_JOB = 'send';

// The job carries only the id; the worker reads the rendered content from the
// database, so a job never holds stale or sensitive data.
export interface SendJobData {
  notificationId: number;
}

export const DLQ_JOB = 'dead';

// Kept for operators: where it came from and why it died. Nothing processes
// the DLQ; redrive (#44) re-queues from the notification's DEAD status.
export interface DlqJobData {
  notificationId: number;
  sourceQueue: string;
  errorCode: string;
}

// BullMQ rejects integer-only custom ids, so the notification id is prefixed.
// The same notification always maps to the same job id, which makes a second
// add() a no-op while the first job is still kept in Redis.
export function jobIdFor(notificationId: number): string {
  return `notification-${notificationId}`;
}
