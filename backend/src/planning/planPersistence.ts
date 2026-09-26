import type { Pool, PoolClient } from "pg";
import type {
  Disclaimer,
  InfeasibleReason,
  LatLng,
  PlanStop,
  RouteBounds,
} from "../domain/planResponse.js";
import type { PriceBasis, StopType } from "../db/types.js";

/** `ST_Envelope` on the geography cast to geometry, read once per route row so `RouteBounds` never needs a second query. */
export const ROUTE_BOUNDS_SELECT = `
  ST_YMin(r.line::geometry) AS bounds_south,
  ST_YMax(r.line::geometry) AS bounds_north,
  ST_XMin(r.line::geometry) AS bounds_west,
  ST_XMax(r.line::geometry) AS bounds_east`;

export interface RouteBoundsRow {
  bounds_south: number | null;
  bounds_north: number | null;
  bounds_west: number | null;
  bounds_east: number | null;
}

/** `routes.line` is nullable (§17); a route with no stored geometry has no bounds to draw. */
export function boundsFromRow(row: RouteBoundsRow): RouteBounds {
  return {
    north: row.bounds_north ?? 0,
    south: row.bounds_south ?? 0,
    east: row.bounds_east ?? 0,
    west: row.bounds_west ?? 0,
  };
}

export interface RouteGeometryRow extends RouteBoundsRow {
  provider: string;
  polyline: string | null;
  distance_miles: string;
  duration_s: number;
}

export const ROUTE_GEOMETRY_SELECT = `r.provider, r.polyline, r.distance_miles, r.duration_s, ${ROUTE_BOUNDS_SELECT}`;

/**
 * The 7 planning fields are nullable at the schema level (T-56 — zero real
 * per-unit data yet, only a flagged seeded default), so this is the raw row,
 * not yet validated as complete. `planService.createPlan` is what checks for
 * a missing field and names it in a 400 — this module only reads.
 */
export interface TruckForPlanRow {
  id: string;
  unit_number: string;
  tank_gallons: string | null;
  avg_mpg: string | null;
  reserve_fraction: string | null;
  max_leg_miles: string | null;
  min_leg_miles: string | null;
  cost_per_mile_usd: string | null;
  fixed_stop_minutes: number | null;
  gross_weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  axle_count: number | null;
  hazmat_class: string | null;
}

/** `null` when `truckId` does not exist — a request error, not a technical failure. */
export async function loadTruckRow(pool: Pool, truckId: string): Promise<TruckForPlanRow | null> {
  const { rows } = await pool.query<TruckForPlanRow>(
    `SELECT id, unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles, min_leg_miles,
            cost_per_mile_usd, fixed_stop_minutes, gross_weight_kg, height_cm, width_cm, length_cm,
            axle_count, hazmat_class
     FROM trucks WHERE id = $1`,
    [truckId],
  );
  return rows[0] ?? null;
}

/**
 * The most recent promoted BVD sheet (§11.1 step 4: only a clean pass reaches `status = 'completed'`).
 * `null` when nothing has ever been ingested — a plan genuinely cannot be priced.
 */
export async function resolveLatestPriceDate(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ effective_date: string | null }>(
    `SELECT MAX(effective_date)::text AS effective_date
     FROM price_imports
     WHERE supplier = 'BVD' AND status = 'completed'`,
  );
  return rows[0]?.effective_date ?? null;
}

