import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { parseOrigins } from '../../src/app.setup';
import { createTestApp } from '../support/app';

const DEMO = 'http://localhost:8080';

describe('CORS (e2e)', () => {
  describe('with CORS_ORIGINS set', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({
        env: { CORS_ORIGINS: `${DEMO}, https://admin.example.com` },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('answers a preflight from an allowed origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/devices')
        .set('Origin', DEMO)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type')
        .expect(204);

      expect(res.headers['access-control-allow-origin']).toBe(DEMO);
    });

    it('exposes ETag, Location and X-Request-Id to browser scripts', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', DEMO)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(DEMO);
      expect(res.headers['access-control-expose-headers']).toBe(
        'ETag,Location,X-Request-Id',
      );
    });

    it('does not allow other origins', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', 'https://evil.example.com')
        .expect(200);

      expect(res.headers).not.toHaveProperty('access-control-allow-origin');
    });
  });

  describe('without CORS_ORIGINS', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('sends no CORS headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', DEMO)
        .expect(200);

      expect(res.headers).not.toHaveProperty('access-control-allow-origin');
    });
  });

  it('parses a comma-separated origin list', () => {
    expect(parseOrigins(' a , ,b ')).toEqual(['a', 'b']);
    expect(parseOrigins('')).toEqual([]);
  });
});
