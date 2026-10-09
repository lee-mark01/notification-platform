import { ProblemException } from '../problem/problem.exception';
import { decodeIdCursor, decodeTimeIdCursor, encodeCursor } from './cursor';

describe('id cursor', () => {
  it('round-trips an id', () => {
    expect(decodeIdCursor(encodeCursor({ id: 42 }))).toEqual({ id: 42 });
  });

  it.each([
    ['not base64 json', 'not-a-cursor'],
    ['missing id', encodeCursor({ other: 1 })],
    ['non-integer id', encodeCursor({ id: 1.5 })],
    ['negative id', encodeCursor({ id: -1 })],
    ['string id', encodeCursor({ id: '1' })],
  ])('rejects %s as a validation problem', (_label, cursor) => {
    expect(() => decodeIdCursor(cursor)).toThrow(ProblemException);
  });
});

describe('time and id cursor', () => {
  it('round-trips a created time and id', () => {
    const at = new Date('2026-10-09T01:02:03.456Z');
    expect(
      decodeTimeIdCursor(encodeCursor({ at: at.toISOString(), id: 7 })),
    ).toEqual({ at, id: 7 });
  });

  it.each([
    ['bad date', encodeCursor({ at: 'yesterday', id: 1 })],
    ['missing id', encodeCursor({ at: '2026-10-09T00:00:00.000Z' })],
  ])('rejects %s', (_label, cursor) => {
    expect(() => decodeTimeIdCursor(cursor)).toThrow(ProblemException);
  });
});
