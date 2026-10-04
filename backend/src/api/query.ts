import { z } from "zod";
import type { RequestedUnits, WeekQuery } from "../actuals/units.js";
import { problemResponse } from "./problem.js";

/** A real calendar date as `YYYY-MM-DD` — the shape alone would let
 * `2026-13-45` through to Postgres, which answers `22008` and a 500. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "must be a real calendar date");

export const currencySchema = z.enum(["USD", "CAD"]);

/** `?units=`: absent means as BVD printed it (gal on a US invoice, L on a CA
 * one); `imperial` forces gallons and `metric` litres (D25, edge 3). */
export const unitsSchema = z.enum(["imperial", "metric"]);

export type ActualsUnits = z.infer<typeof unitsSchema>;

const weekQuerySchema = z.object({
  week: isoDateSchema,
  currency: currencySchema.default("USD"),
  units: unitsSchema.optional(),
});

function paramsOf(url: URL, keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, url.searchParams.get(key) ?? undefined]));
}

function badRequest(url: URL, detail: string): Response {
  return problemResponse({ title: "Bad Request", status: 400, detail, instance: url.pathname });
}

/**
 * The `?week=&currency=&units=` every period-scoped Actuals read takes (T-63).
 * `week` is required and a real `YYYY-MM-DD` date; `currency` is `USD` or `CAD`
 * and defaults to `USD` when absent — one-sided screens cannot sum gallons and
 * litres, and the response says which side it served; `units` is `imperial` or
 * `metric`, absent meaning as printed. Anything else is a 400 problem+json,
 * returned for the caller to pass straight back.
 */
export function parseWeekQuery(url: URL): WeekQuery | Response {
  const parsed = weekQuerySchema.safeParse(paramsOf(url, ["week", "currency", "units"]));
  if (!parsed.success) {
    return badRequest(url, parsed.error.message);
  }
  return { week: parsed.data.week, currency: parsed.data.currency, units: parsed.data.units ?? null };
}

/** `?units=` alone, for the routes with no week (a transaction by id, a
 * station's whole price series). */
export function parseUnits(url: URL): RequestedUnits | Response {
  const parsed = unitsSchema.optional().safeParse(url.searchParams.get("units") ?? undefined);
  return parsed.success ? (parsed.data ?? null) : badRequest(url, parsed.error.message);
}

export { badRequest };
