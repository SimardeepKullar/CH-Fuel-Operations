import type { Pool } from "pg";
import { match, type FuelStopForMatch, type MatchExclusions, type MatchRow, type PlanStopForMatch } from "./match.js";

export interface TruckVariance {
  truckId: string;
  unitNumber: string;
  /** Matched stops only — a skip has no dollar figure and an unplanned stop has no plan to attribute to a truck's adherence. */
  stopCount: number;
  plannedUsd: number;
  actualUsd: number;
  varianceUsd: number;
  /** This truck's own `matched / (matched + skipped_recommendation) * 100` (same formula as the top-level figure, applied per truck). `0`, not `null`, for a truck with only skipped recommendations — a real, meaningful "never touched a planned stop" rather than a null needing a fallback. */
  adherencePct: number;
}

export interface PlanActualResult {
  period: string;
  invoiceId: string | null;
  /** "X of Y stops covered by a plan" (A8.10) — `total` is every actual fuel stop on the invoice, `covered` is how many matched. */
  coverage: { covered: number; total: number };
  matches: MatchRow[];
  exclusions: MatchExclusions;
  /** `matched / (matched + skipped_recommendation) * 100` (Decided, T-38). `null` when no dispatched recommendation fell in the period at all — nothing to take a percentage of. */
  adherencePct: number | null;
  /** Sum of *positive* `delta_usd` across matched rows only — a favourable stop never offsets an unfavourable one in this figure (BUILD-PLAN 38.2). */
  moneyLeftOnTableUsd: number;
  /** Grouped by truck (Decided, T-38 and its T-46 prerequisite amendment) — stop count, planned/actual/variance in dollars, and this truck's own adherence percentage. */
  byTruckVarianceUsd: TruckVariance[];
}

interface InvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
}

async function loadInvoice(pool: Pool, period: string): Promise<InvoiceRow | null> {
  const { rows } = await pool.query<InvoiceRow>(
    `SELECT id, period_start::text, period_end::text FROM invoices WHERE period_start = $1::date`,
    [period],
  );
  return rows[0] ?? null;
}

interface PlanStopSourceRow {
  plan_id: string;
  plan_stop_id: string;
  dispatched_at: Date;
  truck_id: string | null;
  station_id: string | null;
  unit_price_usd: string;
}

/**
 * Every dispatched plan's fuel stops whose `dispatched_at` day falls inside
 * this invoice's period — the window a driver could plausibly have executed
 * it in. A plan_stop's own timestamp doesn't exist (§12), so `dispatched_at`
 * doubles as the date-window anchor for every stop on the plan (Decided,
 * T-38 — see match.ts's `PlanStopForMatch` doc).
 */
async function loadDispatchedPlanStops(pool: Pool, periodStart: string, periodEnd: string): Promise<PlanStopForMatch[]> {
  const { rows } = await pool.query<PlanStopSourceRow>(
    `SELECT p.id AS plan_id, ps.id::text AS plan_stop_id, p.dispatched_at, p.truck_id, ps.station_id, ps.unit_price_usd
       FROM plans p
       JOIN plan_stops ps ON ps.plan_id = p.id
      WHERE p.dispatched_at IS NOT NULL
        AND p.dispatched_at::date BETWEEN $1::date AND $2::date
        AND ps.stop_type = 'fuel'
        AND ps.station_id IS NOT NULL`,
    [periodStart, periodEnd],
  );
  return rows.map((r) => ({
    planId: r.plan_id,
    planStopId: r.plan_stop_id,
    dispatchedAt: r.dispatched_at,
    truckId: r.truck_id,
    stationId: r.station_id!,
    expectedUsdPerGal: Number(r.unit_price_usd),
  }));
}

interface FuelStopSourceRow {
  fuel_stop_id: string;
  occurred_at: Date;
  station_id: string | null;
  truck_id: string | null;
  diesel_gallons: string | null;
  diesel_amount_usd: string | null;
}

/**
 * Every fuel stop on the invoice, diesel-only gallons/amount aggregated per
 * stop (never `fuel_stops.total_usd`, which is DEF-inclusive — CLAUDE.md). A
 * stop with no diesel line (e.g. DEF-only) has `null` aggregates and is
 * dropped before matching — it has nothing for `delta_usd` to compare.
 */
async function loadFuelStops(pool: Pool, invoiceId: string): Promise<FuelStopForMatch[]> {
  const { rows } = await pool.query<FuelStopSourceRow>(
    `SELECT fs.id AS fuel_stop_id, fs.occurred_at, fs.station_id, fs.truck_id,
            SUM(fsl.gallons) FILTER (WHERE fsl.product_code = 'TA') AS diesel_gallons,
            SUM(fsl.gallons * fsl.billed_usd_per_gal) FILTER (WHERE fsl.product_code = 'TA') AS diesel_amount_usd
       FROM fuel_stops fs
       LEFT JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id
      WHERE fs.invoice_id = $1
      GROUP BY fs.id, fs.occurred_at, fs.station_id, fs.truck_id`,
    [invoiceId],
  );
  const result: FuelStopForMatch[] = [];
  for (const r of rows) {
    const gallons = r.diesel_gallons === null ? 0 : Number(r.diesel_gallons);
    if (gallons <= 0) continue;
    result.push({
      fuelStopId: r.fuel_stop_id,
      occurredAt: r.occurred_at,
      stationId: r.station_id,
      truckId: r.truck_id,
      dieselGallons: gallons,
      billedUsdPerGal: Number(r.diesel_amount_usd) / gallons,
      // T-38 leaves split-fill detection caller-supplied (match.ts) rather
      // than guessing a timing heuristic; the live endpoint reports none
      // today. Left as a documented, deliberate scope cut, not a bug — see
      // match.ts's FuelStopForMatch.splitFill doc.
      splitFill: false,
    });
  }
  return result;
}

