import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("0001_planning_schema.sql (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_schema_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("applies with no error against a clean schema", async () => {
    const { rows } = await scopedPool.query<{ filename: string }>(
      `SELECT filename FROM ${schema}.schema_migrations`,
    );
    expect(rows.map((r) => r.filename)).toContain("0001_planning_schema.sql");
  });

  // T-56: trucks' 7 planning fields have no schema-level DEFAULT (they are
  // nullable — zero real per-unit data exists) — 0.150 etc. come from
  // 0005_fleet_roster_seed.sql's flagged application-level default, not a
  // column default, so a bare insert leaves them null.
  it("leaves a truck's planning spec null when not given (T-56 — no schema-level default any more)", async () => {
    await scopedPool.query(`INSERT INTO trucks (unit_number) VALUES ('t1')`);
    const { rows } = await scopedPool.query<{ reserve_fraction: string | null; tank_gallons: string | null }>(
      `SELECT reserve_fraction, tank_gallons FROM trucks WHERE unit_number = 't1'`,
    );
    expect(rows[0]?.reserve_fraction).toBeNull();
    expect(rows[0]?.tank_gallons).toBeNull();
  });

  it("rejects a truck's min_leg_miles greater than its max_leg_miles", async () => {
    await expect(
      scopedPool.query(
        `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg, min_leg_miles, max_leg_miles)
         VALUES ('t2', 200, 7.0, 600, 500)`,
      ),
    ).rejects.toThrow();
  });

  it("rejects a truck's reserve_fraction outside [0, 0.5)", async () => {
    await expect(
      scopedPool.query(`INSERT INTO trucks (unit_number, reserve_fraction) VALUES ('t2b', 0.5)`),
    ).rejects.toThrow();
  });

  it("rejects a duplicate unit_number", async () => {
    await scopedPool.query(`INSERT INTO trucks (unit_number) VALUES ('dup-unit')`);
    await expect(scopedPool.query(`INSERT INTO trucks (unit_number) VALUES ('dup-unit')`)).rejects.toThrow();
  });

  it("rejects a role outside the enum", async () => {
    await expect(
      scopedPool.query(
        `INSERT INTO users (email, password_hash, display_name, role)
         VALUES ('a@example.com', 'hash', 'A', 'superadmin')`,
      ),
    ).rejects.toThrow();
  });

  async function insertStation(
    supplier: string,
    siteRef: string,
  ): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
       VALUES ($1, $2, 'LOVES #368', 'ELOY', 'Eloy', 'AZ')
       RETURNING id`,
      [supplier, siteRef],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertStation failed");
    return id;
  }

  it("rejects a duplicate (supplier, site_ref) but accepts the same site_ref under a different supplier", async () => {
    await insertStation("BVD", "9206810");
    await expect(insertStation("BVD", "9206810")).rejects.toThrow();
    await expect(insertStation("OTHER_SUPPLIER", "9206810")).resolves.toBeTruthy();
  });

  it("rejects an out-of-enum resolution value", async () => {
    await expect(
      scopedPool.query(
        `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps, resolution)
         VALUES ('BVD', 's1', 'LOVES #368', 'ELOY', 'Eloy', 'AZ', 'geocoded')`,
      ),
    ).rejects.toThrow();
  });

  async function insertPriceImport(
    fileSha256: string,
    effectiveDate: string,
  ): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date)
       VALUES ('BVD', 'pcn-usd.csv', $1, $2)
       RETURNING id`,
      [fileSha256, effectiveDate],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertPriceImport failed");
    return id;
  }

  it("accepts two imports with the same effective_date and different hashes, and rejects a repeated hash", async () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    await expect(insertPriceImport(hashA, "2026-08-22")).resolves.toBeTruthy();
    await expect(insertPriceImport(hashB, "2026-08-22")).resolves.toBeTruthy();
    await expect(insertPriceImport(hashA, "2026-08-22")).rejects.toThrow();
  });

  it("computes price_ifta_net as cost + freight + other + federal_tax, treating nulls as zero", async () => {
    const stationId = await insertStation("BVD", "9206810");
    const importId = await insertPriceImport("c".repeat(64), "2026-08-22");
    await scopedPool.query(
      `INSERT INTO station_prices
         (station_id, import_id, raw_product, product_type, cost, freight, federal_tax, your_price, valid_on)
       VALUES ($1, $2, 'ULSD', 'highway_diesel', 2.5000, 0.1000, 0.2440, 3.1000, '2026-08-22')`,
      [stationId, importId],
    );
    const { rows } = await scopedPool.query<{ price_ifta_net: string }>(
      `SELECT price_ifta_net FROM station_prices WHERE station_id = $1`,
      [stationId],
    );
    expect(rows[0]?.price_ifta_net).toBe("2.8440");
  });

  it("rejects a duplicate (station_id, raw_product, valid_on)", async () => {
    const stationId = await insertStation("BVD", "9206810");
    const importId = await insertPriceImport("d".repeat(64), "2026-08-22");
    const insertPrice = () =>
      scopedPool.query(
        `INSERT INTO station_prices
           (station_id, import_id, raw_product, product_type, your_price, valid_on)
         VALUES ($1, $2, 'ULSD', 'highway_diesel', 3.10, '2026-08-22')`,
        [stationId, importId],
      );
    await expect(insertPrice()).resolves.toBeTruthy();
    await expect(insertPrice()).rejects.toThrow();
  });

  async function insertTruck(unitNumber: string): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg)
       VALUES ($1, 200, 7.0)
       RETURNING id`,
      [unitNumber],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertTruck failed");
    return id;
  }

  async function insertRoute(
    truckId: string,
    requestHash: string,
  ): Promise<{ id: string; computed_at: Date }> {
    const { rows } = await scopedPool.query<{ id: string; computed_at: Date }>(
      `INSERT INTO routes
         (provider, request_hash, origin_geom, destination_geom, truck_id,
          distance_miles, duration_s)
       VALUES ('ors', $1, ST_SetSRID(ST_MakePoint(-111, 32), 4326)::geography,
               ST_SetSRID(ST_MakePoint(-112, 33), 4326)::geography, $2, 600, 3600)
       RETURNING id, computed_at`,
      [requestHash, truckId],
    );
    const row = rows[0];
    if (!row) throw new Error("insertRoute failed");
    return row;
  }

  async function insertPlan(
    baseRouteId: string,
    truckId: string,
    status: string = "completed",
  ): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO plans
         (base_route_id, truck_id, start_fuel_gallons, min_arrival_gallons,
          max_leg_miles, min_leg_miles, corridor_miles, max_detour_miles, solve_ms, status)
       VALUES ($1, $2, 200, 30, 500, 300, 25, 10, 100, $3)
       RETURNING id`,
      [baseRouteId, truckId, status],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertPlan failed");
    return id;
  }

  // §17, decided 10 September 2026: ORS geometry is ODbL and carries no storage
  // cap, so v1 has no expiry at all. Pinned so a reinstatement is deliberate.
  it("has no expires_at column and no expiry trigger on routes", async () => {
    const { rows: columns } = await scopedPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'routes'`,
      [schema],
    );
    const columnNames = columns.map((c) => c.column_name);
    // Guards the negative assertion below: a wrong filter returning zero rows
    // would make "not.toContain" pass without proving anything.
    expect(columnNames).toContain("computed_at");
    expect(columnNames).not.toContain("expires_at");

    const { rows: triggers } = await scopedPool.query<{ trigger_name: string }>(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE trigger_schema = $1 AND event_object_table = 'routes'`,
      [schema],
    );
    expect(triggers).toEqual([]);

    const { rows: fn } = await scopedPool.query<{ reg: string | null }>(
      `SELECT to_regproc($1) AS reg`,
      [`${schema}.set_route_expiry`],
    );
    expect(fn[0]?.reg).toBeNull();
  });

  it("nulls line, polyline and legs on an existing route", async () => {
    const truckId = await insertTruck("route-truck-3");
    const route = await insertRoute(truckId, "j".repeat(64));
    await scopedPool.query(
      `UPDATE routes SET line = NULL, polyline = NULL, legs = NULL WHERE id = $1`,
      [route.id],
    );
    const { rows } = await scopedPool.query<{
      line: string | null;
      polyline: string | null;
      legs: string | null;
    }>(`SELECT line, polyline, legs FROM routes WHERE id = $1`, [route.id]);
    expect(rows[0]).toEqual({ line: null, polyline: null, legs: null });
  });

  it("rejects plans.status = 'pending'", async () => {
    const truckId = await insertTruck("route-truck-4");
    const route = await insertRoute(truckId, "k".repeat(64));
    await expect(insertPlan(route.id, truckId, "pending")).rejects.toThrow();
  });

  it("rejects a duplicate (plan_id, seq) in plan_stops", async () => {
    const truckId = await insertTruck("route-truck-5");
    const route = await insertRoute(truckId, "l".repeat(64));
    const planId = await insertPlan(route.id, truckId);
    const stationId = await insertStation("BVD", "9206810");

    const insertStop = () =>
      scopedPool.query(
        `INSERT INTO plan_stops
           (plan_id, seq, station_id, offset_along_route_miles, leg_distance_miles,
            arrival_gallons, purchase_gallons, departure_gallons, unit_price_usd,
            stop_cost_usd, cum_distance_miles, cum_duration_s)
         VALUES ($1, 1, $2, 100, 100, 50, 100, 150, 3.10, 310, 100, 600)`,
        [planId, stationId],
      );
    await expect(insertStop()).resolves.toBeTruthy();
    await expect(insertStop()).rejects.toThrow();
  });

  it("cascades plan deletion to plan_stops, but refuses to delete a station referenced by a stop", async () => {
    const truckId = await insertTruck("route-truck-6");
    const route = await insertRoute(truckId, "m".repeat(64));
    const planId = await insertPlan(route.id, truckId);
    const stationId = await insertStation("BVD", "9206810");
    await scopedPool.query(
      `INSERT INTO plan_stops
         (plan_id, seq, station_id, offset_along_route_miles, leg_distance_miles,
          arrival_gallons, purchase_gallons, departure_gallons, unit_price_usd,
          stop_cost_usd, cum_distance_miles, cum_duration_s)
       VALUES ($1, 1, $2, 100, 100, 50, 100, 150, 3.10, 310, 100, 600)`,
      [planId, stationId],
    );

    await expect(
      scopedPool.query(`DELETE FROM stations WHERE id = $1`, [stationId]),
    ).rejects.toThrow();

    await scopedPool.query(`DELETE FROM plans WHERE id = $1`, [planId]);
    const { rows } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM plan_stops WHERE plan_id = $1`,
      [planId],
    );
    expect(rows[0]?.count).toBe("0");
  });
});
