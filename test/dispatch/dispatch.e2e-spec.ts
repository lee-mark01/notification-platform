import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Notification } from '../../src/notifications/notification.entity';
import {
  jobIdFor,
  QueueNames,
  SEND_JOB,
  SEND_QUEUES,
  type SendQueueName,
} from '../../src/queue/queue.constants';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues } from '../support/queues';
import {
  seedClient,
  seedEmailTemplate,
  seedPushTemplate,
  seedUser,
} from '../support/seed';

// A port nothing listens on, to stand in for an unreachable Redis.
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('Dispatching accepted notifications (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let apiKey: string;
  let userId: number;

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
    ({ apiKey } = await seedClient(dataSource));
    userId = (await seedUser(dataSource)).id;
    await seedEmailTemplate(dataSource);
    await seedPushTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const body = (channel: string, category: string) =>
    channel === 'email'
      ? {
          channel,
          category,
          templateKey: 'email-verification',
          recipient: { email: 'someone@example.com' },
          variables: { code: '381920' },
        }
      : {
          channel,
          category,
          templateKey: 'chat-new-message',
          recipient: { userId },
          variables: { sender: 'Kim', preview: 'hello' },
        };

  const post = (
    target: INestApplication<App>,
    payload: object,
    key = randomUUID(),
  ) =>
    request(target.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', key)
      .send(payload);

  const waitingCount = async (name: SendQueueName) =>
    (await getQueue(app, name).getJobCounts('waiting')).waiting;

  it.each([
    ['email', 'transactional', QueueNames.EmailTransactional],
    ['email', 'marketing', QueueNames.EmailMarketing],
    ['push', 'transactional', QueueNames.PushTransactional],
    ['push', 'marketing', QueueNames.PushMarketing],
  ] as const)(
    'puts %s/%s on %s and marks it QUEUED',
    async (channel, category, queueName) => {
      const res = await post(app, body(channel, category)).expect(202);
      const id = (res.body as { id: number }).id;

      const job = await getQueue(app, queueName).getJob(jobIdFor(id));
      expect(job).toBeDefined();
      expect(job?.name).toBe(SEND_JOB);
      expect(job?.data).toEqual({ notificationId: id });

      for (const other of SEND_QUEUES.filter((q) => q !== queueName)) {
        expect(await waitingCount(other)).toBe(0);
      }

      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id });
      expect(row.status).toBe('QUEUED');
      expect(row.queuedAt).toBeInstanceOf(Date);
    },
  );

  it('does not queue a replayed request again', async () => {
    const key = randomUUID();
    const payload = body('email', 'transactional');
    await post(app, payload, key).expect(202);
    const replay = await post(app, payload, key).expect(202);

    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await waitingCount(QueueNames.EmailTransactional)).toBe(1);
  });

  it('ignores a second add with the same job id', async () => {
    const res = await post(app, body('email', 'transactional')).expect(202);
    const id = (res.body as { id: number }).id;

    await getQueue(app, QueueNames.EmailTransactional).add(
      SEND_JOB,
      { notificationId: id },
      { jobId: jobIdFor(id) },
    );
    expect(await waitingCount(QueueNames.EmailTransactional)).toBe(1);
  });

  describe('when Redis is unreachable', () => {
    let offline: INestApplication<App>;

    beforeAll(async () => {
      offline = await createTestApp({
        env: { REDIS_PORT: String(await closedPort()) },
      });
    });

    afterAll(async () => {
      await offline.close();
    });

    it('still accepts with 202 and leaves the notification PENDING', async () => {
      const started = Date.now();
      const res = await post(offline, body('email', 'transactional')).expect(
        202,
      );
      expect(Date.now() - started).toBeLessThan(3_000);

      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id: (res.body as { id: number }).id });
      expect(row.status).toBe('PENDING');
      expect(row.queuedAt).toBeNull();
    });
  });
});
