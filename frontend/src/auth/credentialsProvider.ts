import Credentials from "next-auth/providers/credentials";
import { authenticateUser } from "@ch/core/catalog/users";
import { getPool } from "@ch/core/db/pool";
import type { User } from "next-auth";

// Exported directly (not read back off the Credentials() provider object —
// that object's own `authorize` is an internal no-op stub; the config it
// wraps is only invoked from inside NextAuth's own request flow) so this
// function is unit-testable without pulling in next-auth's main entry
// point, which imports "next/server" and cannot be resolved outside a
// Next.js runtime.
export async function authorize(
  credentials: Partial<Record<string, unknown>>,
): Promise<User | null> {
  const email = typeof credentials?.email === "string" ? credentials.email : undefined;
  const password = typeof credentials?.password === "string" ? credentials.password : undefined;
  if (!email || !password) {
    return null;
  }

  const user = await authenticateUser(getPool(), email, password);
  if (!user) {
    return null;
  }

  return { id: user.id, email: user.email, name: user.displayName, role: user.role };
}

export const credentialsProvider = Credentials({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  authorize,
});
