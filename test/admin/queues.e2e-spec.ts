import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DLQ_JOB, QueueNames, SEND_JOB } from '../../src/queue/queue.constants';
import { createTestApp } from '../support/app';
import { createTestDataSource } from '../support/database';
import { getQueue, resetQueues } from '../support/queues';

const KEY = process.env.ADMIN_API_KEY as string;
const ADMIN = { 'X-Admin-Key': KEY };
const basic = (password: string) =>
  `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`;

describe('Queue metrics and Bull Board (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    // Workers off: jobs stay where they are put.
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetQueues(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts jobs per send queue and in the DLQ', async () => {
    const email = getQueue(app, QueueNames.EmailMarketing);
    await email.add(SEND_JOB, { notificationId: 1 }, { jobId: 'm-1' });
    await email.add(SEND_JOB, { notificationId: 2 }, { jobId: 'm-2' });
    await email.add(SEND_JOB, { notificationId: 3 }, { delay: 60_000 });
    await getQueue(app, QueueNames.Dlq).add(DLQ_JOB, {
      notificationId: 9,
      sourceQueue: QueueNames.EmailMarketing,
      errorCode: 'PROVIDER_5XX',
    });

    const res = await request(app.getHttpServer())
      .get('/admin/queues/metrics')
      .set(ADMIN)
      .expect(200);

    const body = res.body as {
      queues: { name: string; waiting: number; delayed: number }[];
      dlq: number;
    };
    expect(body.queues.map((q) => q.name)).toEqual([
      'email-transactional',
      'email-marketing',
      'push-transactional',
      'push-marketing',
    ]);
    expect(body.queues[1]).toMatchObject({
      name: 'email-marketing',
      waiting: 2,
      delayed: 1,
      active: 0,
    });
    expect(body.dlq).toBe(1);

    await request(app.getHttpServer()).get('/admin/queues/metrics').expect(401);
  });

  describe('Bull Board', () => {
    const board = '/admin/queues/board';

    it('asks a browser for Basic credentials', async () => {
      const res = await request(app.getHttpServer()).get(board).expect(401);
      expect(res.headers['www-authenticate']).toMatch(/^Basic /);
      await request(app.getHttpServer())
        .get(board)
        .set('Authorization', basic('wrong'))
        .expect(401);
    });

    it('opens with the admin key as the Basic password or the header', async () => {
      await request(app.getHttpServer())
        .get(board)
        .set('Authorization', basic(KEY))
        .expect(200)
        .expect('Content-Type', /html/);
      await request(app.getHttpServer()).get(board).set(ADMIN).expect(200);
    });

    it('lists every queue, read-only', async () => {
      const res = await request(app.getHttpServer())
        .get(`${board}/api/queues`)
        .set(ADMIN)
        .expect(200);
      const queues = (
        res.body as { queues: { name: string; readOnlyMode: boolean }[] }
      ).queues;
      expect(queues.map((q) => q.name).sort()).toEqual(
        Object.values(QueueNames).sort(),
      );
      expect(queues.every((q) => q.readOnlyMode)).toBe(true);
    });
  });
});
