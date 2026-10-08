import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'np_';

/** A new random API key. Shown to the operator once and never stored. */
export function generateApiKey(): string {
  return PREFIX + randomBytes(32).toString('base64url');
}

// Keys are 256-bit random values, so a fast unsalted hash is enough: there is
// nothing to brute-force from a dictionary, unlike user passwords.
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}
