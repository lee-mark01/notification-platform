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

// QUEUE_ROUTING=single exists only for the priority-isolation experiment.
describe('Single-queue routing (e2e)', () => {
  let app: INestApplication<App>;
  let apiKey: string;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({ env: { QUEUE_ROUTING: 'single' } });
    await resetQueues(app);
    const dataSource = app.get(DataSource);
    ({ apiKey } = await seedClient(dataSource));
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('puts a marketing email on the shared queue', async () => {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'email',
        category: 'marketing',
        templateKey: 'email-verification',
        recipient: { email: 'a@example.com' },
        variables: { code: '1' },
      })
      .expect(202);
    const jobId = jobIdFor((res.body as { id: number }).id);

    expect(
      await getQueue(app, QueueNames.EmailTransactional).getJob(jobId),
    ).toBeDefined();
    expect(
      await getQueue(app, QueueNames.EmailMarketing).getJob(jobId),
    ).toBeUndefined();
  });
});
