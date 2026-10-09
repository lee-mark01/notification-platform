import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Notification } from '../../src/notifications/notification.entity';
import { NotificationStatus } from '../../src/notifications/notification.enums';
import { FakeProvider } from '../../src/providers/fake/fake.provider';
import { SuppressionsService } from '../../src/suppressions/suppressions.service';
import { SuppressionReason } from '../../src/suppressions/suppression.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { waitFor } from '../support/wait';

const ADMIN = { 'X-Admin-Key': process.env.ADMIN_API_KEY as string };
const BASE = '/admin/suppressions';

interface Item {
  email: string;
  reason: string;
  source: string | null;
  active: boolean;
}

describe('Suppressions admin API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let fake: FakeProvider;
  let apiKey: string;

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
    await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request.agent(app.getHttpServer()).set(ADMIN);

  const send = async (email: string): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'email',
        category: 'transactional',
        templateKey: 'email-verification',
        recipient: { email },
        variables: { code: '1' },
      })
      .expect(202);
    return (res.body as { id: number }).id;
  };

  const settled = (id: number) =>
    waitFor(async () => {
      const { status } = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id });
      return [NotificationStatus.Sent, NotificationStatus.Suppressed].includes(
        status,
      )
        ? status
        : undefined;
    });

  it('blocks sending after registration and allows it again after release', async () => {
    const created = await http()
      .post(BASE)
      .send({ email: 'Someone@Example.com', note: 'asked by phone' })
      .expect(201);
    expect(created.body).toMatchObject({
      email: 'someone@example.com',
      reason: 'ADMIN',
      source: 'asked by phone',
      active: true,
    });

    expect(await settled(await send('someone@example.com'))).toBe(
      NotificationStatus.Suppressed,
    );

    await http().delete(`${BASE}/someone@example.com`).expect(204);
    expect(await settled(await send('someone@example.com'))).toBe(
      NotificationStatus.Sent,
    );

    // Released again: nothing left to release.
    await http().delete(`${BASE}/someone@example.com`).expect(404);
  });

  it('answers 200 for an address already blocked and keeps its reason', async () => {
    await app
      .get(SuppressionsService)
      .suppress('bounced@example.com', SuppressionReason.HardBounce, 'sns-1');

    const res = await http()
      .post(BASE)
      .send({ email: 'bounced@example.com' })
      .expect(200);
    expect(res.body).toMatchObject({ reason: 'HARD_BOUNCE', active: true });
  });

  it('blocks a released address again with 201', async () => {
    await http().post(BASE).send({ email: 'a@example.com' }).expect(201);
    await http().delete(`${BASE}/a@example.com`).expect(204);
    await http().post(BASE).send({ email: 'a@example.com' }).expect(201);
  });

  it('lists with filters and a cursor, newest first', async () => {
    const service = app.get(SuppressionsService);
    await service.suppress(
      'b1@example.com',
      SuppressionReason.HardBounce,
      null,
    );
    await service.suppress('c1@example.com', SuppressionReason.Complaint, null);
    await service.suppress(
      'b2@example.com',
      SuppressionReason.HardBounce,
      null,
    );
    await service.release('b1@example.com');

    const list = async (query: string) =>
      (await http().get(`${BASE}?${query}`).expect(200)).body as {
        items: Item[];
        nextCursor: string | null;
      };

    expect(
      (await list('reason=HARD_BOUNCE')).items.map((i) => i.email),
    ).toEqual(['b2@example.com', 'b1@example.com']);
    expect((await list('active=true')).items.map((i) => i.email)).toEqual([
      'b2@example.com',
      'c1@example.com',
    ]);
    expect((await list('email=C1@example.com')).items).toHaveLength(1);

    const first = await list('limit=2');
    const second = await list(`limit=2&cursor=${first.nextCursor}`);
    expect([...first.items, ...second.items].map((i) => i.email)).toEqual([
      'b2@example.com',
      'c1@example.com',
      'b1@example.com',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects bad input and a missing admin key', async () => {
    await http().post(BASE).send({ email: 'not-an-email' }).expect(400);
    await http().delete(`${BASE}/not-an-email`).expect(400);
    await http().get(`${BASE}?active=maybe`).expect(400);
    await request(app.getHttpServer()).get(BASE).expect(401);
  });
});
