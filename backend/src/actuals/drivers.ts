import type { Pool } from "pg";
import type { PersonCardStatus } from "../db/types.js";
import { isUuid } from "./ids.js";
import {
  EMPTY_SUMS,
  fleetSums,
  loadFavouredStations,
  loadRollupHistory,
  loadRollupSums,
  toRollup,
  type FavouredStations,
  type RollupHistoryPoint,
  type StopRollup,
} from "./rollup.js";

export interface DriverListRow extends StopRollup {
  driver: { id: string; displayName: string };
}

export interface DriversResult {
  period: string;
  invoiceId: string | null;
  /** Every driver on the roster, spend descending. A driver with no stops in
   * the period is a row of zeros (and a `null` average), not an omission. */
  rows: DriverListRow[];
  /** Stops whose card did not resolve to a driver (D19). They belong to no row,
   * but they are in the invoice, so they are here and in `fleet`. */
  unresolved: StopRollup;
  /** The whole invoice: `rows` + `unresolved`, so the two always reconcile. */
  fleet: StopRollup;
}

interface DriverRosterRow {
  id: string;
  display_name: string;
}

async function loadInvoiceId(pool: Pool, period: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM invoices WHERE period_start = $1::date", [period]);
  return rows[0]?.id ?? null;
}

/**
 * `GET /drivers?period=` (A8.7, A13). `period` is `invoices.period_start`, the
 * key `/overview` and `/express-charges` take (A7).
 *
 * Each row is the per-driver form of the Overview's per-invoice figures, from
 * the same weighted-average formula (`rollup.ts`). A period with no invoice is
 * an empty result with zero totals — the T-33/T-36 precedent — not an error.
 */
export async function listDrivers(pool: Pool, period: string): Promise<DriversResult> {
  const invoiceId = await loadInvoiceId(pool, period);
  if (invoiceId === null) {
    const zero = toRollup(EMPTY_SUMS);
    return { period, invoiceId: null, rows: [], unresolved: zero, fleet: zero };
  }

  const [groups, { rows: roster }] = await Promise.all([
    loadRollupSums(pool, invoiceId, "driver"),
    pool.query<DriverRosterRow>("SELECT id, display_name FROM drivers"),
  ]);

  const rows = roster
    .map((d) => ({ driver: { id: d.id, displayName: d.display_name }, ...toRollup(groups.get(d.id) ?? EMPTY_SUMS) }))
    .sort(
      (a, b) =>
        b.totalUsd - a.totalUsd ||
        a.driver.displayName.localeCompare(b.driver.displayName) ||
        a.driver.id.localeCompare(b.driver.id),
    );

  return {
    period,
    invoiceId,
    rows,
    unresolved: toRollup(groups.get(null) ?? EMPTY_SUMS),
    fleet: toRollup(fleetSums(groups)),
  };
}

export interface DriverDetail {
  period: string;
  invoiceId: string | null;
  driver: { id: string; displayName: string; status: PersonCardStatus };
  summary: StopRollup;
  fleet: {
    avgBilledUsdPerGal: number | null;
    gallons: number;
    stopCount: number;
  };
  /** Driver's average minus the fleet's for the period; `null` if either is undefined. */
  avgVsFleetUsdPerGal: number | null;
  favouredStations: FavouredStations;
  /** Trailing per-invoice series ending at `period`, oldest first. */
  history: RollupHistoryPoint[];
}

interface DriverRow {
  id: string;
  display_name: string;
  status: PersonCardStatus;
}

/**
 * `GET /drivers/{id}?period=`. `null` when the id doesn't name a driver — the
 * route maps that to a 404 problem+json. A driver with no stops in `period`
 * (or a period with no invoice) is not `null`: it is zeros, with a `null`
 * average and DEF ratio.
 *
 * "The fleet" is the whole invoice's gallons-weighted average, computed from
 * the same sums as the list — not a mean of driver averages.
 */
export async function getDriverDetail(pool: Pool, id: string, period: string): Promise<DriverDetail | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { rows } = await pool.query<DriverRow>("SELECT id, display_name, status FROM drivers WHERE id = $1", [id]);
  const driver = rows[0];
  if (!driver) {
    return null;
  }

  const invoiceId = await loadInvoiceId(pool, period);
  const history = await loadRollupHistory(pool, period, "driver", id);
  const driverRef = { id: driver.id, displayName: driver.display_name, status: driver.status };

  if (invoiceId === null) {
    const zero = toRollup(EMPTY_SUMS);
    return {
      period,
      invoiceId: null,
      driver: driverRef,
      summary: zero,
      fleet: { avgBilledUsdPerGal: null, gallons: 0, stopCount: 0 },
      avgVsFleetUsdPerGal: null,
      favouredStations: { stations: [], unresolvedStationStops: 0 },
      history,
    };
  }

  const [groups, favouredStations] = await Promise.all([
    loadRollupSums(pool, invoiceId, "driver"),
    loadFavouredStations(pool, invoiceId, "driver", id),
  ]);
  const summary = toRollup(groups.get(id) ?? EMPTY_SUMS);
  const fleet = toRollup(fleetSums(groups));

  return {
    period,
    invoiceId,
    driver: driverRef,
    summary,
    fleet: { avgBilledUsdPerGal: fleet.avgBilledUsdPerGal, gallons: fleet.gallons, stopCount: fleet.stopCount },
    avgVsFleetUsdPerGal:
      summary.avgBilledUsdPerGal !== null && fleet.avgBilledUsdPerGal !== null
        ? summary.avgBilledUsdPerGal - fleet.avgBilledUsdPerGal
        : null,
    favouredStations,
    history,
  };
}
