import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { KeyObject } from 'node:crypto';
import { Repository } from 'typeorm';
import { isDuplicateEntryError } from '../common/database/mysql-errors';
import { ProblemTypes } from '../common/problem/problem-types';
import { ProblemException } from '../common/problem/problem.exception';
import type { EnvironmentVariables } from '../config/env.validation';
import { SnsHttp } from './sns-http';
import {
  isSnsUrl,
  parseSnsMessage,
  publicKeyFromPem,
  type SnsMessage,
  verifySignature,
} from './sns-message';
import { WebhookEvent } from './webhook-event.entity';

export type WebhookOutcome = 'stored' | 'duplicate' | 'subscribed' | 'ignored';

/**
 * Receives SES events through SNS (POST /webhooks/ses). Nothing is stored or
 * called until the message is proven to come from our SNS topic: the topic
 * must match, the signing certificate must be served by SNS, and the
 * signature must verify (scenario 11).
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  // Certificates rotate rarely; cache them by URL for the process lifetime.
  private readonly keys = new Map<string, Promise<KeyObject>>();

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly http: SnsHttp,
    @InjectRepository(WebhookEvent)
    private readonly events: Repository<WebhookEvent>,
  ) {}

  async receive(body: unknown): Promise<{
    outcome: WebhookOutcome;
    event?: WebhookEvent;
  }> {
    const message = parseSnsMessage(body);
    if (!message) {
      throw new ProblemException(
        ProblemTypes.VALIDATION_FAILED,
        'The body is not an SNS message.',
      );
    }
    await this.verify(message);

    switch (message.Type) {
      case 'SubscriptionConfirmation':
        await this.confirmSubscription(message);
        return { outcome: 'subscribed' };
      case 'UnsubscribeConfirmation':
        this.logger.warn(`Unsubscribed from ${message.TopicArn}`);
        return { outcome: 'ignored' };
      case 'Notification':
        return this.store(message);
    }
  }

  private async verify(message: SnsMessage): Promise<void> {
    const topic = this.config.get('SNS_TOPIC_ARN', { infer: true });
    if (!topic || message.TopicArn !== topic) {
      throw rejected('The message is not from the configured SNS topic.');
    }
    if (!isSnsUrl(message.SigningCertURL, { pem: true })) {
      throw rejected('The signing certificate is not served by SNS.');
    }
    let key: KeyObject;
    try {
      key = await this.signingKey(message.SigningCertURL);
    } catch (error) {
      this.logger.warn(
        `Signing certificate unavailable: ${(error as Error).message}`,
      );
      throw rejected('The signing certificate could not be loaded.');
    }
    if (!verifySignature(message, key)) {
      throw rejected('The message signature is invalid.');
    }
  }

  private signingKey(url: string): Promise<KeyObject> {
    let key = this.keys.get(url);
    if (!key) {
      key = this.http.getText(url).then(publicKeyFromPem);
      // Do not cache a failure: the next message retries the download.
      key.catch(() => this.keys.delete(url));
      this.keys.set(url, key);
    }
    return key;
  }

  private async confirmSubscription(message: SnsMessage): Promise<void> {
    if (
      !message.SubscribeURL ||
      !isSnsUrl(message.SubscribeURL, { pem: false })
    ) {
      throw rejected('The SubscribeURL is not an SNS address.');
    }
    await this.http.getText(message.SubscribeURL);
    this.logger.log(`Subscribed to ${message.TopicArn}`);
  }

  // Insert first: the unique MessageId decides, so a message SNS delivers
  // twice (it retries until it sees a 2xx) is stored once (scenario 10).
  private async store(message: SnsMessage): Promise<{
    outcome: WebhookOutcome;
    event?: WebhookEvent;
  }> {
    const payload = parsePayload(message.Message);
    const event = this.events.create({
      snsMessageId: message.MessageId,
      eventType: eventTypeOf(payload),
      notificationId: null,
      payload,
      receivedAt: new Date(),
      processedAt: null,
    });
    try {
      await this.events.save(event);
    } catch (error) {
      if (isDuplicateEntryError(error)) return { outcome: 'duplicate' };
      throw error;
    }
    return { outcome: 'stored', event };
  }
}

function rejected(detail: string): ProblemException {
  return new ProblemException(ProblemTypes.WEBHOOK_REJECTED, detail);
}

function parsePayload(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Kept as text below.
  }
  return { raw: text };
}

// Configuration set event publishing uses eventType; identity notifications
// use notificationType.
function eventTypeOf(payload: Record<string, unknown>): string {
  const type = payload.eventType ?? payload.notificationType;
  return typeof type === 'string' ? type.slice(0, 30) : 'Unknown';
}
