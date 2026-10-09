import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { type Job, type Queue, UnrecoverableError } from 'bullmq';
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
import {
  type ClassifiedFailure,
  classifyError,
  decideFailure,
  FailureAction,
} from './failure-policy';
import { NotificationTransitions } from './notification-transitions';
import {
  DLQ_JOB,
  type DlqJobData,
  jobIdFor,
  QueueNames,
  type SendJobData,
} from './queue.constants';

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
 * A failure is classified and decided by failure-policy.ts: transient with
 * attempts left goes to RETRYING and BullMQ retries after an exponential
 * backoff with jitter; transient on the last attempt goes to DEAD and the
 * DLQ; permanent goes to FAILED. DEAD and FAILED throw UnrecoverableError so
 * BullMQ stops retrying.
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
    @InjectQueue(QueueNames.Dlq) private readonly dlq: Queue<DlqJobData>,
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
    const attempt = (outcome: AttemptOutcome, failure?: ClassifiedFailure) => ({
      notificationId: id,
      attemptNo,
      provider: provider.name,
      outcome,
      errorCode: failure?.code ?? null,
      errorMessage: failure?.message.slice(0, MAX_ERROR_MESSAGE) ?? null,
      durationMs: Date.now() - startedAt.getTime(),
      startedAt,
    });

    let providerMessageId: string;
    try {
      ({ providerMessageId } = await provider.send(toMessage(notification)));
    } catch (error) {
      await this.recordFailure(job, id, attemptNo, classifyError(error), (f) =>
        attempt(
          f.transient
            ? AttemptOutcome.TransientError
            : AttemptOutcome.PermanentError,
          f,
        ),
      );
      return;
    }

    // Outside the try above: if recording fails after a successful send, the
    // job fails with that error and is not mistaken for a provider failure.
    await this.dataSource.transaction(async (manager) => {
      await this.transitions.markSent(manager, id, providerMessageId);
      await manager.insert(DeliveryAttempt, attempt(AttemptOutcome.Success));
    });
  }

  /** Records the failed attempt and its transition, then fails the job. */
  private async recordFailure(
    job: Job<SendJobData>,
    id: number,
    attemptNo: number,
    failure: ClassifiedFailure,
    row: (failure: ClassifiedFailure) => Partial<DeliveryAttempt>,
  ): Promise<never> {
    const action = decideFailure(
      failure,
      job.attemptsMade ?? 0,
      job.opts?.attempts ?? 1,
    );
    const to = {
      [FailureAction.Retry]: NotificationStatus.Retrying,
      [FailureAction.Dead]: NotificationStatus.Dead,
      [FailureAction.Fail]: NotificationStatus.Failed,
    } as const;

    const moved = await this.dataSource.transaction(async (manager) => {
      const changed = await this.transitions.markFailed(
        manager,
        id,
        attemptNo,
        to[action],
        failure.code,
      );
      await manager.insert(DeliveryAttempt, row(failure));
      return changed;
    });

    if (action === FailureAction.Retry) {
      throw new ProviderError(failure.code, true, failure.message);
    }
    if (action === FailureAction.Dead && moved) {
      await this.moveToDlq(job, id, failure.code);
    }
    throw new UnrecoverableError(`${failure.code}: ${failure.message}`);
  }

  // The DEAD status in MySQL is the record that counts; the DLQ job is for
  // operators and dashboards. If adding it fails, redrive still finds the
  // notification by its status.
  private async moveToDlq(
    job: Job<SendJobData>,
    id: number,
    errorCode: string,
  ): Promise<void> {
    try {
      await this.dlq.add(
        DLQ_JOB,
        { notificationId: id, sourceQueue: job.queueName, errorCode },
        { jobId: jobIdFor(id) },
      );
    } catch (error) {
      this.logger.warn(
        `Notification ${id} is DEAD but not in the DLQ: ${(error as Error).message}`,
      );
    }
  }
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
