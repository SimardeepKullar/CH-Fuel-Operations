import type { Pool } from "pg";
import type { InvoiceCurrency, InvoiceQtyUnit, PersonCardStatus } from "../db/types.js";
import { resolveTruckAtInstant, type TruckAssignmentForMatch } from "../catalog/assignments.js";
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

export interface TruckListRow extends StopRollup {
  truck: { id: string; unitNumber: string };
}

export interface TrucksResult {
  /** The billing week's end, as asked. */
  week: string;
  /** The side of the week shown: every money field below is in it. */
  currency: InvoiceCurrency;
  /** The unit every `qty` below is in — the invoice's own, unless `?units=` said otherwise. */
  qtyUnit: InvoiceQtyUnit;
  invoiceId: string | null;
  /** Every truck on the roster, spend descending; zeros for a truck with no stops. */
  rows: TruckListRow[];
  /** Stops with no resolved truck (a card with no assignment covering the stop, D19). */
  unresolved: StopRollup;
  /** The whole invoice: `rows` + `unresolved`. */
  fleet: StopRollup;
}

interface TruckRosterRow {
  id: string;
  unit_number: string;
}

/**
 * `GET /trucks?week=&currency=` (A8.8, A13). Grouped by `fuel_stops.truck_id` —
 * the truck resolved at import from the assignment in force *then* — so a stop
 * dated before a reassignment stays with the old truck. One side of one
 * billing week, like `GET /drivers` (D26).
 */
export async function listTrucks(pool: Pool, query: WeekQuery): Promise<TrucksResult> {
  const { week, currency } = query;
  const invoice = await loadWeekInvoice(pool, week, currency);
  const conv = qtyConverter(invoice?.qtyUnit ?? qtyUnitFor(currency), query.units);
  const header = { week, currency, qtyUnit: conv.qtyUnit };
  if (invoice === null) {
    const zero = toRollup(EMPTY_SUMS, conv);
    return { ...header, invoiceId: null, rows: [], unresolved: zero, fleet: zero };
  }

  const [groups, { rows: roster }] = await Promise.all([
    loadRollupSums(pool, invoice.id, "truck"),
    pool.query<TruckRosterRow>("SELECT id, unit_number FROM trucks"),
  ]);

  const rows = roster
    .map((t) => ({ truck: { id: t.id, unitNumber: t.unit_number }, ...toRollup(groups.get(t.id) ?? EMPTY_SUMS, conv) }))
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.truck.unitNumber.localeCompare(b.truck.unitNumber) ||
        a.truck.id.localeCompare(b.truck.id),
    );

  return {
    ...header,
    invoiceId: invoice.id,
    rows,
    unresolved: toRollup(groups.get(null) ?? EMPTY_SUMS, conv),
    fleet: toRollup(fleetSums(groups), conv),
  };
}

export interface TruckRosterResult {
  rows: Array<{
    id: string;
    unitNumber: string;
    /** The optimiser's 3 planning inputs Dev Tools previews against the
     * selected truck (T-56) — null when this truck's spec is incomplete. */
    tankGallons: number | null;
    avgMpg: number | null;
    reserveFraction: number | null;
  }>;
}

interface TruckRosterQueryRow extends TruckRosterRow {
  tank_gallons: string | null;
  avg_mpg: string | null;
  reserve_fraction: string | null;
}

/**
 * `GET /trucks` with no `period` (D23) — the plain 27-unit roster, no
 * invoice/spend data. For a picker that carries no period of its own (New
 * Plan's truck field, A7) — `?period=` still serves T-37's spend-scoped
 * analytics unchanged.
 */
export async function listTruckRoster(pool: Pool): Promise<TruckRosterResult> {
  const { rows } = await pool.query<TruckRosterQueryRow>(
    "SELECT id, unit_number, tank_gallons, avg_mpg, reserve_fraction FROM trucks ORDER BY unit_number",
  );
  return {
    rows: rows.map((r) => ({
      id: r.id,
      unitNumber: r.unit_number,
      tankGallons: r.tank_gallons === null ? null : Number(r.tank_gallons),
      avgMpg: r.avg_mpg === null ? null : Number(r.avg_mpg),
      reserveFraction: r.reserve_fraction === null ? null : Number(r.reserve_fraction),
    })),
  };
}

export interface TruckCard {
  id: string;
  cardNumber: string;
  status: PersonCardStatus;
}

export interface TruckAssignmentHistoryItem {
  id: string;
  driver: { id: string; displayName: string };
  /** The driver's card — permanent 1:1 (D19). The active one if there is one, else the newest. */
  card: TruckCard | null;
  /** Inclusive calendar dates, `YYYY-MM-DD`. */
  effectiveFrom: string;
  /** Inclusive; `null` means current. */
  effectiveTo: string | null;
  /** Whether this assignment is the one in force on `asOf`. */
  inForce: boolean;
}

export interface TruckDetail {
  week: string;
  currency: InvoiceCurrency;
  qtyUnit: InvoiceQtyUnit;
  invoiceId: string | null;
  truck: { id: string; unitNumber: string };
  /** The date `inForce`/`assignedCard` are evaluated at: the invoice's printed
   * `period_end`, or `week` itself when there is no invoice. */
  asOf: string;
  /** The card of the assignment in force on `asOf`; `null` if none is. If the
   * schema's per-driver overlap guard allowed two drivers in the truck at once,
   * the latest-starting assignment wins. */
  assignedCard: TruckCard | null;
  /** Every assignment of this truck, oldest to newest. */
  assignments: TruckAssignmentHistoryItem[];
  summary: StopRollup;
  fleet: { avgBilledPerUnit: number | null; qty: number; stopCount: number };
  avgVsFleetPerUnit: number | null;
  favouredStations: FavouredStations;
  history: RollupHistoryPoint[];
}

