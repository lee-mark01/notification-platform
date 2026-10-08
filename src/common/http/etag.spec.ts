import { etagFor, ifMatchSatisfied } from './etag';

describe('ETag helpers', () => {
  it('formats the version as a strong ETag', () => {
    expect(etagFor(3)).toBe('"3"');
  });

  it.each([
    ['"3"', true],
    ['"2"', false],
    ['*', true],
    ['"1", "3"', true],
    ['W/"3"', false],
    ['3', false],
  ])('If-Match %s against version 3 -> %s', (header, expected) => {
    expect(ifMatchSatisfied(header, 3)).toBe(expected);
  });
});
