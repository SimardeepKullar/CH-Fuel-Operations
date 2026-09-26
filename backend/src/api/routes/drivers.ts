import type { Pool } from "pg";
import { z } from "zod";
import { getDriverDetail, listDrivers } from "../../actuals/drivers.js";
import { problemResponse } from "../problem.js";

const querySchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period must be a YYYY-MM-DD date"),
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `GET /drivers?period=` — A8.7's list. */
export async function handleListDrivers(pool: Pool, url: URL): Promise<Response> {
  const parsed = querySchema.safeParse({ period: url.searchParams.get("period") });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }
  return jsonResponse(await listDrivers(pool, parsed.data.period));
}

/** `GET /drivers/{id}?period=` — A8.7's detail. A malformed period is a 400
 * before anything is looked up; an id that names no driver is a 404. */
export async function handleGetDriver(pool: Pool, id: string, url: URL): Promise<Response> {
  const parsed = querySchema.safeParse({ period: url.searchParams.get("period") });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }

  const detail = await getDriverDetail(pool, id, parsed.data.period);
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
