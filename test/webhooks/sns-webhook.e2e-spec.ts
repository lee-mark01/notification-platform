import { INestApplication } from '@nestjs/common';
import { createSign, generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { SnsHttp } from '../../src/webhooks/sns-http';
import { type SnsMessage, stringToSign } from '../../src/webhooks/sns-message';
import { WebhookEvent } from '../../src/webhooks/webhook-event.entity';
import { createTestApp } from '../support/app';
import { createTestDataSource, resetDatabase } from '../support/database';

const TOPIC = 'arn:aws:sns:ap-northeast-2:123456789012:ses-events';
const CERT_URL =
  'https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-test.pem';

// Plays SNS: our key pair stands in for the SNS signing certificate.
const sns = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
const snsPem = sns.publicKey.export({ type: 'spki', format: 'pem' }) as string;

const fetched: string[] = [];
const fakeHttp = {
  getText: (url: string) => {
    fetched.push(url);
    return Promise.resolve(url === CERT_URL ? snsPem : 'ok');
  },
};

function sign(message: SnsMessage, key = sns.privateKey): SnsMessage {
  const signature = createSign('RSA-SHA256')
    .update(stringToSign(message), 'utf8')
    .sign(key, 'base64');
  return { ...message, Signature: signature };
}

let sequence = 0;
function notification(overrides: Partial<SnsMessage> = {}): SnsMessage {
  sequence += 1;
  return {
    Type: 'Notification',
    MessageId: `sns-message-${sequence}`,
    TopicArn: TOPIC,
    Message: JSON.stringify({
      eventType: 'Delivery',
      mail: { messageId: 'ses-1' },
    }),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '2',
    Signature: '',
    SigningCertURL: CERT_URL,
    ...overrides,
  };
}

describe('POST /webhooks/ses (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  beforeAll(async () => {
    const migrator = await createTestDataSource().initialize();
    await migrator.runMigrations();
    await migrator.destroy();

    app = await createTestApp({
      env: { SNS_TOPIC_ARN: TOPIC },
      overrides: [{ provide: SnsHttp, factory: () => fakeHttp }],
    });
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await resetDatabase(dataSource);
    fetched.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  // SNS sends JSON with Content-Type text/plain.
  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/webhooks/ses')
      .set('Content-Type', 'text/plain; charset=UTF-8')
      .send(typeof body === 'string' ? body : JSON.stringify(body));

  const events = () => dataSource.getRepository(WebhookEvent).find();

  it('stores a signed notification with its SES event type', async () => {
    const message = sign(notification());

    const res = await post(message).expect(200);

    expect(res.body).toEqual({ result: 'stored' });
    expect(await events()).toEqual([
      expect.objectContaining({
        snsMessageId: message.MessageId,
        eventType: 'Delivery',
        notificationId: null,
        processedAt: null,
        payload: { eventType: 'Delivery', mail: { messageId: 'ses-1' } },
      }),
    ]);
  });

  it('scenario 10: stores a redelivered message once', async () => {
    const message = sign(notification());

    await post(message).expect(200);
    const again = await post(message).expect(200);

    expect(again.body).toEqual({ result: 'duplicate' });
    expect(await events()).toHaveLength(1);
  });

  describe('scenario 11: rejects what SNS did not sign, storing nothing', () => {
    it('a signature made with another key', async () => {
      const res = await post(sign(notification(), attacker.privateKey)).expect(
        403,
      );
      expect(res.body).toMatchObject({ type: '/problems/webhook-rejected' });
      expect(await events()).toHaveLength(0);
    });

    it('a message changed after signing', async () => {
      const message = {
        ...sign(notification()),
        Message: JSON.stringify({ eventType: 'Bounce' }),
      };
      await post(message).expect(403);
      expect(await events()).toHaveLength(0);
    });

    it('a certificate not served by SNS, without fetching it', async () => {
      const message = sign(
        notification({ SigningCertURL: 'https://evil.example.com/cert.pem' }),
        attacker.privateKey,
      );
      await post(message).expect(403);
      expect(fetched).toEqual([]);
      expect(await events()).toHaveLength(0);
    });

    it('a validly signed message from another topic', async () => {
      await post(
        sign(notification({ TopicArn: 'arn:aws:sns:ap-northeast-2:1:other' })),
      ).expect(403);
      expect(await events()).toHaveLength(0);
    });
  });

  it('rejects a body that is not an SNS message with 400', async () => {
    await post('hello').expect(400);
  });

  describe('subscription confirmation', () => {
    const confirmation = (subscribeUrl: string) =>
      sign({
        ...notification(),
        Type: 'SubscriptionConfirmation',
        Message: 'You have chosen to subscribe',
        SubscribeURL: subscribeUrl,
        Token: 'token',
      });

    it('visits the SubscribeURL of a verified message', async () => {
      const url =
        'https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription&Token=token';

      const res = await post(confirmation(url)).expect(200);

      expect(res.body).toEqual({ result: 'subscribed' });
      expect(fetched).toContain(url);
      expect(await events()).toHaveLength(0);
    });

    it('refuses a SubscribeURL outside SNS', async () => {
      await post(confirmation('https://evil.example.com/confirm')).expect(403);
      expect(fetched).not.toContain('https://evil.example.com/confirm');
    });
  });
});
