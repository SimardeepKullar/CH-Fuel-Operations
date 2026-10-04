import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import { DEFAULT_BUDGET_CEILINGS } from "../../src/routing/budgetCeilings.js";
import { reserveProviderCall } from "../../src/routing/budgetGuard.js";
import { recordQuota } from "../../src/routing/quotaObserver.js";
import { getHealthStatus, type HealthStatus } from "../../src/catalog/health.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const ORS_ENV = { ROUTING_PROVIDER: "ors", ORS_API_KEY: "test-key" };
const NOW = new Date("2026-09-22T15:00:00Z");

describe.skipIf(!hasDatabase)("GET /health (integration, T-18 step 18.2, A16)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_health"));
    app = createApp({ pool });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  it("db.reachable is true against a live pool", async () => {
    const status = await getHealthStatus(pool, ORS_ENV, NOW);
    expect(status.db.reachable).toBe(true);
  });

  it("provider.reachable is a config check only: true with ROUTING_PROVIDER+ORS_API_KEY set, false with either missing", async () => {
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).provider).toMatchObject({ name: "ors", reachable: true });
    expect((await getHealthStatus(pool, { ROUTING_PROVIDER: "ors" }, NOW)).provider).toMatchObject({
      name: "ors",
      reachable: false,
    });
    expect((await getHealthStatus(pool, {}, NOW)).provider).toMatchObject({ name: null, reachable: false });
  });

  it("meters are null when no provider is configured — there is no endpoint set to report on", async () => {
    const status = await getHealthStatus(pool, {}, NOW);
    expect(status.provider.meters).toBeNull();
  });

  it("shows both meters separately per endpoint, never merged into one figure", async () => {
    await reserveProviderCall(pool, "ors", "matrix", DEFAULT_BUDGET_CEILINGS.matrix, NOW);
    await reserveProviderCall(pool, "ors", "matrix", DEFAULT_BUDGET_CEILINGS.matrix, NOW);
    await recordQuota(pool, "ors", "matrix", { limit: 50, remaining: 41 }, NOW);

    const status = await getHealthStatus(pool, ORS_ENV, NOW);
    const matrix = status.provider.meters!.matrix;

    // Ours: what our own reservation counted.
    expect(matrix.ours).toEqual({ callsUsed: 2, ceiling: 50, remaining: 48, period: "2026-09-22" });
    // Theirs: the provider's own reported remaining — independent of ours,
    // and here deliberately different (41 vs our 48) to prove neither
    // collapses into the other.
    expect(matrix.theirs).toEqual({ limit: 50, remaining: 41, observedAt: NOW.toISOString() });
  });

  it("an endpoint never called today reads zero used, full ceiling remaining, and an unobserved theirs — not an error", async () => {
    const status = await getHealthStatus(pool, ORS_ENV, NOW);
    const geocoding = status.provider.meters!.geocoding;

    expect(geocoding.ours).toEqual({ callsUsed: 0, ceiling: 100, remaining: 100, period: "2026-09-22" });
    expect(geocoding.theirs).toEqual({ limit: null, remaining: null, observedAt: null });
  });

  it("ours resets to the calling day's own period — yesterday's reservations don't count against today", async () => {
    const yesterday = new Date("2026-09-21T15:00:00Z");
    await reserveProviderCall(pool, "ors", "directions", DEFAULT_BUDGET_CEILINGS.directions, yesterday);

    const status = await getHealthStatus(pool, ORS_ENV, NOW);

    expect(status.provider.meters!.directions.ours).toEqual({
      callsUsed: 0,
      ceiling: 200,
      remaining: 200,
      period: "2026-09-22",
    });
  });

  it("latestSheetDate is the newest completed price_imports row; not set when there are none", async () => {
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).latestSheetDate).toBeNull();

    await pool.query(
      `INSERT INTO price_imports (supplier, source_filename, file_sha256, effective_date, status)
       VALUES ('BVD', 'a.csv', repeat('a', 64), '2026-08-22', 'completed'),
              ('BVD', 'b.csv', repeat('b', 64), '2026-09-01', 'completed'),
              ('BVD', 'c.csv', repeat('c', 64), '2026-09-15', 'pending')`,
    );

    // The newest completed sheet, not the newest row overall — the pending
    // 09-15 row has nothing a picker could select yet.
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).latestSheetDate).toBe("2026-09-01");
  });

  it("latestInvoicePeriod is the newest imported billing week, on either side; quarantined invoices don't count", async () => {
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).latestInvoicePeriod).toBeNull();

    await pool.query(
      `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
       VALUES ('HLT-1', '2026-07-01', '2026-07-07', '2026-07-07', '2026-07-08', '2026-07-09', 'USD', 'gal', 100, 'imported', repeat('1', 64)),
              ('HLT-2', '2026-08-01', '2026-08-07', '2026-08-07', '2026-08-08', '2026-08-09', 'USD', 'gal', 100, 'quarantined', repeat('2', 64))`,
    );

    expect((await getHealthStatus(pool, ORS_ENV, NOW)).latestInvoicePeriod).toBe("2026-07-07");

    // A CA-only week is still the newest week (T-63 removes T-61's US-only filter).
    await pool.query(
      `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
       VALUES ('HLT-3', '2026-06-01', '2026-07-14', '2026-07-14', '2026-07-15', '2026-07-16', 'CAD', 'L', 100, 'imported', repeat('3', 64))`,
    );
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).latestInvoicePeriod).toBe("2026-07-14");
  });

  it("openAnomalyCount is every undismissed anomaly system-wide, regardless of invoice — T-39's standing flag count", async () => {
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).openAnomalyCount).toBe(0);

    await pool.query(
      `INSERT INTO anomalies (subject_type, subject_id, rule, severity, dismissed_at)
       VALUES ('fuel_stop', gen_random_uuid(), 'sub_gallon', 'red', NULL),
              ('fuel_stop', gen_random_uuid(), 'unit_mismatch', 'amber', NULL),
              ('fuel_stop', gen_random_uuid(), 'too_close', 'amber', now())`,
    );

    // Two undismissed, regardless of which invoice (or none) they belong to
    // — the dismissed third row does not count.
    expect((await getHealthStatus(pool, ORS_ENV, NOW)).openAnomalyCount).toBe(2);
  });

  // "db unreachable degrades every field rather than throwing" is covered
  // deterministically at the unit level (app.test.ts, a pool that throws on
  // touch) — a real pool here is always reachable by construction.

  it("GET /health through the app returns 200 with the full shape", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = (await response.json()) as HealthStatus;
    expect(body.db).toEqual({ reachable: true });
    expect(body).toHaveProperty("provider.reachable");
    expect(body).toHaveProperty("latestSheetDate");
    expect(body).toHaveProperty("latestInvoicePeriod");
    expect(body).toHaveProperty("openAnomalyCount");
  });
});
