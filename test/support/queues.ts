import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QueueNames, type QueueName } from '../../src/queue/queue.constants';
import { WorkersService } from '../../src/queue/workers.service';

export function getQueue(app: INestApplication, name: QueueName): Queue {
  return app.get<Queue>(getQueueToken(name));
}

// Notification ids restart after resetDatabase(), so jobs left by an earlier
// test would collide with new job ids. drain + clean rather than obliterate:
// obliterate pauses the queue and deletes its metadata, which can race the
// live workers of suites that run them. Every test waits for its own jobs to
// finish, so nothing is active here.
export async function resetQueues(app: INestApplication): Promise<void> {
  await Promise.all(
    Object.values(QueueNames).map(async (name) => {
      const queue = getQueue(app, name);
      await queue.drain(true);
      for (const type of ['completed', 'failed', 'wait', 'paused'] as const) {
        await queue.clean(0, 0, type);
      }
    }),
  );
}

// For suites that run workers: wait until producers and workers are connected
// so the first test does not race the connection setup on a busy machine.
export async function waitForQueues(app: INestApplication): Promise<void> {
  await Promise.all(
    Object.values(QueueNames).map((name) =>
      getQueue(app, name).waitUntilReady(),
    ),
  );
  await app.get(WorkersService).ready();
}
