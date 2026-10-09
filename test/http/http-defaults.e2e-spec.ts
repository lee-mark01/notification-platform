import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';

const ADMIN = { 'X-Admin-Key': process.env.ADMIN_API_KEY as string };

describe('HTTP defaults (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    await resetDatabase(app.get(DataSource));
  });

  afterAll(async () => {
    await app.close();
  });

  it('has no root route left over from the project scaffold', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .expect(404)
      .expect('Content-Type', /^application\/problem\+json/);

    expect(res.body).toMatchObject({ type: 'about:blank', status: 404 });
  });

  it.each([
    ['a successful response', '/health/live', 200],
    ['an error response', '/does-not-exist', 404],
  ])('does not send X-Powered-By on %s', async (_label, path, status) => {
    const res = await request(app.getHttpServer()).get(path).expect(status);

    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  describe('ETag', () => {
    let templateId: number;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/admin/templates')
        .set(ADMIN)
        .send({
          key: 'etag-probe',
          channel: 'push',
          title: 'Title',
          body: 'Body',
        })
        .expect(201);
      templateId = (res.body as { id: number }).id;
    });

    // Express would add weak body-hash ETags to these GET responses.
    it.each([
      ['a list response', '/admin/templates', 200],
      ['a health response', '/health/live', 200],
      ['an error response', '/admin/templates/999999', 404],
    ])('is not added to %s', async (_label, path, status) => {
      const res = await request(app.getHttpServer())
        .get(path)
        .set(ADMIN)
        .expect(status);

      expect(res.headers).not.toHaveProperty('etag');
    });

    it('is still the strong version tag on a single template', async () => {
      await request(app.getHttpServer())
        .get(`/admin/templates/${templateId}`)
        .set(ADMIN)
        .expect(200)
        .expect('ETag', '"1"');
    });
  });
});
