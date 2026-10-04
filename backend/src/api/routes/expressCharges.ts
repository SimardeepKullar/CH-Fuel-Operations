import type { Pool } from "pg";
import { listExpressCharges } from "../../actuals/otherCharges.js";
import { parseWeekQuery } from "../query.js";

/** `GET /express-charges?week=&currency=` — A8.6's Other Charges list. */
export async function handleListExpressCharges(pool: Pool, url: URL): Promise<Response> {
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }

  const result = await listExpressCharges(pool, query);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