export interface PersistCompletedPlanInput {
  /** Injected "now" (§ savedLocations.ts's pattern) — stored verbatim, so a `GET` re-fetch's `createdAt` matches the value `POST` already returned instead of drifting to the DB's own insert-time clock. */
  createdAt: Date;
  createdBy: string | null;
  baseRouteId: string;
  optimizedRouteId: string;
  truckId: string;
  originLabel: string | null;
  destinationLabel: string | null;
  optimizerStrategy: string;
  priceBasis: PriceBasis;
  startFuelGallons: number;
  minArrivalGallons: number;
  maxLegMiles: number;
  minLegMiles: number;
  minLegRelaxed: boolean;
  corridorMiles: number;
  maxDetourMiles: number | null;
  driverCostPerHour: number;
  fixedStopMinutes: number;
  maxStops: number | null;
  totalFuelCostUsd: number;
  totalGallons: number;
  totalDistanceMiles: number;
  totalDurationS: number;
  baselineCostUsd: number;
  priceAsOf: string;
  solveMs: number;
  googleMapsUrl: string;
  disclaimers: Disclaimer[];
  stops: Array<{
    seq: number;
    stopType: StopType;
    stationId: string;
    stationPriceId: string;
    offsetAlongRouteMiles: number;
    legDistanceMiles: number;
    detourDistanceMiles: number;
    detourDurationS: number;
    arrivalGallons: number;
    purchaseGallons: number;
    departureGallons: number;
    unitPriceUsd: number;
    stopCostUsd: number;
    cumDistanceMiles: number;
    cumDurationS: number;
  }>;
}

/**
 * One transaction: a `plans` row is meaningless without its `plan_stops`, and a crash between
 * the two must never leave either orphaned (CLAUDE.md; mirrors `cli/resolve.ts`'s
 * `resolveViaGazetteer`). `status = 'completed'` — the DP's actual, priced answer.
 */
