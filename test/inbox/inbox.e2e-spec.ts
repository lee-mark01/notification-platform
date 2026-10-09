import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { seedClient, seedPushTemplate, seedUser } from '../support/seed';

describe('Inbox /me/notifications (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let client: ApiClient;
  let template: Template;
  let me: AppUser;
  let other: AppUser;

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
    template = await seedPushTemplate(dataSource);
    me = await seedUser(dataSource);
    other = await seedUser(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const tokenFor = (user: AppUser) =>
    new JwtService().sign(
      { sub: String(user.id) },
      {
        secret: process.env.JWT_SECRET as string,
        algorithm: 'HS256',
        expiresIn: 3600,
      },
    );

  const api = (user: AppUser | null = me) => {
    const auth = user ? { Authorization: `Bearer ${tokenFor(user)}` } : {};
    const server = app.getHttpServer();
    return {
      get: (path: string) => request(server).get(path).set(auth),
      patch: (path: string) => request(server).patch(path).set(auth),
      post: (path: string) => request(server).post(path).set(auth),
    };
  };

  let minute = 0;
  const insert = async (
    overrides: Partial<Notification> = {},
  ): Promise<number> => {
    minute += 1;
    return (
      await dataSource.getRepository(Notification).save({
        clientId: client.id,
        userId: me.id,
        templateId: template.id,
        templateVersion: 1,
        channel: TemplateChannel.Push,
        category: NotificationCategory.Transactional,
        status: NotificationStatus.Sent,
        recipientEmail: null,
        variables: {},
        renderedTitle: `title ${minute}`,
        renderedBody: 'body',
        renderedText: null,
        createdAt: new Date(Date.UTC(2026, 9, 9, 0, minute)),
        ...overrides,
      })
    ).id;
  };

  const ids = (body: unknown) =>
    (body as { items: { id: number }[] }).items.map((i) => i.id);

  it('lists my sent notifications newest first, without others', async () => {
    const older = await insert();
    const newer = await insert({ status: NotificationStatus.Delivered });
    await insert({ status: NotificationStatus.Suppressed });
    await insert({ status: NotificationStatus.Queued });
    await insert({ userId: other.id });

    const res = await api().get('/me/notifications').expect(200);

    expect(ids(res.body)).toEqual([newer, older]);
    expect((res.body as { items: object[] }).items[0]).toEqual({
      id: newer,
      channel: 'push',
      title: expect.any(String) as string,
      body: 'body',
      readAt: null,
      createdAt: expect.any(String) as string,
    });
  });

  it('pages with a cursor, ordering same-time rows by id', async () => {
    const at = new Date(Date.UTC(2026, 9, 9, 12, 0));
    const a = await insert({ createdAt: at });
    const b = await insert({ createdAt: at });
    const c = await insert({ createdAt: at });

    const first = await api().get('/me/notifications?limit=2').expect(200);
    expect(ids(first.body)).toEqual([c, b]);

    const cursor = (first.body as { nextCursor: string }).nextCursor;
    const second = await api()
      .get(`/me/notifications?limit=2&cursor=${cursor}`)
      .expect(200);
    expect(ids(second.body)).toEqual([a]);
    expect((second.body as { nextCursor: null }).nextCursor).toBeNull();
  });

  it('filters unread and counts them', async () => {
    const unread = await insert();
    await insert({ readAt: new Date() });

    const res = await api().get('/me/notifications?unread=true').expect(200);
    expect(ids(res.body)).toEqual([unread]);
    await api()
      .get('/me/notifications/unread-count')
      .expect(200)
      .expect({ count: 1 });
  });

  it('scenario 12: repeating a read keeps the first read time', async () => {
    const id = await insert();

    const first = await api().patch(`/me/notifications/${id}/read`).expect(200);
    const second = await api()
      .patch(`/me/notifications/${id}/read`)
      .expect(200);

    const readAt = (first.body as { readAt: string }).readAt;
    expect(readAt).toEqual(expect.any(String));
    expect(second.body).toEqual({ id, readAt });
    const stored = await dataSource
      .getRepository(Notification)
      .findOneByOrFail({ id });
    expect(stored.readAt?.toISOString()).toBe(readAt);
    expect(stored.status).toBe(NotificationStatus.Sent);
  });

  it('marks unread again', async () => {
    const id = await insert({ readAt: new Date() });

    await api()
      .patch(`/me/notifications/${id}/unread`)
      .expect(200)
      .expect({ id, readAt: null });
  });

  it('marks all of mine read and reports how many changed', async () => {
    await insert();
    await insert();
    await insert({ readAt: new Date() });
    await insert({ userId: other.id });

    await api()
      .post('/me/notifications/read-all')
      .expect(200)
      .expect({ updated: 2 });
    await api()
      .get('/me/notifications/unread-count')
      .expect(200)
      .expect({ count: 0 });
    await api(other)
      .get('/me/notifications/unread-count')
      .expect(200)
      .expect({ count: 1 });
  });

  it("returns 404 for someone else's or a never-sent notification", async () => {
    const theirs = await insert({ userId: other.id });
    const suppressed = await insert({ status: NotificationStatus.Suppressed });

    await api().patch(`/me/notifications/${theirs}/read`).expect(404);
    await api().patch(`/me/notifications/${suppressed}/read`).expect(404);
    const stored = await dataSource
      .getRepository(Notification)
      .findOneByOrFail({ id: theirs });
    expect(stored.readAt).toBeNull();
  });

  it('rejects a bad cursor with 400 and a missing token with 401', async () => {
    await api().get('/me/notifications?cursor=nope').expect(400);
    await api(null).get('/me/notifications').expect(401);
  });
});
