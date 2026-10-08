import { INestApplication, Logger } from '@nestjs/common';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { createServer } from 'node:net';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from '../support/app';

interface HealthBody {
  status: 'ok' | 'error';
  info: Record<string, { status: string }>;
  error: Record<string, { status: string }>;
}

// A port that was free a moment ago, so nothing is listening on it.
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('Health (e2e)', () => {
  // Terminus logs failed checks; keep the test output readable.
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('with MySQL and Redis up', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports live without checking dependencies', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(res.body).toMatchObject({ status: 'ok', details: {} });
    });

    it('reports ready with both dependencies up', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });

    it('disables caching of health responses', async () => {
      await request(app.getHttpServer())
        .get('/health/ready')
        .expect('Cache-Control', /no-store/);
    });
  });

  describe('with Redis unreachable', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({
        env: {
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: String(await closedPort()),
        },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('fails readiness and names Redis as down', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503)
        .expect('Content-Type', /^application\/json/);

      const body = res.body as HealthBody;
      expect(body.status).toBe('error');
      expect(body.error.redis.status).toBe('down');
      expect(body.info.database.status).toBe('up');
    });

    it('keeps liveness up', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });

  describe('with MySQL stopped after startup', () => {
    let mysql: StartedMySqlContainer;
    let app: INestApplication<App>;

    beforeAll(async () => {
      // A dedicated container, so stopping it does not affect other suites.
      mysql = await new MySqlContainer('mysql:8.4')
        .withDatabase('health_test')
        .withUsername('app')
        .withUserPassword('app_password')
        .start();
      app = await createTestApp({
        env: {
          DB_HOST: mysql.getHost(),
          DB_PORT: String(mysql.getPort()),
          DB_DATABASE: mysql.getDatabase(),
        },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    // Guards against a vacuous pass: the check must succeed while MySQL is
    // up, so a later "down" can only come from stopping it.
    it('is ready while the dedicated MySQL is running', async () => {
      await request(app.getHttpServer()).get('/health/ready').expect(200);
    });

    it('fails readiness and names the database as down', async () => {
      await mysql.stop();

      const res = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503);

      const body = res.body as HealthBody;
      expect(body.error.database.status).toBe('down');
      expect(body.info.redis.status).toBe('up');
    });

    it('keeps liveness up', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });
});
