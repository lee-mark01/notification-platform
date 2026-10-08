import { QueryFailedError } from 'typeorm';

/** MySQL error 1062: a row violated a unique index. */
export function isDuplicateEntryError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const code = (error.driverError as { code?: unknown } | undefined)?.code;
  return code === 'ER_DUP_ENTRY';
}
