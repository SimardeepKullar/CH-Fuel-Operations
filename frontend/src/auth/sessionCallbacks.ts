/**
 * The two Auth.js callbacks, kept pure so they are testable without Next's runtime (`auth.ts`
 * imports `next/server` and cannot be loaded in a unit test).
 *
 * Auth.js does not put the user's id on `session.user` — only name, email and image. The API reads
 * `session.user.id` as the acting user (`receipt_checks.checked_by`), and the receipt routes refuse a
 * request without one, so the id has to be carried from the token to the session here.
 */

interface TokenLike {
  sub?: string;
  role?: string;
}

interface SessionLike {
  user: { id: string; role: string };
}

/** Runs at sign-in with `user` and on later requests without one; only sign-in changes the token. */
export function applyUserToToken<T extends TokenLike>(token: T, user: { id?: string; role?: string } | undefined): T {
  if (!user) return token;
  return { ...token, sub: user.id ?? token.sub, role: user.role };
}

export function applySessionUser<S extends SessionLike>(session: S, token: TokenLike): S {
  session.user.id = token.sub ?? "";
  session.user.role = token.role ?? "dispatcher";
  return session;
}
