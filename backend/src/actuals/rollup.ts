import type { Pool } from "pg";

/**
 * The aggregation `GET /drivers` and `GET /trucks` share (A8.7, A8.8): per-group
 * spend, diesel gallons, gallons-weighted average billed $/gal, receipt
 * compliance and anomaly count over one invoice's fuel stops.
 *
 * The weighted average is the same `SUM(gallons * billed_usd_per_gal) /
 * SUM(gallons)` over `product_code = 'TA'` that `overview.ts` proved (A6.3/A9)
 * — never a mean of prices — and lines are folded into one row per stop
 * *before* the group-by. Summing `fuel_stops.total_usd` across a join to
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
  totalUsd: number;
  /** Diesel (`TA`) gallons — the same meaning `gallons` has in the Overview's top-spend list. */
  gallons: number;
  defGallons: number;
  /** Gallons-weighted; `null` with no TA gallons, never `0`. */
  avgBilledUsdPerGal: number | null;
  /** DF gallons over TA gallons; `null` with no diesel gallons, never `0` or `Infinity`. */
  defRatio: number | null;
  receiptCompliance: ReceiptComplianceRollup;
  anomalyCount: number;
}

/** Additive sums — what groups are combined from, so a fleet figure is derived
 * from the same numbers as its rows and can't drift from them. */
export interface RollupSums {
  stopCount: number;
  totalUsd: number;
  taGallons: number;
  taWeightedNum: number;
  defGallons: number;
  confirmed: number;
  anomalyCount: number;
}

export const EMPTY_SUMS: RollupSums = {
  stopCount: 0,
  totalUsd: 0,
  taGallons: 0,
  taWeightedNum: 0,
  defGallons: 0,
  confirmed: 0,
  anomalyCount: 0,
};

