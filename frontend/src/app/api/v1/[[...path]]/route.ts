import { createApp } from "@ch/core/api/app";
import { auth } from "../../../../auth";

// A thin adapter over backend/src/api's framework-free route table (§13).
// No business logic lives here — it only translates a Next `Request` into
// the app's `handle()` and returns the `Response` it gives back.
const app = createApp();

// `auth()` reads the session cookie via Next's request-scoped context, not
// from `request` itself, so it works unmodified inside a Route Handler
// (same call `layout.tsx` makes). This is the one place a bare `Request`
// gains an identity before reaching the framework-free app — routes that
// need one (receipt_checks.checked_by) read it off `context`, never off a
// header a client could set itself.
async function handle(request: Request): Promise<Response> {
  const session = await auth();
  return app.handle(request, { userId: session?.user?.id });
}

export {
  handle as DELETE,
  handle as GET,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
