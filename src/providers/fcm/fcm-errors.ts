// FCM error codes from firebase-admin (lib/messaging/error.js), per token.

// The token will never work again: deactivate it.
export const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// Returned for a bad payload and also for a malformed token.
export const INVALID_ARGUMENT = 'messaging/invalid-argument';

// The message itself is unacceptable; resending it cannot help.
const PAYLOAD_CODES = new Set([
  INVALID_ARGUMENT,
  'messaging/invalid-payload',
  'messaging/invalid-data-payload-key',
  'messaging/invalid-options',
  'messaging/invalid-recipient',
  'messaging/payload-size-limit-exceeded',
]);

/** The FirebaseError code, or a stand-in for errors without one. */
export function fcmErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'messaging/unknown-error';
}

/**
 * Everything else may succeed later: server errors, rate limits, and also
 * credential errors (third-party-auth-error, mismatched-credential). Those
 * are on our side, not the message's, so they go through retries to the DLQ
 * and can be redriven once fixed. Unknown codes are retried too.
 */
export function isTransientFcmCode(code: string): boolean {
  return !DEAD_TOKEN_CODES.has(code) && !PAYLOAD_CODES.has(code);
}
