import { INestApplication } from '@nestjs/common';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ApiClient } from '../../src/clients/api-client.entity';
import { DeliveryAttempt } from '../../src/notifications/delivery-attempt.entity';
import { Notification } from '../../src/notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../src/notifications/notification.enums';
import { FakeProvider } from '../../src/providers/fake/fake.provider';
import { NotificationTransitions } from '../../src/queue/notification-transitions';
import {
  jobIdFor,
  QueueNames,
  SEND_JOB,
  type SendJobData,
} from '../../src/queue/queue.constants';
import { SendProcessor } from '../../src/queue/send.processor';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import {
  seedClient,
  seedEmailTemplate,
  seedPushTemplate,
  seedUser,
} from '../support/seed';
import { waitFor } from '../support/wait';

describe('Send workers (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let fake: FakeProvider;
  let apiKey: string;
  let client: ApiClient;
  let template: Template;
  let userId: number;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({ env: { WORKERS_ENABLED: 'true' } });
    await waitForQueues(app);
    dataSource = app.get(DataSource);
    fake = app.get(FakeProvider);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    await resetQueues(app);
    fake.reset();
    fake.latencyMs = 0;
    ({ client, apiKey } = await seedClient(dataSource));
    userId = (await seedUser(dataSource)).id;
    template = await seedEmailTemplate(dataSource);
    await seedPushTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const emailRequest = {
    channel: 'email',
    category: 'transactional',
    templateKey: 'email-verification',
    recipient: { email: 'someone@example.com' },
    variables: { code: '381920' },
  };

  const accept = async (body: object = emailRequest): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(202);
    return (res.body as { id: number }).id;
  };

  const notification = (id: number) =>
    dataSource.getRepository(Notification).findOneByOrFail({ id });

  const attempts = (id: number) =>
    dataSource
      .getRepository(DeliveryAttempt)
      .find({ where: { notificationId: id }, order: { attemptNo: 'ASC' } });

  const settled = (id: number, status: NotificationStatus) =>
    waitFor(async () => {
      const row = await notification(id);
      return row.status === status ? row : undefined;
    });

  const finishedState = (jobId: string) =>
    waitFor(async () => {
      const job = await getQueue(app, QueueNames.EmailTransactional).getJob(
        jobId,
      );
      const state = await job?.getState();
      return state === 'completed' || state === 'failed' ? state : undefined;
    });

  // A notification row with no job, for driving the processor directly.
  const insertNotification = async (
    overrides: Partial<Notification> = {},
  ): Promise<number> => {
    const saved = await dataSource.getRepository(Notification).save({
      clientId: client.id,
      userId: null,
      templateId: template.id,
      templateVersion: 1,
      channel: TemplateChannel.Email,
      category: NotificationCategory.Transactional,
      status: NotificationStatus.Queued,
      recipientEmail: 'someone@example.com',
      variables: {},
      renderedTitle: 'Your code 1',
      renderedBody: '<p>1</p>',
      renderedText: '1',
      ...overrides,
    });
    return saved.id;
  };

  describe('success', () => {
    it('sends an email and records SENT with one attempt', async () => {
      const id = await accept();

      const row = await settled(id, NotificationStatus.Sent);
      expect(row.providerMessageId).toMatch(/^fake-/);
      expect(row.sentAt).toBeInstanceOf(Date);
      expect(row.leaseUntil).toBeNull();
      expect(row.attemptCount).toBe(1);

      expect(await attempts(id)).toEqual([
        expect.objectContaining({
          attemptNo: 1,
          provider: 'fake',
          outcome: 'SUCCESS',
          errorCode: null,
        }),
      ]);
      expect(fake.sent).toEqual([
        {
          channel: 'email',
          notificationId: id,
          to: 'someone@example.com',
          subject: 'Your code 381920',
          html: '<p>Code: 381920</p>',
          text: 'Code: 381920',
        },
      ]);
      expect(await finishedState(jobIdFor(id))).toBe('completed');
    });

    it('sends a push to the user with its data payload', async () => {
      const id = await accept({
        channel: 'push',
        category: 'marketing',
        templateKey: 'chat-new-message',
        recipient: { userId },
        variables: { sender: 'Kim', preview: 'hello' },
      });

      await settled(id, NotificationStatus.Sent);
      expect(fake.sent).toEqual([
        {
          channel: 'push',
          notificationId: id,
          userId,
          title: 'Kim',
          body: 'Kim: hello',
          data: { screen: 'chat' },
        },
      ]);
    });
  });

  describe('running the same notification twice', () => {
    it('does not send again when a second job arrives after SENT', async () => {
      const id = await accept();
      await settled(id, NotificationStatus.Sent);

      // A different job id, as if the first job had been removed and the
      // sweeper added the notification again.
      const againId = `${jobIdFor(id)}-again`;
      await getQueue(app, QueueNames.EmailTransactional).add(
        SEND_JOB,
        { notificationId: id },
        { jobId: againId },
      );

      expect(await finishedState(againId)).toBe('completed');
      expect(fake.sent).toHaveLength(1);
      expect(await attempts(id)).toHaveLength(1);
    });

    it('sends once when two workers process it at the same time', async () => {
      const id = await insertNotification();
      const processor = app.get(SendProcessor);
      fake.latencyMs = 100;

      const results = await Promise.allSettled([
        processor.process(jobFor(id)),
        processor.process(jobFor(id)),
      ]);

      // The loser sees a live lease and fails its job so a retry can check
      // again later; it never reaches the provider.
      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(fake.sent).toHaveLength(1);
      expect((await notification(id)).status).toBe(NotificationStatus.Sent);
      expect(await attempts(id)).toHaveLength(1);
    });
  });

  describe('lease', () => {
    it('re-claims a notification whose lease expired (worker died)', async () => {
      const id = await insertNotification({
        status: NotificationStatus.Sending,
        attemptCount: 1,
        leaseUntil: new Date(Date.now() - 1_000),
      });

      await app.get(SendProcessor).process(jobFor(id));

      const row = await notification(id);
      expect(row.status).toBe(NotificationStatus.Sent);
      expect(row.attemptCount).toBe(2);
      expect((await attempts(id)).map((a) => a.attemptNo)).toEqual([2]);
    });

    it('does not let a worker that lost its lease record a failure', async () => {
      const id = await insertNotification();
      const transitions = app.get(NotificationTransitions);

      const stale = await transitions.claim(id);
      await dataSource
        .getRepository(Notification)
        .update(id, { leaseUntil: new Date(Date.now() - 1_000) });
      const current = await transitions.claim(id);
      expect([stale, current]).toEqual([1, 2]);

      const staleFailed = await dataSource.transaction((manager) =>
        transitions.markFailed(
          manager,
          id,
          1,
          NotificationStatus.Failed,
          'STALE',
        ),
      );
      expect(staleFailed).toBe(false);
      expect((await notification(id)).status).toBe(NotificationStatus.Sending);
    });
  });

  describe('failure', () => {
    it('moves a transient failure with attempts left to RETRYING', async () => {
      const id = await insertNotification();
      fake.script({ kind: 'transient', code: 'THROTTLED' });

      await expect(
        app.get(SendProcessor).process(jobFor(id, { attempts: 5 })),
      ).rejects.toMatchObject({ code: 'THROTTLED' });

      const row = await notification(id);
      expect(row.status).toBe(NotificationStatus.Retrying);
      expect(row.lastErrorCode).toBe('THROTTLED');
      expect(row.leaseUntil).toBeNull();
    });

    it('scenario 3: succeeds after three 5xx with four attempts recorded', async () => {
      fake.script(
        { kind: 'transient', code: 'PROVIDER_5XX' },
        { kind: 'transient', code: 'PROVIDER_5XX' },
        { kind: 'transient', code: 'PROVIDER_5XX' },
      );
      const id = await accept();

      const row = await settled(id, NotificationStatus.Sent);
      expect(row.attemptCount).toBe(4);
      expect(row.lastErrorCode).toBeNull();
      expect(
        (await attempts(id)).map((a) => [a.attemptNo, a.outcome, a.errorCode]),
      ).toEqual([
        [1, 'TRANSIENT_ERROR', 'PROVIDER_5XX'],
        [2, 'TRANSIENT_ERROR', 'PROVIDER_5XX'],
        [3, 'TRANSIENT_ERROR', 'PROVIDER_5XX'],
        [4, 'SUCCESS', null],
      ]);
      expect(fake.sent).toHaveLength(1);
      expect(await finishedState(jobIdFor(id))).toBe('completed');
    });

    it('scenario 5: goes DEAD and into the DLQ after the last attempt', async () => {
      fake.script(
        ...Array.from({ length: 5 }, () => ({
          kind: 'transient' as const,
          code: 'PROVIDER_5XX',
        })),
      );
      const id = await accept();

      const row = await settled(id, NotificationStatus.Dead);
      expect(row.attemptCount).toBe(5);
      expect(row.lastErrorCode).toBe('PROVIDER_5XX');
      expect(await attempts(id)).toHaveLength(5);
      expect(fake.sent).toHaveLength(0);
      expect(await finishedState(jobIdFor(id))).toBe('failed');

      const dead = await waitFor(() =>
        getQueue(app, QueueNames.Dlq).getJob(jobIdFor(id)),
      );
      expect(dead.data).toEqual({
        notificationId: id,
        sourceQueue: 'email-transactional',
        errorCode: 'PROVIDER_5XX',
      });
    });

    it('moves a permanent error to FAILED without retrying', async () => {
      fake.script({ kind: 'permanent', code: 'INVALID_ADDRESS' });
      const id = await accept();

      const row = await settled(id, NotificationStatus.Failed);
      expect(row.lastErrorCode).toBe('INVALID_ADDRESS');
      expect(await attempts(id)).toEqual([
        expect.objectContaining({
          outcome: 'PERMANENT_ERROR',
          errorCode: 'INVALID_ADDRESS',
        }),
      ]);
      expect(fake.sent).toHaveLength(0);
      expect(await finishedState(jobIdFor(id))).toBe('failed');
    });
  });
});

function jobFor(
  notificationId: number,
  opts: { attempts?: number } = {},
): Job<SendJobData> {
  return {
    data: { notificationId },
    opts,
    attemptsMade: 0,
    queueName: QueueNames.EmailTransactional,
  } as unknown as Job<SendJobData>;
}
