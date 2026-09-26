import type { MatchKind } from "../db/types.js";

/**
 * One dispatched plan's recommended stop, shaped for matching (A14, T-38).
 * `truckId` is `plans.truck_id` (T-38) — the real fleet truck the plan was
 * for; there is no separate abstract mpg/tank class any more (T-56).
 * `dispatchedAt` is
 * `plans.dispatched_at` (T-19), denormalized onto every stop of the plan:
 * A14 matches dispatched plans only, and — since `plan_stops` carries no
 * timestamp of its own — this is also the anchor for the stop's "date
 * window" (Decided, T-38: same UTC day as `dispatchedAt`, applied to every
 * stop of the plan alike, since a plan's itinerary has no per-stop clock).
 */
export interface PlanStopForMatch {
  planId: string;
  planStopId: string;
  /** `null` on a plan never sent to a driver — such a stop never enters matching (A14). */
  dispatchedAt: Date | null;
  /** `null` on a plan that named no specific truck (T-38) — never matchable, not one of A14's three exclusion classes: it never entered the pool. */
  truckId: string | null;
  stationId: string;
  /** `plan_stops.unit_price_usd` — the "planned expected" price `delta_usd` is measured against. */
  expectedUsdPerGal: number;
}

/**
 * One actual fuel stop, shaped for matching. Gallons/price are the diesel
 * line only (`fuel_stop_lines` filtered to the diesel product code) — never
 * `fuel_stops.total_usd`, which is DEF-inclusive (CLAUDE.md).
 */
export interface FuelStopForMatch {
  fuelStopId: string;
  occurredAt: Date;
  /** `null` when invoice station text resolved to no listed site — the "unresolved station text" exclusion (A14). */
  stationId: string | null;
  /** `null` when the stop's truck did not resolve (T-29) — such a stop is still real spend and still surfaces as `unplanned_stop`; it simply cannot be a candidate for any plan's recommendation, which is keyed on truck identity. */
  truckId: string | null;
  dieselGallons: number;
  billedUsdPerGal: number;
  /**
   * Caller-flagged: this row is one leg of a split fill — a single physical
   * refuel recorded as two or more auth codes (e.g. a card/pump limit) —
   * with no single planned stop to match against. Detecting that is an
   * invoice-line-level concern (grouping raw lines/auth codes), outside
   * this truck+window+station join; T-38 leaves the flag caller-supplied
   * rather than guessing a timing heuristic inside match() that no fixture
   * here can verify.
   */
  splitFill: boolean;
}

export interface MatchRow {
  kind: MatchKind;
  planId: string | null;
  planStopId: string | null;
  fuelStopId: string | null;
  /** `planned expected price × actual gallons` on a `matched` row; `null` otherwise. What the plan would have cost at the actual quantity bought. */
  plannedUsd: number | null;
  /** `actual billed price × actual gallons` on a `matched` row; `null` otherwise. */
  actualUsd: number | null;
  /** `actualUsd − plannedUsd` on a `matched` row (A14); `null` otherwise — nothing to compute for a skip or an unplanned stop. */
  deltaUsd: number | null;
}

/** A14's three named exclusion classes — counted, never silently dropped. */
export interface MatchExclusions {
  splitFill: number;
  unresolvedStation: number;
  /** match() never produces this itself (it has no notion of a price file); a caller (`backtest.ts`) folds its own count in via `MatchOptions`, so every A14 caller reports all three classes through one shape. */
  noArchivedPriceFile: number;
}

export interface MatchResult {
  matches: MatchRow[];
  exclusions: MatchExclusions;
}

