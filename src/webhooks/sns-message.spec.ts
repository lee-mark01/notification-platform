import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isSnsUrl,
  parseSnsMessage,
  publicKeyFromPem,
  type SnsMessage,
  stringToSign,
  verifySignature,
} from './sns-message';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const notification: SnsMessage = {
  Type: 'Notification',
  MessageId: 'm-1',
  TopicArn: 'arn:aws:sns:ap-northeast-2:123456789012:ses-events',
  Message: '{"eventType":"Delivery"}',
  Timestamp: '2026-10-09T00:00:00.000Z',
  SignatureVersion: '2',
  Signature: '',
  SigningCertURL:
    'https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-x.pem',
};

function signed(message: SnsMessage, key = privateKey): SnsMessage {
  const algorithm =
    message.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256';
  const signature = createSign(algorithm)
    .update(stringToSign(message), 'utf8')
    .sign(key, 'base64');
  return { ...message, Signature: signature };
}

const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

describe('stringToSign', () => {
  it('lists Notification fields in order and skips an absent Subject', () => {
    expect(stringToSign(notification)).toBe(
      'Message\n{"eventType":"Delivery"}\nMessageId\nm-1\n' +
        'Timestamp\n2026-10-09T00:00:00.000Z\n' +
        'TopicArn\narn:aws:sns:ap-northeast-2:123456789012:ses-events\n' +
        'Type\nNotification\n',
    );
    expect(stringToSign({ ...notification, Subject: 'hi' })).toContain(
      'MessageId\nm-1\nSubject\nhi\nTimestamp',
    );
  });

  it('includes SubscribeURL and Token for a subscription confirmation', () => {
    const text = stringToSign({
      ...notification,
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.ap-northeast-2.amazonaws.com/?Action=Confirm',
      Token: 't',
    });
    expect(text).toContain('SubscribeURL\nhttps://sns');
    expect(text).toContain('Token\nt\nTopicArn');
  });
});

describe('verifySignature', () => {
  it.each(['1', '2'])(
    'accepts a valid SignatureVersion %s signature',
    (version) => {
      const message = signed({ ...notification, SignatureVersion: version });
      expect(verifySignature(message, publicKeyFromPem(pem))).toBe(true);
    },
  );

  it('rejects a message changed after signing', () => {
    const message = {
      ...signed(notification),
      Message: '{"eventType":"Bounce"}',
    };
    expect(verifySignature(message, publicKeyFromPem(pem))).toBe(false);
  });

  it('rejects a signature made with another key', () => {
    const message = signed(notification, other.privateKey);
    expect(verifySignature(message, publicKeyFromPem(pem))).toBe(false);
  });

  it('rejects an unknown signature version', () => {
    const message = { ...signed(notification), SignatureVersion: '3' };
    expect(verifySignature(message, publicKeyFromPem(pem))).toBe(false);
  });
});

describe('isSnsUrl', () => {
  it.each([
    ['https://sns.ap-northeast-2.amazonaws.com/cert.pem', true],
    ['https://sns.cn-north-1.amazonaws.com.cn/cert.pem', true],
    ['http://sns.ap-northeast-2.amazonaws.com/cert.pem', false],
    ['https://sns.ap-northeast-2.amazonaws.com.evil.com/cert.pem', false],
    ['https://evil.com/sns.ap-northeast-2.amazonaws.com/cert.pem', false],
    ['https://sns.ap-northeast-2.amazonaws.com:8443/cert.pem', false],
    ['https://sns.ap-northeast-2.amazonaws.com/cert.txt', false],
    ['not a url', false],
  ])('%s -> %s', (url, ok) => {
    expect(isSnsUrl(url, { pem: true })).toBe(ok);
  });
});

describe('parseSnsMessage', () => {
  it('parses a text body', () => {
    expect(parseSnsMessage(JSON.stringify(notification))).toMatchObject({
      Type: 'Notification',
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['missing fields', JSON.stringify({ Type: 'Notification' })],
    ['unknown type', JSON.stringify({ ...notification, Type: 'Other' })],
    ['not a string', { ...notification }],
  ])('rejects %s', (_label, body) => {
    expect(parseSnsMessage(body)).toBeNull();
  });
});

describe('publicKeyFromPem', () => {
  it('reads the key from a real SNS signing certificate', () => {
    // Public certificate downloaded from sns.ap-northeast-2.amazonaws.com.
    const cert = readFileSync(
      join(__dirname, '../../test/fixtures/sns-signing-cert.crt'),
      'utf8',
    );
    expect(publicKeyFromPem(cert).asymmetricKeyType).toBe('rsa');
  });
});
