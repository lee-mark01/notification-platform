import { Logger } from '@nestjs/common';
import type { Messaging, MulticastMessage } from 'firebase-admin/messaging';
import { In, Repository } from 'typeorm';
import { DeviceToken } from '../../devices/device-token.entity';
import { TemplateChannel } from '../../templates/template.entity';
import {
  type NotificationProvider,
  type OutboundMessage,
  type PushMessage,
  ProviderError,
  type SendResult,
} from '../notification-provider';
import {
  DEAD_TOKEN_CODES,
  fcmErrorCode,
  INVALID_ARGUMENT,
  isTransientFcmCode,
} from './fcm-errors';

/**
 * Sends a push to every active token of the user with FCM's multicast API,
 * and deactivates tokens FCM reports as gone (scenario 9).
 *
 * One notification, several tokens: if any token received it, the send
 * counts as a success. Retrying a partial success would push it again to the
 * tokens that already got it.
 */
export class FcmProvider implements NotificationProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger(FcmProvider.name);

  constructor(
    private readonly messaging: Messaging,
    private readonly devices: Repository<DeviceToken>,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    if (message.channel !== TemplateChannel.Push) {
      throw new ProviderError(
        'UNSUPPORTED_CHANNEL',
        false,
        `FCM cannot send ${message.channel}`,
      );
    }

    const tokens = (
      await this.devices.find({
        select: { id: true, token: true },
        where: { userId: message.userId, active: true },
      })
    ).map((device) => device.token);
    if (tokens.length === 0) {
      throw new ProviderError(
        'NO_ACTIVE_DEVICE',
        false,
        `User ${message.userId} has no active push token`,
      );
    }

    let batch;
    try {
      batch = await this.messaging.sendEachForMulticast(
        this.multicast(message, tokens),
      );
    } catch (error) {
      const code = fcmErrorCode(error);
      throw new ProviderError(
        code,
        isTransientFcmCode(code),
        error instanceof Error ? error.message : String(error),
      );
    }

    const failures = batch.responses.flatMap((response, i) =>
      response.success
        ? []
        : [{ token: tokens[i], code: fcmErrorCode(response.error) }],
    );
    // invalid-argument also covers a malformed token, but it could be our
    // payload. If another token accepted the same payload, it was the token
    // (Firebase's token management guidance).
    const payloadAccepted = batch.successCount > 0;
    await this.deactivate(
      failures.filter(
        (f) =>
          DEAD_TOKEN_CODES.has(f.code) ||
          (payloadAccepted && f.code === INVALID_ARGUMENT),
      ),
    );

    const delivered = batch.responses.find((response) => response.success);
    if (delivered?.messageId) {
      if (failures.length > 0) {
        this.logger.warn(
          `Notification ${message.notificationId}: ${batch.successCount}/${tokens.length} tokens accepted`,
        );
      }
      return { providerMessageId: delivered.messageId };
    }

    // No token accepted it. Retry if any failure may pass later; otherwise
    // it is permanent (for example, every token was unregistered).
    const transient = failures.find((f) => isTransientFcmCode(f.code));
    const reported = transient ?? failures[0];
    throw new ProviderError(
      reported.code,
      transient !== undefined,
      `FCM rejected all ${tokens.length} tokens`,
    );
  }

  private multicast(message: PushMessage, tokens: string[]): MulticastMessage {
    return {
      tokens,
      notification: { title: message.title, body: message.body },
      // Data values must be strings. The id lets the page or service worker
      // report a click as read (Phase 4).
      data: {
        ...(message.data ?? {}),
        notificationId: String(message.notificationId),
      },
    };
  }

  private async deactivate(
    dead: { token: string; code: string }[],
  ): Promise<void> {
    for (const code of new Set(dead.map((d) => d.code))) {
      const tokens = dead.filter((d) => d.code === code).map((d) => d.token);
      await this.devices.update(
        { token: In(tokens), active: true },
        { active: false, deactivationReason: code.replace('messaging/', '') },
      );
    }
  }
}
