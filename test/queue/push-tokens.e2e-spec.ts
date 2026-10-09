import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type {
  BatchResponse,
  Messaging,
  SendResponse,
} from 'firebase-admin/messaging';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import {
  DevicePlatform,
  DeviceToken,
} from '../../src/devices/device-token.entity';
import { DeliveryAttempt } from '../../src/notifications/delivery-attempt.entity';
import { Notification } from '../../src/notifications/notification.entity';
import { NotificationStatus } from '../../src/notifications/notification.enums';
import { FcmProvider } from '../../src/providers/fcm/fcm.provider';
import { PUSH_PROVIDER } from '../../src/providers/provider-registry';
import { jobIdFor, QueueNames } from '../../src/queue/queue.constants';
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { getQueue, resetQueues, waitForQueues } from '../support/queues';
import { seedClient, seedPushTemplate, seedUser } from '../support/seed';
import { waitFor } from '../support/wait';

// Tokens FCM no longer knows. Everything else is accepted.
const unregistered = new Set<string>();
const fcmCalls: string[][] = [];

const messaging = {
  sendEachForMulticast: ({ tokens }: { tokens: string[] }) => {
    fcmCalls.push(tokens);
    const responses: SendResponse[] = tokens.map((token) =>
      unregistered.has(token)
        ? ({
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          } as unknown as SendResponse)
        : { success: true, messageId: `fcm-${token}` },
    );
    const successCount = responses.filter((r) => r.success).length;
    return Promise.resolve<BatchResponse>({
      responses,
      successCount,
      failureCount: responses.length - successCount,
    });
  },
} as unknown as Messaging;

describe('Scenario 9: unregistered FCM tokens through the worker (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let apiKey: string;
  let user: AppUser;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({
      env: { WORKERS_ENABLED: 'true' },
      // The real FcmProvider (token lookup, classification, deactivation)
      // over a scripted FCM.
      overrides: [
        {
          provide: PUSH_PROVIDER,
          inject: [getRepositoryToken(DeviceToken)],
          factory: (devices: Repository<DeviceToken>) =>
            new FcmProvider(messaging, devices),
        },
      ],
    });
    await waitForQueues(app);
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    await resetQueues(app);
    unregistered.clear();
    fcmCalls.length = 0;
    ({ apiKey } = await seedClient(dataSource));
    user = await seedUser(dataSource);
    await seedPushTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const addToken = (token: string) =>
    dataSource.getRepository(DeviceToken).insert({
      userId: user.id,
      token,
      platform: DevicePlatform.Web,
      active: true,
      deactivationReason: null,
      lastSeenAt: new Date(),
    });

  const push = async (): Promise<number> => {
    const res = await request(app.getHttpServer())
      .post('/notifications')
      .set('X-API-Key', apiKey)
      .set('Idempotency-Key', randomUUID())
      .send({
        channel: 'push',
        category: 'transactional',
        templateKey: 'chat-new-message',
        recipient: { userId: user.id },
        variables: { sender: 'Kim', preview: 'hello' },
      })
      .expect(202);
    return (res.body as { id: number }).id;
  };

  const settled = (id: number, status: NotificationStatus) =>
    waitFor(async () => {
      const row = await dataSource
        .getRepository(Notification)
        .findOneByOrFail({ id });
      return row.status === status ? row : undefined;
    });

  const tokens = async () =>
    (
      await dataSource
        .getRepository(DeviceToken)
        .find({ order: { token: 'ASC' } })
    ).map((t) => [t.token, t.active, t.deactivationReason]);

  it('fails without retrying and deactivates every token when all are unregistered', async () => {
    await addToken('gone-1');
    await addToken('gone-2');
    unregistered.add('gone-1').add('gone-2');

    const id = await push();

    const row = await settled(id, NotificationStatus.Failed);
    expect(row.lastErrorCode).toBe(
      'messaging/registration-token-not-registered',
    );
    // One attempt, one FCM call: a permanent error is not retried.
    expect(
      await dataSource
        .getRepository(DeliveryAttempt)
        .countBy({ notificationId: id }),
    ).toBe(1);
    expect(fcmCalls).toHaveLength(1);
    // FAILED is written before BullMQ finishes the job; wait for that.
    await waitFor(async () => {
      const found = await getQueue(app, QueueNames.PushTransactional).getJob(
        jobIdFor(id),
      );
      return (await found?.getState()) === 'failed' ? true : undefined;
    });
    // Read again: the snapshot above may predate the move to failed.
    const finished = await getQueue(app, QueueNames.PushTransactional).getJob(
      jobIdFor(id),
    );
    expect(finished?.attemptsMade).toBe(1);
    expect(await tokens()).toEqual([
      ['gone-1', false, 'registration-token-not-registered'],
      ['gone-2', false, 'registration-token-not-registered'],
    ]);
  });

  it('sends to the live token and deactivates only the unregistered one', async () => {
    await addToken('alive');
    await addToken('gone');
    unregistered.add('gone');

    const id = await push();

    const row = await settled(id, NotificationStatus.Sent);
    expect(row.providerMessageId).toBe('fcm-alive');
    expect(await tokens()).toEqual([
      ['alive', true, null],
      ['gone', false, 'registration-token-not-registered'],
    ]);
  });

  it('does not call FCM again for a deactivated token', async () => {
    await addToken('gone');
    unregistered.add('gone');
    await settled(await push(), NotificationStatus.Failed);

    const second = await push();

    const row = await settled(second, NotificationStatus.Failed);
    expect(row.lastErrorCode).toBe('NO_ACTIVE_DEVICE');
    expect(fcmCalls).toHaveLength(1);
  });
});
