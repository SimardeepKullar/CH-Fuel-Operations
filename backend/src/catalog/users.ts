import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "../domain/password.js";
import type { UserRole } from "../db/types.js";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

interface UserAuthRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
}

// Hashed once, lazily, so a lookup that finds no user still pays the cost of
// a scrypt comparison. Without this, "unknown email" returns in query time
// alone while "wrong password" returns in query time + scrypt time — that
// gap is what lets a caller enumerate valid emails by timing.
let dummyHash: string | undefined;
function getDummyHash(): string {
  if (!dummyHash) {
    dummyHash = hashPassword("no-such-user-timing-equaliser");
  }
  return dummyHash;
}

/**
 * Looks up a user by email and verifies the password against
 * users.password_hash. Returns null for an unknown email or a wrong
 * password alike, without distinguishing the two and without throwing —
 * T-05's authorize() calls this directly.
 */
export async function authenticateUser(
  pool: Pool,
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const { rows } = await pool.query<UserAuthRow>(
    "SELECT id, email, password_hash, display_name, role FROM users WHERE email = $1",
    [email],
  );
  const user = rows[0];
  const passwordOk = verifyPassword(password, user?.password_hash ?? getDummyHash());

  if (!user || !passwordOk) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
  };
}
