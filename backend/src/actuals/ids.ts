const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A malformed id can't name a row. Detail lookups answer "not found" for one
 * without querying — otherwise `pg` raises `22P02` and a typo in the URL becomes
 * a 500 instead of a 404.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
