import type { Pool } from "pg";
import { getHealthStatus } from "../../catalog/health.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /health` (T-18 step 18.2, A16). `pool` is whatever `app.ts` was
 * given — possibly `undefined` in production, where `getHealthStatus`
 * resolves it lazily so a missing `DATABASE_URL` degrades `db.reachable`
 * instead of crashing the request. */
export async function handleGetHealth(pool: Pool | undefined): Promise<Response> {
  return jsonResponse(await getHealthStatus(pool));
}
