import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app.js";
import { getTransactionById, listTransactions } from "../../src/actuals/transactions.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realFixturePath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realFixturePath);

/**
 * T-32: `GET /transactions` / `GET /transactions/{id}` against the real
 * 999210 invoice (imported the same way `invoice999210.test.ts` proves the
 * import itself) — the worked stop expansion in PROJECT-SCOPE-v2.md §A19
 * (auth `A252014353`, JORDAN, card 9000005, unit 072, LOVES #294) anchors
 * the DoD's "stop total is the sum of all lines" assertion.
 */
describe.skipIf(!hasDatabase || !hasRealFixture)("GET /transactions (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_transactions_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, realMigrationsDir);

    // The stations table is only ever populated by the price-sheet ingest
    // pipeline (T-06/T-08), which this schema-scoped test never runs — so
    // without this row every stop's station_id would resolve to null and
    // the detail test below couldn't exercise the station branch at all.
    // Matched by store number only (resolveStationByName), never by
    // site_ref (CLAUDE.md: SITE matches 0 of 605 real rows).
    await scopedPool.query(
      `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps)
       VALUES ('BVD', '43673', 'LOVES #294', 'Dallas', 'Dallas', 'TX')`,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await runImportInvoiceCli([realFixturePath], scopedPool);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (exitCode !== 0) {
      throw new Error("fixture import failed");
    }
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  async function navjotStopId(): Promise<string> {
    const { rows } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM fuel_stops WHERE base_auth_code = 'A252014353'",
    );
    const id = rows[0]?.id;
    if (!id) throw new Error("fixture is missing auth A252014353");
    return id;
  }

  it("lines for A252014353 sum to the returned stop total, $255.13 (Step 32.2)", async () => {
    const result = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
      { includeLines: true },
    );
    const row = result.rows.find((r) => r.baseAuthCode === "A252014353");
    expect(row).toBeDefined();
    expect(row!.totalUsd).toBe(255.13);
    const lineSum = row!.lines!.reduce((sum, l) => sum + l.amountUsd, 0);
    expect(Math.round(lineSum * 100) / 100).toBe(255.13);
    // Never derived from the TA line alone (CLAUDE.md) — DF must be present too.
    expect(row!.lines!.map((l) => l.productCode).sort()).toEqual(["DF", "TA"]);
  });

  it("a row's truck and driver fields are the A13 {resolved, raw, agrees} shape", async () => {
    const result = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
    );
    const row = result.rows.find((r) => r.baseAuthCode === "A252014353")!;
    expect(row.truck).toEqual({ resolved: "072", raw: "072", agrees: true });
    expect(row.driver.resolved).toBe("NAVJOT");
    expect(row.driver.raw).toBe("NAVJOT");
    expect(row.driver.agrees).toBe(true);
  });

  it("billed price serialises as a 4dp number, never a string and never rounded to 2dp", async () => {
    const result = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
    );
    const row = result.rows.find((r) => r.baseAuthCode === "A252014353")!;
    expect(row.billedUsdPerGal).toBe(5.2395);
    expect(typeof row.billedUsdPerGal).toBe("number");
  });

  it("each filter alone narrows the result, and three combined still compose", async () => {
    const all = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
    );
    expect(all.total).toBeGreaterThanOrEqual(60);

    const { rows: driverRows } = await scopedPool.query<{ id: string }>(
      "SELECT id FROM drivers WHERE display_name = 'NAVJOT'",
    );
    const navjotId = driverRows[0]!.id;

    const byDriver = await listTransactions(
      scopedPool,
      { driverId: navjotId },
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
    );
    expect(byDriver.total).toBeGreaterThan(0);
    expect(byDriver.total).toBeLessThan(all.total);
    for (const row of byDriver.rows) {
      expect(row.driver.resolved).toBe("NAVJOT");
    }

    const byProduct = await listTransactions(
      scopedPool,
      { product: "DF" },
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
    );
    expect(byProduct.total).toBeGreaterThan(0);

    const combined = await listTransactions(
      scopedPool,
      { driverId: navjotId, product: "DF", receiptStatus: "pending" },
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 200 },
    );
    expect(combined.total).toBeGreaterThan(0);
    expect(combined.total).toBeLessThanOrEqual(byDriver.total);
  });

  it("an empty filter object returns every stop for the invoice", async () => {
    const { rows: countRows } = await scopedPool.query<{ count: string }>("SELECT count(*) FROM fuel_stops");
    const result = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 1000 },
    );
    expect(result.total).toBe(Number(countRows[0]!.count));
    expect(result.rows.length).toBe(Number(countRows[0]!.count));
  });

  it("anomalyOnly with a page size of 5 returns 5 flagged rows, not 5 rows of which some are flagged", async () => {
    const { rows: countRows } = await scopedPool.query<{ count: string }>(
      "SELECT count(distinct subject_id) FROM anomalies WHERE subject_type = 'fuel_stop' AND dismissed_at IS NULL AND rule <> 'charges_no_fuel'",
    );
    const flaggedCount = Number(countRows[0]!.count);
    expect(flaggedCount).toBeGreaterThanOrEqual(5); // the real 999210 fixture has plenty flagged

    const result = await listTransactions(
      scopedPool,
      { anomalyOnly: true },
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 5 },
    );
    expect(result.rows).toHaveLength(5);
    for (const row of result.rows) {
      expect(row.flags.length).toBeGreaterThan(0);
    }
    expect(result.total).toBe(flaggedCount);
  });

  it("pagination is stable across pages: page 1 + page 2 partition the same fixed set with no overlap or gap", async () => {
    const pageSize = 10;
    const page1 = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize },
    );
    const page2 = await listTransactions(
      scopedPool,
      {},
      { field: "occurred_at", direction: "desc" },
      { page: 2, pageSize },
    );
    const ids1 = page1.rows.map((r) => r.id);
    const ids2 = page2.rows.map((r) => r.id);
    expect(new Set([...ids1, ...ids2]).size).toBe(ids1.length + ids2.length);
    expect(page1.total).toBe(page2.total);
  });

  it("GET /transactions/{id}: full record with resolution source, invoice link, and no plan link", async () => {
    const id = await navjotStopId();
    const detail = await getTransactionById(scopedPool, id);
    expect(detail).not.toBeNull();
    expect(detail!.lines.map((l) => l.productCode).sort()).toEqual(["DF", "TA"]);
    expect(detail!.station).not.toBeNull();
    expect(detail!.station!.loveNumber).toBe(294);
    expect(detail!.station!.resolution).toBeTruthy();
    expect(detail!.receiptCheck).toBeNull(); // T-35 not built yet — no receipt_checks rows exist
    expect(detail!.invoiceId).toBeTruthy();
    expect(detail!.planId).toBeNull(); // no plans table rows in this fixture at all
  });

  it("GET /transactions/{id} on an unknown id returns 404 problem+json", async () => {
    const app = createApp({ authRequired: false, pool: scopedPool });
    const response = await app.handle(
      new Request("http://localhost/api/v1/transactions/00000000-0000-0000-0000-000000000000"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("?period= scopes to that invoice's stops via invoice_id, not a reconstructed date range (T-40, A7)", async () => {
    const app = createApp({ authRequired: false, pool: scopedPool });
    const { rows: invoiceRows } = await scopedPool.query<{ period_start: string }>(
      "SELECT to_char(period_start, 'YYYY-MM-DD') AS period_start FROM invoices",
    );
    const period = invoiceRows[0]!.period_start;

    const scoped = await app.handle(
      new Request(`http://localhost/api/v1/transactions?pageSize=200&period=${period}`),
    );
    const scopedBody = (await scoped.json()) as { rows: unknown[]; total: number };

    const unscoped = await app.handle(new Request("http://localhost/api/v1/transactions?pageSize=200"));
    const unscopedBody = (await unscoped.json()) as { rows: unknown[]; total: number };

    // Every stop in this fixture belongs to the one imported invoice, so
    // scoping to its period returns the same set as no period at all.
    expect(scopedBody.total).toBe(unscopedBody.total);

    const noMatch = await app.handle(
      new Request("http://localhost/api/v1/transactions?pageSize=200&period=2099-01-01"),
    );
    const noMatchBody = (await noMatch.json()) as { rows: unknown[]; total: number };
    expect(noMatchBody.total).toBe(0);
    expect(noMatchBody.rows).toHaveLength(0);
  });

  it("GET /transactions over HTTP returns the same shape as the service call", async () => {
    const app = createApp({ authRequired: false, pool: scopedPool });
    const response = await app.handle(
      new Request("http://localhost/api/v1/transactions?pageSize=5&anomalyOnly=true"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = (await response.json()) as { rows: unknown[]; total: number };
    expect(body.rows).toHaveLength(5);
    expect(typeof body.total).toBe("number");
  });

  it("a dispatched plan for the same truck and price_as_of date is linked; a non-dispatched one is not", async () => {
    const id = await navjotStopId();
    const { rows: stopRows } = await scopedPool.query<{ occurred_at: Date; truck_id: string }>(
      "SELECT occurred_at, truck_id FROM fuel_stops WHERE id = $1",
      [id],
    );
    const { occurred_at: occurredAt, truck_id: truckId } = stopRows[0]!;
    const occurredDate = occurredAt.toISOString().slice(0, 10);

    const { rows: routeRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO routes (provider, request_hash, origin_geom, destination_geom, truck_id, distance_miles, duration_s)
       VALUES ('ors', repeat('0', 64), 'POINT(0 0)', 'POINT(1 1)', $1, 1000, 1000)
       RETURNING id`,
      [truckId],
    );
    const baseRouteId = routeRows[0]!.id;

    const insertPlan = (dispatchedAt: string | null) =>
      scopedPool.query<{ id: string }>(
        `INSERT INTO plans
           (base_route_id, truck_id, start_fuel_gallons, min_arrival_gallons, max_leg_miles,
            min_leg_miles, corridor_miles, max_detour_miles, solve_ms, status, price_as_of, dispatched_at)
         VALUES ($1, $2, 200, 20, 500, 300, 25, 50, 100, 'completed', $3::date, $4)
         RETURNING id`,
        [baseRouteId, truckId, occurredDate, dispatchedAt],
      );

    const { rows: nonDispatched } = await insertPlan(null);
    let detail = await getTransactionById(scopedPool, id);
    expect(detail!.planId).toBeNull();
    void nonDispatched;

    const { rows: dispatched } = await insertPlan(new Date().toISOString());
    detail = await getTransactionById(scopedPool, id);
    expect(detail!.planId).toBe(dispatched[0]!.id);
  });
});

/**
 * `EXPLAIN` needs enough rows that the planner actually prefers the index
 * over a sequential scan — the real 999210 fixture's ~66 rows are too few
 * to force that choice, so this uses a large synthetic set instead
 * (Step 32.2's own DoD: "EXPLAIN shows an index scan for the default sort").
 */
describe.skipIf(!hasDatabase)("fuel_stops default-sort query plan (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_transactions_explain_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);

    await scopedPool.query(
      `INSERT INTO invoices (invoice_number, period_start, period_end, invoice_date, due_date, grand_total_usd, status, file_sha256)
       VALUES ('EXPLAIN-TEST', '2020-01-01', '2020-01-07', '2020-01-08', '2020-01-09', 0, 'imported', repeat('0', 64))`,
    );
    await scopedPool.query("INSERT INTO fuel_cards (card_number) VALUES ('9999999')");
    await scopedPool.query(
      `INSERT INTO fuel_stops (invoice_id, base_auth_code, occurred_at, card_id, unit_raw, driver_name_raw, total_usd)
       SELECT (SELECT id FROM invoices WHERE invoice_number = 'EXPLAIN-TEST'),
              'EXPLAIN-' || gs,
              TIMESTAMPTZ '2020-01-01' - (gs || ' minutes')::interval,
              (SELECT id FROM fuel_cards WHERE card_number = '9999999'),
              '999', 'SYNTHETIC', 100.00
       FROM generate_series(1, 8000) gs`,
    );
    await scopedPool.query("ANALYZE fuel_stops");
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("uses an index scan, not a sequential scan, for the unfiltered default sort", async () => {
    const { rows } = await scopedPool.query<{ "QUERY PLAN": string }>(
      `EXPLAIN SELECT fs.id FROM fuel_stops fs ORDER BY fs.occurred_at DESC, fs.id ASC LIMIT 25 OFFSET 0`,
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).not.toContain("Seq Scan");
    expect(plan).toMatch(/Index( Only)? Scan/);
  });
});

/**
 * T-40I: `anomalyOnly` must not match a stop whose only undismissed anomaly
 * is `charges_no_fuel` — that rule is never rendered as a flag anywhere on
 * this screen (T-40H), so it must not be able to satisfy a filter meant to
 * mean "has a visible flag" either.
 */
describe.skipIf(!hasDatabase)("anomalyOnly excludes a charges_no_fuel-only stop (integration, T-40I)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let scaleOnlyId: string;
  let scaleAndMismatchId: string;

  beforeEach(async () => {
    schema = `test_transactions_anomaly_only_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);

    await scopedPool.query(
      `INSERT INTO invoices (invoice_number, period_start, period_end, invoice_date, due_date, grand_total_usd, status, file_sha256)
       VALUES ('T-40I-TEST', '2020-01-01', '2020-01-07', '2020-01-08', '2020-01-09', 0, 'imported', repeat('1', 64))`,
    );
    await scopedPool.query("INSERT INTO fuel_cards (card_number) VALUES ('9999901'), ('9999902')");

    const { rows: scaleOnlyRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO fuel_stops (invoice_id, base_auth_code, occurred_at, card_id, unit_raw, driver_name_raw, total_usd)
       VALUES ((SELECT id FROM invoices WHERE invoice_number = 'T-40I-TEST'), 'SCALE-ONLY',
               TIMESTAMPTZ '2020-01-01', (SELECT id FROM fuel_cards WHERE card_number = '9999901'),
               '900', 'SCALE ONLY DRIVER', 15.00)
       RETURNING id`,
    );
    const scaleOnlyStopId = scaleOnlyRows[0]!.id;
    const { rows: scaleAndMismatchRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO fuel_stops (invoice_id, base_auth_code, occurred_at, card_id, unit_raw, driver_name_raw, total_usd)
       VALUES ((SELECT id FROM invoices WHERE invoice_number = 'T-40I-TEST'), 'SCALE-AND-MISMATCH',
               TIMESTAMPTZ '2020-01-02', (SELECT id FROM fuel_cards WHERE card_number = '9999902'),
               '901', 'SCALE AND MISMATCH DRIVER', 20.00)
       RETURNING id`,
    );
    const scaleAndMismatchStopId = scaleAndMismatchRows[0]!.id;

    await scopedPool.query(
      `INSERT INTO anomalies (subject_type, subject_id, rule, severity) VALUES
         ('fuel_stop', $1, 'charges_no_fuel', 'amber'),
         ('fuel_stop', $2, 'charges_no_fuel', 'amber'),
         ('fuel_stop', $2, 'unit_mismatch', 'red')`,
      [scaleOnlyStopId, scaleAndMismatchStopId],
    );

    scaleOnlyId = scaleOnlyStopId;
    scaleAndMismatchId = scaleAndMismatchStopId;
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("a stop whose only undismissed anomaly is charges_no_fuel is absent from anomalyOnly", async () => {
    const result = await listTransactions(
      scopedPool,
      { anomalyOnly: true },
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 10 },
    );
    const ids = result.rows.map((r) => r.id);
    expect(ids).not.toContain(scaleOnlyId);
    expect(ids).toContain(scaleAndMismatchId);
    expect(result.total).toBe(1);
  });

  it("a stop with charges_no_fuel plus another anomaly still shows that other flag", async () => {
    const result = await listTransactions(
      scopedPool,
      { anomalyOnly: true },
      { field: "occurred_at", direction: "desc" },
      { page: 1, pageSize: 10 },
    );
    const row = result.rows.find((r) => r.id === scaleAndMismatchId);
    expect(row).toBeDefined();
    expect(row!.flags.some((f) => f.rule === "unit_mismatch")).toBe(true);
  });
});
