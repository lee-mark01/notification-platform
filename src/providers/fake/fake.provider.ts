import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  type NotificationProvider,
  type OutboundMessage,
  ProviderError,
  type SendResult,
} from '../notification-provider';

export type FakeOutcome =
  | { kind: 'success' }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string; invalidRecipient?: boolean };

/**
 * Stands in for SES and FCM (D7). Tests script the next outcomes, a latency,
 * or a random failure rate, then read what was sent.
 */
@Injectable()
export class FakeProvider implements NotificationProvider {
  readonly name = 'fake';
  private readonly logger = new Logger(FakeProvider.name);
  readonly sent: OutboundMessage[] = [];
  latencyMs: number;
  failureRate = 0;
  private readonly outcomes: FakeOutcome[] = [];

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.latencyMs = config.get('FAKE_PROVIDER_LATENCY_MS', { infer: true });
  }

  /** Outcomes for the next sends, in order; afterwards sends succeed. */
  script(...outcomes: FakeOutcome[]): void {
    this.outcomes.push(...outcomes);
  }

  reset(): void {
    this.sent.length = 0;
    this.outcomes.length = 0;
    this.failureRate = 0;
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (this.latencyMs > 0) await sleep(this.latencyMs);

    const outcome = this.outcomes.shift() ?? this.randomOutcome();
    if (outcome.kind !== 'success') {
      throw new ProviderError(
        outcome.code,
        outcome.kind === 'transient',
        `fake ${outcome.kind} error`,
        outcome.kind === 'permanent' && outcome.invalidRecipient === true,
      );
    }
    this.sent.push(message);
    // One line per delivered message: the chaos scripts count these across
    // worker restarts to measure duplicate sends (scenario 6).
    this.logger.log(`delivered notification=${message.notificationId}`);
    return { providerMessageId: `fake-${randomUUID()}` };
  }

  private randomOutcome(): FakeOutcome {
    return Math.random() < this.failureRate
      ? { kind: 'transient', code: 'FAKE_RANDOM_FAILURE' }
      : { kind: 'success' };
  }
}
