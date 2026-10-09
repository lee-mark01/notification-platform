import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  BatchStatus,
  NotificationBatch,
} from '../../src/batches/notification-batch.entity';
import { ApiClient } from '../../src/clients/api-client.entity';
import { Notification } from '../../src/notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../src/notifications/notification.enums';
import { jobIdFor, QueueNames } from '../../src/queue/queue.constants';
import { Sweeper } from '../../src/sweeper/sweeper.service';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues } from '../support/queues';
import {
  seedClient,
  seedEmailTemplate,
  seedPushTemplate,
  seedUser,
} from '../support/seed';
import { waitFor } from '../support/wait';

const PROBLEM_JSON = /^application\/problem\+json/;

describe('Notification batches (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let apiKey: string;
  let client: ApiClient;
  let email: Template;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    await resetQueues(app);
    ({ client, apiKey } = await seedClient(dataSource));
    email = await seedEmailTemplate(dataSource);
    await seedPushTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const emailBatch = (count: number) => ({
    channel: 'email',
    category: 'marketing',
    templateKey: 'email-verification',
    recipients: Array.from({ length: count }, (_, i) => ({
      email: `r${i}@example.com`,
      variables: { code: String(i) },
    })),
  });

  const post = (body: object, key = randomUUID()) =>
    request(app.getHttpServer())
      .post('/notification-batches')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', key)
      .send(body);

  const get = (id: number, key = apiKey) =>
    request(app.getHttpServer())
      .get(`/notification-batches/${id}`)
      .set('X-API-Key', key);

  const batchStatus = async (id: number) =>
    (await dataSource.getRepository(NotificationBatch).findOneByOrFail({ id }))
      .status;

  const enqueued = (id: number) =>
    waitFor(
      async () =>
        (await batchStatus(id)) === BatchStatus.Enqueued ? true : undefined,
      { timeoutMs: 30_000 },
    );

  const rowsOf = (batchId: number) =>
    dataSource
      .getRepository(Notification)
      .find({ where: { batchId }, order: { id: 'ASC' } });

  describe('accepting', () => {
    it('stores one rendered notification per recipient, answers 202, then queues them', async () => {
      const user = await seedUser(dataSource, { email: 'member@example.com' });
      const res = await post({
        channel: 'email',
        category: 'marketing',
        templateKey: 'email-verification',
        recipients: [
          { email: 'a@example.com', variables: { code: '111' } },
          { userId: user.id, variables: { code: '222' } },
        ],
      }).expect(202);

      const { batchId, totalCount } = res.body as {
        batchId: number;
        totalCount: number;
      };
      expect(totalCount).toBe(2);
      expect(res.headers.location).toBe(`/notification-batches/${batchId}`);

      await enqueued(batchId);
      const rows = await rowsOf(batchId);
      expect(
        rows.map((n) => ({
          userId: n.userId,
          recipientEmail: n.recipientEmail,
          renderedTitle: n.renderedTitle,
          category: n.category,
          status: n.status,
        })),
      ).toEqual([
        {
          userId: null,
          recipientEmail: 'a@example.com',
          renderedTitle: 'Your code 111',
          category: NotificationCategory.Marketing,
          status: NotificationStatus.Queued,
        },
        {
          userId: user.id,
          recipientEmail: 'member@example.com',
          renderedTitle: 'Your code 222',
          category: NotificationCategory.Marketing,
          status: NotificationStatus.Queued,
        },
      ]);

      const queue = getQueue(app, QueueNames.EmailMarketing);
      for (const row of rows) {
        expect(await queue.getJob(jobIdFor(row.id))).toBeDefined();
      }

      const status = await get(batchId).expect(200);
      expect(status.body).toMatchObject({
        id: batchId,
        status: 'ENQUEUED',
        channel: 'email',
        category: 'marketing',
        totalCount: 2,
        byStatus: { QUEUED: 2 },
      });
    });

    it('takes 10,000 recipients: chunked inserts, every id read back and queued', async () => {
      const startedAt = Date.now();
      const res = await post(emailBatch(10_000)).expect(202);
      const acceptMs = Date.now() - startedAt;
      const { batchId } = res.body as { batchId: number };

      await enqueued(batchId);
      const rows = await rowsOf(batchId);
      expect(rows).toHaveLength(10_000);
      expect(rows.every((n) => n.status === NotificationStatus.Queued)).toBe(
        true,
      );
      const counts = await getQueue(
        app,
        QueueNames.EmailMarketing,
      ).getJobCounts('wait');
      expect(counts.wait).toBe(10_000);
      // Printed for the record; not asserted, CI machines vary.
      console.log(`10,000-recipient batch accepted in ${acceptMs} ms`);
    }, 60_000);

    it('replays the stored response for the same key and body', async () => {
      const key = randomUUID();
      const first = await post(emailBatch(3), key).expect(202);
      const again = await post(emailBatch(3), key).expect(202);

      expect(again.body).toEqual(first.body);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(await dataSource.getRepository(NotificationBatch).count()).toBe(1);
      expect(await dataSource.getRepository(Notification).count()).toBe(3);

      await post(emailBatch(4), key).expect(422);
    });
  });

  describe('rejecting', () => {
    it('accepts nothing when one recipient is unusable, and names it by index', async () => {
      const key = randomUUID();
      const body = {
        channel: 'push',
        category: 'marketing',
        templateKey: 'chat-new-message',
        recipients: [
          {
            userId: (await seedUser(dataSource)).id,
            variables: { sender: 'A', preview: 'hi' },
          },
          { userId: 999_999, variables: { sender: 'B', preview: 'hi' } },
          { userId: (await seedUser(dataSource)).id, variables: {} },
        ],
      };
      const res = await post(body, key)
        .expect(422)
        .expect('Content-Type', PROBLEM_JSON);

      expect(res.body).toMatchObject({
        type: '/problems/recipient-unusable',
        errors: [
          { field: 'recipients[1].userId', message: 'user not found' },
          {
            field: 'recipients[2].variables',
            message: 'missing required variables: sender, preview',
          },
        ],
      });
      expect(await dataSource.getRepository(NotificationBatch).count()).toBe(0);
      expect(await dataSource.getRepository(Notification).count()).toBe(0);

      // The key was released: the corrected request goes through with it.
      body.recipients = [body.recipients[0]];
      await post(body, key).expect(202);
    });

    it('rejects a push recipient without userId as a validation error', async () => {
      const res = await post({
        channel: 'push',
        category: 'marketing',
        templateKey: 'chat-new-message',
        recipients: [{ email: 'a@example.com' }],
      }).expect(400);

      expect(res.body).toMatchObject({
        type: '/problems/validation-failed',
        errors: [
          {
            field: 'recipients[0].userId',
            message: 'userId is required for push',
          },
        ],
      });
    });

    it('rejects an empty batch and one over 10,000 recipients', async () => {
      await post(emailBatch(0)).expect(400);
      await post(emailBatch(10_001)).expect(400);
      expect(await dataSource.getRepository(NotificationBatch).count()).toBe(0);
    });

    it('rejects a template of the other channel', async () => {
      const res = await post({
        ...emailBatch(1),
        channel: 'push',
        recipients: [{ userId: 1 }],
      }).expect(422);
      expect(res.body).toMatchObject({ type: '/problems/template-unusable' });
    });

    it("reports another client's batch as missing", async () => {
      const res = await post(emailBatch(1)).expect(202);
      const { batchId } = res.body as { batchId: number };
      const other = await seedClient(dataSource, 'other');
      await get(batchId, other.apiKey).expect(404);
    });
  });

  describe('resuming', () => {
    // As if the process died after commit, part way through enqueuing.
    it('the sweeper finishes a batch left ENQUEUING', async () => {
      const batch = await dataSource.getRepository(NotificationBatch).save({
        clientId: client.id,
        templateId: email.id,
        channel: TemplateChannel.Email,
        category: NotificationCategory.Marketing,
        totalCount: 3,
        status: BatchStatus.Enqueuing,
      });
      const ids: number[] = [];
      for (const status of [
        NotificationStatus.Queued,
        NotificationStatus.Pending,
        NotificationStatus.Pending,
      ]) {
        const saved = await dataSource.getRepository(Notification).save({
          clientId: client.id,
          batchId: batch.id,
          userId: null,
          templateId: email.id,
          templateVersion: 1,
          channel: TemplateChannel.Email,
          category: NotificationCategory.Marketing,
          status,
          recipientEmail: 'a@example.com',
          variables: { code: '1' },
          renderedTitle: 't',
          renderedBody: 'b',
          renderedText: null,
          renderedData: null,
        });
        ids.push(saved.id);
      }

      // updated_at must be strictly older than "now - 0".
      await sleep(5);
      await app
        .get(Sweeper)
        .sweep({ pendingAfterMs: 0, stuckAfterMs: 3_600_000 });

      expect(await batchStatus(batch.id)).toBe(BatchStatus.Enqueued);
      const rows = await rowsOf(batch.id);
      expect(rows.map((n) => n.status)).toEqual([
        NotificationStatus.Queued,
        NotificationStatus.Queued,
        NotificationStatus.Queued,
      ]);
      const queue = getQueue(app, QueueNames.EmailMarketing);
      // Only the rows that were still PENDING were added.
      expect(await queue.getJob(jobIdFor(ids[0]))).toBeUndefined();
      expect(await queue.getJob(jobIdFor(ids[1]))).toBeDefined();
      expect(await queue.getJob(jobIdFor(ids[2]))).toBeDefined();
    });
  });
});
