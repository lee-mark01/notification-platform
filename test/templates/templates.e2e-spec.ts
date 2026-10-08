import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';

const BASE = '/admin/templates';
const PROBLEM_JSON = /^application\/problem\+json/;

const emailTemplate = {
  key: 'email-verification',
  channel: 'email',
  subject: 'Verify your email',
  htmlBody: '<p>Your code is {{code}}</p>',
  requiredVariables: ['code'],
};

const pushTemplate = {
  key: 'chat-new-message',
  channel: 'push',
  title: 'New message',
  body: '{{sender}} sent you a message',
  data: { screen: 'chat' },
  requiredVariables: ['sender'],
};

describe('Templates (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function create(body: object) {
    return http().post(BASE).send(body).expect(201);
  }

  describe('create and read', () => {
    it('creates an email template with Location and ETag', async () => {
      const res = await create(emailTemplate);

      const id = (res.body as { id: number }).id;
      expect(res.headers.location).toBe(`${BASE}/${id}`);
      expect(res.headers.etag).toBe('"1"');
      expect(res.body).toMatchObject({
        key: 'email-verification',
        channel: 'email',
        subject: 'Verify your email',
        htmlBody: '<p>Your code is {{code}}</p>',
        textBody: null,
        requiredVariables: ['code'],
      });
      expect(res.body).not.toHaveProperty('title');
      expect(res.body).not.toHaveProperty('version');
    });

    it('returns the template with its ETag', async () => {
      const created = await create(pushTemplate);
      const id = (created.body as { id: number }).id;

      const res = await http().get(`${BASE}/${id}`).expect(200);

      expect(res.headers.etag).toBe('"1"');
      expect(res.body).toMatchObject({
        channel: 'push',
        title: 'New message',
        data: { screen: 'chat' },
      });
      expect(res.body).not.toHaveProperty('subject');
    });

    it('returns 404 for an unknown id and 400 for a non-integer id', async () => {
      await http()
        .get(`${BASE}/999`)
        .expect(404)
        .expect('Content-Type', PROBLEM_JSON);
      const res = await http().get(`${BASE}/abc`).expect(400);
      expect(res.body).toMatchObject({
        type: '/problems/validation-failed',
        errors: [{ field: 'id' }],
      });
    });
  });

  describe('validation', () => {
    it('requires the fields of the chosen channel', async () => {
      const res = await http()
        .post(BASE)
        .send({ key: 'welcome', channel: 'email', subject: 'Hi' })
        .expect(400);

      expect(res.body).toMatchObject({
        type: '/problems/validation-failed',
        errors: [
          {
            field: 'htmlBody',
            message: 'htmlBody is required for email templates',
          },
        ],
      });
    });

    it('rejects fields of the other channel', async () => {
      const res = await http()
        .post(BASE)
        .send({ ...pushTemplate, subject: 'email only' })
        .expect(400);

      expect(res.body).toMatchObject({
        errors: [{ field: 'subject' }],
      });
    });

    it.each([
      [
        'an invalid key',
        { ...emailTemplate, key: 'Email Verification' },
        'key',
      ],
      ['non-string data values', { ...pushTemplate, data: { n: 1 } }, 'data'],
      [
        'an invalid variable name',
        { ...emailTemplate, requiredVariables: ['user-name'] },
        'requiredVariables',
      ],
    ])('rejects %s', async (_label, body, field) => {
      const res = await http().post(BASE).send(body).expect(400);

      expect(res.body).toMatchObject({ errors: [{ field }] });
    });
  });

  describe('key uniqueness', () => {
    it('allows only one of two concurrent creates with the same key', async () => {
      const responses = await Promise.all([
        http().post(BASE).send(emailTemplate),
        http()
          .post(BASE)
          .send({ ...pushTemplate, key: emailTemplate.key }),
      ]);

      const statuses = responses.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const conflict = responses.find((r) => r.status === 409)!;
      expect(conflict.body).toMatchObject({
        type: '/problems/template-key-conflict',
      });
    });

    it('keeps the key of a deleted template reserved', async () => {
      const created = await create(emailTemplate);
      await http()
        .delete(`${BASE}/${(created.body as { id: number }).id}`)
        .expect(204);

      await http().post(BASE).send(emailTemplate).expect(409);
    });
  });

  describe('update with If-Match', () => {
    let id: number;

    beforeEach(async () => {
      id = ((await create(emailTemplate)).body as { id: number }).id;
    });

    it('updates content and returns the next ETag', async () => {
      const res = await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', '"1"')
        .send({ subject: 'Confirm your email', textBody: 'Code: {{code}}' })
        .expect(200);

      expect(res.headers.etag).toBe('"2"');
      expect(res.body).toMatchObject({
        subject: 'Confirm your email',
        textBody: 'Code: {{code}}',
        htmlBody: emailTemplate.htmlBody,
      });

      const reread = await http().get(`${BASE}/${id}`).expect(200);
      expect(reread.headers.etag).toBe('"2"');
    });

    it('returns 428 without If-Match', async () => {
      const res = await http()
        .patch(`${BASE}/${id}`)
        .send({ subject: 'x' })
        .expect(428);

      expect(res.body).toMatchObject({
        type: '/problems/precondition-required',
      });
    });

    it('returns 412 for a stale ETag and leaves the template unchanged', async () => {
      await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', '"1"')
        .send({ subject: 'First edit' })
        .expect(200);

      const res = await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', '"1"')
        .send({ subject: 'Lost update' })
        .expect(412);

      expect(res.body).toMatchObject({ type: '/problems/precondition-failed' });
      const current = await http().get(`${BASE}/${id}`).expect(200);
      expect(current.body).toMatchObject({ subject: 'First edit' });
    });

    it('lets only one of two concurrent edits with the same ETag succeed', async () => {
      const responses = await Promise.all(
        ['Edit A', 'Edit B'].map((subject) =>
          http()
            .patch(`${BASE}/${id}`)
            .set('If-Match', '"1"')
            .send({ subject }),
        ),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([200, 412]);
      const current = await http().get(`${BASE}/${id}`).expect(200);
      expect(current.headers.etag).toBe('"2"');
    });

    it('rejects a weak ETag in If-Match', async () => {
      await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', 'W/"1"')
        .send({ subject: 'x' })
        .expect(412);
    });

    it.each([
      ['key', { key: 'renamed' }],
      ['channel', { channel: 'push' }],
    ])('rejects changing %s', async (_field, body) => {
      await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', '"1"')
        .send(body)
        .expect(400);
    });

    it('rejects clearing a required field and adding another channel field', async () => {
      const res = await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', '"1"')
        .send({ subject: null, title: 'push only' })
        .expect(400);

      const fields = (res.body as { errors: { field: string }[] }).errors.map(
        (e) => e.field,
      );
      expect(fields).toEqual(expect.arrayContaining(['subject', 'title']));
    });
  });

  describe('delete', () => {
    it('soft-deletes: 204, then 404 on read, delete, and update', async () => {
      const id = ((await create(emailTemplate)).body as { id: number }).id;

      await http().delete(`${BASE}/${id}`).expect(204);

      await http().get(`${BASE}/${id}`).expect(404);
      await http().delete(`${BASE}/${id}`).expect(404);
      await http()
        .patch(`${BASE}/${id}`)
        .set('If-Match', '"1"')
        .send({ subject: 'x' })
        .expect(404);

      const rows: unknown[] = await dataSource.query(
        'SELECT id FROM template WHERE id = ? AND deleted_at IS NOT NULL',
        [id],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('list', () => {
    it('pages through templates with an opaque cursor and filters by channel', async () => {
      for (let i = 1; i <= 5; i += 1) {
        await create({ ...emailTemplate, key: `email-${i}` });
      }
      await create(pushTemplate);
      const deleted = await create({ ...emailTemplate, key: 'email-deleted' });
      await http()
        .delete(`${BASE}/${(deleted.body as { id: number }).id}`)
        .expect(204);

      const keys: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await http()
          .get(BASE)
          .query({ channel: 'email', limit: 2, ...(cursor && { cursor }) })
          .expect(200);
        const page = res.body as {
          items: { key: string }[];
          nextCursor: string | null;
        };
        keys.push(...page.items.map((t) => t.key));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor);

      expect(keys).toEqual([
        'email-1',
        'email-2',
        'email-3',
        'email-4',
        'email-5',
      ]);
      expect(pages).toBe(3);
    });

    it.each([
      ['limit above 100', { limit: 101 }, 'limit'],
      ['non-numeric limit', { limit: 'ten' }, 'limit'],
      ['malformed cursor', { cursor: 'garbage' }, 'cursor'],
    ])('rejects %s', async (_label, query, field) => {
      const res = await http().get(BASE).query(query).expect(400);

      const fields = (res.body as { errors: { field: string }[] }).errors.map(
        (e) => e.field,
      );
      expect(new Set(fields)).toEqual(new Set([field]));
    });
  });
});
