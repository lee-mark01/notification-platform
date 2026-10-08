// Strong ETag derived from the row version. If-Match uses strong comparison
// (RFC 9110 13.1.1), so a weak W/"..." tag would never match.
export function etagFor(version: number): string {
  return `"${version}"`;
}

/**
 * True when an If-Match header value allows modifying a resource whose
 * current version is `version`: "*" or any listed strong tag equal to it.
 */
export function ifMatchSatisfied(ifMatch: string, version: number): boolean {
  const current = etagFor(version);
  return ifMatch
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || tag === current);
}
