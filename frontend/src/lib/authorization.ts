const SIGNIN_PATH = "/signin";

export interface AuthorizationDecision {
  /** A page request with no session: redirect here (307). */
  redirectTo?: string;
  /** An /api/ request with no session: refuse with this status, as application/problem+json. */
  problemStatus?: number;
}

/**
 * The §13 boundary, decided as plain data rather than a Response so it is
 * testable with no Next.js types. A page request with no session gets a
 * redirect; an /api/ request gets a structured refusal instead of a
 * redirect — a redirect answering `fetch` with a 200 sign-in page is the
 * confusing failure this split exists to prevent. Nothing is exempt,
 * including /api/v1/health.
 *
 * /api/auth (next-auth's own routes, which must stay reachable for a
 * session to ever be established) is exempted at the middleware matcher,
 * not here — this function is never called for that path.
 */
export function decideAuthorization(
  pathname: string,
  isLoggedIn: boolean,
): AuthorizationDecision | null {
  const isSignInPage = pathname === SIGNIN_PATH;

  if (isLoggedIn) {
    return isSignInPage ? { redirectTo: "/" } : null;
  }

  if (isSignInPage) {
    return null;
  }

  return pathname.startsWith("/api/") ? { problemStatus: 401 } : { redirectTo: SIGNIN_PATH };
}
