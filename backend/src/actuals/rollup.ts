import type { Pool } from "pg";
import type { InvoiceCurrency } from "../db/types.js";
import { convertNullable, type QtyConverter } from "./units.js";

/**
 * The aggregation `GET /drivers` and `GET /trucks` share (A8.7, A8.8): per-group
 * spend, diesel quantity, quantity-weighted average billed price per unit,
 * receipt compliance and anomaly count over one invoice's fuel stops. The
 * invoice is one currency in one unit (D24/D25); a `QtyConverter` carries the
 * quantity and per-unit price to the unit the caller asked for, and money is
 * left exactly as billed.
 *
 * The weighted average is the same `SUM(qty * billed_per_unit) /
 * SUM(qty)` over `product_code = 'TA'` that `overview.ts` proved (A6.3/A9)
 * — never a mean of prices — and lines are folded into one row per stop
 * *before* the group-by. Summing `fuel_stops.total` across a join to
 * `fuel_stop_lines` would count a stop's total once per line (a stop with a TA
 * and a DF line twice), so the stop is the grain the money is summed at.
 */

/** Which stored column a rollup groups by. The stored id is read, never
 * re-resolved: a stop dated before a truck reassignment keeps its old
 * `truck_id` (T-26, D19). Whitelisted — the only thing interpolated into the
 * SQL below, and never a caller-supplied string. */
export type RollupKey = "driver" | "truck";

const ROLLUP_COLUMNS: Readonly<Record<RollupKey, string>> = {
  driver: "driver_id",
  truck: "truck_id",
};

export interface ReceiptComplianceRollup {
  confirmed: number;
  total: number;
  /** 0-100. `null` with no stops — 0/0 is not a compliance rate. */
  pct: number | null;
}

export interface StopRollup {
  stopCount: number;
  /** In the invoice's currency, as billed. */
  total: number;
  /** Diesel (`TA`) quantity — the same meaning `qty` has in the Overview's top-spend list. */
  qty: number;
  defQty: number;
  /** Quantity-weighted; `null` with no TA quantity, never `0`. */
  avgBilledPerUnit: number | null;
  /** DF quantity over TA quantity; `null` with no diesel quantity, never `0` or `Infinity`. */
  defRatio: number | null;
  receiptCompliance: ReceiptComplianceRollup;
  anomalyCount: number;
}

/** Additive sums — what groups are combined from, so a fleet figure is derived
 * from the same numbers as its rows and can't drift from them. */
export interface RollupSums {
  stopCount: number;
  total: number;
  taQty: number;
  taWeightedNum: number;
  defQty: number;
  confirmed: number;
  anomalyCount: number;
}

export const EMPTY_SUMS: RollupSums = {
  stopCount: 0,
  total: 0,
  taQty: 0,
  taWeightedNum: 0,
  defQty: 0,
  confirmed: 0,
  anomalyCount: 0,
};

