import type { Pool } from "pg";
import type { InvoiceCurrency, InvoiceQtyUnit } from "../db/types.js";
import { gallonsToLiters, litersToGallons } from "../domain/units.js";

/** Quantity unit follows currency (D25): BVD bills Canadian fuel in litres and
 * US fuel in gallons — measured on 999217 and 999210, one each. */
export function qtyUnitFor(currency: InvoiceCurrency): InvoiceQtyUnit {
  return currency === "CAD" ? "L" : "gal";
}

/** `?units=`: absent means as BVD printed; `imperial` is gallons, `metric` litres. */
export type RequestedUnits = "imperial" | "metric" | null;

/** Four places for a converted quantity, six for a converted per-unit price —
 * only enough to strip float noise from the division; display rounding is the
 * frontend's (CLAUDE.md: numbers, not display strings). */
const QTY_PLACES = 4;
const PRICE_PLACES = 6;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * Edge 3 of CLAUDE.md's conversion edges, for invoice figures (D25). Storage is
 * as printed; this converts a *quantity* and a *per-unit price* on the way out,
 * and nothing else — money never changes, so a CAD invoice read in gallons has
 * the same CAD amounts and a CAD-per-gallon price instead of CAD-per-litre.
 */
export interface QtyConverter {
  /** The unit every `qty` this converter returns is in. */
  qtyUnit: InvoiceQtyUnit;
  qty(stored: number): number;
  /** A price per stored unit, as a price per `qtyUnit`. */
  perUnit(stored: number): number;
}

export function qtyConverter(stored: InvoiceQtyUnit, requested: RequestedUnits): QtyConverter {
  const target: InvoiceQtyUnit = requested === null ? stored : requested === "imperial" ? "gal" : "L";
  if (target === stored) {
    return { qtyUnit: stored, qty: (n) => n, perUnit: (n) => n };
  }
  // Same unit-per-unit factor both ways; a price scales by the inverse of a quantity.
  return stored === "L"
    ? { qtyUnit: "gal", qty: (n) => round(litersToGallons(n), QTY_PLACES), perUnit: (n) => round(gallonsToLiters(n), PRICE_PLACES) }
    : { qtyUnit: "L", qty: (n) => round(gallonsToLiters(n), QTY_PLACES), perUnit: (n) => round(litersToGallons(n), PRICE_PLACES) };
}

/** `null` stays `null` — a missing price is never `0` (nulls are meaningful). */
export function convertNullable(fn: (n: number) => number, value: number | null): number | null {
  return value === null ? null : fn(value);
}

/** What a period-scoped read was asked for, already validated at the route. */
export interface WeekQuery {
  /** `YYYY-MM-DD` — the billing week's end (D26). */
  week: string;
  currency: InvoiceCurrency;
  units: RequestedUnits;
}

/** The one imported invoice a billing week holds for a currency (D26). */
export interface WeekInvoice {
  id: string;
  currency: InvoiceCurrency;
  qtyUnit: InvoiceQtyUnit;
  grandTotal: string;
  /** The printed end, `YYYY-MM-DD` — what "in force on" is evaluated at. */
  periodEnd: string;
}

/**
 * `?week=` + `?currency=` -> the invoice behind it, or `null` for a week that
 * side has no invoice in (an empty result, never an error). Imported only: a
 * quarantined invoice has no rows and must not shadow the one that replaces it.
 */
export async function loadWeekInvoice(pool: Pool, week: string, currency: InvoiceCurrency): Promise<WeekInvoice | null> {
  const { rows } = await pool.query<{
    id: string;
    currency: InvoiceCurrency;
    qty_unit: InvoiceQtyUnit;
    grand_total: string;
    period_end: string;
  }>(
    `SELECT id, currency, qty_unit, grand_total, to_char(period_end, 'YYYY-MM-DD') AS period_end
     FROM invoices
     WHERE billing_week_end = $1::date AND currency = $2 AND status = 'imported'`,
    [week, currency],
  );
  const row = rows[0];
  return row
    ? { id: row.id, currency: row.currency, qtyUnit: row.qty_unit, grandTotal: row.grand_total, periodEnd: row.period_end }
    : null;
}
