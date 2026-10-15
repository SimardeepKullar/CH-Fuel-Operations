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
 * and nothing else — `?units=` never touches money (that is `moneyConverter`,
 * T-66), so a CAD invoice read in gallons has the same CAD amounts and a
 * CAD-per-gallon price instead of CAD-per-litre.
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

/**
 * D27 (as amended): the exchange rate a dispatcher enters on a CA invoice, CAD
 * per 1 USD, stored as `numeric(10,6)`. The band is a typo guard — 13.712 or
 * 0.13712 for 1.3712 — not a market check.
 */
export const FX_RATE_MIN = 0.5;
export const FX_RATE_MAX = 3.0;
export const FX_RATE_PLACES = 6;

/** Why `rate` cannot be stored as an entered rate, or `null` when it can. */
export function fxRateProblem(rate: unknown): string | null {
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return "the exchange rate must be a number (CAD per 1 USD)";
  }
  if (rate <= 0) {
    return "the exchange rate must be greater than 0";
  }
  if (rate < FX_RATE_MIN || rate > FX_RATE_MAX) {
    return `the exchange rate must be between ${FX_RATE_MIN.toFixed(1)} and ${FX_RATE_MAX.toFixed(1)} CAD per USD`;
  }
  // Inside the band a number never prints in exponent form, so its decimal
  // places are what follows the point.
  const places = String(rate).split(".")[1]?.length ?? 0;
  if (places > FX_RATE_PLACES) {
    return `the exchange rate has at most ${FX_RATE_PLACES} decimal places`;
  }
  return null;
}

/** An entered rate as a response carries it (D27): `rate` is CAD per 1 USD,
 * `enteredAt` when it last changed. Named by what it is — no response key
 * carries `Usd` (T-63). */
export interface InvoiceFx {
  rate: number;
  enteredAt: string;
}

/** `?convertTo=`: absent means each row in the currency its invoice was billed in. */
export type RequestedCurrency = InvoiceCurrency | null;

/** The rate behind a row as read from `invoices` — the CA invoice of the row's
 * billing week: its own for a CA row, its week's for a US one. */
export interface StoredFx {
  /** `numeric(10,6)` as pg returns it, e.g. `"1.371200"`. */
  rate: string;
  enteredAt: Date;
}

/** A decimal string as an exact scaled integer: `"-12.50"` -> `-1250n` at scale 2. */
function parseDecimal(value: string): { n: bigint; scale: number } {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`not a decimal: ${value}`);
  }
  const fraction = match[3] ?? "";
  const n = BigInt(match[2]! + fraction);
  return { n: match[1] === "-" ? -n : n, scale: fraction.length };
}

/** `num / den` rounded half away from zero; `den` > 0. */
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  const twiceR = 2n * (r < 0n ? -r : r);
  if (twiceR >= den) {
    return num < 0n ? q - 1n : q + 1n;
  }
  return q;
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

/** A rational multiplier, kept exact. */
interface Ratio {
  n: bigint;
  d: bigint;
}

/** `LITERS_PER_GALLON` (3.785411784, exact by definition) as a ratio, so a
 * price converted in both unit and currency is rounded once, not twice. */
export const LITERS_PER_GALLON_RATIO: Ratio = { n: 3_785_411_784n, d: 1_000_000_000n };

/** `value` × `ratio`, rounded once to `places`. Exact up to that one rounding. */
function scaleExact(value: string, ratio: Ratio, places: number): number {
  const { n, scale } = parseDecimal(value);
  const scaled = divRound(n * ratio.n * pow10(places), ratio.d * pow10(scale));
  return Number(scaled) / 10 ** places;
}

/** Cents for money, four places for a per-unit price (A6.1's display precision). */
const MONEY_PLACES = 2;
const CONVERTED_PRICE_PLACES = 4;

/**
 * Edge 3 for invoice money (T-66, amending D25): `?convertTo=` converts every
 * money figure and per-unit price on a row at the rate the dispatcher entered
 * on that billing week's CA invoice — CAD -> USD divides by it, USD -> CAD
 * multiplies. Each stored figure is converted on its own and rounded once:
 * money to the cent, prices to four places (a price whose unit also changes
 * takes the unit factor inside that same rounding). Nothing converted is
 * stored, so a corrected rate re-converts on the next read.
 *
 * No entered rate means "rate pending": every money figure and price is `null`
 * and nothing is computed — never a 1.0 rate (D27). A row already in the
 * requested currency is returned exactly as without `convertTo`.
 */
export interface MoneyConverter {
  /** What every figure this converter returns is in. */
  currency: InvoiceCurrency;
  /** The rate used, only when this converter actually converts. */
  fx: InvoiceFx | null;
  /** Conversion was asked for and no rate is entered. */
  ratePending: boolean;
  money(stored: string): number | null;
  /** A price per stored unit, in `currency` per the `QtyConverter`'s `qtyUnit`. */
  perUnit(stored: string): number | null;
}

export function moneyConverter(
  invoiceCurrency: InvoiceCurrency,
  requested: RequestedCurrency,
  fx: StoredFx | null,
  storedUnit: InvoiceQtyUnit,
  units: RequestedUnits,
): MoneyConverter {
  const qty = qtyConverter(storedUnit, units);
  if (requested === null || requested === invoiceCurrency) {
    return {
      currency: invoiceCurrency,
      fx: null,
      ratePending: false,
      money: (stored) => Number(stored),
      perUnit: (stored) => qty.perUnit(Number(stored)),
    };
  }
  if (fx === null) {
    return { currency: requested, fx: null, ratePending: true, money: () => null, perUnit: () => null };
  }

  const rate = parseDecimal(fx.rate);
  const rateRatio: Ratio = { n: rate.n, d: pow10(rate.scale) };
  // CAD -> USD divides by CAD-per-USD; USD -> CAD multiplies.
  const fxRatio: Ratio = invoiceCurrency === "CAD" ? { n: rateRatio.d, d: rateRatio.n } : rateRatio;
  // A per-litre price is a per-gallon one × litres per gallon, and back.
  const unitRatio: Ratio =
    qty.qtyUnit === storedUnit
      ? { n: 1n, d: 1n }
      : storedUnit === "L"
        ? LITERS_PER_GALLON_RATIO
        : { n: LITERS_PER_GALLON_RATIO.d, d: LITERS_PER_GALLON_RATIO.n };
  const priceRatio: Ratio = { n: fxRatio.n * unitRatio.n, d: fxRatio.d * unitRatio.d };

  return {
    currency: requested,
    fx: { rate: Number(fx.rate), enteredAt: fx.enteredAt.toISOString() },
    ratePending: false,
    money: (stored) => scaleExact(stored, fxRatio, MONEY_PLACES),
    perUnit: (stored) => scaleExact(stored, priceRatio, CONVERTED_PRICE_PLACES),
  };
}
