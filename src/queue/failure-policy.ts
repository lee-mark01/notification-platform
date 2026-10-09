import { ProviderError } from '../providers/notification-provider';

export interface ClassifiedFailure {
  code: string;
  transient: boolean;
  message: string;
}

/**
 * Normalizes a send failure. Provider adapters classify their own errors;
 * anything else (a bug, a network error an adapter did not catch) is treated
 * as transient, since retrying ends in the DLQ where a person can look,
 * while a wrong "permanent" drops the message for good.
 */
export function classifyError(error: unknown): ClassifiedFailure {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      transient: error.transient,
      message: error.message,
    };
  }
  return {
    code: 'UNCLASSIFIED',
    transient: true,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** What the worker does with a failed attempt. */
export enum FailureAction {
  /** RETRYING, then BullMQ retries after an exponential backoff. */
  Retry = 'retry',
  /** DEAD and moved to the DLQ: transient, but out of attempts. */
  Dead = 'dead',
  /** FAILED at once: the error is permanent. */
  Fail = 'fail',
}

/**
 * @param attemptsMade attempts already finished before this one (BullMQ's
 *   job.attemptsMade while processing)
 * @param maxAttempts the job's attempts option
 */
export function decideFailure(
  failure: Pick<ClassifiedFailure, 'transient'>,
  attemptsMade: number,
  maxAttempts: number,
): FailureAction {
  if (!failure.transient) return FailureAction.Fail;
  return attemptsMade + 1 >= maxAttempts
    ? FailureAction.Dead
    : FailureAction.Retry;
}
