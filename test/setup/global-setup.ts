import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';

declare global {
  var __MYSQL_CONTAINER__: StartedMySqlContainer | undefined;
}

export const MIGRATION_TEST_DATABASE = 'migration_test';

// One MySQL container for the whole E2E run. Tests run serially
// (--runInBand), so they can share it without interfering.
export default async function globalSetup(): Promise<void> {
  const container = await new MySqlContainer('mysql:8.4')
    .withDatabase('notification_test')
    .withUsername('app')
    .withUserPassword('app_password')
    .withRootPassword('root_password')
    .withCommand([
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_0900_ai_ci',
    ])
    .start();

  // Migration tests create and drop tables, so they get their own database.
  await container.executeQuery(
    `CREATE DATABASE ${MIGRATION_TEST_DATABASE}; ` +
      `GRANT ALL PRIVILEGES ON ${MIGRATION_TEST_DATABASE}.* TO 'app'@'%';`,
    [],
    true,
  );

  globalThis.__MYSQL_CONTAINER__ = container;

  // Process env takes precedence over .env in ConfigModule, so these win.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: container.getHost(),
    DB_PORT: String(container.getPort()),
    DB_DATABASE: container.getDatabase(),
    DB_USERNAME: container.getUsername(),
    DB_PASSWORD: container.getUserPassword(),
    REDIS_HOST: process.env.REDIS_HOST ?? 'localhost',
    REDIS_PORT: process.env.REDIS_PORT ?? '6379',
  });
}
