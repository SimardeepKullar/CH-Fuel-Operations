import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleGetPlanActual, handleGetPlanActualBacktest } from "../../src/api/routes/planActual.js";
import { getBacktest } from "../../src/planActual/backtest.js";
import { getPlanActual } from "../../src/planActual/live.js";
import { insertCard, insertInvoice, insertPublishedPrice, insertStop, insertTruck, scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("planActual (integration, T-38)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  async function insertGeoStation(spec: { ref: string; lat: number; lng: number }): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', $1, $2, $3, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 'exact', 0, 'operator_verified')
       RETURNING id`,
      [spec.ref, `LOVES #${spec.ref}`, Number(spec.ref) || null, spec.lng, spec.lat],
    );
    return rows[0]!.id;
  }

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("plan_actual"));
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function insertDispatchedPlan(spec: { truckId: string; dispatchedAt: string; stationId: string; expectedUsdPerGal: number }): Promise<string> {
    const { rows: routeRows } = await pool.query<{ id: string }>(
      `INSERT INTO routes (provider, request_hash, origin_geom, destination_geom, truck_id, distance_miles, duration_s)
       VALUES ('ors', $1, ST_SetSRID(ST_MakePoint(-97, 30), 4326)::geography, ST_SetSRID(ST_MakePoint(-97, 32), 4326)::geography, $2, 200, 12000)
       RETURNING id`,
      [`hash-${Math.random().toString(36).slice(2)}`, spec.truckId],
    );
    const baseRouteId = routeRows[0]!.id;

    const { rows: planRows } = await pool.query<{ id: string }>(
      `INSERT INTO plans
         (base_route_id, truck_id, start_fuel_gallons, min_arrival_gallons,
          max_leg_miles, min_leg_miles, corridor_miles, max_detour_miles, solve_ms, status, dispatched_at)
       VALUES ($1, $2, 200, 30, 500, 300, 25, 10, 100, 'completed', $3::timestamptz)
       RETURNING id`,
      [baseRouteId, spec.truckId, spec.dispatchedAt],
    );
    const planId = planRows[0]!.id;

    await pool.query(
      `INSERT INTO plan_stops
         (plan_id, seq, stop_type, station_id, offset_along_route_miles, leg_distance_miles,
          arrival_gallons, purchase_gallons, departure_gallons, unit_price_usd, stop_cost_usd,
          cum_distance_miles, cum_duration_s)
       VALUES ($1, 1, 'fuel', $2, 100, 100, 50, 50, 100, $3, 0, 100, 6000)`,
      [planId, spec.stationId, spec.expectedUsdPerGal],
    );

    return planId;
  }

  describe("GET /plan-actual", () => {
    it("returns a well-formed payload with coverage counts on zero overlap, never a 404 or bare []", async () => {
      const invoiceId = await insertInvoice(pool, { number: "999001", periodStart: "2026-08-01", periodEnd: "2026-08-31" });
      const cardId = await insertCard(pool, { cardNumber: "CARD-1" });
      const stationId = await insertGeoStation({ ref: "300", lat: 35, lng: -97 });
      await insertStop(pool, { invoiceId, cardId, occurredAt: "2026-08-10T12:00:00Z", stationId, lines: [{ code: "TA", gallons: 50, billed: 5.0 }] });

      const request = new Request("http://localhost/api/v1/plan-actual?week=2026-08-31");
      const response = await handleGetPlanActual(pool, new URL(request.url));
      expect(response.status).toBe(200);

      const body = (await response.json()) as { coverage: { covered: number; total: number }; matches: unknown[] };
      expect(body.coverage).toEqual({ covered: 0, total: 1 });
      expect(Array.isArray(body.matches)).toBe(true);
    });

    it("returns zero coverage, not an error, when no invoice exists for the period", async () => {
      const request = new Request("http://localhost/api/v1/plan-actual?week=2099-01-01");
      const response = await handleGetPlanActual(pool, new URL(request.url));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { coverage: { covered: number; total: number }; invoiceId: string | null };
      expect(body.coverage).toEqual({ covered: 0, total: 0 });
      expect(body.invoiceId).toBeNull();
    });

    it("matches a dispatched plan's stop against an actual fuel stop, computing delta_usd, adherence and by-truck variance", async () => {
      const invoiceId = await insertInvoice(pool, { number: "999002", periodStart: "2026-08-01", periodEnd: "2026-08-31" });
      const cardId = await insertCard(pool, { cardNumber: "CARD-2" });
      const truckId = await insertTruck(pool, "T-LIVE-1");
      const stationId = await insertGeoStation({ ref: "301", lat: 35, lng: -97 });

      await insertStop(pool, {
        invoiceId,
        cardId,
        truckId,
        stationId,
        occurredAt: "2026-08-10T09:00:00Z",
        lines: [{ code: "TA", gallons: 100, billed: 5.5 }],
      });
      await insertDispatchedPlan({ truckId, dispatchedAt: "2026-08-10T08:00:00Z", stationId, expectedUsdPerGal: 5.0 });

      const result = await getPlanActual(pool, "2026-08-31");

      expect(result.coverage).toEqual({ covered: 1, total: 1 });
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.kind).toBe("matched");
      expect(result.matches[0]!.plannedUsd).toBeCloseTo(500, 6);
      expect(result.matches[0]!.actualUsd).toBeCloseTo(550, 6);
      expect(result.matches[0]!.deltaUsd).toBeCloseTo(100 * (5.5 - 5.0), 6);
      expect(result.adherencePct).toBe(100);
      expect(result.moneyLeftOnTableUsd).toBeCloseTo(50, 6);
      expect(result.byTruckVarianceUsd).toHaveLength(1);
      const byTruck = result.byTruckVarianceUsd[0]!;
      expect(byTruck.truckId).toBe(truckId);
      expect(byTruck.unitNumber).toBe("T-LIVE-1");
      expect(byTruck.stopCount).toBe(1);
      expect(byTruck.plannedUsd).toBeCloseTo(500, 6);
      expect(byTruck.actualUsd).toBeCloseTo(550, 6);
      expect(byTruck.varianceUsd).toBeCloseTo(50, 6);
      expect(byTruck.adherencePct).toBe(100);
    });

    it("gives a truck with only a skipped recommendation a real 0% adherence row, not an omission", async () => {
      // An invoice must exist for the period or getPlanActual short-circuits
      // to its zero-overlap shape before ever computing matches — see the
      // "zero overlap" test above. No fuel stop is inserted: the dispatched
      // plan's stop is meant to match nothing.
      await insertInvoice(pool, { number: "999005", periodStart: "2026-08-01", periodEnd: "2026-08-31" });
      const truckId = await insertTruck(pool, "T-LIVE-2");
      const stationId = await insertGeoStation({ ref: "305", lat: 35, lng: -97 });

      await insertDispatchedPlan({ truckId, dispatchedAt: "2026-08-15T08:00:00Z", stationId, expectedUsdPerGal: 5.0 });

      const result = await getPlanActual(pool, "2026-08-31");

      expect(result.matches).toEqual([
        expect.objectContaining({ kind: "skipped_recommendation" }),
      ]);
      const byTruck = result.byTruckVarianceUsd[0]!;
      expect(byTruck.truckId).toBe(truckId);
      expect(byTruck.stopCount).toBe(0);
      expect(byTruck.plannedUsd).toBe(0);
      expect(byTruck.actualUsd).toBe(0);
      expect(byTruck.varianceUsd).toBe(0);
      expect(byTruck.adherencePct).toBe(0);
    });
  });

  describe("GET /plan-actual/backtest", () => {
    it("produces a priced row for a truck-day with an archived price file, and never lets projected exceed actual with a cheaper stop available", async () => {
      const invoiceId = await insertInvoice(pool, { number: "999003", periodStart: "2026-08-01", periodEnd: "2026-08-31" });
      const cardId = await insertCard(pool, { cardNumber: "CARD-3" });
      const truckId = await insertTruck(pool, "T-BT-1");
      // buildHistoricalLane (T-56) reads the truck's own spec directly —
      // insertTruck leaves it null (irrelevant for the fixture's other
      // uses), so this test sets it explicitly to reach a "priced" row.
      await pool.query(
        "UPDATE trucks SET tank_gallons = 200, avg_mpg = 7.5, reserve_fraction = 0.150, max_leg_miles = 500, min_leg_miles = 300, cost_per_mile_usd = 0 WHERE id = $1",
        [truckId],
      );
      const expensiveStation = await insertGeoStation({ ref: "302", lat: 35, lng: -97 });
      const cheapStation = await insertGeoStation({ ref: "303", lat: 35.05, lng: -97 });

      await insertStop(pool, {
        invoiceId,
        cardId,
        truckId,
        stationId: expensiveStation,
        occurredAt: "2026-08-15T09:00:00Z",
        lines: [{ code: "TA", gallons: 100, billed: 6.0 }],
      });
      await insertPublishedPrice(pool, { stationId: expensiveStation, validOn: "2026-08-15", yourPrice: 6.0 });
      await insertPublishedPrice(pool, { stationId: cheapStation, validOn: "2026-08-15", yourPrice: 4.5 });

      const result = await getBacktest(pool, "2026-08-15", "2026-08-15");

      expect(result.exclusions.noArchivedPriceFile).toBe(0);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0]!;
      expect(row.kind).toBe("priced");
      if (row.kind !== "priced") throw new Error("expected priced");
      expect(row.actualCostUsd).toBeCloseTo(600, 6);
      expect(row.projectedCostUsd).toBeLessThanOrEqual(row.actualCostUsd);
    });

    it("names and counts a date with no archived price file as an exclusion, never a zero delta", async () => {
      const invoiceId = await insertInvoice(pool, { number: "999004", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
      const cardId = await insertCard(pool, { cardNumber: "CARD-4" });
      const truckId = await insertTruck(pool, "T-BT-2");
      const stationId = await insertGeoStation({ ref: "304", lat: 35, lng: -97 });

      // 2026-01-11 is the real, documented gap date (CLAUDE.md) — no price sheet exists for it.
      await insertStop(pool, {
        invoiceId,
        cardId,
        truckId,
        stationId,
        occurredAt: "2026-01-11T09:00:00Z",
        lines: [{ code: "TA", gallons: 80, billed: 5.0 }],
      });

      const result = await getBacktest(pool, "2026-01-11", "2026-01-11");

      expect(result.rows).toEqual([{ kind: "no_archived_price_file", date: "2026-01-11", truckId }]);
      expect(result.exclusions.noArchivedPriceFile).toBe(1);
    });

    it("is reachable through the HTTP route and validates from <= to", async () => {
      const badRequest = new Request("http://localhost/api/v1/plan-actual/backtest?from=2026-08-31&to=2026-08-01");
      const badResponse = await handleGetPlanActualBacktest(pool, new URL(badRequest.url));
      expect(badResponse.status).toBe(400);

      const okRequest = new Request("http://localhost/api/v1/plan-actual/backtest?from=2026-08-01&to=2026-08-01");
      const okResponse = await handleGetPlanActualBacktest(pool, new URL(okRequest.url));
      expect(okResponse.status).toBe(200);
      const body = (await okResponse.json()) as { rows: unknown[]; exclusions: { noArchivedPriceFile: number } };
      expect(Array.isArray(body.rows)).toBe(true);
    });
  });
});
