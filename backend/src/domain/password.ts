import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * scrypt with a random salt per password, self-describing so the
 * parameters can change later without breaking existing hashes.
 * T-05's authorize() calls verifyPassword() against this exact format.
 */
const KEY_LENGTH = 64;
const SCHEME = "scrypt";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `${SCHEME}:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== SCHEME || !saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
