import { createSign, generateKeyPairSync } from 'node:crypto';
import { type SnsMessage, stringToSign } from '../../src/webhooks/sns-message';

export const TEST_TOPIC = 'arn:aws:sns:ap-northeast-2:123456789012:ses-events';
export const TEST_CERT_URL =
  'https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-test.pem';

// Plays SNS: this key pair stands in for the SNS signing certificate.
export const snsKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const snsPem = snsKeys.publicKey.export({
  type: 'spki',
  format: 'pem',
}) as string;

/** Replaces SnsHttp: serves the test certificate and records every call. */
export function fakeSnsHttp(): {
  getText: (url: string) => Promise<string>;
  fetched: string[];
} {
  const fetched: string[] = [];
  return {
    fetched,
    getText: (url: string) => {
      fetched.push(url);
      return Promise.resolve(url === TEST_CERT_URL ? snsPem : 'ok');
    },
  };
}

export function signSns(
  message: SnsMessage,
  key = snsKeys.privateKey,
): SnsMessage {
  const signature = createSign('RSA-SHA256')
    .update(stringToSign(message), 'utf8')
    .sign(key, 'base64');
  return { ...message, Signature: signature };
}

let sequence = 0;

/** A signed SNS Notification carrying `event` as its Message. */
export function snsNotification(
  event: object,
  overrides: Partial<SnsMessage> = {},
): SnsMessage {
  sequence += 1;
  return signSns({
    Type: 'Notification',
    MessageId: `sns-message-${Date.now()}-${sequence}`,
    TopicArn: TEST_TOPIC,
    Message: JSON.stringify(event),
    Timestamp: new Date().toISOString(),
    SignatureVersion: '2',
    Signature: '',
    SigningCertURL: TEST_CERT_URL,
    ...overrides,
  });
}
