import { INestApplication } from '@nestjs/common';
import type { BatchResponse, Messaging } from 'firebase-admin/messaging';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import {
  DevicePlatform,
  DeviceToken,
} from '../../src/devices/device-token.entity';
import { FcmProvider } from '../../src/providers/fcm/fcm.provider';
import { TemplateChannel } from '../../src/templates/template.entity';
import { AppUser } from '../../src/users/app-user.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { seedUser } from '../support/seed';

// FCM itself is replaced by a scripted Messaging; the token lookup and
// deactivation run against MySQL.
describe('FcmProvider with the database (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let devices: Repository<DeviceToken>;
  let user: AppUser;
  let other: AppUser;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp();
    dataSource = app.get(DataSource);
    devices = dataSource.getRepository(DeviceToken);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    user = await seedUser(dataSource);
    other = await seedUser(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const addToken = (owner: AppUser, token: string, active = true) =>
    devices.insert({
      userId: owner.id,
      token,
      platform: DevicePlatform.Web,
      active,
      deactivationReason: active ? null : 'registration-token-not-registered',
      lastSeenAt: new Date(),
    });

  const providerReturning = (respond: (tokens: string[]) => BatchResponse) => {
    const sentTo: string[][] = [];
    const messaging = {
      sendEachForMulticast: ({ tokens }: { tokens: string[] }) => {
        sentTo.push(tokens);
        return Promise.resolve(respond(tokens));
      },
    } as unknown as Messaging;
    return { provider: new FcmProvider(messaging, devices), sentTo };
  };

  const push = () => ({
    channel: TemplateChannel.Push as const,
    notificationId: 1,
    userId: user.id,
    title: 't',
    body: 'b',
    data: null,
  });

  it("sends only to the user's active tokens", async () => {
    await addToken(user, 'mine-active');
    await addToken(user, 'mine-inactive', false);
    await addToken(other, 'someone-else');
    const { provider, sentTo } = providerReturning((tokens) => ({
      responses: tokens.map(() => ({ success: true, messageId: 'm' })),
      successCount: tokens.length,
      failureCount: 0,
    }));

    await provider.send(push());

    expect(sentTo).toEqual([['mine-active']]);
  });

  it('deactivates an unregistered token and keeps the others', async () => {
    await addToken(user, 'alive');
    await addToken(user, 'gone');
    const { provider } = providerReturning((tokens) => ({
      responses: tokens.map((token) =>
        token === 'gone'
          ? ({
              success: false,
              error: { code: 'messaging/registration-token-not-registered' },
            } as unknown as BatchResponse['responses'][number])
          : { success: true, messageId: 'm1' },
      ),
      successCount: 1,
      failureCount: 1,
    }));

    await expect(provider.send(push())).resolves.toEqual({
      providerMessageId: 'm1',
    });

    const rows = await devices.find({ order: { token: 'ASC' } });
    expect(rows.map((r) => [r.token, r.active, r.deactivationReason])).toEqual([
      ['alive', true, null],
      ['gone', false, 'registration-token-not-registered'],
    ]);
  });
});
