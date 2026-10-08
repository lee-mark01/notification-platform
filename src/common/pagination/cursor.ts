import { ProblemTypes } from '../problem/problem-types';
import { ProblemException } from '../problem/problem.exception';

// Cursors are opaque to clients (base64url JSON), so the position they encode
// can grow from an id to a compound key without changing the API.
export function encodeCursor(position: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodeIdCursor(cursor: string): { id: number } {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    const id = (parsed as { id?: unknown } | null)?.id;
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) {
      return { id };
    }
  } catch {
    // Fall through to the validation error below.
  }
  throw new ProblemException(
    ProblemTypes.VALIDATION_FAILED,
    'The cursor is not valid.',
    { errors: [{ field: 'cursor', message: 'cursor is malformed' }] },
  );
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
