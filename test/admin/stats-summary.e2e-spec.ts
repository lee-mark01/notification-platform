import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ApiClient } from '../../src/clients/api-client.entity';
import { Notification } from '../../src/notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../src/notifications/notification.enums';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import {
  seedClient,
  seedEmailTemplate,
  seedPushTemplate,
} from '../support/seed';

const ADMIN = { 'X-Admin-Key': process.env.ADMIN_API_KEY as string };
const DAY = Date.parse('2026-10-09T00:00:00.000Z');
const PERIOD = `from=${new Date(DAY).toISOString()}&to=${new Date(DAY + 86_400_000).toISOString()}`;
const S = NotificationStatus;
const C = NotificationCategory;

describe('GET /admin/stats/summary (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let client: ApiClient;
  let email: Template;
  let push: Template;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    ({ client } = await seedClient(dataSource));
    email = await seedEmailTemplate(dataSource);
    push = await seedPushTemplate(dataSource);

    // email transactional: 3 succeeded (1 read), 1 bounced, 1 suppressed
    // email marketing: 1 failed, 1 queued
    // push transactional: 2 sent (2 read), 1 dead
    const rows: [
      Template,
      NotificationCategory,
      NotificationStatus,
      boolean,
    ][] = [
      [email, C.Transactional, S.Sent, true],
      [email, C.Transactional, S.Delivered, false],
      [email, C.Transactional, S.Complained, false],
      [email, C.Transactional, S.Bounced, false],
      [email, C.Transactional, S.Suppressed, false],
      [email, C.Marketing, S.Failed, false],
      [email, C.Marketing, S.Queued, false],
      [push, C.Transactional, S.Sent, true],
      [push, C.Transactional, S.Sent, true],
      [push, C.Transactional, S.Dead, false],
    ];
    for (const [template, category, status, read] of rows) {
      await insert(template, category, status, read);
    }
    // Outside the period.
    await insert(email, C.Transactional, S.Failed, false, DAY - 1);
  });

  afterAll(async () => {
    await app.close();
  });

  const insert = (
    template: Template,
    category: NotificationCategory,
    status: NotificationStatus,
    read: boolean,
    createdAt = DAY + 3_600_000,
  ) =>
    dataSource.getRepository(Notification).save({
      clientId: client.id,
      userId: null,
      templateId: template.id,
      templateVersion: 1,
      channel: template.channel,
      category,
      status,
      recipientEmail:
        template.channel === TemplateChannel.Email ? 'a@example.com' : null,
      variables: {},
      renderedTitle: 't',
      renderedBody: 'b',
      renderedText: null,
      renderedData: null,
      readAt: read ? new Date() : null,
      createdAt: new Date(createdAt),
    });

  const get = async (query: string, expected = 200) =>
    (
      await request(app.getHttpServer())
        .get(`/admin/stats/summary?${query}`)
        .set(ADMIN)
        .expect(expected)
    ).body as { groupBy: string[]; items: Record<string, unknown>[] };

  it('reports one total by default', async () => {
    const body = await get(PERIOD);

    expect(body.groupBy).toEqual([]);
    expect(body.items).toEqual([
      {
        total: 10,
        byStatus: {
          SENT: 3,
          DELIVERED: 1,
          COMPLAINED: 1,
          BOUNCED: 1,
          SUPPRESSED: 1,
          FAILED: 1,
          QUEUED: 1,
          DEAD: 1,
        },
        inFlight: 1,
        // succeeded 5 (SENT 3, DELIVERED, COMPLAINED) / finished 8
        successRate: 0.625,
        // read 3 / reached the provider 6
        readRate: 0.5,
      },
    ]);
  });

  it('groups by channel and category in a fixed order', async () => {
    const body = await get(`${PERIOD}&groupBy=category,channel`);

    expect(body.groupBy).toEqual(['channel', 'category']);
    expect(
      body.items.map(({ channel, category, total, successRate, readRate }) => ({
        channel,
        category,
        total,
        successRate,
        readRate,
      })),
    ).toEqual([
      {
        channel: 'email',
        category: 'marketing',
        total: 2,
        successRate: 0,
        readRate: null,
      },
      {
        channel: 'email',
        category: 'transactional',
        total: 5,
        successRate: 0.75,
        readRate: 0.25,
      },
      {
        channel: 'push',
        category: 'transactional',
        total: 3,
        successRate: 0.6667,
        readRate: 1,
      },
    ]);
  });

  it('rejects an unknown group and a too long period', async () => {
    await get(`${PERIOD}&groupBy=status`, 400);
    await get('from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z', 400);
  });

  it('requires the admin key', async () => {
    await request(app.getHttpServer()).get('/admin/stats/summary').expect(401);
  });
});
