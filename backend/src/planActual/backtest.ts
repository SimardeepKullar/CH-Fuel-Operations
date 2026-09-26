import type { Pool } from "pg";
import { dynamicProgrammingOptimizer } from "../optimizer/dp_v1.js";
import type { OptimizerCandidate, OptimizerInput } from "../optimizer/types.js";
import { DEFAULT_CORRIDOR_MILES } from "../planning/planDefaults.js";

/**
 * One truck's actual stop set for one historical day, already shaped for a
 * re-solve. `optimizerInput` is `null` when no BVD price sheet was ingested
 * for `date` — the "no archived price file" exclusion (A14) — built by the
 * caller from `price_imports`/`station_prices`, never from a file on disk at
 * request time (A14 needs this cheap enough to run over ten years of
 * history at once).
 */
export interface HistoricalLane {
  date: string;
  truckId: string;
  optimizerInput: OptimizerInput | null;
  /** What the truck actually paid for diesel that day (`fuel_stop_lines`, product 'TA'). */
  actualCostUsd: number;
}

export type BacktestRow =
  | { kind: "priced"; date: string; truckId: string; projectedCostUsd: number; actualCostUsd: number; deltaUsd: number }
  | { kind: "no_archived_price_file"; date: string; truckId: string };

export interface BacktestResult {
  rows: BacktestRow[];
  exclusions: { noArchivedPriceFile: number };
}

/**
 * Re-solves each historical lane with **`dp_v1`, unchanged** — the same
 * strategy live planning uses, imported directly rather than through
 * `OPTIMIZERS`'s configurable lookup, since a backtest's whole point is
 * "what dp_v1 would have chosen," not whatever strategy a plan happened to
 * be solved with (A14). `solve()` is synchronous and pure (`optimizer/types.ts`),
 * so this whole function has zero I/O in scope — every archived price and
 * every actual figure was already resolved by the caller before this runs.
 *
 * A lane with no archived price file is a named, counted exclusion, never a
 * zero delta.
 */
export function runBacktest(lanes: readonly HistoricalLane[]): BacktestResult {
  const rows: BacktestRow[] = [];
  let noArchivedPriceFile = 0;

  for (const lane of lanes) {
    if (lane.optimizerInput === null) {
      noArchivedPriceFile++;
      rows.push({ kind: "no_archived_price_file", date: lane.date, truckId: lane.truckId });
      continue;
    }

    const result = dynamicProgrammingOptimizer.solve(lane.optimizerInput);
    // An infeasible lane has no better answer to offer than what actually
    // happened — a delta of 0, not a manufactured "worse than actual"
    // figure the optimiser never produced.
    const projectedCostUsd = result.kind === "plan" ? result.totalFuelCostUsd : lane.actualCostUsd;

    rows.push({
      kind: "priced",
      date: lane.date,
      truckId: lane.truckId,
      projectedCostUsd,
      actualCostUsd: lane.actualCostUsd,
      deltaUsd: lane.actualCostUsd - projectedCostUsd,
    });
  }

  return { rows, exclusions: { noArchivedPriceFile } };
}

interface StationPointRow {
  id: string;
  lng: number;
  lat: number;
}

