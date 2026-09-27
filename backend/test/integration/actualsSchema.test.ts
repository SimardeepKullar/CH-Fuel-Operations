import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("0003_actuals_schema.sql (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_actuals_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("applies all six migrations, and a second run is a no-op", async () => {
    const first = await runMigrations(scopedPool, migrationsDir);
    expect(first.every((r) => !r.applied)).toBe(true);
    const { rows } = await scopedPool.query<{ filename: string }>(
      `SELECT filename FROM ${schema}.schema_migrations ORDER BY filename`,
    );
    expect(rows.map((r) => r.filename)).toEqual([
      "0001_planning_schema.sql",
      "0002_planning_seed.sql",
      "0003_actuals_schema.sql",
      "0004_actuals_config_seed.sql",
      "0005_fleet_roster_seed.sql",
      "0006_remove_def_ratio_anomalies.sql",
    ]);
  });

  // ─── Step 25.1: reference layer ────────────────────────────────────────

  async function insertDriver(displayName: string): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO drivers (display_name) VALUES ($1) RETURNING id`,
      [displayName],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertDriver failed");
    return id;
  }

  async function insertTruck(unitNumber: string): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number) VALUES ($1) RETURNING id`,
      [unitNumber],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertTruck failed");
    return id;
  }

  async function insertCard(cardNumber: string, driverId?: string): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO fuel_cards (card_number, driver_id) VALUES ($1, $2) RETURNING id`,
      [cardNumber, driverId ?? null],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertCard failed");
    return id;
  }

  it("round-trips unit_number = '099' with its leading zero", async () => {
    await insertTruck("099");
    const { rows } = await scopedPool.query<{ unit_number: string }>(
      `SELECT unit_number FROM trucks WHERE unit_number = '099'`,
    );
    expect(rows[0]?.unit_number).toBe("099");
  });

  it("rejects two overlapping truck assignments for one driver", async () => {
    const driverId = await insertDriver("DRIVER A");
    const truckA = await insertTruck("T1");
    const truckB = await insertTruck("T2");

    await scopedPool.query(
      `INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
       VALUES ($1, $2, '2026-01-01', NULL)`,
      [driverId, truckA],
    );

    await expect(
      scopedPool.query(
        `INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
         VALUES ($1, $2, '2026-03-01', NULL)`,
        [driverId, truckB],
      ),
    ).rejects.toThrow();
  });

  it("accepts effective_to = NULL as meaning current", async () => {
    const driverId = await insertDriver("DRIVER C");
    const truckId = await insertTruck("T3");

    await scopedPool.query(
      `INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
       VALUES ($1, $2, '2026-01-01', NULL)`,
      [driverId, truckId],
    );
    const { rows } = await scopedPool.query<{ effective_to: Date | null }>(
      `SELECT effective_to FROM truck_assignments WHERE driver_id = $1`,
      [driverId],
    );
    expect(rows[0]?.effective_to).toBeNull();
  });

  it("rejects a second active card for one driver, but allows an inactive one alongside a new active one", async () => {
    const driverId = await insertDriver("DRIVER CARD OWNER");
    await insertCard("CARDONE", driverId);

    await expect(insertCard("CARDTWO", driverId)).rejects.toThrow();

    await scopedPool.query(
      `UPDATE fuel_cards SET status = 'inactive' WHERE card_number = 'CARDONE'`,
    );
    await expect(insertCard("CARDTHREE", driverId)).resolves.toBeTruthy();
  });

  it("rejects a duplicate spelling of one alias, unique on alias_normalized", async () => {
    const driverId = await insertDriver("DRIVER D");
    await scopedPool.query(
      `INSERT INTO driver_aliases (alias_normalized, driver_id, source)
       VALUES ('driver d', $1, 'seed')`,
      [driverId],
    );
    await expect(
      scopedPool.query(
        `INSERT INTO driver_aliases (alias_normalized, driver_id, source)
         VALUES ('driver d', $1, 'seed')`,
        [driverId],
      ),
    ).rejects.toThrow();
  });

  // ─── Step 25.2: invoice layer ───────────────────────────────────────────

  async function insertInvoice(
    invoiceNumber: string,
    fileSha256: string,
    status: "quarantined" | "imported" = "imported",
  ): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO invoices
         (invoice_number, period_start, period_end, invoice_date, due_date,
          grand_total_usd, status, file_sha256)
       VALUES ($1, '2026-09-03', '2026-09-09', '2026-09-10', '2026-09-11', 50929.71, $3, $2)
       RETURNING id`,
      [invoiceNumber, fileSha256, status],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertInvoice failed");
    return id;
  }

  async function insertFuelStop(
    invoiceId: string,
    cardId: string,
    baseAuthCode: string,
    stationId?: string,
  ): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO fuel_stops
         (invoice_id, base_auth_code, occurred_at, card_id, unit_raw,
          driver_name_raw, station_id, total_usd)
       VALUES ($1, $2, now(), $3, '072', 'JORDAN', $4, 218.35)
       RETURNING id`,
      [invoiceId, baseAuthCode, cardId, stationId ?? null],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertFuelStop failed");
    return id;
  }

  it("round-trips 5.2395 in fuel_stop_lines.billed_usd_per_gal without rounding to 2dp", async () => {
    const cardId = await insertCard("C3");
    const invoiceId = await insertInvoice("INV-1", "a".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH1");
    await scopedPool.query(
      `INSERT INTO fuel_stop_lines
         (fuel_stop_id, product_code, gallons, retail_usd_per_gal, billed_usd_per_gal, amount_usd)
       VALUES ($1, 'TA', 41.67, 5.9890, 5.2395, 218.15)`,
      [stopId],
    );
    const { rows } = await scopedPool.query<{ billed_usd_per_gal: string }>(
      `SELECT billed_usd_per_gal FROM fuel_stop_lines WHERE fuel_stop_id = $1`,
      [stopId],
    );
    expect(rows[0]?.billed_usd_per_gal).toBe("5.2395");
  });

  it("rejects the same file_sha256 twice, and the same invoice_number with a different hash under a different constraint", async () => {
    await insertInvoice("INV-DUP-HASH-A", "b".repeat(64));
    await expect(insertInvoice("INV-DUP-HASH-B", "b".repeat(64))).rejects.toThrow(
      /invoices_file_sha256_key/,
    );

    await insertInvoice("INV-DUP-NUM", "c".repeat(64));
    await expect(insertInvoice("INV-DUP-NUM", "d".repeat(64))).rejects.toThrow(
      /invoices_invoice_number_key/,
    );
  });

  it("rejects a duplicate (fuel_stop_id, product_code) line", async () => {
    const cardId = await insertCard("C4");
    const invoiceId = await insertInvoice("INV-2", "e".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH2");
    const insertLine = () =>
      scopedPool.query(
        `INSERT INTO fuel_stop_lines
           (fuel_stop_id, product_code, gallons, retail_usd_per_gal, billed_usd_per_gal, amount_usd)
         VALUES ($1, 'TA', 41.67, 5.9890, 5.2395, 218.15)`,
        [stopId],
      );
    await expect(insertLine()).resolves.toBeTruthy();
    await expect(insertLine()).rejects.toThrow();
  });

  it("accepts a fuel stop with a null station_id (unresolved station)", async () => {
    const cardId = await insertCard("C5");
    const invoiceId = await insertInvoice("INV-3", "f".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH3");
    const { rows } = await scopedPool.query<{ station_id: string | null }>(
      `SELECT station_id FROM fuel_stops WHERE id = $1`,
      [stopId],
    );
    expect(rows[0]?.station_id).toBeNull();
  });

  it("accepts an express charge with a null driver_id", async () => {
    const truckId = await insertTruck("098");
    const invoiceId = await insertInvoice("INV-4", "g".repeat(64));
    await scopedPool.query(
      `INSERT INTO express_charges
         (invoice_id, express_code, occurred_at, truck_id, unit_raw, amount_usd, total_usd)
       VALUES ($1, 'LUMPER', now(), $2, '098', 200.00, 203.00)`,
      [invoiceId, truckId],
    );
    const { rows } = await scopedPool.query<{ driver_id: string | null }>(
      `SELECT driver_id FROM express_charges WHERE invoice_id = $1`,
      [invoiceId],
    );
    expect(rows[0]?.driver_id).toBeNull();
  });

  it("cascades an invoice delete to fuel_stops, fuel_stop_lines and express_charges, but refuses to delete a referenced station", async () => {
    const cardId = await insertCard("C6");
    const truckId = await insertTruck("074");
    const { rows: stationRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
       VALUES ('BVD', 'SITE1', 'LOVES #1', 'DALLAS', 'dallas', 'TX')
       RETURNING id`,
    );
    const stationId = stationRows[0]?.id;
    if (!stationId) throw new Error("station insert failed");

    const invoiceId = await insertInvoice("INV-5", "h".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH5", stationId);
    await scopedPool.query(
      `INSERT INTO fuel_stop_lines
         (fuel_stop_id, product_code, gallons, retail_usd_per_gal, billed_usd_per_gal, amount_usd)
       VALUES ($1, 'TA', 41.67, 5.9890, 5.2395, 218.15)`,
      [stopId],
    );
    await scopedPool.query(
      `INSERT INTO express_charges
         (invoice_id, express_code, occurred_at, truck_id, unit_raw, amount_usd, total_usd)
       VALUES ($1, 'LUMPER', now(), $2, '074', 200.00, 203.00)`,
      [invoiceId, truckId],
    );

    await expect(
      scopedPool.query(`DELETE FROM stations WHERE id = $1`, [stationId]),
    ).rejects.toThrow();

    await scopedPool.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);

    const { rows: stops } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM fuel_stops WHERE invoice_id = $1`,
      [invoiceId],
    );
    expect(stops[0]?.count).toBe("0");
    const { rows: lines } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM fuel_stop_lines WHERE fuel_stop_id = $1`,
      [stopId],
    );
    expect(lines[0]?.count).toBe("0");
    const { rows: express } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM express_charges WHERE invoice_id = $1`,
      [invoiceId],
    );
    expect(express[0]?.count).toBe("0");
  });

  // ─── Step 25.3: receipts, anomalies, thresholds, matches ───────────────

  async function insertUser(email: string): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'h', 'U') RETURNING id`,
      [email],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("insertUser failed");
    return id;
  }

  it("persists two receipt checks on one stop; the later checked_at is the derived status", async () => {
    const cardId = await insertCard("C7");
    const userId = await insertUser("checker@example.com");
    const invoiceId = await insertInvoice("INV-6", "i".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH6");

    await scopedPool.query(
      `INSERT INTO receipt_checks (fuel_stop_id, checked_by, checked_at, outcome)
       VALUES ($1, $2, '2026-09-10 10:00:00+00', 'missing')`,
      [stopId, userId],
    );
    await scopedPool.query(
      `INSERT INTO receipt_checks (fuel_stop_id, checked_by, checked_at, outcome)
       VALUES ($1, $2, '2026-09-10 11:00:00+00', 'confirmed')`,
      [stopId, userId],
    );

    const { rows: all } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM receipt_checks WHERE fuel_stop_id = $1`,
      [stopId],
    );
    expect(all[0]?.count).toBe("2");

    const { rows: latest } = await scopedPool.query<{ outcome: string }>(
      `SELECT outcome FROM receipt_checks WHERE fuel_stop_id = $1
       ORDER BY checked_at DESC LIMIT 1`,
      [stopId],
    );
    expect(latest[0]?.outcome).toBe("confirmed");
  });

  it("rejects a severity outside amber/red", async () => {
    const cardId = await insertCard("C8");
    const invoiceId = await insertInvoice("INV-7", "j".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH7");
    await expect(
      scopedPool.query(
        `INSERT INTO anomalies (subject_type, subject_id, rule, severity)
         VALUES ('fuel_stop', $1, 'sub_gallon', 'critical')`,
        [stopId],
      ),
    ).rejects.toThrow();
  });

  it("upserts on (rule, subject_type, subject_id), leaving one row", async () => {
    const cardId = await insertCard("C9");
    const invoiceId = await insertInvoice("INV-8", "k".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH8");
    const upsert = () =>
      scopedPool.query(
        `INSERT INTO anomalies (subject_type, subject_id, rule, severity)
         VALUES ('fuel_stop', $1, 'sub_gallon', 'red')
         ON CONFLICT (rule, subject_type, subject_id) DO UPDATE SET severity = EXCLUDED.severity`,
        [stopId],
      );
    await upsert();
    await upsert();
    const { rows } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM anomalies WHERE rule = 'sub_gallon' AND subject_id = $1`,
      [stopId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("keeps the anomaly row when dismissed_at is set", async () => {
    const cardId = await insertCard("C10");
    const invoiceId = await insertInvoice("INV-9", "l".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH9");
    await scopedPool.query(
      `INSERT INTO anomalies (subject_type, subject_id, rule, severity)
       VALUES ('fuel_stop', $1, 'sub_gallon', 'red')`,
      [stopId],
    );
    await scopedPool.query(
      `UPDATE anomalies SET dismissed_at = now() WHERE rule = 'sub_gallon' AND subject_id = $1`,
      [stopId],
    );
    const { rows } = await scopedPool.query<{ count: string }>(
      `SELECT count(*) FROM anomalies WHERE rule = 'sub_gallon' AND subject_id = $1`,
      [stopId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  async function insertPlan(): Promise<string> {
    const { rows: truckRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO trucks (unit_number, tank_gallons, avg_mpg) VALUES ('actuals-test', 200, 7.0) RETURNING id`,
    );
    const truckId = truckRows[0]?.id;
    if (!truckId) throw new Error("truck insert failed");

    const { rows: routeRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO routes
         (provider, request_hash, origin_geom, destination_geom, truck_id,
          distance_miles, duration_s)
       VALUES ('ors', $1, ST_SetSRID(ST_MakePoint(-111, 32), 4326)::geography,
               ST_SetSRID(ST_MakePoint(-112, 33), 4326)::geography, $2, 1000, 3600)
       RETURNING id`,
      ["z".repeat(64), truckId],
    );
    const routeId = routeRows[0]?.id;
    if (!routeId) throw new Error("route insert failed");

    const { rows: planRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO plans
         (base_route_id, truck_id, start_fuel_gallons, min_arrival_gallons,
          max_leg_miles, min_leg_miles, corridor_miles, max_detour_miles, solve_ms, status)
       VALUES ($1, $2, 200, 30, 500, 300, 25, 10, 100, 'infeasible')
       RETURNING id`,
      [routeId, truckId],
    );
    const planId = planRows[0]?.id;
    if (!planId) throw new Error("plan insert failed");
    return planId;
  }

  it("rejects plan_actual_matches with both plan_stop_id and fuel_stop_id null, but accepts either alone", async () => {
    const planId = await insertPlan();
    const cardId = await insertCard("C11");
    const invoiceId = await insertInvoice("INV-10", "m".repeat(64));
    const stopId = await insertFuelStop(invoiceId, cardId, "AUTH10");

    await expect(
      scopedPool.query(
        `INSERT INTO plan_actual_matches (plan_id, kind) VALUES ($1, 'unplanned_stop')`,
        [planId],
      ),
    ).rejects.toThrow();

    await expect(
      scopedPool.query(
        `INSERT INTO plan_actual_matches (plan_id, fuel_stop_id, kind) VALUES ($1, $2, 'unplanned_stop')`,
        [planId, stopId],
      ),
    ).resolves.toBeTruthy();
  });
});