export async function persistCompletedPlan(pool: Pool, input: PersistCompletedPlanInput): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const planId = await insertPlanRow(client, {
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      baseRouteId: input.baseRouteId,
      optimizedRouteId: input.optimizedRouteId,
      truckId: input.truckId,
      originLabel: input.originLabel,
      destinationLabel: input.destinationLabel,
      optimizerStrategy: input.optimizerStrategy,
      priceBasis: input.priceBasis,
      startFuelGallons: input.startFuelGallons,
      minArrivalGallons: input.minArrivalGallons,
      maxLegMiles: input.maxLegMiles,
      minLegMiles: input.minLegMiles,
      minLegRelaxed: input.minLegRelaxed,
      corridorMiles: input.corridorMiles,
      maxDetourMiles: input.maxDetourMiles,
      driverCostPerHour: input.driverCostPerHour,
      fixedStopMinutes: input.fixedStopMinutes,
      maxStops: input.maxStops,
      status: "completed",
      infeasibleReason: null,
      totalFuelCostUsd: input.totalFuelCostUsd,
      totalGallons: input.totalGallons,
      totalDistanceMiles: input.totalDistanceMiles,
      totalDurationS: input.totalDurationS,
      baselineCostUsd: input.baselineCostUsd,
      priceAsOf: input.priceAsOf,
      solveMs: input.solveMs,
      googleMapsUrl: input.googleMapsUrl,
      disclaimers: input.disclaimers,
    });

    for (const stop of input.stops) {
      await client.query(
        `INSERT INTO plan_stops
           (plan_id, seq, stop_type, station_id, station_price_id, offset_along_route_miles,
            leg_distance_miles, detour_distance_miles, detour_duration_s, arrival_gallons,
            purchase_gallons, departure_gallons, unit_price_usd, stop_cost_usd, cum_distance_miles, cum_duration_s)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          planId,
          stop.seq,
          stop.stopType,
          stop.stationId,
          stop.stationPriceId,
          stop.offsetAlongRouteMiles,
          stop.legDistanceMiles,
          stop.detourDistanceMiles,
          Math.round(stop.detourDurationS),
          stop.arrivalGallons,
          stop.purchaseGallons,
          stop.departureGallons,
          stop.unitPriceUsd,
          stop.stopCostUsd,
          stop.cumDistanceMiles,
          Math.round(stop.cumDurationS),
        ],
      );
    }

    await client.query("COMMIT");
    return planId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface PersistInfeasiblePlanInput {
  createdAt: Date;
  createdBy: string | null;
  baseRouteId: string;
  truckId: string;
  originLabel: string | null;
  destinationLabel: string | null;
  optimizerStrategy: string;
  priceBasis: PriceBasis;
  startFuelGallons: number;
  minArrivalGallons: number;
  maxLegMiles: number;
  minLegMiles: number;
  corridorMiles: number;
  maxDetourMiles: number | null;
  driverCostPerHour: number;
  fixedStopMinutes: number;
  maxStops: number | null;
  baselineCostUsd: number;
  priceAsOf: string;
  solveMs: number;
  reason: InfeasibleReason;
}

/**
 * A single-row transaction (no `plan_stops`): an infeasible lane is a legitimate, persisted
 * answer — §12.2 — not a technical failure. `optimized_route_id` stays null: nothing was
 * ever validated as routable.
 */
export async function persistInfeasiblePlan(pool: Pool, input: PersistInfeasiblePlanInput): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const planId = await insertPlanRow(client, {
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      baseRouteId: input.baseRouteId,
      optimizedRouteId: null,
      truckId: input.truckId,
      originLabel: input.originLabel,
      destinationLabel: input.destinationLabel,
      optimizerStrategy: input.optimizerStrategy,
      priceBasis: input.priceBasis,
      startFuelGallons: input.startFuelGallons,
      minArrivalGallons: input.minArrivalGallons,
      maxLegMiles: input.maxLegMiles,
      minLegMiles: input.minLegMiles,
      minLegRelaxed: false,
      corridorMiles: input.corridorMiles,
      maxDetourMiles: input.maxDetourMiles,
      driverCostPerHour: input.driverCostPerHour,
      fixedStopMinutes: input.fixedStopMinutes,
      maxStops: input.maxStops,
      status: "infeasible",
      infeasibleReason: input.reason,
      totalFuelCostUsd: null,
      totalGallons: null,
      totalDistanceMiles: null,
      totalDurationS: null,
      baselineCostUsd: input.baselineCostUsd,
      priceAsOf: input.priceAsOf,
      solveMs: input.solveMs,
      googleMapsUrl: null,
      disclaimers: [],
    });
    await client.query("COMMIT");
    return planId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

interface InsertPlanRowInput {
  createdAt: Date;
  createdBy: string | null;
  baseRouteId: string;
  optimizedRouteId: string | null;
  truckId: string;
  originLabel: string | null;
  destinationLabel: string | null;
  optimizerStrategy: string;
  priceBasis: PriceBasis;
  startFuelGallons: number;
  minArrivalGallons: number;
  maxLegMiles: number;
  minLegMiles: number;
  minLegRelaxed: boolean;
  corridorMiles: number;
  maxDetourMiles: number | null;
  driverCostPerHour: number;
  fixedStopMinutes: number;
  maxStops: number | null;
  status: "completed" | "infeasible";
  infeasibleReason: InfeasibleReason | null;
  totalFuelCostUsd: number | null;
  totalGallons: number | null;
  totalDistanceMiles: number | null;
  totalDurationS: number | null;
  baselineCostUsd: number;
  priceAsOf: string;
  solveMs: number;
  googleMapsUrl: string | null;
  disclaimers: Disclaimer[];
}

async function insertPlanRow(client: PoolClient, input: InsertPlanRowInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO plans
       (created_at, created_by, base_route_id, optimized_route_id, truck_id, origin_label, destination_label,
        optimizer_strategy, price_basis, start_fuel_gallons, min_arrival_gallons, max_leg_miles, min_leg_miles,
        min_leg_relaxed, corridor_miles, max_detour_miles, driver_cost_per_hour, fixed_stop_minutes, max_stops,
        status, infeasible_reason, total_fuel_cost_usd, total_gallons, total_distance_miles, total_duration_s,
        baseline_cost_usd, price_as_of, solve_ms, google_maps_url, disclaimers, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24,$25,$26,$27::date,$28,$29,$30::jsonb,$1)
     RETURNING id`,
    [
      input.createdAt,
      input.createdBy,
      input.baseRouteId,
      input.optimizedRouteId,
      input.truckId,
      input.originLabel,
      input.destinationLabel,
      input.optimizerStrategy,
      input.priceBasis,
      input.startFuelGallons,
      input.minArrivalGallons,
      input.maxLegMiles,
      input.minLegMiles,
      input.minLegRelaxed,
      input.corridorMiles,
      input.maxDetourMiles,
      input.driverCostPerHour,
      input.fixedStopMinutes,
      input.maxStops,
      input.status,
      input.infeasibleReason === null ? null : JSON.stringify(input.infeasibleReason),
      input.totalFuelCostUsd,
      input.totalGallons,
      input.totalDistanceMiles,
      input.totalDurationS,
      input.baselineCostUsd,
      input.priceAsOf,
      input.solveMs,
      input.googleMapsUrl,
      JSON.stringify(input.disclaimers),
    ],
  );
  return rows[0]!.id;
}

