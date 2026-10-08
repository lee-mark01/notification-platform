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
});
