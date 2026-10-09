import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DeliveryAttempt } from '../../src/notifications/delivery-attempt.entity';
import { Notification } from '../../src/notifications/notification.entity';
import { NotificationStatus } from '../../src/notifications/notification.enums';
import { FakeProvider } from '../../src/providers/fake/fake.provider';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { waitFor } from '../support/wait';

// Scenario 7, in process: closing the app while a send is in flight lets the
// job finish and record its result. The chaos script covers a real SIGTERM.
describe('Graceful shutdown (e2e)', () => {
  let app: INestApplication<App>;
  // Outlives the app, to check the result after it has closed.
  let db: DataSource;

  beforeAll(async () => {
    db = await createTestDataSource().initialize();
    await db.runMigrations();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('finishes the job in progress before closing', async () => {
    app = await createTestApp({
      env: { WORKERS_ENABLED: 'true', FAKE_PROVIDER_LATENCY_MS: '800' },
    });
    await waitForQueues(app);
    await resetDatabase(db);
    await resetQueues(app);
    const { apiKey } = await seedClient(db);
    await seedEmailTemplate(db);

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
    const row = () => db.getRepository(Notification).findOneByOrFail({ id });

    // The provider call (800 ms) is now in flight.
    await waitFor(async () =>
      (await row()).status === NotificationStatus.Sending ? true : undefined,
    );
    const sending = app.get(FakeProvider).sent.length;

    await app.close();

    expect(sending).toBe(0);
    const after = await row();
    expect(after.status).toBe(NotificationStatus.Sent);
    expect(after.leaseUntil).toBeNull();
    expect(
      await db.getRepository(DeliveryAttempt).findBy({ notificationId: id }),
    ).toEqual([expect.objectContaining({ attemptNo: 1, outcome: 'SUCCESS' })]);
  });
});