export function addSums(a: RollupSums, b: RollupSums): RollupSums {
  return {
    stopCount: a.stopCount + b.stopCount,
    total: a.total + b.total,
    taQty: a.taQty + b.taQty,
    taWeightedNum: a.taWeightedNum + b.taWeightedNum,
    defQty: a.defQty + b.defQty,
    confirmed: a.confirmed + b.confirmed,
    anomalyCount: a.anomalyCount + b.anomalyCount,
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** `null` when there is nothing to weight over. In the invoice's own unit —
 * convert the result, not the inputs. */
export function weightedAverage(weightedNum: number, qty: number): number | null {
  return qty > 0 ? weightedNum / qty : null;
}

export function toRollup(sums: RollupSums, conv: QtyConverter): StopRollup {
  return {
    stopCount: sums.stopCount,
    total: round(sums.total, 2),
    qty: round(conv.qty(sums.taQty), 2),
    defQty: round(conv.qty(sums.defQty), 2),
    avgBilledPerUnit: convertNullable(conv.perUnit, weightedAverage(sums.taWeightedNum, sums.taQty)),
    // A ratio of two quantities in one unit: unit-free, so never converted.
    defRatio: sums.taQty > 0 ? sums.defQty / sums.taQty : null,
    receiptCompliance: {
      confirmed: sums.confirmed,
      total: sums.stopCount,
      pct: sums.stopCount > 0 ? (sums.confirmed / sums.stopCount) * 100 : null,
    },
    anomalyCount: sums.anomalyCount,
  };
}

interface GroupRow {
  group_id: string | null;
  stop_count: string;
  total: string;
  ta_qty: string;
  ta_weighted_num: string;
  df_qty: string;
  confirmed: string;
  anomaly_count: string;
}

/**
 * One invoice's stops, grouped by a stored id. The `null` key is the stops with
 * no resolved driver/truck (an unresolved card, D19) — they belong to no row of
 * the list but are still in the invoice, so they stay in the map for the caller
 * to fold into fleet figures rather than vanish.
 */
export async function loadRollupSums(pool: Pool, invoiceId: string, key: RollupKey): Promise<Map<string | null, RollupSums>> {
  const column = ROLLUP_COLUMNS[key];
  if (column === undefined) {
    throw new Error(`unknown rollup key '${String(key)}'`);
  }

  const { rows } = await pool.query<GroupRow>(
    `WITH stop_agg AS (
       SELECT fs.id, fs.${column} AS group_id, fs.total, fs.receipt_status,
              COALESCE(SUM(fsl.qty) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_qty,
              COALESCE(SUM(fsl.qty * fsl.billed_per_unit) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_weighted_num,
              COALESCE(SUM(fsl.qty) FILTER (WHERE fsl.product_code = 'DF'), 0) AS df_qty
       FROM fuel_stops fs
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       WHERE fs.invoice_id = $1
       GROUP BY fs.id
     ),
     anomaly_agg AS (
       SELECT a.subject_id AS fuel_stop_id, count(*) AS n
       FROM anomalies a
       WHERE a.subject_type = 'fuel_stop' AND a.dismissed_at IS NULL
       GROUP BY a.subject_id
     )
     SELECT s.group_id,
            count(*) AS stop_count,
            SUM(s.total) AS total,
            SUM(s.ta_qty) AS ta_qty,
            SUM(s.ta_weighted_num) AS ta_weighted_num,
            SUM(s.df_qty) AS df_qty,
            count(*) FILTER (WHERE s.receipt_status = 'confirmed') AS confirmed,
            COALESCE(SUM(an.n), 0) AS anomaly_count
     FROM stop_agg s
     LEFT JOIN anomaly_agg an ON an.fuel_stop_id = s.id
     GROUP BY s.group_id`,
    [invoiceId],
  );

  return new Map(
    rows.map((r) => [
      r.group_id,
      {
        stopCount: Number(r.stop_count),
        total: Number(r.total),
        taQty: Number(r.ta_qty),
        taWeightedNum: Number(r.ta_weighted_num),
        defQty: Number(r.df_qty),
        confirmed: Number(r.confirmed),
        anomalyCount: Number(r.anomaly_count),
      },
    ]),
  );
}

/** Every group's sums added together, `null` group included. */
export function fleetSums(groups: ReadonlyMap<string | null, RollupSums>): RollupSums {
  let total = EMPTY_SUMS;
  for (const sums of groups.values()) {
    total = addSums(total, sums);
  }
  return total;
}

export interface FavouredStation {
  station: { id: string; nameRaw: string; cityRaw: string; stateUsps: string };
  stopCount: number;
  /** Diesel quantity at this station. */
  qty: number;
  total: number;
  avgBilledPerUnit: number | null;
}

export interface FavouredStations {
  /** Ranked by stop count, then diesel quantity, then station name, then id — a
   * total order, so ties never depend on row order from the database. */
  stations: FavouredStation[];
  /** Stops in the group whose station did not resolve (T-29). Not stations, so
   * not ranked, but counted rather than dropped. */
  unresolvedStationStops: number;
}

const FAVOURED_STATION_LIMIT = 5;

interface FavouredRow {
  station_id: string | null;
  name_raw: string | null;
  city_raw: string | null;
  state_usps: string | null;
  stop_count: string;
  ta_qty: string;
  ta_weighted_num: string;
  total: string;
}

/** `key` picks the same whitelisted column as `loadRollupSums`. */
export async function loadFavouredStations(
  pool: Pool,
  invoiceId: string,
  key: RollupKey,
  groupId: string,
  conv: QtyConverter,
  limit = FAVOURED_STATION_LIMIT,
): Promise<FavouredStations> {
  const column = ROLLUP_COLUMNS[key];
  if (column === undefined) {
    throw new Error(`unknown rollup key '${String(key)}'`);
  }

  const { rows } = await pool.query<FavouredRow>(
    `WITH stop_agg AS (
       SELECT fs.id, fs.station_id, fs.total,
              COALESCE(SUM(fsl.qty) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_qty,
              COALESCE(SUM(fsl.qty * fsl.billed_per_unit) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_weighted_num
       FROM fuel_stops fs
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       WHERE fs.invoice_id = $1 AND fs.${column} = $2
       GROUP BY fs.id
     )
     SELECT s.station_id, st.name_raw, st.city_raw, st.state_usps,
            count(*) AS stop_count,
            SUM(s.ta_qty) AS ta_qty,
            SUM(s.ta_weighted_num) AS ta_weighted_num,
            SUM(s.total) AS total
     FROM stop_agg s
     LEFT JOIN stations st ON st.id = s.station_id
     GROUP BY s.station_id, st.name_raw, st.city_raw, st.state_usps`,
    [invoiceId, groupId],
  );

  const ranked: FavouredStation[] = [];
  let unresolvedStationStops = 0;
  for (const row of rows) {
    if (row.station_id === null) {
      unresolvedStationStops += Number(row.stop_count);
      continue;
    }
    const qty = Number(row.ta_qty);
    ranked.push({
      station: {
        id: row.station_id,
        nameRaw: row.name_raw!,
        cityRaw: row.city_raw!,
        stateUsps: row.state_usps!,
      },
      stopCount: Number(row.stop_count),
      qty: round(conv.qty(qty), 2),
      total: round(Number(row.total), 2),
      avgBilledPerUnit: convertNullable(conv.perUnit, weightedAverage(Number(row.ta_weighted_num), qty)),
    });
  }

  ranked.sort(
    (a, b) =>
      b.stopCount - a.stopCount ||
      b.qty - a.qty ||
      a.station.nameRaw.localeCompare(b.station.nameRaw) ||
      a.station.id.localeCompare(b.station.id),
  );

  return { stations: ranked.slice(0, limit), unresolvedStationStops };
}

export interface RollupHistoryPoint {
  /** The billing week's end, `YYYY-MM-DD`. */
  week: string;
  invoiceId: string;
  stopCount: number;
  avgBilledPerUnit: number | null;
  /** The whole invoice's quantity-weighted average that week, for the same axis. */
  fleetAvgBilledPerUnit: number | null;
  receiptCompliance: ReceiptComplianceRollup;
}

interface HistoryRow {
  invoice_id: string;
  week_end: string;
  stop_count: string;
  confirmed: string;
  ta_qty: string;
  ta_weighted_num: string;
  fleet_ta_qty: string;
  fleet_ta_weighted_num: string;
}

const HISTORY_PERIODS = 8;

/**
 * The group's trailing series across invoices — A8.7's "compliance over time".
 * One currency only: a price series across litres and gallons, or CAD and USD,
 * is not a series. Like the Overview's trend it lists only weeks that have an
 * imported invoice of that currency, oldest first, and it ends at `week`; a
 * week the group had no stops in still appears, with zero stops.
 */
export async function loadRollupHistory(
  pool: Pool,
  week: string,
  currency: InvoiceCurrency,
  key: RollupKey,
  groupId: string,
  conv: QtyConverter,
  limit = HISTORY_PERIODS,
): Promise<RollupHistoryPoint[]> {
  const column = ROLLUP_COLUMNS[key];
  if (column === undefined) {
    throw new Error(`unknown rollup key '${String(key)}'`);
  }

  const { rows } = await pool.query<HistoryRow>(
    `WITH inv AS (
       SELECT id, billing_week_end FROM invoices
       WHERE billing_week_end <= $1::date AND currency = $4 AND status = 'imported'
       ORDER BY billing_week_end DESC
       LIMIT $2
     ),
     stop_agg AS (
       SELECT fs.id, fs.invoice_id, fs.${column} AS group_id, fs.receipt_status,
              COALESCE(SUM(fsl.qty) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_qty,
              COALESCE(SUM(fsl.qty * fsl.billed_per_unit) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_weighted_num
       FROM fuel_stops fs
       JOIN inv ON inv.id = fs.invoice_id
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       GROUP BY fs.id
     )
     SELECT inv.id AS invoice_id, to_char(inv.billing_week_end, 'YYYY-MM-DD') AS week_end,
            count(s.id) FILTER (WHERE s.group_id = $3) AS stop_count,
            count(s.id) FILTER (WHERE s.group_id = $3 AND s.receipt_status = 'confirmed') AS confirmed,
            COALESCE(SUM(s.ta_qty) FILTER (WHERE s.group_id = $3), 0) AS ta_qty,
            COALESCE(SUM(s.ta_weighted_num) FILTER (WHERE s.group_id = $3), 0) AS ta_weighted_num,
            COALESCE(SUM(s.ta_qty), 0) AS fleet_ta_qty,
            COALESCE(SUM(s.ta_weighted_num), 0) AS fleet_ta_weighted_num
     FROM inv
     LEFT JOIN stop_agg s ON s.invoice_id = inv.id
     GROUP BY inv.id, inv.billing_week_end
     ORDER BY inv.billing_week_end ASC`,
    [week, limit, groupId, currency],
  );

  return rows.map((r) => {
    const stopCount = Number(r.stop_count);
    const confirmed = Number(r.confirmed);
    return {
      week: r.week_end,
      invoiceId: r.invoice_id,
      stopCount,
      avgBilledPerUnit: convertNullable(conv.perUnit, weightedAverage(Number(r.ta_weighted_num), Number(r.ta_qty))),
      fleetAvgBilledPerUnit: convertNullable(
        conv.perUnit,
        weightedAverage(Number(r.fleet_ta_weighted_num), Number(r.fleet_ta_qty)),
      ),
      receiptCompliance: { confirmed, total: stopCount, pct: stopCount > 0 ? (confirmed / stopCount) * 100 : null },
    };
  });
}
