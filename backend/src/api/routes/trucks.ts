import type { Pool } from "pg";
import { getTruckDetail, listTruckRoster, listTrucks } from "../../actuals/trucks.js";
import { problemResponse } from "../problem.js";
import { parseWeekQuery } from "../query.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `GET /trucks?week=&currency=` — A8.8's list, one side of one billing week.
 * `week` omitted (D23) returns the plain 27-unit roster instead — no invoice,
 * no spend figures — for a picker that carries no week of its own (New Plan's
 * truck field, A7). A `week` that is present but malformed is still a 400.
 */
export async function handleListTrucks(pool: Pool, url: URL): Promise<Response> {
  if (!url.searchParams.has("week") && !url.searchParams.has("currency") && !url.searchParams.has("units")) {
    return jsonResponse(await listTruckRoster(pool));
  }
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }
  return jsonResponse(await listTrucks(pool, query));
}

/** `GET /trucks/{id}?week=&currency=` — A8.8's detail, with the assignment history. */
export async function handleGetTruck(pool: Pool, id: string, url: URL): Promise<Response> {
  const query = parseWeekQuery(url);
  if (query instanceof Response) {
    return query;
  }

  const detail = await getTruckDetail(pool, id, query);
  if (!detail) {
    return problemResponse({
      title: "Not Found",
      status: 404,
      detail: `No truck with id ${id}`,
      instance: url.pathname,
    });
  }
  return jsonResponse(detail);
}
