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
const DAY = new Date('2026-10-09T00:00:00.000Z');

describe('GET /admin/stats/read-rates (e2e)', () => {
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
  });

  afterAll(async () => {
    await app.close();
  });

  const insert = (
    template: Template,
    status: NotificationStatus,
    read: boolean,
    createdAt = new Date(DAY.getTime() + 3_600_000),
  ) =>
    dataSource.getRepository(Notification).save({
      clientId: client.id,
      userId: null,
      templateId: template.id,
      templateVersion: 1,
      channel: template.channel,
      category: NotificationCategory.Transactional,
      status,
      recipientEmail:
        template.channel === TemplateChannel.Email ? 'a@example.com' : null,
      variables: {},
      renderedTitle: 't',
      renderedBody: 'b',
      renderedText: null,
      readAt: read ? new Date() : null,
      createdAt,
    });

  const get = (query = '') =>
    request(app.getHttpServer())
      .get(`/admin/stats/read-rates${query}`)
      .set(ADMIN);

  const period = `?from=${DAY.toISOString()}&to=${new Date(DAY.getTime() + 86_400_000).toISOString()}`;

  it('reports sent, read and the rate per template and channel', async () => {
    // push: 4 sent, 3 read
    await insert(push, NotificationStatus.Sent, true);
    await insert(push, NotificationStatus.Delivered, true);
    await insert(push, NotificationStatus.Sent, true);
    await insert(push, NotificationStatus.Sent, false);
    // email: 3 sent (a bounce still counts as sent), 1 opened
    await insert(email, NotificationStatus.Delivered, true);
    await insert(email, NotificationStatus.Bounced, false);
    await insert(email, NotificationStatus.Sent, false);
    // never sent: not in the base
    await insert(email, NotificationStatus.Suppressed, false);
    await insert(push, NotificationStatus.Failed, false);
    // outside the period
    await insert(
      push,
      NotificationStatus.Sent,
      true,
      new Date('2026-10-01T00:00:00Z'),
    );

    const res = await get(period).expect(200);

    expect((res.body as { items: unknown[] }).items).toEqual([
      {
        templateKey: 'chat-new-message',
        channel: 'push',
        sent: 4,
        read: 3,
        readRate: 0.75,
      },
      {
        templateKey: 'email-verification',
        channel: 'email',
        sent: 3,
        read: 1,
        readRate: 0.3333,
      },
    ]);
  });

  it('defaults to the last 7 days', async () => {
    const res = await get().expect(200);
    const { from, to } = res.body as { from: string; to: string };
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(
      7 * 86_400_000,
    );
  });

  it('rejects a reversed or too long period', async () => {
    await get(`?from=${DAY.toISOString()}&to=2026-10-01T00:00:00Z`).expect(400);
    await get('?from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z').expect(400);
  });

  it('requires the admin key', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats/read-rates')
      .expect(401);
  });
});
