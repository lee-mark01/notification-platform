import { Injectable } from '@nestjs/common';

// Bounded so a slow or hanging SNS endpoint cannot hold the webhook request.
const TIMEOUT_MS = 5_000;

/**
 * The two outbound calls the webhook makes: fetching SNS signing
 * certificates and visiting a SubscribeURL. Separate so tests can replace it.
 * Callers check that URLs belong to SNS before calling.
 */
@Injectable()
export class SnsHttp {
  async getText(url: string): Promise<string> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`GET ${new URL(url).host} returned ${response.status}`);
    }
    return response.text();
  }
}
