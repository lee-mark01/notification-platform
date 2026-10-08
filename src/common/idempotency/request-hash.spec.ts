import { canonicalJson, requestHash } from './request-hash';

describe('requestHash', () => {
  it('ignores object key order at every level', () => {
    const a = { channel: 'email', recipient: { userId: 1, email: 'a@b.c' } };
    const b = { recipient: { email: 'a@b.c', userId: 1 }, channel: 'email' };

    expect(requestHash(a)).toBe(requestHash(b));
  });

  it('treats undefined properties as absent', () => {
    expect(requestHash({ a: 1, b: undefined })).toBe(requestHash({ a: 1 }));
  });

  it('distinguishes different values, types, and array order', () => {
    expect(requestHash({ code: '1' })).not.toBe(requestHash({ code: 1 }));
    expect(requestHash({ v: [1, 2] })).not.toBe(requestHash({ v: [2, 1] }));
  });

  it('produces 64 hex characters', () => {
    expect(requestHash({})).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serializes deterministically', () => {
    expect(canonicalJson({ b: [true, null], a: 'x' })).toBe(
      '{"a":"x","b":[true,null]}',
    );
  });
});