export function addSums(a: RollupSums, b: RollupSums): RollupSums {
  return {
    stopCount: a.stopCount + b.stopCount,
    totalUsd: a.totalUsd + b.totalUsd,
    taGallons: a.taGallons + b.taGallons,
    taWeightedNum: a.taWeightedNum + b.taWeightedNum,
    defGallons: a.defGallons + b.defGallons,
    confirmed: a.confirmed + b.confirmed,
    anomalyCount: a.anomalyCount + b.anomalyCount,
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** `null` when there is nothing to weight over. */
export function weightedAverage(weightedNum: number, gallons: number): number | null {
  return gallons > 0 ? weightedNum / gallons : null;
}

export function toRollup(sums: RollupSums): StopRollup {
  return {
    stopCount: sums.stopCount,
    totalUsd: round(sums.totalUsd, 2),
    gallons: round(sums.taGallons, 2),
    defGallons: round(sums.defGallons, 2),
    avgBilledUsdPerGal: weightedAverage(sums.taWeightedNum, sums.taGallons),
    defRatio: sums.taGallons > 0 ? sums.defGallons / sums.taGallons : null,
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
  total_usd: string;
  ta_gallons: string;
  ta_weighted_num: string;
  df_gallons: string;
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
       SELECT fs.id, fs.${column} AS group_id, fs.total_usd, fs.receipt_status,
              COALESCE(SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_gallons,
              COALESCE(SUM(fsl.gallons * fsl.billed_usd_per_gal) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_weighted_num,
              COALESCE(SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'DF'), 0) AS df_gallons
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
            SUM(s.total_usd) AS total_usd,
            SUM(s.ta_gallons) AS ta_gallons,
            SUM(s.ta_weighted_num) AS ta_weighted_num,
            SUM(s.df_gallons) AS df_gallons,
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
        totalUsd: Number(r.total_usd),
        taGallons: Number(r.ta_gallons),
        taWeightedNum: Number(r.ta_weighted_num),
        defGallons: Number(r.df_gallons),
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
  /** Diesel gallons at this station. */
  gallons: number;
  totalUsd: number;
  avgBilledUsdPerGal: number | null;
}

export interface FavouredStations {
  /** Ranked by stop count, then diesel gallons, then station name, then id — a
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
  ta_gallons: string;
  ta_weighted_num: string;
  total_usd: string;
}

/** `key` picks the same whitelisted column as `loadRollupSums`. */
export async function loadFavouredStations(
  pool: Pool,
  invoiceId: string,
  key: RollupKey,
  groupId: string,
  limit = FAVOURED_STATION_LIMIT,
): Promise<FavouredStations> {
  const column = ROLLUP_COLUMNS[key];
  if (column === undefined) {
    throw new Error(`unknown rollup key '${String(key)}'`);
  }

  const { rows } = await pool.query<FavouredRow>(
    `WITH stop_agg AS (
       SELECT fs.id, fs.station_id, fs.total_usd,
              COALESCE(SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_gallons,
              COALESCE(SUM(fsl.gallons * fsl.billed_usd_per_gal) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_weighted_num
       FROM fuel_stops fs
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       WHERE fs.invoice_id = $1 AND fs.${column} = $2
       GROUP BY fs.id
     )
     SELECT s.station_id, st.name_raw, st.city_raw, st.state_usps,
            count(*) AS stop_count,
            SUM(s.ta_gallons) AS ta_gallons,
            SUM(s.ta_weighted_num) AS ta_weighted_num,
            SUM(s.total_usd) AS total_usd
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
    const gallons = Number(row.ta_gallons);
    ranked.push({
      station: {
        id: row.station_id,
        nameRaw: row.name_raw!,
        cityRaw: row.city_raw!,
        stateUsps: row.state_usps!,
      },
      stopCount: Number(row.stop_count),
      gallons: round(gallons, 2),
      totalUsd: round(Number(row.total_usd), 2),
      avgBilledUsdPerGal: weightedAverage(Number(row.ta_weighted_num), gallons),
    });
  }

  ranked.sort(
    (a, b) =>
      b.stopCount - a.stopCount ||
      b.gallons - a.gallons ||
      a.station.nameRaw.localeCompare(b.station.nameRaw) ||
      a.station.id.localeCompare(b.station.id),
  );

  return { stations: ranked.slice(0, limit), unresolvedStationStops };
}

export interface RollupHistoryPoint {
  period: string;
  invoiceId: string;
  stopCount: number;
  avgBilledUsdPerGal: number | null;
  /** The whole invoice's gallons-weighted average that period, for the same axis. */
  fleetAvgBilledUsdPerGal: number | null;
  receiptCompliance: ReceiptComplianceRollup;
}

interface HistoryRow {
  invoice_id: string;
  period_start: Date;
  stop_count: string;
  confirmed: string;
  ta_gallons: string;
  ta_weighted_num: string;
  fleet_ta_gallons: string;
  fleet_ta_weighted_num: string;
}

const HISTORY_PERIODS = 8;

/**
 * The group's trailing series across invoices — A8.7's "compliance over time".
 * Like the Overview's trend it lists only periods that have an invoice, oldest
 * first, and it ends at `period`; a period the group had no stops in still
 * appears, with zero stops.
 */
export async function loadRollupHistory(
  pool: Pool,
  period: string,
  key: RollupKey,
  groupId: string,
  limit = HISTORY_PERIODS,
): Promise<RollupHistoryPoint[]> {
  const column = ROLLUP_COLUMNS[key];
  if (column === undefined) {
    throw new Error(`unknown rollup key '${String(key)}'`);
  }

  const { rows } = await pool.query<HistoryRow>(
    `WITH inv AS (
       SELECT id, period_start FROM invoices
       WHERE period_start <= $1::date
       ORDER BY period_start DESC
       LIMIT $2
     ),
     stop_agg AS (
       SELECT fs.id, fs.invoice_id, fs.${column} AS group_id, fs.receipt_status,
              COALESCE(SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_gallons,
              COALESCE(SUM(fsl.gallons * fsl.billed_usd_per_gal) FILTER (WHERE fsl.product_code = 'TA'), 0) AS ta_weighted_num
       FROM fuel_stops fs
       JOIN inv ON inv.id = fs.invoice_id
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
       GROUP BY fs.id
     )
     SELECT inv.id AS invoice_id, inv.period_start,
            count(s.id) FILTER (WHERE s.group_id = $3) AS stop_count,
            count(s.id) FILTER (WHERE s.group_id = $3 AND s.receipt_status = 'confirmed') AS confirmed,
            COALESCE(SUM(s.ta_gallons) FILTER (WHERE s.group_id = $3), 0) AS ta_gallons,
            COALESCE(SUM(s.ta_weighted_num) FILTER (WHERE s.group_id = $3), 0) AS ta_weighted_num,
            COALESCE(SUM(s.ta_gallons), 0) AS fleet_ta_gallons,
            COALESCE(SUM(s.ta_weighted_num), 0) AS fleet_ta_weighted_num
     FROM inv
     LEFT JOIN stop_agg s ON s.invoice_id = inv.id
     GROUP BY inv.id, inv.period_start
     ORDER BY inv.period_start ASC`,
    [period, limit, groupId],
  );

  return rows.map((r) => {
    const stopCount = Number(r.stop_count);
    const confirmed = Number(r.confirmed);
    return {
      period: r.period_start.toISOString().slice(0, 10),
      invoiceId: r.invoice_id,
      stopCount,
      avgBilledUsdPerGal: weightedAverage(Number(r.ta_weighted_num), Number(r.ta_gallons)),
      fleetAvgBilledUsdPerGal: weightedAverage(Number(r.fleet_ta_weighted_num), Number(r.fleet_ta_gallons)),
      receiptCompliance: { confirmed, total: stopCount, pct: stopCount > 0 ? (confirmed / stopCount) * 100 : null },
    };
  });
}