export interface PlanRowForRead {
  id: string;
  created_at: Date;
  status: "completed" | "infeasible";
  base_route_id: string;
  optimized_route_id: string | null;
  truck_id: string;
  origin_label: string | null;
  destination_label: string | null;
  optimizer_strategy: string;
  price_basis: PriceBasis;
  corridor_miles: string;
  max_detour_miles: string | null;
  price_as_of: string;
  solve_ms: number;
  baseline_cost_usd: string;
  total_fuel_cost_usd: string | null;
  total_gallons: string | null;
  total_distance_miles: string | null;
  total_duration_s: number | null;
  fixed_stop_minutes: number;
  google_maps_url: string | null;
  disclaimers: Disclaimer[];
  infeasible_reason: InfeasibleReason | null;
  dispatched_at: Date | null;
}

export async function loadPlanRow(pool: Pool, planId: string): Promise<PlanRowForRead | null> {
  const { rows } = await pool.query<PlanRowForRead>(
    `SELECT id, created_at, status, base_route_id, optimized_route_id, truck_id,
            origin_label, destination_label, optimizer_strategy, price_basis, corridor_miles,
            max_detour_miles, price_as_of::text AS price_as_of, solve_ms, baseline_cost_usd,
            total_fuel_cost_usd, total_gallons, total_distance_miles, total_duration_s,
            fixed_stop_minutes, google_maps_url, disclaimers, infeasible_reason, dispatched_at
     FROM plans WHERE id = $1`,
    [planId],
  );
  return rows[0] ?? null;
}

export interface PlanDispatchRow {
  status: "completed" | "infeasible";
  dispatched_at: Date | null;
}

/** Read-before-write for `PATCH /plans/{id}` (T-19) — lets the route tell an
 * unknown id (404) apart from an infeasible one (409: nothing to dispatch)
 * before touching `dispatched_at`. */
export async function loadPlanDispatchStatus(pool: Pool, planId: string): Promise<PlanDispatchRow | null> {
  const { rows } = await pool.query<PlanDispatchRow>(`SELECT status, dispatched_at FROM plans WHERE id = $1`, [planId]);
  return rows[0] ?? null;
}

/**
 * Sets or clears `plans.dispatched_at` — a flag only (T-19): it does not
 * touch `plan_stops` or any total, and it records no acting user, because
 * `plans` takes no new column for T-19 (PROJECT-SCOPE-v2.md A11, "no new
 * columns" — `context.userId` is checked for auth/attribution at the route
 * boundary and never persisted). `now()` is the database's clock, same as
 * `receipt_checks.checked_at` (`actuals/receipts.ts`) — there is no earlier
 * response value this write needs to match, unlike `persistCompletedPlan`'s
 * injected `createdAt`.
 */
export async function setPlanDispatched(pool: Pool, planId: string, sentToDriver: boolean): Promise<Date | null> {
  const { rows } = await pool.query<{ dispatched_at: Date | null }>(
    `UPDATE plans SET dispatched_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING dispatched_at`,
    [planId, sentToDriver],
  );
  return rows[0]!.dispatched_at;
}

