import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

declare global {
  var __MYSQL_CONTAINER__: StartedMySqlContainer | undefined;
  var __REDIS_CONTAINER__: StartedRedisContainer | undefined;
}

export const MIGRATION_TEST_DATABASE = 'migration_test';

// One MySQL and one Redis container for the whole E2E run. Tests run
// serially (--runInBand), so they can share them without interfering.
export default async function globalSetup(): Promise<void> {
  const [mysql, redis] = await Promise.all([
    new MySqlContainer('mysql:8.4')
      .withDatabase('notification_test')
      .withUsername('app')
      .withUserPassword('app_password')
      .withRootPassword('root_password')
      .withCommand([
        '--character-set-server=utf8mb4',
        '--collation-server=utf8mb4_0900_ai_ci',
      ])
      .start(),
    // Same eviction policy as docker-compose.yml; BullMQ requires it.
    new RedisContainer('redis:7.4-alpine')
      .withCommand(['redis-server', '--maxmemory-policy', 'noeviction'])
      .start(),
  ]);

  // Migration tests create and drop tables, so they get their own database.
  await mysql.executeQuery(
    `CREATE DATABASE ${MIGRATION_TEST_DATABASE}; ` +
      `GRANT ALL PRIVILEGES ON ${MIGRATION_TEST_DATABASE}.* TO 'app'@'%';`,
    [],
    true,
  );

  globalThis.__MYSQL_CONTAINER__ = mysql;
  globalThis.__REDIS_CONTAINER__ = redis;

  // Process env takes precedence over .env in ConfigModule, so these win.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: mysql.getHost(),
    DB_PORT: String(mysql.getPort()),
    DB_DATABASE: mysql.getDatabase(),
    DB_USERNAME: mysql.getUsername(),
    DB_PASSWORD: mysql.getUserPassword(),
    REDIS_HOST: redis.getHost(),
    REDIS_PORT: String(redis.getPort()),
    // Explicit so a developer's .env cannot change test behavior.
    SWAGGER_ENABLED: 'false',
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-chars',
    // Suites that need workers turn them on through createTestApp({ env }).
    WORKERS_ENABLED: 'false',
    EMAIL_PROVIDER: 'fake',
    PUSH_PROVIDER: 'fake',
    FAKE_PROVIDER_LATENCY_MS: '0',
  });
}
