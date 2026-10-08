import { ProblemException } from '../problem/problem.exception';
import { decodeIdCursor, encodeCursor } from './cursor';

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
