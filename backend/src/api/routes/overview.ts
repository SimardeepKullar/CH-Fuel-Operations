import type { Pool } from "pg";
import { getOverview } from "../../actuals/overview.js";
import { badRequest, currencySchema, parseWeekQuery } from "../query.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /overview?week=` — A8.1's whole landing screen in one call, as `{ us,
 * ca, combined, fx }` (T-65). `units` sets the unit of every per-unit rate and
 * quantity; `convertTo=USD|CAD` the combined panel's currency (USD when
 * absent). Neither converts a side's own figures. `currency`, if sent, is
 * validated like every period-scoped route and otherwise ignored. */
export async function handleGetOverview(pool: Pool, url: URL): Promise<Response> {
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }
  const convertTo = currencySchema.optional().safeParse(url.searchParams.get("convertTo") ?? undefined);
  if (!convertTo.success) {
    return badRequest(url, convertTo.error.message);
  }

  return jsonResponse(await getOverview(pool, query.week, { units: query.units, convertTo: convertTo.data ?? null }));
}
