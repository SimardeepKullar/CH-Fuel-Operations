import { NextResponse } from "next/server";
import { auth } from "./auth";
import { decideAuthorization } from "./lib/authorization";

// Named proxy.ts, not middleware.ts (Next 16 renamed it; proxy.ts always
// runs on the Node.js runtime). That matters here: the credentials
// provider pulled in through ./auth uses node:crypto via T-03's
// password.ts, which the Edge runtime middleware.ts would have run under
// does not support.
//
// Thin wrapper: all the actual boundary logic lives in decideAuthorization()
// so it is unit-testable with no Next.js/next-auth types. This file only
// translates that decision into a real NextResponse.
export default auth((request) => {
  const decision = decideAuthorization(request.nextUrl.pathname, Boolean(request.auth));
  if (!decision) {
    return NextResponse.next();
  }

  if (decision.redirectTo) {
    return NextResponse.redirect(new URL(decision.redirectTo, request.url));
  }

  const status = decision.problemStatus!;
  return NextResponse.json(
    {
      type: "about:blank",
      title: "Unauthorized",
      status,
      detail: `Authentication required for ${request.nextUrl.pathname}`,
      instance: request.nextUrl.pathname,
    },
    { status, headers: { "content-type": "application/problem+json" } },
  );
});

export const config = {
  // /api/auth stays reachable so a session can be established at all.
  // Static assets are excluded so the signin page itself can load its CSS
  // and icons before a session exists.
  matcher: ["/((?!api/auth|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|ico|webp)$).*)"],
};
