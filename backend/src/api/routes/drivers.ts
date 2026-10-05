import type { Pool } from "pg";
import { getDriverDetail, listDrivers } from "../../actuals/drivers.js";
import { problemResponse } from "../problem.js";
import { parseWeekQuery } from "../query.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /drivers?week=&currency=` — A8.7's list, one side of one billing week. */
export async function handleListDrivers(pool: Pool, url: URL): Promise<Response> {
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }
  return jsonResponse(await listDrivers(pool, query));
}

/** `GET /drivers/{id}?week=&currency=` — A8.7's detail. A malformed week or an
 * unknown currency is a 400 before anything is looked up; an id that names no
 * driver is a 404. */
export async function handleGetDriver(pool: Pool, id: string, url: URL): Promise<Response> {
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }

  const detail = await getDriverDetail(pool, id, query);
  if (!detail) {
    return problemResponse({
      title: "Not Found",
      status: 404,
      detail: `No driver with id ${id}`,
      instance: url.pathname,
    });
  }
  return jsonResponse(detail);
}
