import { TemplateChannel } from '../templates/template.entity';

export interface EmailMessage {
  channel: TemplateChannel.Email;
  notificationId: number;
  to: string;
  subject: string;
  html: string;
  text: string | null;
}

// Push is addressed to a user; the push provider resolves the user's devices.
export interface PushMessage {
  channel: TemplateChannel.Push;
  notificationId: number;
  userId: number;
  title: string;
  body: string;
  data: Record<string, string> | null;
}

export type OutboundMessage = EmailMessage | PushMessage;

export interface SendResult {
  providerMessageId: string;
}

/**
 * One interface for every delivery service (adapter pattern). The worker
 * only sees this, so swapping SES for the fake in tests changes no worker
 * code.
 */
export interface NotificationProvider {
  /** Stored in delivery_attempt.provider. */
  readonly name: string;
  /** Throws ProviderError when the provider rejects or cannot be reached. */
  send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * A failed send, already classified by the adapter that understands the
 * provider's errors. Transient errors may succeed on retry; permanent ones
 * never will (bad address, unregistered token).
 */
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    readonly transient: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