export interface MatchOptions {
  noArchivedPriceFileCount?: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fuelStopKey(truckId: string, day: string, stationId: string): string {
  return `${truckId}\u0000${day}\u0000${stationId}`;
}

/**
 * Pure over injected plan stops and fuel stops — no database, no clock
 * (CLAUDE.md, A14). Matches on truck + date window (same UTC day, Decided
 * T-38) + station. Only stops from a dispatched plan with a chosen truck
 * enter the pool; everything else in `planStops` is silently excluded from
 * consideration (not one of A14's three named exclusion classes).
 *
 * Where two or more actual fuel stops land in one plan stop's window, the
 * one nearest in time to the plan's `dispatchedAt` wins as `matched`; the
 * rest become `unplanned_stop` rows, never dropped.
 */
export function match(
  planStops: readonly PlanStopForMatch[],
  fuelStops: readonly FuelStopForMatch[],
  options: MatchOptions = {},
): MatchResult {
  let splitFillCount = 0;
  let unresolvedStationCount = 0;

  const usableFuelStops: Array<FuelStopForMatch & { stationId: string }> = [];
  for (const fs of fuelStops) {
    if (fs.splitFill) {
      splitFillCount++;
      continue;
    }
    if (fs.stationId === null) {
      unresolvedStationCount++;
      continue;
    }
    usableFuelStops.push({ ...fs, stationId: fs.stationId });
  }

  const fuelIndex = new Map<string, Array<FuelStopForMatch & { stationId: string }>>();
  for (const fs of usableFuelStops) {
    if (fs.truckId === null) continue; // no truck resolved — cannot be a candidate for any plan's recommendation (falls through to unplanned_stop below)
    const key = fuelStopKey(fs.truckId, dayKey(fs.occurredAt), fs.stationId);
    const bucket = fuelIndex.get(key);
    if (bucket) bucket.push(fs);
    else fuelIndex.set(key, [fs]);
  }

  const consumedFuelStopIds = new Set<string>();
  const rows: MatchRow[] = [];

  for (const ps of planStops) {
    if (ps.dispatchedAt === null || ps.truckId === null) continue;

    const key = fuelStopKey(ps.truckId, dayKey(ps.dispatchedAt), ps.stationId);
    // Excludes fuel stops another plan stop already won at this same key —
    // two dispatched plans sharing a truck/day/station is a rare but
    // possible overlap, and a fuel stop must not be double-counted.
    const candidates = (fuelIndex.get(key) ?? []).filter((c) => !consumedFuelStopIds.has(c.fuelStopId));

    if (candidates.length === 0) {
      rows.push({
        kind: "skipped_recommendation",
        planId: ps.planId,
        planStopId: ps.planStopId,
        fuelStopId: null,
        plannedUsd: null,
        actualUsd: null,
        deltaUsd: null,
      });
      continue;
    }

    const dispatchedAtMs = ps.dispatchedAt.getTime();
    const winner = candidates.reduce((nearest, c) =>
      Math.abs(c.occurredAt.getTime() - dispatchedAtMs) < Math.abs(nearest.occurredAt.getTime() - dispatchedAtMs) ? c : nearest,
    );

    // Any other candidate in this window loses the tie-break; it is real
    // spend with nothing to reconcile against, so it is left unconsumed
    // here and picked up as unplanned_stop by the loop below rather than
    // being dropped.
    consumedFuelStopIds.add(winner.fuelStopId);
    const plannedUsd = ps.expectedUsdPerGal * winner.dieselGallons;
    const actualUsd = winner.billedUsdPerGal * winner.dieselGallons;
    rows.push({
      kind: "matched",
      planId: ps.planId,
      planStopId: ps.planStopId,
      fuelStopId: winner.fuelStopId,
      plannedUsd,
      actualUsd,
      deltaUsd: actualUsd - plannedUsd,
    });
  }

  for (const fs of usableFuelStops) {
    if (consumedFuelStopIds.has(fs.fuelStopId)) continue;
    rows.push({
      kind: "unplanned_stop",
      planId: null,
      planStopId: null,
      fuelStopId: fs.fuelStopId,
      plannedUsd: null,
      actualUsd: null,
      deltaUsd: null,
    });
  }

  return {
    matches: rows,
    exclusions: {
      splitFill: splitFillCount,
      unresolvedStation: unresolvedStationCount,
      noArchivedPriceFile: options.noArchivedPriceFileCount ?? 0,
    },
  };
}
