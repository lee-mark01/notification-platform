// Transitions between these states are defined in docs/design/state-machine.md.
export enum NotificationStatus {
  Pending = 'PENDING',
  Queued = 'QUEUED',
  Sending = 'SENDING',
  Retrying = 'RETRYING',
  Sent = 'SENT',
  Delivered = 'DELIVERED',
  Failed = 'FAILED',
  Dead = 'DEAD',
  Suppressed = 'SUPPRESSED',
  Bounced = 'BOUNCED',
  Complained = 'COMPLAINED',
}

export enum NotificationCategory {
  Transactional = 'transactional',
  Marketing = 'marketing',
}

export enum AttemptOutcome {
  Success = 'SUCCESS',
  TransientError = 'TRANSIENT_ERROR',
  PermanentError = 'PERMANENT_ERROR',
}
