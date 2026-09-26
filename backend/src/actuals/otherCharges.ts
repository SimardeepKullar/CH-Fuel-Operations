import type { Pool } from "pg";
import type { ExpressMatchStatus } from "../db/types.js";

export interface ExpressChargeDriver {
  id: string;
  displayName: string;
}

export interface ExpressChargeTruck {
  id: string;
  unitNumber: string;
}

/**
 * One express code, as BVD printed it (A8.6). Not `RawResolvedString`: that
 * shape's `raw` is non-nullable and its `agrees` flag compares raw against
 * resolved, but an express driver is matched through an alias table, so the
 * two are *expected* to differ ("Finn" -> FINN GRAY), and either side
 * may be absent. `matchStatus` is the whole story here.
 */
export interface ExpressChargeItem {
  id: string;
  expressCode: string;
  occurredAt: string;
  /** `null` — never a guess — when the raw name is blank or matches no alias
   * or roster entry. Always `null` iff `matchStatus` is `"unmatched"`. */
  driver: ExpressChargeDriver | null;
  /** As printed, or `null` when blank. Kept beside `driver` so an unmatched
   * name is still visible, and can be offered as an alias candidate (T-46). */
  driverNameRaw: string | null;
  matchStatus: ExpressMatchStatus;
  /** `null` on every row of a CSV import, which has no tractor column: a
   * property of the file, not a resolution miss. On a PDF import a null here
   * would be genuine. Nothing in this shape treats it as suspect. */
  truck: ExpressChargeTruck | null;
  unitRaw: string | null;
  trailerRaw: string | null;
  cdlRaw: string | null;
  tripNumberRaw: string | null;
  amountUsd: number;
  /** BVD's flat per-code fee, carried per row and never folded into `amountUsd`. */
  feeUsd: number;
  totalUsd: number;
  currency: "USD";
  payee: string | null;
  /** Verbatim — no trimming, casing or categorisation. */
  note: string | null;
  category: string | null;
}

export interface ExpressChargeTotals {
  count: number;
  amountUsd: number;
  /** Separate from `amountUsd` (A8.6: "surface the $3.00 fee total separately"). */
  feeUsd: number;
  /** `amountUsd + feeUsd`, summed in SQL — the figure that ties to the invoice's printed express total. */
  totalUsd: number;
  currency: "USD";
}

export interface ExpressChargesResult {
  period: string;
  /** `null` when no invoice has this `period_start` — an empty result, not an error. */
  invoiceId: string | null;
  rows: ExpressChargeItem[];
  totals: ExpressChargeTotals;
}

interface ExpressChargeRowWithJoins {
  id: string;
  express_code: string;
  occurred_at: Date;
  driver_id: string | null;
  driver_display_name: string | null;
  driver_name_raw: string | null;
  match_status: ExpressMatchStatus;
  truck_id: string | null;
  truck_unit_number: string | null;
  unit_raw: string | null;
  trailer_raw: string | null;
  cdl_raw: string | null;
  trip_number_raw: string | null;
  amount_usd: string;
  fee_usd: string;
  total_usd: string;
  payee: string | null;
  note: string | null;
  category: string | null;
}

interface TotalsRow {
  count: string;
  amount_usd: string;
  fee_usd: string;
  total_usd: string;
}

function toItem(row: ExpressChargeRowWithJoins): ExpressChargeItem {
  return {
    id: row.id,
    expressCode: row.express_code,
    occurredAt: row.occurred_at.toISOString(),
    driver:
      row.driver_id !== null && row.driver_display_name !== null
        ? { id: row.driver_id, displayName: row.driver_display_name }
        : null,
    driverNameRaw: row.driver_name_raw,
    matchStatus: row.match_status,
    truck:
      row.truck_id !== null && row.truck_unit_number !== null
        ? { id: row.truck_id, unitNumber: row.truck_unit_number }
        : null,
    unitRaw: row.unit_raw,
    trailerRaw: row.trailer_raw,
    cdlRaw: row.cdl_raw,
    tripNumberRaw: row.trip_number_raw,
    amountUsd: Number(row.amount_usd),
    feeUsd: Number(row.fee_usd),
    totalUsd: Number(row.total_usd),
    currency: "USD",
    payee: row.payee,
    note: row.note,
    category: row.category,
  };
}

/**
 * `GET /express-charges?period=` (A8.6, A13). `period` is
 * `invoices.period_start` as `YYYY-MM-DD`, the same key `GET /overview` takes,
 * since that is what the frontend's period selector holds (A7).
 *
 * A read, not a resolution: `driver_id` and `match_status` are the columns
 * `importInvoice()` wrote via `resolveExpressDriver()`, and nothing here
 * re-resolves. A period with no invoice comes back empty with zero totals.
 * Unpaginated — a real invoice carries about six of these.
 */
export async function listExpressCharges(pool: Pool, period: string): Promise<ExpressChargesResult> {
  const { rows: invoiceRows } = await pool.query<{ id: string }>(
    "SELECT id FROM invoices WHERE period_start = $1::date",
    [period],
  );
  const invoiceId = invoiceRows[0]?.id ?? null;

  if (invoiceId === null) {
    return {
      period,
      invoiceId: null,
      rows: [],
      totals: { count: 0, amountUsd: 0, feeUsd: 0, totalUsd: 0, currency: "USD" },
    };
  }

  const [{ rows }, { rows: totalsRows }] = await Promise.all([
    pool.query<ExpressChargeRowWithJoins>(
      `SELECT ec.id, ec.express_code, ec.occurred_at,
              ec.driver_id, d.display_name AS driver_display_name, ec.driver_name_raw, ec.match_status,
              ec.truck_id, t.unit_number AS truck_unit_number, ec.unit_raw,
              ec.trailer_raw, ec.cdl_raw, ec.trip_number_raw,
              ec.amount_usd, ec.fee_usd, ec.total_usd,
              ec.payee, ec.note, ec.category
       FROM express_charges ec
       LEFT JOIN drivers d ON d.id = ec.driver_id
       LEFT JOIN trucks t ON t.id = ec.truck_id
       WHERE ec.invoice_id = $1
       ORDER BY ec.occurred_at ASC, ec.id ASC`,
      [invoiceId],
    ),
    pool.query<TotalsRow>(
      `SELECT count(*) AS count,
              COALESCE(SUM(amount_usd), 0) AS amount_usd,
              COALESCE(SUM(fee_usd), 0) AS fee_usd,
              COALESCE(SUM(total_usd), 0) AS total_usd
       FROM express_charges WHERE invoice_id = $1`,
      [invoiceId],
    ),
  ]);

  const totals = totalsRows[0]!;
  return {
    period,
    invoiceId,
    rows: rows.map(toItem),
    totals: {
      count: Number(totals.count),
      amountUsd: Number(totals.amount_usd),
      feeUsd: Number(totals.fee_usd),
      totalUsd: Number(totals.total_usd),
      currency: "USD",
    },
  };
}
