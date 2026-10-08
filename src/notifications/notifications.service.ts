import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ApiClient } from '../clients/api-client.entity';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { requestHash } from '../common/idempotency/request-hash';
import { ProblemTypes } from '../common/problem/problem-types';
import {
  type FieldError,
  ProblemException,
} from '../common/problem/problem.exception';
import {
  missingVariables,
  renderTemplate,
} from '../templates/rendering/template-renderer';
import { Template, TemplateChannel } from '../templates/template.entity';
import { TemplatesService } from '../templates/templates.service';
import { AppUser } from '../users/app-user.entity';
import { DeliveryAttempt } from './delivery-attempt.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import {
  AcceptedNotificationResponse,
  NotificationResponse,
} from './dto/notification.response';
import { Notification } from './notification.entity';
import { NotificationStatus } from './notification.enums';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_TITLE_LENGTH = 255;

export interface AcceptResult {
  status: number;
  body: AcceptedNotificationResponse;
  replayed: boolean;
}

type PreparedNotification = Omit<
  Notification,
  | 'id'
  | 'client'
  | 'user'
  | 'template'
  | 'createdAt'
  | 'updatedAt'
  | 'attemptCount'
>;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(DeliveryAttempt)
    private readonly attempts: Repository<DeliveryAttempt>,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    private readonly templates: TemplatesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Accepts a send request. The idempotency key is taken first, so a replay
   * returns the stored response even if the template changed since. Only a
   * successful acceptance is remembered: if preparing or saving fails, the key
   * is released and the client may retry with the same key.
   */
  async accept(
    client: ApiClient,
    idempotencyKeyHeader: string | undefined,
    dto: CreateNotificationDto,
  ): Promise<AcceptResult> {
    const idemKey = parseIdempotencyKey(idempotencyKeyHeader);
    const begun = await this.idempotency.begin(
      client.id,
      idemKey,
      requestHash(dto),
    );
    if (begun.kind === 'replay') {
      return {
        status: begun.status,
        body: begun.body as unknown as AcceptedNotificationResponse,
        replayed: true,
      };
    }

    try {
      const prepared = await this.prepare(client, dto);
      const notification = await this.dataSource.transaction(
        async (manager) => {
          const saved = await manager.save(Notification, prepared);
          await this.idempotency.complete(manager, begun.recordId, {
            status: HttpStatus.ACCEPTED,
            body: { id: saved.id },
            notificationId: saved.id,
          });
          return saved;
        },
      );
      return {
        status: HttpStatus.ACCEPTED,
        body: { id: notification.id },
        replayed: false,
      };
    } catch (error) {
      await this.idempotency.abandon(begun.recordId);
      throw error;
    }
  }

  async get(client: ApiClient, id: number): Promise<NotificationResponse> {
    // Other clients' notifications are reported as missing, not forbidden,
    // so sequential ids reveal nothing.
    const notification = await this.notifications.findOne({
      where: { id, clientId: client.id },
      relations: { template: true },
      withDeleted: true,
    });
    if (!notification) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `Notification ${id} was not found.`,
      );
    }
    const attempts = await this.attempts.find({
      where: { notificationId: id },
      order: { attemptNo: 'ASC' },
    });
    return NotificationResponse.from(
      notification,
      notification.template?.key ?? '',
      attempts,
    );
  }

  // Resolves the template and recipient and renders the content, so the stored
  // notification is exactly what will be sent.
  private async prepare(
    client: ApiClient,
    dto: CreateNotificationDto,
  ): Promise<PreparedNotification> {
    const template = await this.usableTemplate(dto);
    const variables = dto.variables ?? {};
    const recipient = await this.resolveRecipient(dto);

    const rendered = renderTemplate(template, variables);
    const title =
      rendered.channel === TemplateChannel.Email
        ? rendered.subject
        : rendered.title;
    if (title.length > MAX_TITLE_LENGTH) {
      throw templateUnusable([
        {
          field: 'variables',
          message: `rendered title exceeds ${MAX_TITLE_LENGTH} characters`,
        },
      ]);
    }

    return {
      clientId: client.id,
      batchId: null,
      userId: recipient.userId,
      templateId: template.id,
      templateVersion: template.version,
      channel: dto.channel,
      category: dto.category,
      status: NotificationStatus.Pending,
      recipientEmail: recipient.email,
      variables,
      renderedTitle: title,
      renderedBody:
        rendered.channel === TemplateChannel.Email
          ? rendered.html
          : rendered.body,
      renderedText:
        rendered.channel === TemplateChannel.Email ? rendered.text : null,
      renderedData:
        rendered.channel === TemplateChannel.Push ? rendered.data : null,
      leaseUntil: null,
      providerMessageId: null,
      lastErrorCode: null,
      queuedAt: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
    };
  }

  private async usableTemplate(dto: CreateNotificationDto): Promise<Template> {
    const template = await this.templates.findActiveByKey(dto.templateKey);
    if (!template) {
      throw templateUnusable([
        { field: 'templateKey', message: 'template not found or deleted' },
      ]);
    }
    if (template.channel !== dto.channel) {
      throw templateUnusable([
        {
          field: 'channel',
          message: `template "${template.key}" is a ${template.channel} template`,
        },
      ]);
    }
    const missing = missingVariables(template, dto.variables ?? {});
    if (missing.length > 0) {
      throw templateUnusable([
        {
          field: 'variables',
          message: `missing required variables: ${missing.join(', ')}`,
        },
      ]);
    }
    return template;
  }

  private async resolveRecipient(
    dto: CreateNotificationDto,
  ): Promise<{ userId: number | null; email: string | null }> {
    const { userId, email } = dto.recipient;

    if (dto.channel === TemplateChannel.Push && userId === undefined) {
      throw validationFailed('recipient.userId', 'userId is required for push');
    }
    if (
      dto.channel === TemplateChannel.Email &&
      !email &&
      userId === undefined
    ) {
      throw validationFailed(
        'recipient',
        'email or userId is required for email',
      );
    }

    if (userId === undefined) return { userId: null, email: email ?? null };

    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      throw new ProblemException(
        ProblemTypes.RECIPIENT_UNUSABLE,
        `User ${userId} does not exist.`,
        { errors: [{ field: 'recipient.userId', message: 'user not found' }] },
      );
    }
    const recipientEmail =
      dto.channel === TemplateChannel.Email ? (email ?? user.email) : null;
    return { userId: user.id, email: recipientEmail };
  }
}

export function parseIdempotencyKey(header: string | undefined): string {
  if (header === undefined || header.length === 0) {
    throw new ProblemException(
      ProblemTypes.IDEMPOTENCY_KEY_MISSING,
      'Send a unique Idempotency-Key header with each new request.',
    );
  }
  if (
    header.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !/^[\x21-\x7e]+$/.test(header)
  ) {
    throw validationFailed(
      'Idempotency-Key',
      `must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} printable ASCII characters`,
    );
  }
  return header;
}

function templateUnusable(errors: FieldError[]): ProblemException {
  return new ProblemException(
    ProblemTypes.TEMPLATE_UNUSABLE,
    'The template cannot be used with this request.',
    { errors },
  );
}

function validationFailed(field: string, message: string): ProblemException {
  return new ProblemException(
    ProblemTypes.VALIDATION_FAILED,
    'One or more fields are invalid.',
    { errors: [{ field, message }] },
  );
}
