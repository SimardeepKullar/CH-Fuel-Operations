import type { Pool } from "pg";
import { z } from "zod";
import { getTruckDetail, listTruckRoster, listTrucks } from "../../actuals/trucks.js";
import { problemResponse } from "../problem.js";

const periodSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "period must be a YYYY-MM-DD date");
const querySchema = z.object({ period: periodSchema });
/** `period` optional here only (D23) — the list endpoint doubles as an unscoped roster picker; the detail endpoint below always needs one to compute `assignedCard`/`favouredStations` as of a date. */
const listQuerySchema = z.object({ period: periodSchema.optional() });

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * `GET /trucks?period=` — A8.8's list. `period` omitted (D23) returns the
 * plain 27-unit roster instead — no invoice, no spend figures — for a picker
 * that carries no period of its own (New Plan's truck field, A7).
 */
export async function handleListTrucks(pool: Pool, url: URL): Promise<Response> {
  const parsed = listQuerySchema.safeParse({ period: url.searchParams.get("period") ?? undefined });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }
  if (parsed.data.period === undefined) {
    return jsonResponse(await listTruckRoster(pool));
  }
  return jsonResponse(await listTrucks(pool, parsed.data.period));
}

/** `GET /trucks/{id}?period=` — A8.8's detail, with the assignment history. */
export async function handleGetTruck(pool: Pool, id: string, url: URL): Promise<Response> {
  const parsed = querySchema.safeParse({ period: url.searchParams.get("period") });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }

  const detail = await getTruckDetail(pool, id, parsed.data.period);
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
