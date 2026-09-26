import type { Pool } from "pg";
import { z } from "zod";
import { loadPlanDispatchStatus, setPlanDispatched } from "../../planning/planPersistence.js";
import { problemResponse } from "../problem.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const patchPlanRequestSchema = z.object({ sentToDriver: z.boolean() }).strict();

/**
 * `PATCH /plans/{id}` (T-19) — dispatcher bookkeeping that survives a
 * reload. A flag only: it does not freeze the plan, stop re-pricing, or
 * touch `plan_stops`/totals — a third axis alongside solve status and trip
 * lifecycle (UI contract §3.10/§7), not folded into either.
 *
 * `userId` is required by the caller (`app.ts` calls `requireUser()` before
 * reaching here, the same pattern `/receipt-checks` uses) but is never
 * persisted: `plans` takes no new column for T-19 (PROJECT-SCOPE-v2.md A11,
 * "no new columns") — the acting user is an auth/attribution boundary, not
 * stored data.
 *
 * Restricted to `status = 'completed'` plans. An infeasible plan has no
 * route, no stops and no `googleMapsUrl` — there is nothing to have sent a
 * driver, so this 409s rather than silently accepting the flag.
 */
export async function handlePatchPlan(pool: Pool, id: string, request: Request, url: URL, _userId: string): Promise<Response> {
  if (!z.string().uuid().safeParse(id).success) {
    return problemResponse({ title: "Not Found", status: 404, detail: `No plan with id ${id}`, instance: url.pathname });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemResponse({ title: "Bad Request", status: 400, detail: "expected a JSON body", instance: url.pathname });
  }

  const parsed = patchPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }

  const existing = await loadPlanDispatchStatus(pool, id);
  if (!existing) {
    return problemResponse({ title: "Not Found", status: 404, detail: `No plan with id ${id}`, instance: url.pathname });
  }

  if (existing.status === "infeasible") {
    return problemResponse({
      title: "Conflict",
      status: 409,
      detail: "An infeasible plan has no route to send a driver",
      instance: url.pathname,
    });
  }

  const dispatchedAt = await setPlanDispatched(pool, id, parsed.data.sentToDriver);
  return jsonResponse({
    planId: id,
    sentToDriver: dispatchedAt !== null,
    sentToDriverAt: dispatchedAt ? dispatchedAt.toISOString() : null,
  });
}