async function countInvoiceFuelStops(pool: Pool, invoiceId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM fuel_stops WHERE invoice_id = $1`, [invoiceId]);
  return Number(rows[0]!.count);
}

function computeAdherencePct(matches: readonly MatchRow[]): number | null {
  const matched = matches.filter((m) => m.kind === "matched").length;
  const skipped = matches.filter((m) => m.kind === "skipped_recommendation").length;
  const denominator = matched + skipped;
  return denominator === 0 ? null : (matched / denominator) * 100;
}

function computeMoneyLeftOnTableUsd(matches: readonly MatchRow[]): number {
  return matches.filter((m) => m.kind === "matched" && m.deltaUsd !== null && m.deltaUsd > 0).reduce((sum, m) => sum + m.deltaUsd!, 0);
}

interface TruckAgg {
  stopCount: number;
  plannedUsd: number;
  actualUsd: number;
  varianceUsd: number;
  matchedCount: number;
  skippedCount: number;
}

function emptyTruckAgg(): TruckAgg {
  return { stopCount: 0, plannedUsd: 0, actualUsd: 0, varianceUsd: 0, matchedCount: 0, skippedCount: 0 };
}

async function computeByTruckVariance(pool: Pool, matches: readonly MatchRow[], planStops: readonly PlanStopForMatch[]): Promise<TruckVariance[]> {
  const truckIdByPlanId = new Map(planStops.map((ps) => [ps.planId, ps.truckId]));
  const byTruck = new Map<string, TruckAgg>();

  for (const m of matches) {
    if (m.planId === null) continue; // unplanned_stop has no plan, so no truck to attribute it to here
    const truckId = truckIdByPlanId.get(m.planId);
    if (!truckId) continue;

    const agg = byTruck.get(truckId) ?? emptyTruckAgg();
    if (m.kind === "matched") {
      agg.stopCount += 1;
      agg.plannedUsd += m.plannedUsd ?? 0;
      agg.actualUsd += m.actualUsd ?? 0;
      agg.varianceUsd += m.deltaUsd ?? 0;
      agg.matchedCount += 1;
    } else if (m.kind === "skipped_recommendation") {
      agg.skippedCount += 1;
    }
    byTruck.set(truckId, agg);
  }
  if (byTruck.size === 0) return [];

  const { rows } = await pool.query<{ id: string; unit_number: string }>(
    `SELECT id, unit_number FROM trucks WHERE id = ANY($1::uuid[])`,
    [[...byTruck.keys()]],
  );
  const unitNumberById = new Map(rows.map((r) => [r.id, r.unit_number]));

  return [...byTruck.entries()]
    .map(([truckId, agg]) => ({
      truckId,
      unitNumber: unitNumberById.get(truckId) ?? "",
      stopCount: agg.stopCount,
      plannedUsd: agg.plannedUsd,
      actualUsd: agg.actualUsd,
      varianceUsd: agg.varianceUsd,
      adherencePct: agg.matchedCount + agg.skippedCount === 0 ? 0 : (agg.matchedCount / (agg.matchedCount + agg.skippedCount)) * 100,
    }))
    .sort((a, b) => b.varianceUsd - a.varianceUsd || a.unitNumber.localeCompare(b.unitNumber));
}

/**
 * `GET /plan-actual?period=` (A14, A13). Zero overlap between plans and
 * invoices is a real, persistent state (A8.10) — this always returns a
 * well-formed payload with coverage counts, never a 404 or a bare `[]`.
 */
export async function getPlanActual(pool: Pool, period: string): Promise<PlanActualResult> {
  const invoice = await loadInvoice(pool, period);
  if (invoice === null) {
    return {
      period,
      invoiceId: null,
      coverage: { covered: 0, total: 0 },
      matches: [],
      exclusions: { splitFill: 0, unresolvedStation: 0, noArchivedPriceFile: 0 },
      adherencePct: null,
      moneyLeftOnTableUsd: 0,
      byTruckVarianceUsd: [],
    };
  }

  const [planStops, fuelStops, totalFuelStops] = await Promise.all([
    loadDispatchedPlanStops(pool, invoice.period_start, invoice.period_end),
    loadFuelStops(pool, invoice.id),
    countInvoiceFuelStops(pool, invoice.id),
  ]);

  const { matches, exclusions } = match(planStops, fuelStops);
  const covered = matches.filter((m) => m.kind === "matched").length;
  const byTruckVarianceUsd = await computeByTruckVariance(pool, matches, planStops);

  return {
    period,
    invoiceId: invoice.id,
    coverage: { covered, total: totalFuelStops },
    matches,
    exclusions,
    adherencePct: computeAdherencePct(matches),
    moneyLeftOnTableUsd: computeMoneyLeftOnTableUsd(matches),
    byTruckVarianceUsd,
  };
}
