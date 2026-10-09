import {
  BeforeApplicationShutdown,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { ApiClient } from '../clients/api-client.entity';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { requestHash } from '../common/idempotency/request-hash';
import { ProblemTypes } from '../common/problem/problem-types';
import {
  type FieldError,
  ProblemException,
} from '../common/problem/problem.exception';
import { Dispatcher } from '../dispatch/dispatcher.service';
import { Notification } from '../notifications/notification.entity';
import { NotificationStatus } from '../notifications/notification.enums';
import {
  parseIdempotencyKey,
  templateUnusable,
} from '../notifications/notifications.service';
import {
  MAX_TITLE_LENGTH,
  renderedFields,
} from '../notifications/rendered-fields';
import { missingVariables } from '../templates/rendering/template-renderer';
import { Template, TemplateChannel } from '../templates/template.entity';
import { TemplatesService } from '../templates/templates.service';
import { AppUser } from '../users/app-user.entity';
import { AcceptedBatchResponse, BatchResponse } from './dto/batch.response';
import { BatchRecipientDto, CreateBatchDto } from './dto/create-batch.dto';
import { BatchStatus, NotificationBatch } from './notification-batch.entity';

// Rows per multi-row INSERT and per addBulk(). Large enough to cut round
// trips, small enough to keep each statement and Redis call short.
export const BATCH_CHUNK = 500;
const USER_LOOKUP_CHUNK = 1_000;
// A 10,000-recipient batch with one mistake per recipient would otherwise
// produce a 10,000-entry error body.
const MAX_REPORTED_ERRORS = 100;

export interface AcceptBatchResult {
  status: number;
  body: AcceptedBatchResponse;
  replayed: boolean;
}

type BatchRow = Pick<
  Notification,
  | 'clientId'
  | 'userId'
  | 'templateId'
  | 'templateVersion'
  | 'channel'
  | 'category'
  | 'status'
  | 'recipientEmail'
  | 'variables'
  | 'renderedTitle'
  | 'renderedBody'
  | 'renderedText'
  | 'renderedData'
>;

/**
 * Bulk intake (Phase 5). Same contract as a single notification, applied to
 * many recipients at once:
 *
 * 1. Validate and render every recipient first; one bad recipient rejects
 *    the whole batch, so one Idempotency-Key always means one whole batch.
 * 2. One transaction: the batch row, the notifications in multi-row INSERTs,
 *    and the stored idempotent response.
 * 3. After commit and after answering 202, put the notifications on the
 *    queue in chunks. If that stops part way (Redis down, process killed),
 *    the rows stay PENDING and the sweeper resumes the batch (ADR-0003).
 */
@Injectable()
export class BatchesService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BatchesService.name);
  private readonly running = new Set<Promise<void>>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(NotificationBatch)
    private readonly batches: Repository<NotificationBatch>,
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    private readonly templates: TemplatesService,
    private readonly idempotency: IdempotencyService,
    private readonly dispatcher: Dispatcher,
  ) {}

  async accept(
    client: ApiClient,
    idempotencyKeyHeader: string | undefined,
    dto: CreateBatchDto,
    correlationId?: string,
  ): Promise<AcceptBatchResult> {
    const idemKey = parseIdempotencyKey(idempotencyKeyHeader);
    const begun = await this.idempotency.begin(
      client.id,
      idemKey,
      requestHash(dto),
    );
    if (begun.kind === 'replay') {
      return {
        status: begun.status,
        body: begun.body as unknown as AcceptedBatchResponse,
        replayed: true,
      };
    }

    let body: AcceptedBatchResponse;
    try {
      const { template, rows } = await this.prepare(client, dto);
      body = await this.dataSource.transaction(async (manager) => {
        const batch = await manager.save(NotificationBatch, {
          clientId: client.id,
          templateId: template.id,
          channel: dto.channel,
          category: dto.category,
          totalCount: rows.length,
          status: BatchStatus.Accepted,
        });
        for (let i = 0; i < rows.length; i += BATCH_CHUNK) {
          // updateEntity(false): TypeORM would otherwise derive each row's id
          // from the first insert id, assuming the ids are consecutive, which
          // innodb_autoinc_lock_mode=2 does not promise. Ids are read back by
          // batch_id when enqueuing instead.
          await manager
            .createQueryBuilder()
            .insert()
            .into(Notification)
            .values(
              rows
                .slice(i, i + BATCH_CHUNK)
                .map((row) => ({ ...row, batchId: batch.id })),
            )
            .updateEntity(false)
            .execute();
        }
        const accepted = { batchId: batch.id, totalCount: rows.length };
        await this.idempotency.complete(
          manager,
          begun.recordId,
          begun.lockToken,
          { status: HttpStatus.ACCEPTED, body: { ...accepted } },
        );
        return accepted;
      });
    } catch (error) {
      await this.idempotency.abandon(begun.recordId, begun.lockToken);
      throw error;
    }

    this.enqueueInBackground(body.batchId, correlationId);
    return { status: HttpStatus.ACCEPTED, body, replayed: false };
  }

  async get(client: ApiClient, id: number): Promise<BatchResponse> {
    const batch = await this.batches.findOneBy({ id, clientId: client.id });
    if (!batch) {
      throw new ProblemException(
        ProblemTypes.RESOURCE_NOT_FOUND,
        `Batch ${id} was not found.`,
      );
    }
    const counts = await this.notifications
      .createQueryBuilder('n')
      .select('n.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('n.batch_id = :id', { id })
      .groupBy('n.status')
      .getRawMany<{ status: string; count: string }>();
    return {
      id: batch.id,
      status: batch.status,
      channel: batch.channel,
      category: batch.category,
      totalCount: batch.totalCount,
      byStatus: Object.fromEntries(
        counts.map((c) => [c.status, Number(c.count)]),
      ),
      createdAt: batch.createdAt,
    };
  }

  /**
   * Puts the batch's PENDING notifications on the queue, BATCH_CHUNK at a
   * time, in id order. Safe to run again or alongside another run: rows
   * already QUEUED are skipped, an existing job id is not added twice, and the
   * worker's conditional claim stops a second send. Returns false if it
   * stopped early; the batch stays ENQUEUING for the sweeper.
   */
  async enqueue(batchId: number, correlationId?: string): Promise<boolean> {
    await this.touch(batchId, [BatchStatus.Accepted, BatchStatus.Enqueuing]);
    let afterId = 0;
    for (;;) {
      const chunk = await this.notifications.find({
        select: { id: true, channel: true, category: true },
        where: {
          batchId,
          status: NotificationStatus.Pending,
          id: MoreThan(afterId),
        },
        order: { id: 'ASC' },
        take: BATCH_CHUNK,
      });
      if (chunk.length === 0) break;
      if (!(await this.dispatcher.dispatchMany(chunk, correlationId))) {
        return false;
      }
      afterId = chunk[chunk.length - 1].id;
      // Keeps updated_at fresh so the sweeper does not resume a batch that
      // is still making progress.
      await this.touch(batchId, [BatchStatus.Enqueuing]);
    }
    await this.batches.update(
      { id: batchId, status: BatchStatus.Enqueuing },
      { status: BatchStatus.Enqueued },
    );
    return true;
  }

  async beforeApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.running]);
  }

  // Not awaited by the request: 10,000 jobs take a while to add, and the
  // client only needs to know the batch is stored. Shutdown waits for it.
  private enqueueInBackground(batchId: number, correlationId?: string): void {
    const run = this.enqueue(batchId, correlationId)
      .then((done) => {
        if (!done) {
          this.logger.warn(`Batch ${batchId} left for the sweeper`);
        }
      })
      .catch((error: Error) =>
        this.logger.warn(`Batch ${batchId} enqueue failed: ${error.message}`),
      )
      .finally(() => this.running.delete(run));
    this.running.add(run);
  }

  // Sets the status and updated_at even when the status does not change;
  // MySQL's ON UPDATE only fires when some value changes.
  private async touch(batchId: number, from: BatchStatus[]): Promise<void> {
    await this.batches.update(
      { id: batchId, status: In(from) },
      {
        status: BatchStatus.Enqueuing,
        updatedAt: () => 'CURRENT_TIMESTAMP(3)',
      },
    );
  }

  private async prepare(
    client: ApiClient,
    dto: CreateBatchDto,
  ): Promise<{ template: Template; rows: BatchRow[] }> {
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

    const shapeErrors = errorsOf(dto.recipients, (r) => recipientShape(dto, r));
    if (shapeErrors.length > 0) {
      throw new ProblemException(
        ProblemTypes.VALIDATION_FAILED,
        'One or more recipients are invalid.',
        { errors: shapeErrors },
      );
    }

    const users = await this.loadUsers(dto.recipients);
    const rows: BatchRow[] = [];
    const errors = errorsOf(dto.recipients, (recipient) => {
      const variables = recipient.variables ?? {};
      let userId: number | null = null;
      let email = recipient.email ?? null;
      if (recipient.userId !== undefined) {
        const user = users.get(recipient.userId);
        if (!user) return { field: 'userId', message: 'user not found' };
        userId = user.id;
        email = recipient.email ?? user.email;
      }
      const missing = missingVariables(template, variables);
      if (missing.length > 0) {
        return {
          field: 'variables',
          message: `missing required variables: ${missing.join(', ')}`,
        };
      }
      const fields = renderedFields(template, variables);
      if (!fields) {
        return {
          field: 'variables',
          message: `rendered title exceeds ${MAX_TITLE_LENGTH} characters`,
        };
      }
      rows.push({
        clientId: client.id,
        userId,
        templateId: template.id,
        templateVersion: template.version,
        channel: dto.channel,
        category: dto.category,
        status: NotificationStatus.Pending,
        recipientEmail: dto.channel === TemplateChannel.Email ? email : null,
        variables,
        ...fields,
      });
      return null;
    });
    if (errors.length > 0) {
      throw new ProblemException(
        ProblemTypes.RECIPIENT_UNUSABLE,
        'One or more recipients cannot be used; nothing was accepted.',
        { errors },
      );
    }
    return { template, rows };
  }

  private async loadUsers(
    recipients: BatchRecipientDto[],
  ): Promise<Map<number, AppUser>> {
    const ids = [
      ...new Set(
        recipients
          .map((r) => r.userId)
          .filter((id): id is number => id !== undefined),
      ),
    ];
    const found = new Map<number, AppUser>();
    for (let i = 0; i < ids.length; i += USER_LOOKUP_CHUNK) {
      const users = await this.users.find({
        select: { id: true, email: true },
        where: { id: In(ids.slice(i, i + USER_LOOKUP_CHUNK)) },
      });
      for (const user of users) found.set(user.id, user);
    }
    return found;
  }
}

// Same rules as a single notification's recipient.
function recipientShape(
  dto: CreateBatchDto,
  recipient: BatchRecipientDto,
): FieldError | null {
  if (dto.channel === TemplateChannel.Push && recipient.userId === undefined) {
    return { field: 'userId', message: 'userId is required for push' };
  }
  if (
    dto.channel === TemplateChannel.Email &&
    !recipient.email &&
    recipient.userId === undefined
  ) {
    return { field: '', message: 'email or userId is required for email' };
  }
  return null;
}

// Runs check on every recipient and reports the first MAX_REPORTED_ERRORS
// problems with their index, e.g. recipients[3].userId.
function errorsOf(
  recipients: BatchRecipientDto[],
  check: (recipient: BatchRecipientDto) => FieldError | null,
): FieldError[] {
  const errors: FieldError[] = [];
  recipients.forEach((recipient, index) => {
    const error = check(recipient);
    if (error && errors.length < MAX_REPORTED_ERRORS) {
      const at = `recipients[${index}]`;
      errors.push({
        field: error.field ? `${at}.${error.field}` : at,
        message: error.message,
      });
    }
  });
  return errors;
}
