import type { Pool } from "pg";
import { loadSide, loadStoredFx, type OverviewSide } from "./overview.js";

/** Every figure the Overview needs of one billing week (T-70): what its range, all-time and
 * single-week views are all aggregated from. Each side is as BVD printed it — US in USD and
 * gallons, CA in CAD with HST and litres — and absent when the week has no imported invoice. */
export interface OverviewWeekUs {
  invoice: string;
  gal: number;
  diesel: number;
  def: number;
  defGal: number;
  other: number;
  disc: number;
  /** Fuel stops on the invoice. */
  stops: number;
  receiptsExpected: number;
  receiptsConfirmed: number;
  anomalies: number;
}

export interface OverviewWeekCa {
  invoice: string;
  litres: number;
  dieselWithTax: number;
  dieselPreTax: number;
  defWithTax: number;
  defPreTax: number;
  defLitres: number;
  disc: number;
  stops: number;
  receiptsExpected: number;
  receiptsConfirmed: number;
  anomalies: number;
}

/** A driver's fuel spend in the week, one side in USD/gal and the other in CAD/L; zero where they bought none. */
export interface OverviewWeekDriver {
  driverId: string | null;
  driverName: string | null;
  usd: number;
  usGal: number;
  cad: number;
  caLitres: number;
}

export interface OverviewWeek {
  /** The billing week's end, `YYYY-MM-DD`. */
  weekEnd: string;
  /** The first and last transaction's date across the week's invoices (the printed range for one with none). */
  start: string;
  end: string;
  /** CAD per 1 USD for the week; `null` until entered. Read from the week's CA invoice until T-68 moves it. */
  fx: number | null;
  us: OverviewWeekUs | null;
  ca: OverviewWeekCa | null;
  drivers: OverviewWeekDriver[];
}

export interface OverviewWeeksResult {
  /** Ascending by `weekEnd`. */
  weeks: OverviewWeek[];
}

interface WeekRow {
  week_end: string;
  start: string;
  end: string;
}

/** Large enough to list every driver; the per-invoice route caps at ten. */
const ALL_DRIVERS = 100_000;

function usWeek(side: OverviewSide): OverviewWeekUs {
  const { kpis } = side;
  return {
    invoice: kpis.invoiceId,
    gal: kpis.diesel.qty,
    diesel: kpis.diesel.amount,
    def: kpis.def.amount,
    defGal: kpis.def.qty,
    other: kpis.otherCharges.total,
    disc: kpis.discount.total,
    stops: kpis.receiptCompliance.total,
    receiptsExpected: kpis.receiptCompliance.total,
    receiptsConfirmed: kpis.receiptCompliance.confirmed,
    anomalies: kpis.anomaliesFlagged,
  };
}

function caWeek(side: OverviewSide): OverviewWeekCa {
  const { kpis } = side;
  return {
    invoice: kpis.invoiceId,
    litres: kpis.diesel.qty,
    dieselWithTax: kpis.diesel.amount,
    dieselPreTax: kpis.diesel.preTax,
    defWithTax: kpis.def.amount,
    defPreTax: kpis.def.preTax,
    defLitres: kpis.def.qty,
    disc: kpis.discount.total,
    stops: kpis.receiptCompliance.total,
    receiptsExpected: kpis.receiptCompliance.total,
    receiptsConfirmed: kpis.receiptCompliance.confirmed,
    anomalies: kpis.anomaliesFlagged,
  };
}

/** The two sides' driver lists folded into one row per driver; an unassigned stop is the `null` driver. */
function mergeDrivers(us: OverviewSide | null, ca: OverviewSide | null): OverviewWeekDriver[] {
  const byDriver = new Map<string, OverviewWeekDriver>();
  const row = (id: string | null, name: string | null): OverviewWeekDriver => {
    const key = id ?? "";
    let existing = byDriver.get(key);
    if (existing === undefined) {
      existing = { driverId: id, driverName: name, usd: 0, usGal: 0, cad: 0, caLitres: 0 };
      byDriver.set(key, existing);
    }
    return existing;
  };
  for (const d of us?.topSpendByDriver ?? []) {
    const r = row(d.driverId, d.driverName);
    r.usd += d.total;
    r.usGal += d.qty;
  }
  for (const d of ca?.topSpendByDriver ?? []) {
    const r = row(d.driverId, d.driverName);
    r.cad += d.total;
    r.caLitres += d.qty;
  }
  return [...byDriver.values()];
}

/**
 * `GET /overview/weeks` (T-70) — one entry per imported billing week, ascending, carrying the
 * figures the Overview aggregates over whatever scope the dispatcher picks. The server does no
 * aggregation of its own: sums, weighted prices and conversion at each week's own rate are the
 * client's one function, so a week, a range and all time can never disagree.
 */
export async function getOverviewWeeks(pool: Pool): Promise<OverviewWeeksResult> {
  const { rows } = await pool.query<WeekRow>(
    `SELECT to_char(billing_week_end, 'YYYY-MM-DD') AS week_end,
            to_char(min(COALESCE(actual_start, period_start)), 'YYYY-MM-DD') AS start,
            to_char(max(COALESCE(actual_end, period_end)), 'YYYY-MM-DD') AS "end"
     FROM invoices
     WHERE status = 'imported'
     GROUP BY billing_week_end
     ORDER BY billing_week_end`,
  );

  const options = { trendPeriods: 0, anomalyDigestLimit: 0, topDriverLimit: ALL_DRIVERS };
  const weeks = await Promise.all(
    rows.map(async (r): Promise<OverviewWeek> => {
      const [us, ca] = await Promise.all([loadSide(pool, r.week_end, "USD", options), loadSide(pool, r.week_end, "CAD", options)]);
      const fx = ca ? await loadStoredFx(pool, ca.kpis.invoiceId) : null;
      return {
        weekEnd: r.week_end,
        start: r.start,
        end: r.end,
        fx: fx === null ? null : Number(fx.rate),
        us: us === null ? null : usWeek(us),
        ca: ca === null ? null : caWeek(ca),
        drivers: mergeDrivers(us, ca),
      };
    }),
  );
  return { weeks };
}