interface TruckRow {
  id: string;
  unit_number: string;
}

interface AssignmentQueryRow {
  id: string;
  driver_id: string;
  display_name: string;
  effective_from: string;
  effective_to: string | null;
  card_id: string | null;
  card_number: string | null;
  card_status: PersonCardStatus | null;
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Dates come back from SQL as text and are anchored to UTC midnight here, because
 * `resolveTruckAtInstant` reads UTC calendar components — a `pg`-parsed `date`
 * is local midnight and would be off a day in some zones. */
async function loadAssignments(pool: Pool, truckId: string): Promise<AssignmentQueryRow[]> {
  const { rows } = await pool.query<AssignmentQueryRow>(
    `SELECT ta.id, ta.driver_id, d.display_name,
            to_char(ta.effective_from, 'YYYY-MM-DD') AS effective_from,
            to_char(ta.effective_to, 'YYYY-MM-DD') AS effective_to,
            fc.id AS card_id, fc.card_number, fc.status AS card_status
     FROM truck_assignments ta
     JOIN drivers d ON d.id = ta.driver_id
     LEFT JOIN LATERAL (
       SELECT id, card_number, status FROM fuel_cards
       WHERE driver_id = ta.driver_id
       ORDER BY (status = 'active') DESC, created_at DESC, id
       LIMIT 1
     ) fc ON true
     WHERE ta.truck_id = $1
     ORDER BY ta.effective_from ASC, ta.id ASC`,
    [truckId],
  );
  return rows;
}

/**
 * `GET /trucks/{id}?week=&currency=`. `null` when the id doesn't name a truck (→ 404).
 *
 * The stop figures read the stored `fuel_stops.truck_id`, never today's
 * assignment. The assignment history is the separate, complete record of who
 * had the truck when; "in force" on a date is `resolveTruckAtInstant` — the one
 * inclusive-boundary rule — run over this truck's own assignment rows, where a
 * hit for a driver means that driver's assignment *to this truck* covered the date.
 */
export async function getTruckDetail(pool: Pool, id: string, query: WeekQuery): Promise<TruckDetail | null> {
  if (!isUuid(id)) {
    return null;
  }
  const { rows } = await pool.query<TruckRow>("SELECT id, unit_number FROM trucks WHERE id = $1", [id]);
  const truck = rows[0];
  if (!truck) {
    return null;
  }

  const { week, currency } = query;
  const invoice = await loadWeekInvoice(pool, week, currency);
  const conv = qtyConverter(invoice?.qtyUnit ?? qtyUnitFor(currency), query.units);
  const header = { week, currency, qtyUnit: conv.qtyUnit };
  const asOf = invoice?.periodEnd ?? week;

  const [assignmentRows, history] = await Promise.all([
    loadAssignments(pool, id),
    loadRollupHistory(pool, week, currency, "truck", id, conv),
  ]);

  const forMatch: TruckAssignmentForMatch[] = assignmentRows.map((a) => ({
    driverId: a.driver_id,
    truckId: id,
    effectiveFrom: utcDate(a.effective_from),
    effectiveTo: a.effective_to === null ? null : utcDate(a.effective_to),
  }));
  const asOfDate = utcDate(asOf);
  const inForceIds = new Set(
    assignmentRows.filter((a, i) => resolveTruckAtInstant(a.driver_id, [forMatch[i]!], asOfDate) === id).map((a) => a.id),
  );

  const assignments: TruckAssignmentHistoryItem[] = assignmentRows.map((a) => ({
    id: a.id,
    driver: { id: a.driver_id, displayName: a.display_name },
    card:
      a.card_id !== null && a.card_number !== null && a.card_status !== null
        ? { id: a.card_id, cardNumber: a.card_number, status: a.card_status }
        : null,
    effectiveFrom: a.effective_from,
    effectiveTo: a.effective_to,
    inForce: inForceIds.has(a.id),
  }));
  const assignedCard = [...assignments].reverse().find((a) => a.inForce)?.card ?? null;

  const truckRef = { id: truck.id, unitNumber: truck.unit_number };
  if (invoice === null) {
    return {
      ...header,
      invoiceId: null,
      truck: truckRef,
      asOf,
      assignedCard,
      assignments,
      summary: toRollup(EMPTY_SUMS, conv),
      fleet: { avgBilledPerUnit: null, qty: 0, stopCount: 0 },
      avgVsFleetPerUnit: null,
      favouredStations: { stations: [], unresolvedStationStops: 0 },
      history,
    };
  }

  const [groups, favouredStations] = await Promise.all([
    loadRollupSums(pool, invoice.id, "truck"),
    loadFavouredStations(pool, invoice.id, "truck", id, conv),
  ]);
  const summary = toRollup(groups.get(id) ?? EMPTY_SUMS, conv);
  const fleet = toRollup(fleetSums(groups), conv);

  return {
    ...header,
    invoiceId: invoice.id,
    truck: truckRef,
    asOf,
    assignedCard,
    assignments,
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
