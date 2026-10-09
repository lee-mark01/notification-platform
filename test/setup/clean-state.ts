import Redis from 'ioredis';
import { createTestDataSource, resetDatabase } from '../support/database';

// Runs before each test file, while no app is open (the previous file has
// closed its app). Suites share one Redis and one database, and a new app
// starts working before the file's own beforeEach cleanup: its workers pick
// up jobs left in Redis, and the sweeper's scheduler runs once at start and
// re-queues stale rows left in the database. Both were seen in CI as another
// suite's notification being sent during this suite's first test.
beforeAll(async () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    lazyConnect: true,
  });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();

  const dataSource = await createTestDataSource().initialize();
  try {
    await resetDatabase(dataSource);
  } finally {
    await dataSource.destroy();
  }
});
