import Redis from 'ioredis';

// Runs before each test file. Suites share one Redis, and a suite can end
// with a job still waiting or delayed. The next suite's workers start with
// its app, before its own beforeEach cleanup, and would pick that job up
// against the new suite's data (seen in CI as a duplicate delivery_attempt
// for notification 1). The previous suite's app is closed by now, so nothing
// is using Redis while it is flushed.
beforeAll(async () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    lazyConnect: true,
  });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();
});
