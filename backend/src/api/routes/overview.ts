import type { Pool } from "pg";
import { getOverview } from "../../actuals/overview.js";
import { parseWeekQuery } from "../query.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /overview?week=` — A8.1's whole landing screen in one call. Takes the
 * week alone (T-65 shapes the CA and combined panels); `currency`, if sent, is
 * validated like every period-scoped route and otherwise ignored. */
export async function handleGetOverview(pool: Pool, url: URL): Promise<Response> {
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }

  return jsonResponse(await getOverview(pool, query.week, { units: query.units }));
}
