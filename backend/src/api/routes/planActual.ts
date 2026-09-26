import type { Pool } from "pg";
import { z } from "zod";
import { getPlanActual } from "../../planActual/live.js";
import { getBacktest } from "../../planActual/backtest.js";
import { problemResponse } from "../problem.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date");

const liveQuerySchema = z.object({ period: dateSchema });

/**
 * `GET /plan-actual?period=` (A14, A13, A8.10). Zero overlap between plans
 * and invoices is a real, persistent state — always a well-formed payload
 * with coverage counts, never a 404 or a bare `[]`.
 */
export async function handleGetPlanActual(pool: Pool, url: URL): Promise<Response> {
  const parsed = liveQuerySchema.safeParse({ period: url.searchParams.get("period") });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }

  const result = await getPlanActual(pool, parsed.data.period);
  return jsonResponse(result);
}

const backtestQuerySchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((q) => q.from <= q.to, { message: "from must not be after to" });

/**
 * `GET /plan-actual/backtest?from=&to=` (A14, A13). Needs no plan — every
 * truck-day with real fuel stops in range is re-solved with `dp_v1`
 * unchanged against that day's archived price file.
 */
export async function handleGetPlanActualBacktest(pool: Pool, url: URL): Promise<Response> {
  const parsed = backtestQuerySchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }

  const result = await getBacktest(pool, parsed.data.from, parsed.data.to);
  return jsonResponse(result);
}
