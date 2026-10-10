import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Notification } from '../../src/notifications/notification.entity';
import { NotificationStatus } from '../../src/notifications/notification.enums';
import { QueueNames } from '../../src/queue/queue.constants';
import { createTestApp } from '../support/app';
import { createTestDataSource } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { waitFor } from '../support/wait';

const ADMIN = { 'X-Admin-Key': process.env.ADMIN_API_KEY as string };

describe('Pausing a send queue (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let apiKey: string;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({ env: { WORKERS_ENABLED: 'true' } });
    await waitForQueues(app);
    await resetQueues(app);
    dataSource = app.get(DataSource);
    ({ apiKey } = await seedClient(dataSource));
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    // A pause lives in Redis; leave the queue as other suites expect it.
    await getQueue(app, QueueNames.EmailTransactional).resume();
    await app.close();
  });

  const admin = (method: 'get' | 'post', path: string) =>
    request(app.getHttpServer())[method](path).set(ADMIN);

  const status = async (id: number) =>
    (await dataSource.getRepository(Notification).findOneByOrFail({ id }))
      .status;

  it('holds jobs while paused and sends them after resume', async () => {
    const paused = await admin(
      'post',
      '/admin/queues/email-transactional/pause',
    ).expect(200);
    expect(paused.body).toMatchObject({
      name: 'email-transactional',
      paused: true,
    });

    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'email',
        category: 'transactional',
        templateKey: 'email-verification',
        recipient: { email: 'a@example.com' },
        variables: { code: '1' },
      })
      .expect(202);
    const id = (res.body as { id: number }).id;

    // Workers are running; give them time to (not) pick it up.
    await sleep(1_500);
    expect(await status(id)).toBe(NotificationStatus.Queued);
    const metrics = await admin('get', '/admin/queues/metrics').expect(200);
    expect(
      (metrics.body as { queues: { name: string }[] }).queues.find(
        (q) => q.name === 'email-transactional',
      ),
    ).toMatchObject({ waiting: 1, paused: true });

    await admin('post', '/admin/queues/email-transactional/resume')
      .expect(200)
      .expect((r) => expect(r.body).toMatchObject({ paused: false }));
    await waitFor(async () =>
      (await status(id)) === NotificationStatus.Sent ? true : undefined,
    );
  });

  it('only pauses send queues, and only for admins', async () => {
    await admin('post', '/admin/queues/notification-dlq/pause').expect(404);
    await admin('post', '/admin/queues/nope/pause').expect(404);
    await request(app.getHttpServer())
      .post('/admin/queues/email-transactional/pause')
      .expect(401);
  });
});
