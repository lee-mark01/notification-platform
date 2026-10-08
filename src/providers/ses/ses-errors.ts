import { ProviderError } from '../notification-provider';

// SendEmail errors (SES API v2 reference) that may succeed if sent later:
// throttling, quota, and SES-side failures.
const TRANSIENT = new Set([
  'TooManyRequestsException',
  'LimitExceededException',
  'InternalServiceErrorException',
  // Account or configuration problems are not this message's fault. Retrying
  // ends in the DLQ, where it can be redriven once an operator fixes the
  // account, instead of failing every message permanently.
  'AccountSuspendedException',
  'SendingPausedException',
  'MailFromDomainNotVerifiedException',
  'NotFoundException',
]);

// The message itself is unacceptable (bad address, rejected content, or in
// the sandbox an unverified recipient). Sending it again cannot help.
const PERMANENT = new Set(['MessageRejected', 'BadRequestException']);

/** Maps an SES SDK error to a classified ProviderError. */
export function classifySesError(error: unknown): ProviderError {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const message = error instanceof Error ? error.message : String(error);

  if (PERMANENT.has(name)) return new ProviderError(name, false, message);
  if (TRANSIENT.has(name)) return new ProviderError(name, true, message);

  // Timeouts, connection resets and 5xx without a modeled error are network
  // or service hiccups; anything else unknown is also safer to retry.
  return new ProviderError(name, true, message);
}
