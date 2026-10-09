import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ApiClient } from '../../src/clients/api-client.entity';
import { Notification } from '../../src/notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../src/notifications/notification.enums';
import { FakeProvider } from '../../src/providers/fake/fake.provider';
import {
  jobIdFor,
  QueueNames,
  SEND_JOB,
} from '../../src/queue/queue.constants';
import { Sweeper } from '../../src/sweeper/sweeper.service';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { waitFor } from '../support/wait';

const NOW = { pendingAfterMs: 0, stuckAfterMs: 0 };

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('Sweeper (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let fake: FakeProvider;
  let apiKey: string;
  let client: ApiClient;
  let template: Template;
  let scheduledAtStart: boolean;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({ env: { WORKERS_ENABLED: 'true' } });
    await waitForQueues(app);
    dataSource = app.get(DataSource);
    fake = app.get(FakeProvider);
    scheduledAtStart = await waitFor(async () =>
      (await getQueue(app, QueueNames.Maintenance).getJobScheduler('sweep'))
        ? true
        : undefined,
    );
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

  const sweeper = () => app.get(Sweeper);
  const emailQueue = () => getQueue(app, QueueNames.EmailTransactional);

  const row = (id: number) =>
    dataSource.getRepository(Notification).findOneByOrFail({ id });

  const settled = (id: number, status: NotificationStatus) =>
    waitFor(async () => ((await row(id)).status === status ? true : undefined));

  const insert = async (overrides: Partial<Notification>): Promise<number> => {
    const saved = await dataSource.getRepository(Notification).save({
      clientId: client.id,
      userId: null,
      templateId: template.id,
      templateVersion: 1,
      channel: TemplateChannel.Email,
      category: NotificationCategory.Transactional,
      recipientEmail: 'someone@example.com',
      variables: {},
      renderedTitle: 't',
      renderedBody: 'b',
      renderedText: null,
      ...overrides,
    });
    return saved.id;
  };

  // Backdates updated_at so the row looks stale to any threshold.
  const age = (id: number) =>
    dataSource
      .createQueryBuilder()
      .update(Notification)
      .set({ updatedAt: () => 'CURRENT_TIMESTAMP(3) - INTERVAL 1 HOUR' })
      .where('id = :id', { id })
      .execute();

  it('schedules itself on the maintenance queue', () => {
    expect(scheduledAtStart).toBe(true);
  });

  it('scenario 2: sends a notification accepted while Redis was down', async () => {
    const offline = await createTestApp({
      env: { REDIS_PORT: String(await closedPort()) },
    });
    let id: number;
    try {
      const res = await request(offline.getHttpServer())
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
      id = (res.body as { id: number }).id;
    } finally {
      await offline.close();
    }
    expect((await row(id)).status).toBe(NotificationStatus.Pending);

    // Redis is back (this app reaches it): the sweep re-adds the job.
    const result = await sweeper().sweep(NOW);

    expect(result).toEqual({ checked: 1, added: 1, stoppedEarly: false });
    await settled(id, NotificationStatus.Sent);
    expect(fake.sent).toHaveLength(1);
  });

  it('leaves a recent PENDING notification to the normal path', async () => {
    await insert({ status: NotificationStatus.Pending });

    const result = await sweeper().sweep();

    expect(result.checked).toBe(0);
    expect(await emailQueue().getJobCounts('waiting')).toEqual({ waiting: 0 });
  });

  it('does not touch a job that is still waiting', async () => {
    const id = await insert({ status: NotificationStatus.Queued });
    await age(id);
    await emailQueue().pause();
    try {
      const job = await emailQueue().add(
        SEND_JOB,
        { notificationId: id },
        { jobId: jobIdFor(id) },
      );

      const result = await sweeper().sweep(NOW);

      expect(result).toEqual({ checked: 1, added: 0, stoppedEarly: false });
      const same = await emailQueue().getJob(jobIdFor(id));
      expect(same?.timestamp).toBe(job.timestamp);
    } finally {
      await emailQueue().resume();
    }
    await settled(id, NotificationStatus.Sent);
  });

  it('re-adds a QUEUED notification whose job is gone', async () => {
    const id = await insert({ status: NotificationStatus.Queued });
    await age(id);

    const result = await sweeper().sweep(NOW);

    expect(result.added).toBe(1);
    await settled(id, NotificationStatus.Sent);
  });

  it('re-adds a SENDING notification left by a dead worker after its lease', async () => {
    // Its job is already finished, e.g. failed after stalling twice
    // (maxStalledCount); here it runs while the row says FAILED and is skipped.
    const id = await insert({ status: NotificationStatus.Failed });
    await emailQueue().add(
      SEND_JOB,
      { notificationId: id },
      { jobId: jobIdFor(id) },
    );
    await waitFor(async () =>
      (await (await emailQueue().getJob(jobIdFor(id)))?.getState()) ===
      'completed'
        ? true
        : undefined,
    );
    // What the dead worker left: SENDING, lease long expired, no live job.
    await dataSource.getRepository(Notification).update(id, {
      status: NotificationStatus.Sending,
      attemptCount: 1,
      leaseUntil: new Date(Date.now() - 60_000),
    });
    await age(id);

    await sweeper().sweep(NOW);

    await settled(id, NotificationStatus.Sent);
    expect((await row(id)).attemptCount).toBe(2);
    expect(fake.sent).toHaveLength(1);
  });

  it('stops early and changes nothing when Redis is unreachable', async () => {
    const offline = await createTestApp({
      env: { REDIS_PORT: String(await closedPort()) },
    });
    try {
      const id = await insert({ status: NotificationStatus.Pending });
      await age(id);

      const result = await offline.get(Sweeper).sweep(NOW);

      expect(result).toEqual({ checked: 1, added: 0, stoppedEarly: true });
      expect((await row(id)).status).toBe(NotificationStatus.Pending);
    } finally {
      await offline.close();
    }
  });
});
