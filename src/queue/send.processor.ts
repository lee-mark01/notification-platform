import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { type Job, UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { DeliveryAttempt } from '../notifications/delivery-attempt.entity';
import { Notification } from '../notifications/notification.entity';
import {
  AttemptOutcome,
  NotificationStatus,
} from '../notifications/notification.enums';
import {
  type OutboundMessage,
  ProviderError,
} from '../providers/notification-provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { TemplateChannel } from '../templates/template.entity';
import { NotificationTransitions } from './notification-transitions';
import type { SendJobData } from './queue.constants';

const MAX_ERROR_MESSAGE = 500;

export class LeaseHeldError extends Error {
  constructor(id: number) {
    super(`Notification ${id} is being sent by another worker`);
    this.name = 'LeaseHeldError';
  }
}

/**
 * Handles one send job: claim, call the provider outside any transaction,
 * then record the outcome and one delivery_attempt row together.
 *
 * Retries, backoff, the DLQ and the suppression check come in Phase 3. Here a
 * transient error moves the notification to RETRYING and fails the job; a
 * permanent error moves it to FAILED and tells BullMQ not to retry.
 */
@Injectable()
export class SendProcessor {
  private readonly logger = new Logger(SendProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly transitions: NotificationTransitions,
    private readonly providers: ProviderRegistry,
  ) {}

  async process(job: Job<SendJobData>): Promise<void> {
    const id = job.data.notificationId;
    const attemptNo = await this.transitions.claim(id);
    if (attemptNo === null) {
      const status = await this.transitions.statusOf(id);
      // Another worker is mid-send. Failing the job (rather than completing
      // it) lets a retry re-claim once that lease expires (scenario 6).
      if (status === NotificationStatus.Sending) throw new LeaseHeldError(id);
      // Already finished, or gone: this is a duplicate job, nothing to send.
      this.logger.log(
        `Notification ${id} skipped: status ${status ?? 'missing'}`,
      );
      return;
    }

    const notification = await this.notifications.findOneByOrFail({ id });
    const provider = this.providers.forChannel(notification.channel);
    const startedAt = new Date();

    try {
      const result = await provider.send(toMessage(notification));
      await this.dataSource.transaction(async (manager) => {
        await this.transitions.markSent(manager, id, result.providerMessageId);
        await manager.insert(DeliveryAttempt, {
          notificationId: id,
          attemptNo,
          provider: provider.name,
          outcome: AttemptOutcome.Success,
          errorCode: null,
          errorMessage: null,
          durationMs: Date.now() - startedAt.getTime(),
          startedAt,
        });
      });
    } catch (error) {
      const failure = classify(error);
      await this.dataSource.transaction(async (manager) => {
        await this.transitions.markFailed(
          manager,
          id,
          attemptNo,
          failure.transient
            ? NotificationStatus.Retrying
            : NotificationStatus.Failed,
          failure.code,
        );
        await manager.insert(DeliveryAttempt, {
          notificationId: id,
          attemptNo,
          provider: provider.name,
          outcome: failure.transient
            ? AttemptOutcome.TransientError
            : AttemptOutcome.PermanentError,
          errorCode: failure.code,
          errorMessage: failure.message.slice(0, MAX_ERROR_MESSAGE),
          durationMs: Date.now() - startedAt.getTime(),
          startedAt,
        });
      });
      throw failure.transient
        ? error
        : new UnrecoverableError(`${failure.code}: ${failure.message}`);
    }
  }
}

// Anything that is not a classified ProviderError (a bug, a network error the
// adapter did not catch) is treated as transient: retrying is the safer guess.
function classify(error: unknown): {
  code: string;
  transient: boolean;
  message: string;
} {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      transient: error.transient,
      message: error.message,
    };
  }
  return {
    code: 'UNCLASSIFIED',
    transient: true,
    message: error instanceof Error ? error.message : String(error),
  };
}

function toMessage(n: Notification): OutboundMessage {
  if (n.channel === TemplateChannel.Email) {
    if (n.recipientEmail === null) {
      throw new ProviderError(
        'NO_RECIPIENT',
        false,
        'Email notification has no recipient address',
      );
    }
    return {
      channel: TemplateChannel.Email,
      notificationId: n.id,
      to: n.recipientEmail,
      subject: n.renderedTitle,
      html: n.renderedBody,
      text: n.renderedText,
    };
  }
  if (n.userId === null) {
    throw new ProviderError(
      'NO_RECIPIENT',
      false,
      'Push notification has no user',
    );
  }
  return {
    channel: TemplateChannel.Push,
    notificationId: n.id,
    userId: n.userId,
    title: n.renderedTitle,
    body: n.renderedBody,
    data: n.renderedData,
  };
}
