import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ApiClient } from '../../src/clients/api-client.entity';
import { Notification } from '../../src/notifications/notification.entity';
import {
  NotificationCategory,
  NotificationStatus,
} from '../../src/notifications/notification.enums';
import { Suppression } from '../../src/suppressions/suppression.entity';
import { Template, TemplateChannel } from '../../src/templates/template.entity';
import { SesEventProcessor } from '../../src/webhooks/ses-event.processor';
import { SnsHttp } from '../../src/webhooks/sns-http';
import type { SnsMessage } from '../../src/webhooks/sns-message';
import { WebhookEvent } from '../../src/webhooks/webhook-event.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';
import { seedClient, seedEmailTemplate } from '../support/seed';
import { fakeSnsHttp, snsNotification, TEST_TOPIC } from '../support/sns';

const SES_ID = '0100018b-test-0001';

describe('SES events applied to notifications (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let client: ApiClient;
  let template: Template;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({
      env: { SNS_TOPIC_ARN: TEST_TOPIC },
      overrides: [{ provide: SnsHttp, factory: () => fakeSnsHttp() }],
    });
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    ({ client } = await seedClient(dataSource));
    template = await seedEmailTemplate(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const insert = async (
    overrides: Partial<Notification> = {},
  ): Promise<number> =>
    (
      await dataSource.getRepository(Notification).save({
        clientId: client.id,
        userId: null,
        templateId: template.id,
        templateVersion: 1,
        channel: TemplateChannel.Email,
        category: NotificationCategory.Transactional,
        status: NotificationStatus.Sent,
        recipientEmail: 'someone@example.com',
        variables: {},
        renderedTitle: 't',
        renderedBody: 'b',
        renderedText: null,
        providerMessageId: SES_ID,
        sentAt: new Date(),
        ...overrides,
      })
    ).id;

  const post = (message: SnsMessage) =>
    request(app.getHttpServer())
      .post('/webhooks/ses')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(message))
      .expect(200);

  const row = (id: number) =>
    dataSource.getRepository(Notification).findOneByOrFail({ id });

  const mail = { messageId: SES_ID, destination: ['someone@example.com'] };
  const delivery = (timestamp = '2026-10-09T01:00:00.000Z') =>
    snsNotification({ eventType: 'Delivery', mail, delivery: { timestamp } });
  const bounce = (bounceType: string, email = 'someone@example.com') =>
    snsNotification({
      eventType: 'Bounce',
      mail,
      bounce: { bounceType, bouncedRecipients: [{ emailAddress: email }] },
    });
  const complaint = () =>
    snsNotification({
      eventType: 'Complaint',
      mail,
      complaint: {
        complainedRecipients: [{ emailAddress: 'someone@example.com' }],
      },
    });
  const open = (timestamp: string) =>
    snsNotification({ eventType: 'Open', mail, open: { timestamp } });

  it('marks a SENT notification DELIVERED at the reported time', async () => {
    const id = await insert();

    await post(delivery('2026-10-09T01:00:00.000Z'));

    const after = await row(id);
    expect(after.status).toBe(NotificationStatus.Delivered);
    expect(after.deliveredAt?.toISOString()).toBe('2026-10-09T01:00:00.000Z');
    expect(await dataSource.getRepository(WebhookEvent).find()).toEqual([
      expect.objectContaining({
        notificationId: id,
        processedAt: expect.any(Date) as Date,
      }),
    ]);
  });

  it('marks a permanent bounce BOUNCED and suppresses the address', async () => {
    const id = await insert();

    await post(bounce('Permanent', 'Someone@Example.com'));

    expect((await row(id)).status).toBe(NotificationStatus.Bounced);
    expect(await dataSource.getRepository(Suppression).find()).toEqual([
      expect.objectContaining({
        email: 'someone@example.com',
        reason: 'HARD_BOUNCE',
        releasedAt: null,
      }),
    ]);
  });

  it('ignores a transient bounce: no status change, no suppression', async () => {
    const id = await insert();

    await post(bounce('Transient'));

    expect((await row(id)).status).toBe(NotificationStatus.Sent);
    expect(await dataSource.getRepository(Suppression).count()).toBe(0);
  });

  it('moves a delivered notification to COMPLAINED and suppresses', async () => {
    const id = await insert();

    await post(delivery());
    await post(complaint());

    expect((await row(id)).status).toBe(NotificationStatus.Complained);
    expect(await dataSource.getRepository(Suppression).find()).toEqual([
      expect.objectContaining({ reason: 'COMPLAINT' }),
    ]);
  });

  it('ignores a Delivery that arrives after a bounce', async () => {
    const id = await insert();

    await post(bounce('Permanent'));
    await post(delivery());

    const after = await row(id);
    expect(after.status).toBe(NotificationStatus.Bounced);
    expect(after.deliveredAt).toBeNull();
  });

  it('records the first open as the read time and keeps it', async () => {
    const id = await insert();

    await post(open('2026-10-09T02:00:00.000Z'));
    await post(open('2026-10-09T03:00:00.000Z'));

    const after = await row(id);
    expect(after.readAt?.toISOString()).toBe('2026-10-09T02:00:00.000Z');
    expect(after.status).toBe(NotificationStatus.Sent);
  });

  it('keeps an event that arrives before SENT and applies it on a later sweep', async () => {
    // SES reported the delivery before the worker recorded SENT.
    const id = await insert({
      status: NotificationStatus.Sending,
      providerMessageId: null,
      sentAt: null,
    });

    await post(delivery());

    const [stored] = await dataSource.getRepository(WebhookEvent).find();
    expect(stored).toMatchObject({ notificationId: null, processedAt: null });

    // The worker now records SENT; the maintenance job retries the event.
    await dataSource.getRepository(Notification).update(id, {
      status: NotificationStatus.Sent,
      providerMessageId: SES_ID,
    });
    expect(await app.get(SesEventProcessor).reprocessPending()).toBe(1);

    expect((await row(id)).status).toBe(NotificationStatus.Delivered);
    expect(
      await dataSource
        .getRepository(WebhookEvent)
        .findOneByOrFail({ id: stored.id }),
    ).toMatchObject({
      notificationId: id,
      processedAt: expect.any(Date) as Date,
    });
  });

  it('suppresses a hard bounce at once and stops matching after 24 hours', async () => {
    await post(bounce('Permanent', 'gone@example.com'));

    // The address is blocked even though no notification matched yet.
    expect(await dataSource.getRepository(Suppression).find()).toEqual([
      expect.objectContaining({
        email: 'gone@example.com',
        reason: 'HARD_BOUNCE',
      }),
    ]);
    const [stored] = await dataSource.getRepository(WebhookEvent).find();
    expect(stored.processedAt).toBeNull();

    const later = new Date(stored.receivedAt.getTime() + 25 * 60 * 60 * 1000);
    await app.get(SesEventProcessor).reprocessPending(later);

    expect(
      await dataSource
        .getRepository(WebhookEvent)
        .findOneByOrFail({ id: stored.id }),
    ).toMatchObject({
      notificationId: null,
      processedAt: expect.any(Date) as Date,
    });
  });
});
