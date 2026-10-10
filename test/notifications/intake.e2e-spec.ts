import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import {
  IdempotencyKey,
  IdempotencyStatus,
} from '../../src/common/idempotency/idempotency-key.entity';
import { requestHash } from '../../src/common/idempotency/request-hash';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';
import { hashApiKey } from '../../src/clients/api-key';
import { Notification } from '../../src/notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../src/notifications/notification.enums';
import { TemplateChannel } from '../../src/templates/template.entity';
import { ApiClient } from '../../src/clients/api-client.entity';
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import {
  seedClient,
  seedEmailTemplate,
  seedPushTemplate,
  seedUser,
} from '../support/seed';

const PROBLEM_JSON = /^application\/problem\+json/;

describe('Notification intake (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let apiKey: string;
  let client: ApiClient;
  let user: AppUser;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    ({ client, apiKey } = await seedClient(dataSource));
    user = await seedUser(dataSource, { email: 'member@example.com' });
    await seedEmailTemplate(dataSource);
    await seedPushTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const emailRequest = () => ({
    channel: 'email',
    category: 'transactional',
    templateKey: 'email-verification',
    recipient: { email: 'someone@example.com' },
    variables: { code: '381920' },
  });

  const post = (body: object, key: string | null = randomUUID()) => {
    const req = request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey);
    if (key !== null) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  const notificationCount = () =>
    dataSource.getRepository(Notification).count();

  describe('accepting', () => {
    it('stores the notification with rendered content and returns 202', async () => {
      const res = await post(emailRequest()).expect(202);

      const id = (res.body as { id: number }).id;
      expect(res.body).toEqual({ id });
      expect(res.headers.location).toBe(`/notifications/${id}`);
      expect(res.headers).not.toHaveProperty('idempotent-replayed');

      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id });
      expect(row).toMatchObject({
        status: 'QUEUED',
        channel: 'email',
        category: 'transactional',
        recipientEmail: 'someone@example.com',
        userId: null,
        templateVersion: 1,
        renderedTitle: 'Your code 381920',
        renderedBody: '<p>Code: 381920</p>',
        renderedText: 'Code: 381920',
        variables: { code: '381920' },
      });
    });

    it("uses the user's address when only userId is given", async () => {
      const res = await post({
        ...emailRequest(),
        recipient: { userId: user.id },
      }).expect(202);

      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id: (res.body as { id: number }).id });
      expect(row).toMatchObject({
        userId: user.id,
        recipientEmail: 'member@example.com',
      });
    });

    it('renders push title, body, and data for a user', async () => {
      const res = await post({
        channel: 'push',
        category: 'transactional',
        templateKey: 'chat-new-message',
        recipient: { userId: user.id },
        variables: { sender: 'Kim', preview: 'hi' },
      }).expect(202);

      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id: (res.body as { id: number }).id });
      expect(row).toMatchObject({
        renderedTitle: 'Kim',
        renderedBody: 'Kim: hi',
        renderedText: null,
        renderedData: { screen: 'chat' },
        recipientEmail: null,
      });
    });
  });

  describe('authentication', () => {
    it('stores only the SHA-256 of the API key', async () => {
      const rows = await dataSource.query<{ key_hash: string }[]>(
        'SELECT key_hash FROM api_key WHERE client_id = ?',
        [client.id],
      );

      expect(rows[0].key_hash).toBe(hashApiKey(apiKey));
      expect(rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].key_hash).not.toContain(apiKey.slice(3, 20));
    });

    it.each([
      ['missing', undefined],
      ['unknown', 'np_not-a-real-key'],
    ])('returns 401 for a %s API key', async (_label, key) => {
      const req = request(app.getHttpServer())
        .post('/notifications')
        .set('Idempotency-Key', randomUUID());
      if (key) req.set('X-API-Key', key);

      const res = await req.send(emailRequest()).expect(401);

      expect(res.headers['www-authenticate']).toContain('ApiKey');
      expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
    });
  });

  describe('Idempotency-Key', () => {
    it('returns 400 when the header is missing', async () => {
      const res = await post(emailRequest(), null).expect(400);

      expect(res.body).toMatchObject({
        type: '/problems/idempotency-key-missing',
      });
    });

    it('replays the stored response for the same key and body', async () => {
      const key = randomUUID();
      const first = await post(emailRequest(), key).expect(202);
      // Same content, keys in a different order.
      const { variables, recipient, ...rest } = emailRequest();
      const second = await post({ variables, recipient, ...rest }, key).expect(
        202,
      );

      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.headers.location).toBe(first.headers.location);
      expect(await notificationCount()).toBe(1);
    });

    it('returns 422 for the same key with a different body', async () => {
      const key = randomUUID();
      await post(emailRequest(), key).expect(202);

      const res = await post(
        { ...emailRequest(), variables: { code: '000000' } },
        key,
      ).expect(422);

      expect(res.body).toMatchObject({
        type: '/problems/idempotency-key-reused',
      });
      expect(await notificationCount()).toBe(1);
    });

    it('returns 409 with Retry-After while the same key is in progress', async () => {
      const key = randomUUID();
      await holdKey(key, { lockedForMs: 20_000 });

      const res = await post(emailRequest(), key).expect(409);

      expect(res.body).toMatchObject({
        type: '/problems/idempotency-key-in-progress',
      });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(await notificationCount()).toBe(0);
    });

    it('takes over a key whose holder stopped before completing', async () => {
      const key = randomUUID();
      await holdKey(key, { lockedForMs: -1 });

      await post(emailRequest(), key).expect(202);

      expect(await notificationCount()).toBe(1);
    });

    // Scenario 1: concurrent requests with one key create one notification.
    it('creates exactly one notification for concurrent requests with one key', async () => {
      const key = randomUUID();

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => post(emailRequest(), key)),
      );

      expect(await notificationCount()).toBe(1);
      const statuses = responses.map((r) => r.status);
      expect(statuses.every((s) => s === 202 || s === 409)).toBe(true);
      const ids = new Set(
        responses
          .filter((r) => r.status === 202)
          .map((r) => (r.body as { id: number }).id),
      );
      expect(ids.size).toBe(1);
    });

    it('releases the key when the request is rejected, so it can be retried', async () => {
      const key = randomUUID();
      await post({ ...emailRequest(), variables: {} }, key).expect(422);

      await post(emailRequest(), key).expect(202);
      expect(await notificationCount()).toBe(1);
    });

    // A request whose lock expired while it was still running must not be able
    // to complete after a retry took the key over: that would create a second
    // notification. complete() is fenced by the lock token.
    it('rolls back a holder that lost its key to a takeover', async () => {
      const idempotency = app.get(IdempotencyService);
      const key = randomUUID();
      const hash = requestHash(emailRequest());

      const first = await idempotency.begin(client.id, key, hash);
      if (first.kind !== 'acquired') throw new Error('expected acquired');
      await dataSource
        .getRepository(IdempotencyKey)
        .update(
          { id: first.recordId },
          { lockedUntil: new Date(Date.now() - 1) },
        );
      const second = await idempotency.begin(client.id, key, hash);
      if (second.kind !== 'acquired') throw new Error('expected takeover');
      expect(second.recordId).toBe(first.recordId);
      expect(second.lockToken).not.toBe(first.lockToken);

      const completeAs = (lockToken: string, code: string) =>
        dataSource.transaction(async (manager) => {
          const saved = await manager.save(Notification, {
            clientId: client.id,
            templateId: (
              await dataSource.query<{ id: number }[]>(
                'SELECT id FROM template LIMIT 1',
              )
            )[0].id,
            templateVersion: 1,
            channel: TemplateChannel.Email,
            category: NotificationCategory.Transactional,
            status: NotificationStatus.Pending,
            recipientEmail: 'a@example.com',
            variables: { code },
            renderedTitle: code,
            renderedBody: code,
          });
          await idempotency.complete(manager, first.recordId, lockToken, {
            status: 202,
            body: { id: saved.id },
            notificationId: saved.id,
          });
        });

      // The original holder wakes up and tries to finish: rejected, rolled back.
      await expect(completeAs(first.lockToken, 'stale')).rejects.toThrow();
      expect(await notificationCount()).toBe(0);
      // abandon() by the stale holder must not delete the new holder's key.
      await idempotency.abandon(first.recordId, first.lockToken);

      await completeAs(second.lockToken, 'current');
      expect(await notificationCount()).toBe(1);
      const stored = await dataSource
        .getRepository(IdempotencyKey)
        .findOneByOrFail({ id: first.recordId });
      expect(stored.status).toBe(IdempotencyStatus.Completed);
    });

    // Simulates another request of this client holding the key.
    async function holdKey(
      key: string,
      { lockedForMs }: { lockedForMs: number },
    ) {
      await dataSource.getRepository(IdempotencyKey).insert({
        clientId: client.id,
        idemKey: key,
        requestHash: requestHash(emailRequest()),
        status: IdempotencyStatus.InProgress,
        lockToken: randomUUID(),
        lockedUntil: new Date(Date.now() + lockedForMs),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    }
  });

  describe('request validation', () => {
    it.each([
      [
        'an unknown template',
        { templateKey: 'no-such-template' },
        '/problems/template-unusable',
        'templateKey',
      ],
      [
        'a channel that does not match the template',
        { channel: 'push', recipient: { userId: 1 } },
        '/problems/template-unusable',
        'channel',
      ],
      [
        'missing required variables',
        { variables: {} },
        '/problems/template-unusable',
        'variables',
      ],
    ])('returns 422 for %s', async (_label, patch, type, field) => {
      const res = await post({ ...emailRequest(), ...patch }).expect(422);

      expect(res.body).toMatchObject({ type, errors: [{ field }] });
    });

    it('returns 422 recipient-unusable for an unknown user', async () => {
      const res = await post({
        ...emailRequest(),
        recipient: { userId: 999_999 },
      }).expect(422);

      expect(res.body).toMatchObject({
        type: '/problems/recipient-unusable',
      });
    });

    it.each([
      [
        'push without userId',
        {
          channel: 'push',
          templateKey: 'chat-new-message',
          recipient: { email: 'a@b.co' },
          variables: { sender: 'a', preview: 'b' },
        },
        'recipient.userId',
      ],
      ['email without any recipient', { recipient: {} }, 'recipient'],
      [
        'non-primitive variable values',
        { variables: { code: { nested: true } } },
        'variables',
      ],
      [
        'an invalid email',
        { recipient: { email: 'not-an-email' } },
        'recipient.email',
      ],
    ])('returns 400 for %s', async (_label, patch, field) => {
      const res = await post({ ...emailRequest(), ...patch }).expect(400);

      const body = res.body as { type: string; errors: { field: string }[] };
      expect(body.type).toBe('/problems/validation-failed');
      expect(body.errors.map((e) => e.field)).toContain(field);
    });
  });

  describe('GET /notifications/{id}', () => {
    it('returns the notification with its template key and attempts', async () => {
      const created = await post(emailRequest()).expect(202);
      const id = (created.body as { id: number }).id;

      const res = await request(app.getHttpServer())
        .get(`/notifications/${id}`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(res.body).toMatchObject({
        id,
        status: 'QUEUED',
        channel: 'email',
        templateKey: 'email-verification',
        templateVersion: 1,
        attempts: [],
      });
    });

    it("returns 404 for another client's notification", async () => {
      const created = await post(emailRequest()).expect(202);
      const other = await seedClient(dataSource, 'other');

      await request(app.getHttpServer())
        .get(`/notifications/${(created.body as { id: number }).id}`)
        .set('X-API-Key', other.apiKey)
        .expect(404);
    });
  });
});