interface PricedCandidateRow {
  id: string;
  lng: number;
  lat: number;
  unit_price_usd: string;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance between two lat/lng points, in miles. */
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/**
 * Builds one truck-day's `OptimizerInput` from archived data only — no
 * routing-provider call, so this is cheap enough to run across the full
 * backfilled history (A14). There is no recorded trip/route for a historical
 * day the way a freshly-solved plan has one, so the "lane" is a
 * straight-line reduction (Decided, T-38): waypoints are the stations the
 * truck actually visited that day, in visit order, connected by great-circle
 * legs; a candidate station is any BVD station within `radiusMiles` of the
 * *nearest* waypoint, positioned at that waypoint's cumulative straight-line
 * offset and priced as of `date`.
 *
 * Reads the backtested truck's own `trucks` row for its mpg/tank spec
 * (T-56) — before the merge, real trucks had no linked spec at all, so this
 * re-solved against one fixed reference `truck_profiles` row instead
 * ("what would dp_v1 have chosen with a representative truck"). Every truck
 * now carries its own spec directly; today every one of the 27 is still the
 * same seeded default (0005_fleet_roster_seed.sql), so the answer is
 * unchanged for now, but a future per-truck correction flows straight into
 * that truck's own backtest with no further change here.
 */
export async function buildHistoricalLane(
  pool: Pool,
  params: { date: string; truckId: string; stationIds: readonly string[]; actualCostUsd: number; radiusMiles: number },
): Promise<HistoricalLane> {
  const excluded = (): HistoricalLane => ({ date: params.date, truckId: params.truckId, optimizerInput: null, actualCostUsd: params.actualCostUsd });

  if (params.stationIds.length === 0) return excluded();

  const { rows: sheetRows } = await pool.query<{ id: string }>(
    `SELECT id FROM price_imports WHERE supplier = 'BVD' AND status = 'completed' AND effective_date = $1::date LIMIT 1`,
    [params.date],
  );
  if (sheetRows.length === 0) return excluded();

  const { rows: profileRows } = await pool.query<{
    tank_gallons: string | null;
    avg_mpg: string | null;
    reserve_fraction: string | null;
    max_leg_miles: string | null;
    min_leg_miles: string | null;
    cost_per_mile_usd: string | null;
  }>(`SELECT tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles, cost_per_mile_usd FROM trucks WHERE id = $1`, [
    params.truckId,
  ]);
  const profile = profileRows[0];
  if (!profile || Object.values(profile).some((v) => v === null)) return excluded();

  // Visited waypoints, in the order the caller gave them (occurred_at asc).
  const { rows: waypointRows } = await pool.query<StationPointRow>(
    `SELECT v.id, ST_X(s.geom::geometry) AS lng, ST_Y(s.geom::geometry) AS lat
       FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, ord)
       JOIN stations s ON s.id = v.id
      ORDER BY v.ord`,
    [params.stationIds],
  );
  if (waypointRows.length === 0) return excluded();

  const waypoints = waypointRows.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng }));
  const cumulativeOffsetMiles: number[] = [0];
  for (let i = 1; i < waypoints.length; i++) {
    cumulativeOffsetMiles.push(cumulativeOffsetMiles[i - 1]! + haversineMiles(waypoints[i - 1]!, waypoints[i]!));
  }
  const totalDistanceMiles = cumulativeOffsetMiles[cumulativeOffsetMiles.length - 1]!;

  // Any priced BVD station within radiusMiles of at least one waypoint.
  const { rows: nearbyRows } = await pool.query<PricedCandidateRow>(
    `SELECT DISTINCT ON (s.id) s.id, ST_X(s.geom::geometry) AS lng, ST_Y(s.geom::geometry) AS lat, sp.your_price AS unit_price_usd
       FROM stations s
       JOIN LATERAL (
         SELECT your_price FROM station_prices
          WHERE station_id = s.id AND valid_on = $3::date
          ORDER BY your_price ASC
          LIMIT 1
       ) sp ON true
      WHERE EXISTS (
        SELECT 1 FROM unnest($1::uuid[]) AS wp(id)
        JOIN stations ws ON ws.id = wp.id
        WHERE ST_DWithin(s.geom, ws.geom, $2 * 1609.344)
      )
      ORDER BY s.id`,
    [params.stationIds, params.radiusMiles, params.date],
  );

  const candidates: OptimizerCandidate[] = nearbyRows.map((r) => {
    const point = { lat: r.lat, lng: r.lng };
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    waypoints.forEach((wp, i) => {
      const d = haversineMiles(wp, point);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIndex = i;
      }
    });
    return {
      id: r.id,
      positionMiles: cumulativeOffsetMiles[nearestIndex]!,
      unitPriceUsd: Number(r.unit_price_usd),
      detourMiles: 0,
      detourHours: 0,
    };
  });

  const optimizerInput: OptimizerInput = {
    totalDistanceMiles,
    candidates,
    fuel: {
      tankGallons: Number(profile.tank_gallons),
      avgMpg: Number(profile.avg_mpg),
      reserveFraction: Number(profile.reserve_fraction),
      maxLegMiles: Number(profile.max_leg_miles),
      minLegMiles: Number(profile.min_leg_miles),
      startGallons: Number(profile.tank_gallons),
      minArrivalGallons: Number(profile.reserve_fraction) * Number(profile.tank_gallons),
      requireArrivalWithinMaxLeg: true,
    },
    cost: { costPerMile: Number(profile.cost_per_mile_usd), driverCostPerHour: 0, fixedStopMinutes: 0 },
    maxStops: null,
  };

  return { date: params.date, truckId: params.truckId, optimizerInput, actualCostUsd: params.actualCostUsd };
}

interface TruckDayRow {
  truck_id: string;
  day: string;
  station_ids: string[];
  actual_cost_usd: string;
}

/**
 * Every (truck, UTC day) with at least one resolved-station diesel fuel stop
 * in `[from, to]`, with that day's stations in visit order and the diesel
 * cost actually billed — the raw material `buildHistoricalLane` turns into
 * an `OptimizerInput` per day.
 */
async function loadTruckDays(pool: Pool, from: string, to: string): Promise<TruckDayRow[]> {
  const { rows } = await pool.query<TruckDayRow>(
    `SELECT fs.truck_id,
            (fs.occurred_at AT TIME ZONE 'UTC')::date::text AS day,
            array_agg(fs.station_id ORDER BY fs.occurred_at) AS station_ids,
            SUM(fsl.gallons * fsl.billed_usd_per_gal) AS actual_cost_usd
       FROM fuel_stops fs
       JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id AND fsl.product_code = 'TA'
      WHERE fs.truck_id IS NOT NULL
        AND fs.station_id IS NOT NULL
        AND fs.occurred_at::date BETWEEN $1::date AND $2::date
      GROUP BY fs.truck_id, (fs.occurred_at AT TIME ZONE 'UTC')::date`,
    [from, to],
  );
  return rows;
}

export interface GetBacktestResult extends BacktestResult {
  from: string;
  to: string;
}

/**
 * `GET /plan-actual/backtest?from=&to=` (A14, A13). Needs no plan: every
 * truck-day with real fuel stops in range is re-solved, so this works over
 * the full backfilled history at once.
 */
export async function getBacktest(pool: Pool, from: string, to: string): Promise<GetBacktestResult> {
  const truckDays = await loadTruckDays(pool, from, to);

  const lanes = await Promise.all(
    truckDays.map((row) =>
      buildHistoricalLane(pool, {
        date: row.day,
        truckId: row.truck_id,
        stationIds: row.station_ids,
        actualCostUsd: Number(row.actual_cost_usd),
        radiusMiles: DEFAULT_CORRIDOR_MILES,
      }),
    ),
  );

  return { from, to, ...runBacktest(lanes) };
}
