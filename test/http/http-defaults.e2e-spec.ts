import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from '../support/app';

describe('HTTP defaults (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
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
});
