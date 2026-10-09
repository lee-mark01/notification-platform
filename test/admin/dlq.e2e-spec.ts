import { INestApplication } from '@nestjs/common';
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
import { jobIdFor, QueueNames } from '../../src/queue/queue.constants';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { waitFor } from '../support/wait';

const ADMIN_KEY = process.env.ADMIN_API_KEY as string;

describe('DLQ admin API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let fake: FakeProvider;
  let apiKey: string;
  let client: ApiClient;
  let template: Template;

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
    ({ client, apiKey } = await seedClient(dataSource));
    template = await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const admin = () => ({ 'X-Admin-Key': ADMIN_KEY });

  const status = async (id: number) =>
    (await dataSource.getRepository(Notification).findOneByOrFail({ id }))
      .status;

  const settled = (id: number, want: NotificationStatus) =>
    waitFor(async () => ((await status(id)) === want ? true : undefined)).catch(
      async (error: unknown) => {
        // Context for intermittent CI failures.
        const row = await dataSource
          .getRepository(Notification)
          .findOneByOrFail({ id });
        const job = await getQueue(app, QueueNames.EmailTransactional).getJob(
          jobIdFor(id),
        );
        console.error('settled timeout', {
          id,
          want,
          status: row.status,
          attemptCount: row.attemptCount,
          lastErrorCode: row.lastErrorCode,
          jobState: job ? await job.getState() : 'no job',
          jobAttemptsMade: job?.attemptsMade,
          jobFailedReason: job?.failedReason,
        });
        throw error;
      },
    );

  // Accepts a notification whose five attempts all fail, so it ends DEAD.
  const deadNotification = async (): Promise<number> => {
    fake.script(
      ...Array.from({ length: 5 }, () => ({
        kind: 'transient' as const,
        code: 'PROVIDER_5XX',
      })),
    );
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'email',
        category: 'transactional',
        templateKey: 'email-verification',
        recipient: { email: 'someone@example.com' },
        variables: { code: '381920' },
      })
      .expect(202);
    const id = (res.body as { id: number }).id;
    await settled(id, NotificationStatus.Dead);
    return id;
  };

  const insertDead = async (): Promise<number> =>
    (
      await dataSource.getRepository(Notification).save({
        clientId: client.id,
        userId: null,
        templateId: template.id,
        templateVersion: 1,
        channel: TemplateChannel.Email,
        category: NotificationCategory.Transactional,
        status: NotificationStatus.Dead,
        recipientEmail: 'someone@example.com',
        variables: {},
        renderedTitle: 't',
        renderedBody: 'b',
        renderedText: null,
        attemptCount: 5,
        lastErrorCode: 'PROVIDER_5XX',
      })
    ).id;

  it('scenario 5: redrives a DEAD notification until it is SENT', async () => {
    const id = await deadNotification();
    await waitFor(() => getQueue(app, QueueNames.Dlq).getJob(jobIdFor(id)));
    // Redrive comes later in practice; wait until BullMQ has finished the
    // failed job so it can be replaced.
    await waitFor(async () => {
      const job = await getQueue(app, QueueNames.EmailTransactional).getJob(
        jobIdFor(id),
      );
      return (await job?.getState()) === 'failed' ? true : undefined;
    });

    const list = await request(app.getHttpServer())
      .get('/admin/dlq')
      .set(admin())
      .expect(200);
    expect(list.body).toEqual({
      items: [
        expect.objectContaining({
          id,
          templateKey: 'email-verification',
          attemptCount: 5,
          lastErrorCode: 'PROVIDER_5XX',
        }),
      ],
      nextCursor: null,
    });

    // The provider has recovered: the fake has no failures left.
    const res = await request(app.getHttpServer())
      .post('/admin/dlq/redrive')
      .set(admin())
      .send({ notificationIds: [id] })
      .expect(200);
    expect(res.body).toEqual({ redriven: 1, skipped: [] });

    await settled(id, NotificationStatus.Sent);
    const attempts = await dataSource
      .getRepository(DeliveryAttempt)
      .find({ where: { notificationId: id }, order: { attemptNo: 'ASC' } });
    // Attempt numbers keep growing across the redrive.
    expect(attempts.map((a) => [a.attemptNo, a.outcome])).toEqual([
      [1, 'TRANSIENT_ERROR'],
      [2, 'TRANSIENT_ERROR'],
      [3, 'TRANSIENT_ERROR'],
      [4, 'TRANSIENT_ERROR'],
      [5, 'TRANSIENT_ERROR'],
      [6, 'SUCCESS'],
    ]);
    expect(fake.sent).toHaveLength(1);
    expect(
      await getQueue(app, QueueNames.Dlq).getJob(jobIdFor(id)),
    ).toBeUndefined();
  });

  it('skips ids that are not DEAD, so a repeated redrive queues once', async () => {
    const id = await insertDead();

    const [first, second] = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/admin/dlq/redrive')
          .set(admin())
          .send({ notificationIds: [id, 999_999] }),
      ),
    );

    const bodies = [first.body, second.body] as {
      redriven: number;
      skipped: number[];
    }[];
    expect(bodies.map((b) => b.redriven).sort()).toEqual([0, 1]);
    expect(bodies.every((b) => b.skipped.includes(999_999))).toBe(true);
    await settled(id, NotificationStatus.Sent);
    expect(fake.sent).toHaveLength(1);
  });

  it('pages through DEAD notifications with a cursor', async () => {
    const ids = [await insertDead(), await insertDead(), await insertDead()];

    const first = await request(app.getHttpServer())
      .get('/admin/dlq?limit=2')
      .set(admin())
      .expect(200);
    const page1 = first.body as { items: { id: number }[]; nextCursor: string };
    expect(page1.items.map((i) => i.id)).toEqual(ids.slice(0, 2));

    const second = await request(app.getHttpServer())
      .get(`/admin/dlq?limit=2&cursor=${page1.nextCursor}`)
      .set(admin())
      .expect(200);
    expect(second.body).toEqual({
      items: [expect.objectContaining({ id: ids[2] })],
      nextCursor: null,
    });
  });

  it('rejects an empty or oversized redrive request', async () => {
    for (const notificationIds of [
      [],
      Array.from({ length: 101 }, (_, i) => i + 1),
    ]) {
      await request(app.getHttpServer())
        .post('/admin/dlq/redrive')
        .set(admin())
        .send({ notificationIds })
        .expect(400);
    }
  });

  it.each([
    ['no key', {}],
    ['a wrong key', { 'X-Admin-Key': 'wrong-key' }],
  ])('rejects %s with 401', async (_label, headers) => {
    const res = await request(app.getHttpServer())
      .get('/admin/dlq')
      .set(headers)
      .expect(401);
    expect(res.headers['www-authenticate']).toBe(
      'AdminKey header="X-Admin-Key"',
    );
  });
});
