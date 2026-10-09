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
  seedUser,
} from '../support/seed';

const ADMIN = { 'X-Admin-Key': process.env.ADMIN_API_KEY as string };
const DAY = Date.parse('2026-10-09T00:00:00.000Z');
const at = (hours: number) => new Date(DAY + hours * 3_600_000);
const PERIOD = `from=${at(0).toISOString()}&to=${at(24).toISOString()}`;

interface Page {
  items: { id: number; status: string; templateKey: string }[];
  nextCursor: string | null;
}

describe('GET /admin/notifications (e2e)', () => {
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

  const insert = async (
    overrides: Partial<Notification> & { template?: Template } = {},
  ): Promise<number> => {
    const { template = email, ...rest } = overrides;
    const saved = await dataSource.getRepository(Notification).save({
      clientId: client.id,
      userId: null,
      templateId: template.id,
      templateVersion: 1,
      channel: template.channel,
      category: NotificationCategory.Transactional,
      status: NotificationStatus.Sent,
      recipientEmail:
        template.channel === TemplateChannel.Email ? 'a@example.com' : null,
      variables: {},
      renderedTitle: 't',
      renderedBody: 'b',
      renderedText: null,
      renderedData: null,
      createdAt: at(1),
      ...rest,
    });
    return saved.id;
  };

  const search = async (query: string, expected = 200) =>
    (
      await request(app.getHttpServer())
        .get(`/admin/notifications?${query}`)
        .set(ADMIN)
        .expect(expected)
    ).body as Page;

  it('lists notifications in the period, newest first', async () => {
    const older = await insert({ createdAt: at(1) });
    const newer = await insert({ createdAt: at(5) });
    await insert({ createdAt: at(30) }); // after the period

    const page = await search(PERIOD);
    expect(page.items.map((n) => n.id)).toEqual([newer, older]);
    expect(page.items[0]).toMatchObject({
      templateKey: 'email-verification',
      clientId: client.id,
      recipientEmail: 'a@example.com',
    });
    expect(page.nextCursor).toBeNull();
  });

  it('combines filters with AND', async () => {
    const user = await seedUser(dataSource);
    const match = await insert({
      template: push,
      userId: user.id,
      recipientEmail: null,
      category: NotificationCategory.Marketing,
      status: NotificationStatus.Failed,
    });
    await insert({ template: push, userId: user.id }); // SENT, transactional
    await insert({ status: NotificationStatus.Failed }); // email
    const dead = await insert({
      template: push,
      userId: user.id,
      category: NotificationCategory.Marketing,
      status: NotificationStatus.Dead,
      createdAt: at(2),
    });

    const page = await search(
      `${PERIOD}&channel=push&category=marketing&status=FAILED,DEAD&userId=${user.id}&templateKey=chat-new-message`,
    );
    expect(page.items.map((n) => n.id)).toEqual([dead, match]);

    const byEmail = await search(`${PERIOD}&email=b@example.com`);
    expect(byEmail.items).toEqual([]);
  });

  it('pages with a cursor, ordering same-time rows by id', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await insert({ createdAt: at(3) }));

    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const page = await search(
        `${PERIOD}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.items.map((n) => n.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([...ids].reverse());
  });

  it('rejects bad input with 400 and a missing key with 401', async () => {
    await search(`${PERIOD}&status=SENT,NOPE`, 400);
    await search(`${PERIOD}&cursor=garbage`, 400);
    await search('from=2026-01-01T00:00:00Z&to=2026-10-01T00:00:00Z', 400);
    await request(app.getHttpServer()).get('/admin/notifications').expect(401);
  });
});
