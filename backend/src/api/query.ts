import { z } from "zod";
import type { InvoiceCurrency } from "../db/types.js";

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

/** The week/currency/units a period-scoped Actuals route was asked for (T-63). */
export interface WeekScope {
  week: string;
  currency: InvoiceCurrency | null;
  units: ActualsUnits | null;
}
