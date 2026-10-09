import {
  createPublicKey,
  createVerify,
  type KeyObject,
  X509Certificate,
} from 'node:crypto';

export type SnsMessageType =
  'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';

export interface SnsMessage {
  Type: SnsMessageType;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const TYPES = new Set<string>([
  'Notification',
  'SubscriptionConfirmation',
  'UnsubscribeConfirmation',
]);
const REQUIRED = [
  'Type',
  'MessageId',
  'TopicArn',
  'Message',
  'Timestamp',
  'SignatureVersion',
  'Signature',
  'SigningCertURL',
] as const;

/** Parses an SNS HTTP body (sent as text/plain); null if it is not one. */
export function parseSnsMessage(body: unknown): SnsMessage | null {
  if (typeof body !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  for (const key of REQUIRED) {
    if (typeof record[key] !== 'string') return null;
  }
  if (!TYPES.has(record.Type as string)) return null;
  return record as unknown as SnsMessage;
}

// Signing certificates and subscription links must come from SNS itself:
// https, an sns.<region>.amazonaws.com host. Otherwise anyone could sign a
// forged message with their own certificate and point us at it.
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isSnsUrl(value: string, { pem }: { pem: boolean }): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    SNS_HOST.test(url.hostname) &&
    url.port === '' &&
    (!pem || url.pathname.endsWith('.pem'))
  );
}

/**
 * The string SNS signed: "Key\nValue\n" for a fixed list of keys in
 * alphabetical order, skipping absent optional ones (AWS SNS documentation,
 * "Verifying the signatures of Amazon SNS messages").
 */
export function stringToSign(message: SnsMessage): string {
  const keys =
    message.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : [
          'Message',
          'MessageId',
          'SubscribeURL',
          'Timestamp',
          'Token',
          'TopicArn',
          'Type',
        ];
  return keys
    .filter((key) => message[key as keyof SnsMessage] !== undefined)
    .map((key) => `${key}\n${message[key as keyof SnsMessage]}\n`)
    .join('');
}

/** SignatureVersion 1 is SHA1withRSA, 2 is SHA256withRSA. */
export function signatureAlgorithm(version: string): string | null {
  if (version === '1') return 'RSA-SHA1';
  if (version === '2') return 'RSA-SHA256';
  return null;
}

export function verifySignature(message: SnsMessage, key: KeyObject): boolean {
  const algorithm = signatureAlgorithm(message.SignatureVersion);
  if (!algorithm) return false;
  const verifier = createVerify(algorithm);
  verifier.update(stringToSign(message), 'utf8');
  try {
    return verifier.verify(key, message.Signature, 'base64');
  } catch {
    return false;
  }
}

/** The key from SNS's X.509 signing certificate, or from a bare PEM key. */
export function publicKeyFromPem(pem: string): KeyObject {
  return pem.includes('BEGIN CERTIFICATE')
    ? new X509Certificate(pem).publicKey
    : createPublicKey(pem);
}
