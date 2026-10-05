import type { Pool } from "pg";
import type { InvoiceCurrency, InvoiceQtyUnit, PersonCardStatus } from "../db/types.js";
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
import { loadWeekInvoice, qtyConverter, qtyUnitFor, type WeekQuery } from "./units.js";

export interface DriverListRow extends StopRollup {
  driver: { id: string; displayName: string };
}

export interface DriversResult {
  /** The billing week's end, as asked. */
  week: string;
  /** The side of the week shown: every money field below is in it. */
  currency: InvoiceCurrency;
  /** The unit every `qty` below is in — the invoice's own, unless `?units=` said otherwise. */
  qtyUnit: InvoiceQtyUnit;
  invoiceId: string | null;
  /** Every driver on the roster, spend descending. A driver with no stops in the
   * week is a row of zeros (and a `null` average), not an omission. */
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

/**
 * `GET /drivers?week=&currency=` (A8.7, A13). One side of one billing week
 * (D26): a sum of gallons and litres is meaningless, so a week's CA invoice is
 * a separate read of the same endpoint, never folded into the US figures.
 *
 * Each row is the per-driver form of the Overview's per-invoice figures, from
 * the same weighted-average formula (`rollup.ts`). A week with no invoice on
 * that side is an empty result with zero totals — the T-33/T-36 precedent —
 * not an error.
 */
export async function listDrivers(pool: Pool, query: WeekQuery): Promise<DriversResult> {
  const { week, currency } = query;
  const invoice = await loadWeekInvoice(pool, week, currency);
  const conv = qtyConverter(invoice?.qtyUnit ?? qtyUnitFor(currency), query.units);
  const header = { week, currency, qtyUnit: conv.qtyUnit };
  if (invoice === null) {
    const zero = toRollup(EMPTY_SUMS, conv);
    return { ...header, invoiceId: null, rows: [], unresolved: zero, fleet: zero };
  }

  const [groups, { rows: roster }] = await Promise.all([
    loadRollupSums(pool, invoice.id, "driver"),
    pool.query<DriverRosterRow>("SELECT id, display_name FROM drivers"),
  ]);

  const rows = roster
    .map((d) => ({ driver: { id: d.id, displayName: d.display_name }, ...toRollup(groups.get(d.id) ?? EMPTY_SUMS, conv) }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.driver.displayName.localeCompare(b.driver.displayName) ||
        a.driver.id.localeCompare(b.driver.id),
    );

  return {
    ...header,
    invoiceId: invoice.id,
    rows,
    unresolved: toRollup(groups.get(null) ?? EMPTY_SUMS, conv),
    fleet: toRollup(fleetSums(groups), conv),
  };
}

export interface DriverDetail {
  week: string;
  currency: InvoiceCurrency;
  qtyUnit: InvoiceQtyUnit;
  invoiceId: string | null;
  driver: { id: string; displayName: string; status: PersonCardStatus };
  summary: StopRollup;
  fleet: {
    avgBilledPerUnit: number | null;
    qty: number;
    stopCount: number;
  };
  /** Driver's average minus the fleet's for the week, per unit; `null` if either is undefined. */
  avgVsFleetPerUnit: number | null;
  favouredStations: FavouredStations;
  /** Trailing per-invoice series (this currency only) ending at `week`, oldest first. */
  history: RollupHistoryPoint[];
}

interface DriverRow {
  id: string;
  display_name: string;
  status: PersonCardStatus;
}

/**
 * `GET /drivers/{id}?week=&currency=`. `null` when the id doesn't name a
 * driver — the route maps that to a 404 problem+json. A driver with no stops
 * that week (or a week with no invoice on that side) is not `null`: it is
 * zeros, with a `null` average and DEF ratio.
 *
 * "The fleet" is the whole invoice's quantity-weighted average, computed from
 * the same sums as the list — not a mean of driver averages.
 */
export async function getDriverDetail(pool: Pool, id: string, query: WeekQuery): Promise<DriverDetail | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { rows } = await pool.query<DriverRow>("SELECT id, display_name, status FROM drivers WHERE id = $1", [id]);
  const driver = rows[0];
  if (!driver) {
    return null;
  }

  const { week, currency } = query;
  const invoice = await loadWeekInvoice(pool, week, currency);
  const conv = qtyConverter(invoice?.qtyUnit ?? qtyUnitFor(currency), query.units);
  const header = { week, currency, qtyUnit: conv.qtyUnit };
  const history = await loadRollupHistory(pool, week, currency, "driver", id, conv);
  const driverRef = { id: driver.id, displayName: driver.display_name, status: driver.status };

  if (invoice === null) {
    return {
      ...header,
      invoiceId: null,
      driver: driverRef,
      summary: toRollup(EMPTY_SUMS, conv),
      fleet: { avgBilledPerUnit: null, qty: 0, stopCount: 0 },
      avgVsFleetPerUnit: null,
      favouredStations: { stations: [], unresolvedStationStops: 0 },
      history,
    };
  }

  const [groups, favouredStations] = await Promise.all([
    loadRollupSums(pool, invoice.id, "driver"),
    loadFavouredStations(pool, invoice.id, "driver", id, conv),
  ]);
  const summary = toRollup(groups.get(id) ?? EMPTY_SUMS, conv);
  const fleet = toRollup(fleetSums(groups), conv);

  return {
    ...header,
    invoiceId: invoice.id,
    driver: driverRef,
    summary,
    fleet: { avgBilledPerUnit: fleet.avgBilledPerUnit, qty: fleet.qty, stopCount: fleet.stopCount },
    avgVsFleetPerUnit:
      summary.avgBilledPerUnit !== null && fleet.avgBilledPerUnit !== null
        ? summary.avgBilledPerUnit - fleet.avgBilledPerUnit
        : null,
    favouredStations,
    history,
  };
}