export interface PlanListItem {
  planId: string;
  createdAt: string;
  origin: { label: string | null };
  destination: { label: string | null };
  status: "completed" | "infeasible";
  /** The real fleet unit this plan is for (`plans.truck_id`, T-56) — every plan names one; there is no abstract class to fall back on. */
  truck: { id: string; unitNumber: string };
  /** `null` for an infeasible plan — nothing was ever optimised. */
  distanceMiles: number | null;
  savingsVsBaselineUsd: number | null;
  /** UI contract §6.11 — always `false`/`null` for an infeasible plan, since `PATCH /plans/{id}` refuses one (T-19). */
  sentToDriver: boolean;
  sentToDriverAt: string | null;
}

export interface PlanListResult {
  plans: PlanListItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface PlanListRow {
  id: string;
  created_at: Date;
  status: "completed" | "infeasible";
  origin_label: string | null;
  destination_label: string | null;
  total_distance_miles: string | null;
  baseline_cost_usd: string;
  total_fuel_cost_usd: string | null;
  truck_id: string;
  truck_unit_number: string;
  dispatched_at: Date | null;
}

/**
 * `GET /plans` (T-18 step 18.3, UI contract §4) — the Recent table's list
 * projection: newest first, paginated, and deliberately not the full
 * `PlanResponse` shape (no `stops`/`candidateStations`) — a page of full
 * plans would mean re-running `findCorridor` once per row.
 *
 * Plain `JOIN`, not `LEFT JOIN`: `plans.truck_id` is `NOT NULL` (T-56) — every
 * plan names a real truck.
 */
export async function listPlans(pool: Pool, options: { page: number; pageSize: number }): Promise<PlanListResult> {
  const { page, pageSize } = options;
  const offset = (page - 1) * pageSize;

  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query<{ total: string }>("SELECT count(*) AS total FROM plans"),
    pool.query<PlanListRow>(
      `SELECT p.id, p.created_at, p.status, p.origin_label, p.destination_label,
              p.total_distance_miles, p.baseline_cost_usd, p.total_fuel_cost_usd,
              t.id AS truck_id, t.unit_number AS truck_unit_number, p.dispatched_at
       FROM plans p
       JOIN trucks t ON t.id = p.truck_id
       ORDER BY p.created_at DESC, p.id
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ),
  ]);

  return {
    plans: rows.map(
      (row): PlanListItem => ({
        planId: row.id,
        createdAt: row.created_at.toISOString(),
        origin: { label: row.origin_label },
        destination: { label: row.destination_label },
        status: row.status,
        truck: { id: row.truck_id, unitNumber: row.truck_unit_number },
        distanceMiles: row.total_distance_miles === null ? null : Number(row.total_distance_miles),
        savingsVsBaselineUsd:
          row.total_fuel_cost_usd === null ? null : Number(row.baseline_cost_usd) - Number(row.total_fuel_cost_usd),
        sentToDriver: row.dispatched_at !== null,
        sentToDriverAt: row.dispatched_at ? row.dispatched_at.toISOString() : null,
      }),
    ),
    page,
    pageSize,
    total: Number(countRows[0]!.total),
  };
}

export interface PlanStopRowForRead {
  seq: number;
  stop_type: StopType;
  station_id: string;
  offset_along_route_miles: string;
  leg_distance_miles: string;
  detour_distance_miles: string;
  detour_duration_s: number;
  arrival_gallons: string;
  purchase_gallons: string;
  departure_gallons: string;
  unit_price_usd: string;
  stop_cost_usd: string;
  cum_distance_miles: string;
  cum_duration_s: number;
  station_name_raw: string;
  station_store_number: number | null;
  station_city_raw: string;
  station_state_usps: string;
  station_lat: number;
  station_lng: number;
  station_resolution: string;
  station_uncertainty_miles: string | null;
  station_truck_accessible: string;
}

export async function loadPlanStopRows(pool: Pool, planId: string): Promise<PlanStopRowForRead[]> {
  const { rows } = await pool.query<PlanStopRowForRead>(
    `SELECT ps.seq, ps.stop_type, ps.station_id, ps.offset_along_route_miles, ps.leg_distance_miles,
            ps.detour_distance_miles, ps.detour_duration_s, ps.arrival_gallons, ps.purchase_gallons,
            ps.departure_gallons, ps.unit_price_usd, ps.stop_cost_usd, ps.cum_distance_miles, ps.cum_duration_s,
            s.name_raw AS station_name_raw, s.store_number AS station_store_number, s.city_raw AS station_city_raw,
            s.state_usps AS station_state_usps, ST_Y(s.geom::geometry) AS station_lat, ST_X(s.geom::geometry) AS station_lng,
            s.resolution AS station_resolution, s.uncertainty_miles AS station_uncertainty_miles,
            s.truck_accessible AS station_truck_accessible
     FROM plan_stops ps
     JOIN stations s ON s.id = ps.station_id
     WHERE ps.plan_id = $1
     ORDER BY ps.seq`,
    [planId],
  );
  return rows;
}

export function planStopFromRow(row: PlanStopRowForRead, tankGallons: number): PlanStop {
  const arrivalGallons = Number(row.arrival_gallons);
  return {
    seq: row.seq,
    stopType: row.stop_type,
    station: {
      id: row.station_id,
      name: row.station_name_raw,
      storeNumber: row.station_store_number,
      city: row.station_city_raw,
      state: row.station_state_usps,
      location: { lat: row.station_lat, lng: row.station_lng },
      resolution: row.station_resolution as PlanStop["station"]["resolution"],
      uncertaintyMiles: Number(row.station_uncertainty_miles ?? 0),
      truckAccessible: row.station_truck_accessible as PlanStop["station"]["truckAccessible"],
    },
    legDistanceMiles: Number(row.leg_distance_miles),
    detourMiles: Number(row.detour_distance_miles),
    detourSeconds: row.detour_duration_s,
    unitPriceUsd: Number(row.unit_price_usd),
    arrivalGallons,
    purchaseGallons: Number(row.purchase_gallons),
    departureGallons: Number(row.departure_gallons),
    stopCostUsd: Number(row.stop_cost_usd),
    cumulativeDistanceMiles: Number(row.cum_distance_miles),
    cumulativeDurationSeconds: row.cum_duration_s,
    arrivalFuelPercent: (arrivalGallons / tankGallons) * 100,
  };
}

export async function loadRouteGeometry(pool: Pool, routeId: string): Promise<RouteGeometryRow> {
  const { rows } = await pool.query<RouteGeometryRow>(`SELECT ${ROUTE_GEOMETRY_SELECT} FROM routes r WHERE r.id = $1`, [routeId]);
  const row = rows[0];
  if (!row) {
    throw new Error(`route ${routeId} does not exist`);
  }
  return row;
}

/** Where a stored point sits, for rebuilding a `ResolvedLocation` on `GET` without a live re-geocode. */
export async function loadRoutePoint(pool: Pool, routeId: string, which: "origin" | "destination"): Promise<LatLng> {
  // Two static statements, never an interpolated column name (CLAUDE.md:
  // parameterised SQL only, no string interpolation of values, anywhere).
  const sql =
    which === "origin"
      ? `SELECT ST_Y(origin_geom::geometry) AS lat, ST_X(origin_geom::geometry) AS lng FROM routes WHERE id = $1`
      : `SELECT ST_Y(destination_geom::geometry) AS lat, ST_X(destination_geom::geometry) AS lng FROM routes WHERE id = $1`;
  const { rows } = await pool.query<{ lat: number; lng: number }>(sql, [routeId]);
  const row = rows[0];
  if (!row) {
    throw new Error(`route ${routeId} does not exist`);
  }
  return { lat: row.lat, lng: row.lng };
}
