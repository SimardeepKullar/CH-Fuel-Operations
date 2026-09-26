import { createHash } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { METERS_PER_MILE } from "../../src/domain/units.js";
import { CORRIDOR_SQL, CorridorError, findCorridor } from "../../src/planning/corridor.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** A due-north route down the -97° meridian, 30°N → 40°N (~690 mi). A meridian
 * is its own geodesic, so a station at lng -97 is exactly on it and one at
 * lng -96.99 is ~0.57 mi east — no great-circle bow to reason around. */
const ROUTE_LNG = -97;
const ROUTE_DISTANCE_MILES = 750; // what a provider reports: longer than the arc, as roads are
const RADIUS_MILES = 12;
const VALID_ON = "2026-09-08";

interface StationSpec {
  ref: string;
  lat: number;
  /** Degrees east of the route; ~0.57 mi per 0.01° at these latitudes. */
  lngDelta?: number;
  resolution?: "exact" | "city" | "unresolved";
  uncertaintyMiles?: number | null;
  truckAccessible?: "operator_verified" | "unverified" | "excluded";
}

describe.skipIf(!hasDatabase)("corridor query (integration, T-11)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let routeId: string;
  const importIds = new Map<string, string>();

  async function insertStation(spec: StationSpec): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO stations
         (supplier, site_ref, name_raw, store_number, city_raw, city_normalized, state_usps,
          geom, resolution, uncertainty_miles, truck_accessible)
       VALUES ('BVD', $1, $2, $3, 'Testville', 'TESTVILLE', 'TX',
               ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8)
       RETURNING id`,
      [
        spec.ref,
        `LOVES #${spec.ref}`,
        Number(spec.ref.replace(/\D/g, "")) || null,
        ROUTE_LNG + (spec.lngDelta ?? 0),
        spec.lat,
        spec.resolution ?? "exact",
        spec.uncertaintyMiles ?? null,
        spec.truckAccessible ?? "operator_verified",
      ],
    );
    return rows[0]!.id;
  }

  async function importFor(validOn: string): Promise<string> {
    const existing = importIds.get(validOn);
    if (existing) {
      return existing;
    }
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', $1, $2, $3::date, 'completed') RETURNING id`,
      [`corridor-${validOn}.csv`, createHash("sha256").update(`corridor-${validOn}`).digest("hex"), validOn],
    );
    importIds.set(validOn, rows[0]!.id);
    return rows[0]!.id;
  }

  async function insertPrice(
    stationId: string,
    price: {
      validOn?: string;
      yourPrice?: number | null;
      cost?: number;
      freight?: number;
      other?: number;
      federalTax?: number;
      totalCost?: number | null;
      productType?: string;
      rawProduct?: string;
    },
  ): Promise<void> {
    const validOn = price.validOn ?? VALID_ON;
    await pool.query(
      `INSERT INTO station_prices
         (station_id, import_id, raw_product, product_type, cost, freight, other, federal_tax,
          total_cost, your_price, valid_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date)`,
      [
        stationId,
        await importFor(validOn),
        price.rawProduct ?? "ULSD",
        price.productType ?? "highway_diesel",
        price.cost ?? null,
        price.freight ?? null,
        price.other ?? null,
        price.federalTax ?? null,
        price.totalCost === undefined ? (price.yourPrice ?? null) : price.totalCost,
        price.yourPrice ?? null,
        validOn,
      ],
    );
  }

  const corridor = (overrides: Partial<Parameters<typeof findCorridor>[1]> = {}) =>
    findCorridor(pool, { routeId, radiusMiles: RADIUS_MILES, priceBasis: "pump", validOn: VALID_ON, ...overrides });

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_corridor"));
    importIds.clear();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO routes (provider, request_hash, origin_geom, destination_geom, truck_id,
                           line, distance_miles, duration_s)
       SELECT 'ors', $1,
              ST_GeogFromText('POINT(${ROUTE_LNG} 30)'), ST_GeogFromText('POINT(${ROUTE_LNG} 40)'),
              (SELECT id FROM trucks LIMIT 1),
              ST_GeogFromText('LINESTRING(${ROUTE_LNG} 30, ${ROUTE_LNG} 40)'), $2, 40000
       RETURNING id`,
      [createHash("sha256").update("corridor-route").digest("hex"), ROUTE_DISTANCE_MILES],
    );
    routeId = rows[0]!.id;
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  it("returns a lane's candidates ordered by position, with offset, perpendicular offset and unit price", async () => {
    // Inserted out of order on purpose: the query, not insertion order, sorts.
    const late = await insertStation({ ref: "3", lat: 38 });
    const early = await insertStation({ ref: "1", lat: 31 });
    const mid = await insertStation({ ref: "2", lat: 34.5, lngDelta: 0.1 }); // ~5.7 mi east
    await insertPrice(late, { yourPrice: 4.1 });
    await insertPrice(early, { yourPrice: 3.9 });
    await insertPrice(mid, { yourPrice: 4.0123 });

    const result = await corridor();

    expect(result.routeDistanceMiles).toBe(ROUTE_DISTANCE_MILES);
    expect(result.candidates.map((c) => c.id)).toEqual([early, mid, late]);
    expect(result.exclusions).toEqual([]);

    const [first, second] = result.candidates;
    // 1° of 10° along the arc → 1/10 of the provider's distance.
    expect(first!.offsetAlongRouteMiles).toBeCloseTo(ROUTE_DISTANCE_MILES * 0.1, 1);
    expect(first!.perpOffsetMiles).toBeCloseTo(0, 0);
    expect(first!.unitPriceUsd).toBe(3.9);
    expect(first!.storeNumber).toBe(1);
    expect(second!.offsetAlongRouteMiles).toBeCloseTo(ROUTE_DISTANCE_MILES * 0.45, 0);
    expect(second!.perpOffsetMiles).toBeGreaterThan(5.59);
    expect(second!.perpOffsetMiles).toBeLessThan(5.78);
    expect(second!.unitPriceUsd).toBe(4.0123);
    expect(second!.lat).toBeCloseTo(34.5, 6);
    expect(second!.lng).toBeCloseTo(ROUTE_LNG + 0.1, 6);
    expect(typeof second!.priceId).toBe("string");
  });

  it("names a station priced only on a different date in exclusions rather than dropping it (requirement b)", async () => {
    const priced = await insertStation({ ref: "1", lat: 32 });
    const otherDay = await insertStation({ ref: "2", lat: 34 });
    const neverPriced = await insertStation({ ref: "3", lat: 36 });
    await insertPrice(priced, { yourPrice: 4 });
    await insertPrice(otherDay, { yourPrice: 3.5, validOn: "2026-09-07" });

    const result = await corridor();

    expect(result.candidates.map((c) => c.id)).toEqual([priced]);
    expect(result.exclusions.map((e) => [e.id, e.reason])).toEqual([
      [otherDay, "no_price_on_date"],
      [neverPriced, "no_price_on_date"],
    ]);
    // The same station is a candidate when its own day is asked for.
    const yesterday = await corridor({ validOn: "2026-09-07" });
    expect(yesterday.candidates.map((c) => c.id)).toEqual([otherDay]);
  });

  it("does not confuse 'not on this route' with 'no price': a far station is in neither list", async () => {
    const near = await insertStation({ ref: "1", lat: 35 });
    const far = await insertStation({ ref: "2", lat: 35, lngDelta: 0.5 }); // ~45 km east
    await insertPrice(near, { yourPrice: 4 });
    await insertPrice(far, { yourPrice: 3 });

    const result = await corridor();

    expect(result.candidates.map((c) => c.id)).toEqual([near]);
    expect(result.exclusions).toEqual([]);
  });

  it("never returns an unresolved station, priced or not", async () => {
    const unresolved = await insertStation({ ref: "1", lat: 33, resolution: "unresolved" });
    const resolved = await insertStation({ ref: "2", lat: 34 });
    await insertPrice(unresolved, { yourPrice: 2 });
    await insertPrice(resolved, { yourPrice: 4 });

    const result = await corridor();

    expect(result.candidates.map((c) => c.id)).toEqual([resolved]);
    expect(result.exclusions).toEqual([]);
  });

  it("never returns a station marked truck_accessible = 'excluded'", async () => {
    const barred = await insertStation({ ref: "1", lat: 33, truckAccessible: "excluded" });
    const unverified = await insertStation({ ref: "2", lat: 34, truckAccessible: "unverified" });
    await insertPrice(barred, { yourPrice: 2 });
    await insertPrice(unverified, { yourPrice: 4 });

    const result = await corridor();

    expect(result.candidates.map((c) => [c.id, c.truckAccessible])).toEqual([[unverified, "unverified"]]);
    expect(result.exclusions).toEqual([]);
  });

  it("reports city-tier stations with their uncertainty, and null uncertainty as 0", async () => {
    const city = await insertStation({ ref: "1", lat: 33, resolution: "city", uncertaintyMiles: 4 });
    const exact = await insertStation({ ref: "2", lat: 34, uncertaintyMiles: null });
    await insertPrice(city, { yourPrice: 4 });
    await insertPrice(exact, { yourPrice: 4 });

    const result = await corridor();

    expect(result.candidates.map((c) => [c.resolution, c.uncertaintyMiles])).toEqual([
      ["city", 4],
      ["exact", 0],
    ]);
  });

  it("selects the price column by basis, and files a row missing that basis under price_basis_null", async () => {
    const full = await insertStation({ ref: "1", lat: 32 });
    const noTotal = await insertStation({ ref: "2", lat: 34 });
    await insertPrice(full, { yourPrice: 4.5, cost: 3.1, freight: 0.2, other: 0.05, federalTax: 0.244, totalCost: 4.8 });
    await insertPrice(noTotal, { yourPrice: 4.5, cost: 3.0, freight: 0.1, other: 0, federalTax: 0.244, totalCost: null });

    const pump = await corridor({ priceBasis: "pump" });
    expect(pump.candidates.map((c) => c.unitPriceUsd)).toEqual([4.5, 4.5]);

    const ifta = await corridor({ priceBasis: "ifta_net" });
    expect(ifta.candidates.map((c) => c.unitPriceUsd)).toEqual([3.594, 3.344]);

    const total = await corridor({ priceBasis: "total_cost" });
    expect(total.candidates.map((c) => [c.id, c.unitPriceUsd])).toEqual([[full, 4.8]]);
    expect(total.exclusions.map((e) => [e.id, e.reason])).toEqual([[noTotal, "price_basis_null"]]);
  });

  it("prices only highway_diesel, never another product type on the same day", async () => {
    const station = await insertStation({ ref: "1", lat: 33 });
    await insertPrice(station, { yourPrice: 1.5, rawProduct: "GAS", productType: "gasoline" });

    const result = await corridor();

    expect(result.candidates).toEqual([]);
    expect(result.exclusions.map((e) => e.id)).toEqual([station]);
  });

  it("is deterministic when two raw products map to highway_diesel for a station-day", async () => {
    const station = await insertStation({ ref: "1", lat: 33 });
    await insertPrice(station, { yourPrice: 4.0, rawProduct: "ULSD" });
    await insertPrice(station, { yourPrice: 4.4, rawProduct: "ULSD2" });

    const runs = await Promise.all([corridor(), corridor(), corridor()]);

    expect(runs.map((r) => r.candidates.length)).toEqual([1, 1, 1]);
    expect(new Set(runs.map((r) => r.candidates[0]!.unitPriceUsd)).size).toBe(1);
  });

  it("returns offsets that are monotonic and bounded by the route length", async () => {
    // Includes the two endpoints, and a station past the end that snaps to it.
    const lats = [30, 30.5, 31.7, 33, 35.2, 37.9, 39.99, 40];
    for (const [i, lat] of lats.entries()) {
      const id = await insertStation({ ref: String(i + 1), lat, lngDelta: (i % 3) * 0.02 });
      await insertPrice(id, { yourPrice: 4 });
    }
    const beyond = await insertStation({ ref: "99", lat: 40.05 }); // ~3.5 mi past the end, inside the radius
    await insertPrice(beyond, { yourPrice: 4 });

    const { candidates } = await corridor();
    const offsets = candidates.map((c) => c.offsetAlongRouteMiles);

    expect(offsets).toHaveLength(lats.length + 1);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(ROUTE_DISTANCE_MILES);
    expect(offsets[0]).toBeCloseTo(0, 3);
    expect(offsets.at(-1)).toBeCloseTo(ROUTE_DISTANCE_MILES, 3);
  });

  it("screens by a radius given in miles", async () => {
    const id = await insertStation({ ref: "1", lat: 34.5, lngDelta: 0.1 }); // ~5.7 mi east
    await insertPrice(id, { yourPrice: 4 });

    expect((await corridor({ radiusMiles: 5.5 })).candidates).toEqual([]);
    expect((await corridor({ radiusMiles: 5.9 })).candidates.map((c) => c.id)).toEqual([id]);
  });

  it("converts the radius parameter, not the column, with the same constant the units module uses", () => {
    expect(CORRIDOR_SQL).toContain(`$2::float8 * ${METERS_PER_MILE}`);
    expect(CORRIDOR_SQL).toContain(`/ ${METERS_PER_MILE}`);
    expect(CORRIDOR_SQL).not.toMatch(/ST_DWithin\(s\.geom, r\.line, \$2\)/);
  });

  it("screens with the GIST index on stations.geom", async () => {
    for (let i = 0; i < 20; i++) {
      const id = await insertStation({ ref: String(i + 1), lat: 30 + i * 0.5 });
      await insertPrice(id, { yourPrice: 4 });
    }
    await pool.query("ANALYZE stations");

    // A dozen rows would seq-scan whatever the indexes are; forbid it so the plan
    // shows whether ST_DWithin can reach the index at all.
    const client = await pool.connect();
    try {
      await client.query("SET enable_seqscan = off");
      const { rows } = await client.query<{ "QUERY PLAN": unknown }>(`EXPLAIN (FORMAT JSON) ${CORRIDOR_SQL}`, [
        routeId,
        RADIUS_MILES,
        "pump",
        VALID_ON,
      ]);
      expect(JSON.stringify(rows[0]!["QUERY PLAN"])).toContain("stations_geom_gix");
    } finally {
      client.release();
    }
  });

  it("throws ROUTE_NOT_FOUND for an unknown route", async () => {
    await expect(corridor({ routeId: "3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e" })).rejects.toMatchObject({
      name: "CorridorError",
      code: "ROUTE_NOT_FOUND",
    });
  });

  it("throws ROUTE_GEOMETRY_MISSING for a route with no line, not an empty corridor", async () => {
    await pool.query("UPDATE routes SET line = NULL, polyline = NULL, legs = NULL WHERE id = $1", [routeId]);

    const failure = await corridor().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(CorridorError);
    expect((failure as CorridorError).code).toBe("ROUTE_GEOMETRY_MISSING");
  });

  it("rejects a malformed valid_on or radius before touching the database", async () => {
    await expect(corridor({ validOn: "today" })).rejects.toThrow(RangeError);
    await expect(corridor({ validOn: "2026-9-8" })).rejects.toThrow(RangeError);
    await expect(corridor({ radiusMiles: -1 })).rejects.toThrow(RangeError);
    await expect(corridor({ radiusMiles: Number.NaN })).rejects.toThrow(RangeError);
  });
});
