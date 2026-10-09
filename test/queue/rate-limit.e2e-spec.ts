import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, In } from 'typeorm';
import { Notification } from '../../src/notifications/notification.entity';
import { NotificationStatus } from '../../src/notifications/notification.enums';
import { jobIdFor, QueueNames } from '../../src/queue/queue.constants';
import { createTestApp } from '../support/app';
import { createTestDataSource } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { waitFor } from '../support/wait';

describe('Per-queue rate limit (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let apiKey: string;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    // Email budget 4/s split evenly: 2/s for email-transactional.
    app = await createTestApp({
      env: {
        WORKERS_ENABLED: 'true',
        EMAIL_RATE_PER_SEC: '4',
        TRANSACTIONAL_RATE_SHARE: '0.5',
      },
    });
    await waitForQueues(app);
    await resetQueues(app);
    dataSource = app.get(DataSource);
    ({ apiKey } = await seedClient(dataSource));
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('processes at most max jobs per second on a queue', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app.getHttpServer())
        .post('/notifications')
        .set('X-API-Key', apiKey)
        .set('Idempotency-Key', randomUUID())
        .send({
          channel: 'email',
          category: 'transactional',
          templateKey: 'email-verification',
          recipient: { email: `r${i}@example.com` },
          variables: { code: String(i) },
        })
        .expect(202);
      ids.push((res.body as { id: number }).id);
    }

    await waitFor(
      async () =>
        (await dataSource.getRepository(Notification).countBy({
          id: In(ids),
          status: NotificationStatus.Sent,
        })) === ids.length
          ? true
          : undefined,
      { timeoutMs: 15_000 },
    );

    const queue = getQueue(app, QueueNames.EmailTransactional);
    const started = await Promise.all(
      ids.map(async (id) => (await queue.getJob(jobIdFor(id)))!.processedOn!),
    );
    started.sort((a, b) => a - b);
    // BullMQ's limiter is a fixed window that opens with the first job, so
    // the end of one window and the start of the next can run up to 4 jobs
    // close together. What always holds: the third job waits for the second
    // window, and 6 jobs need three windows. Without the limiter all 6 start
    // within a few hundred milliseconds.
    expect(started[2] - started[0]).toBeGreaterThanOrEqual(900);
    expect(started[5] - started[0]).toBeGreaterThanOrEqual(1_800);
  }, 30_000);
});
