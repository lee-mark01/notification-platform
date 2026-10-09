import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { jobIdFor, QueueNames } from '../../src/queue/queue.constants';
import { createTestApp } from '../support/app';
import { createTestDataSource } from '../support/database';
import { getQueue, resetQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Request id (e2e)', () => {
  let app: INestApplication<App>;
  let apiKey: string;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    await resetQueues(app);
    const dataSource = app.get(DataSource);
    ({ apiKey } = await seedClient(dataSource));
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates one when the caller sends none', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it("keeps the caller's id", async () => {
    await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'checkout-7f3a.1')
      .expect('X-Request-Id', 'checkout-7f3a.1');
  });

  it.each([
    ['spaces', 'a b c'],
    ['over 128 characters', 'x'.repeat(129)],
  ])('replaces an id with %s', async (_label, given) => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', given)
      .expect(200);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('passes the id to the send job as its correlation id', async () => {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .set('X-Request-Id', 'signup-42')
      .send({
        channel: 'email',
        category: 'transactional',
        templateKey: 'email-verification',
        recipient: { email: 'a@example.com' },
        variables: { code: '1' },
      })
      .expect(202)
      .expect('X-Request-Id', 'signup-42');

    const job = await getQueue(app, QueueNames.EmailTransactional).getJob(
      jobIdFor((res.body as { id: number }).id),
    );
    expect(job?.data).toEqual({
      notificationId: (res.body as { id: number }).id,
      correlationId: 'signup-42',
    });
  });
});
