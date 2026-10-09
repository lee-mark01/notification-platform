import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { DeliveryAttempt } from '../../src/notifications/delivery-attempt.entity';
import { Notification } from '../../src/notifications/notification.entity';
import { NotificationStatus } from '../../src/notifications/notification.enums';
import { FakeProvider } from '../../src/providers/fake/fake.provider';
import { QueueNames } from '../../src/queue/queue.constants';
import {
  Suppression,
  SuppressionReason,
} from '../../src/suppressions/suppression.entity';
import { SuppressionsService } from '../../src/suppressions/suppressions.service';
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate, seedUser } from '../support/seed';
import { waitFor } from '../support/wait';

describe('Send policy: suppression and marketing consent (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let fake: FakeProvider;
  let apiKey: string;
  let user: AppUser;

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
    ({ apiKey } = await seedClient(dataSource));
    user = await seedUser(dataSource, { email: 'member@example.com' });
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const accept = async (
    category: 'transactional' | 'marketing',
    recipient: object,
  ): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'email',
        category,
        templateKey: 'email-verification',
        recipient,
        variables: { code: '381920' },
      })
      .expect(202);
    return (res.body as { id: number }).id;
  };

  const settled = (id: number, status: NotificationStatus) =>
    waitFor(async () => {
      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id });
      return row.status === status ? row : undefined;
    });

  const attempts = (id: number) =>
    dataSource.getRepository(DeliveryAttempt).countBy({ notificationId: id });

  const suppressions = () => dataSource.getRepository(Suppression).find();

  const optIn = (value: boolean) =>
    dataSource.getRepository(AppUser).update(user.id, {
      marketingOptIn: value,
      marketingOptInAt: value ? new Date() : null,
    });

  describe('suppression list', () => {
    it('scenario 8: suppresses mail to a blocked address without trying', async () => {
      await app
        .get(SuppressionsService)
        .suppress('Blocked@Example.com', SuppressionReason.HardBounce, null);

      const id = await accept('transactional', {
        email: 'blocked@example.com',
      });

      const row = await settled(id, NotificationStatus.Suppressed);
      expect(row.lastErrorCode).toBe('SUPPRESSED_ADDRESS');
      expect(row.leaseUntil).toBeNull();
      expect(await attempts(id)).toBe(0);
      expect(fake.sent).toHaveLength(0);
    });

    it('sends again once the address is released', async () => {
      await app
        .get(SuppressionsService)
        .suppress('released@example.com', SuppressionReason.Admin, null);
      await dataSource
        .getRepository(Suppression)
        .update({ email: 'released@example.com' }, { releasedAt: new Date() });

      const id = await accept('transactional', {
        email: 'released@example.com',
      });

      await settled(id, NotificationStatus.Sent);
    });

    it('scenario 4: fails a rejected address once and suppresses it', async () => {
      fake.script({
        kind: 'permanent',
        code: 'BadRequestException',
        invalidRecipient: true,
      });
      const first = await accept('transactional', { email: 'Bad@Example.com' });

      const row = await settled(first, NotificationStatus.Failed);
      expect(row.lastErrorCode).toBe('BadRequestException');
      expect(await attempts(first)).toBe(1);
      expect(await suppressions()).toEqual([
        expect.objectContaining({
          email: 'bad@example.com',
          reason: 'INVALID_ADDRESS',
          source: `notification:${first}`,
          releasedAt: null,
        }),
      ]);

      // The next notification to it stops before the provider.
      const second = await accept('transactional', {
        email: 'bad@example.com',
      });
      await settled(second, NotificationStatus.Suppressed);
      expect(fake.sent).toHaveLength(0);
    });

    it('does not suppress on a permanent error about something else', async () => {
      fake.script({ kind: 'permanent', code: 'MessageRejected' });
      const id = await accept('transactional', { email: 'fine@example.com' });

      await settled(id, NotificationStatus.Failed);
      expect(await suppressions()).toEqual([]);
    });
  });

  describe('marketing consent', () => {
    it('suppresses marketing to a user who has not opted in', async () => {
      const id = await accept('marketing', { userId: user.id });

      const row = await settled(id, NotificationStatus.Suppressed);
      expect(row.lastErrorCode).toBe('NO_MARKETING_CONSENT');
      expect(fake.sent).toHaveLength(0);
    });

    it('sends marketing to a user who has opted in', async () => {
      await optIn(true);

      const id = await accept('marketing', { userId: user.id });

      await settled(id, NotificationStatus.Sent);
    });

    it('suppresses marketing to an address with no user', async () => {
      const id = await accept('marketing', { email: 'stranger@example.com' });

      await settled(id, NotificationStatus.Suppressed);
    });

    it('checks consent at send time, not at intake', async () => {
      await optIn(true);
      const queue = getQueue(app, QueueNames.EmailMarketing);
      await queue.pause();
      let id: number;
      try {
        id = await accept('marketing', { userId: user.id });
        // The user opts out after the request was accepted.
        const token = new JwtService().sign(
          { sub: String(user.id) },
          {
            secret: process.env.JWT_SECRET as string,
            algorithm: 'HS256',
            expiresIn: 3600,
          },
        );
        await request(app.getHttpServer())
          .put('/me/marketing-consent')
          .set('Authorization', `Bearer ${token}`)
          .send({ optIn: false })
          .expect(200);
      } finally {
        await queue.resume();
      }

      await settled(id, NotificationStatus.Suppressed);
      expect(fake.sent).toHaveLength(0);
    });
  });
});
