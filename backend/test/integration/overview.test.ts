import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app.js";
import { getOverview } from "../../src/actuals/overview.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";
import { insertCard, insertDriver, insertInvoice, insertStop } from "./support/actualsFixtures.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realFixturePath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixture = existsSync(realFixturePath);

/**
 * T-33: `GET /overview?period=` against the real 999210 invoice.
 *
 * `period=2026-09-03` is the invoice's own `period_start` — A13's chosen key
 * (A7's top bar talks about periods, not invoice numbers).
 *
 * Two figures are asserted against measured reality, not A5's printed
 * table, for the same reason `invoice999210.test.ts` already measures them:
 * `importInvoice()` never writes `receipt_checks` (T-35's job), so every
 * stop here is `pending`, and the anomaly count is T-30's real engine
 * output against the current seed roster, not the pre-T-30 "3". Every other
 * figure in this describe block matches A5 exactly, per BUILD-PLAN-v2.md
 * Step 33.1 and TICKETS-v2.md's T-33 DoD — including discount, which reads
 * BVD's own printed "Disc AMT" off `invoice_totals` rather than recomputing
 * it (see the discount test below for why that distinction matters here).
 */
describe.skipIf(!hasDatabase || !hasRealFixture)("GET /overview against 999210 (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_overview_999210_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, realMigrationsDir);

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

  it("matches A5's untouched figures exactly: total, diesel, DEF, scale, express, fee", async () => {
    const result = await getOverview(scopedPool, "2026-09-03");

    expect(result.kpis.invoiceId).not.toBeNull();
    expect(result.kpis.total).toEqual({ amountUsd: 50929.71, currency: "USD" });
    expect(result.kpis.diesel).toEqual({ gallons: 8733.11, amountUsd: 48450.68, currency: "USD" });
    expect(result.kpis.def).toEqual({ gallons: 174.43, amountUsd: 845.4, currency: "USD" });
    expect(result.kpis.otherCharges.scaleUsd).toBe(90.5);
    expect(result.kpis.otherCharges.expressUsd).toBe(1543.13);
    expect(result.kpis.otherCharges.expressFeeUsd).toBe(18);
    // Other charges combines scale + express for the single KPI card (A8.1)
    // while still surfacing each separately (Step 33.1's own DoD).
    expect(result.kpis.otherCharges.totalUsd).toBe(1633.63);
  });

  it("average billed price is gallons-weighted and rounds to A5's $5.55/gal", async () => {
    const result = await getOverview(scopedPool, "2026-09-03");
    expect(Math.round(result.kpis.avgBilledUsdPerGal! * 100) / 100).toBe(5.55);
  });

  it("the weighted average diverges from a naive mean of per-line prices, proving the weighting", async () => {
    const result = await getOverview(scopedPool, "2026-09-03");
    const { rows } = await scopedPool.query<{ avg: string }>(
      "SELECT AVG(billed_usd_per_gal) AS avg FROM fuel_stop_lines WHERE product_code = 'TA'",
    );
    const unweightedMean = Number(rows[0]!.avg);
    expect(result.kpis.avgBilledUsdPerGal).not.toBeCloseTo(unweightedMean, 2);
  });

  /**
   * Discount is read straight off `invoice_totals.discount_usd` — BVD's own
   * printed per-code "Disc AMT" from the invoice's Grand Totals section,
   * trusted as given (T-33 follow-up). Recomputing gallons × (retail −
   * billed) from the 4dp `retail_usd_per_gal`/`billed_usd_per_gal` columns
   * does *not* reproduce this exactly — it drifts a few cents from BVD's own
   * internal rounding — which is exactly why this reads the printed figure
   * instead of deriving it.
   */
  it("discount matches A5's printed $5,088.61 exactly, read from invoice_totals not recomputed", async () => {
    const result = await getOverview(scopedPool, "2026-09-03");
    expect(result.kpis.discount.totalUsd).toBe(5088.61);
    expect(Math.round(result.kpis.discount.avgUsdPerGal! * 100) / 100).toBe(0.58);
  });

  it("receipt compliance and anomaly count reflect the database, not A5's pre-T-30/T-35 figures", async () => {
    const result = await getOverview(scopedPool, "2026-09-03");
    expect(result.kpis.receiptCompliance).toEqual({ confirmed: 0, total: 66 });
    // 13, not 84 — 0005's driver/truck pairing now comes from the real
    // invoice instead of a guess, so the false-positive unit_mismatch
    // findings the old pairing produced are gone (invoice999210.test.ts);
    // and T-40A retired the def_ratio rule, dropping the count from 26 to 13.
    expect(result.kpis.anomaliesFlagged).toBe(13);
  });

  it("a period with no matching invoice returns a well-formed empty payload over HTTP, not an error", async () => {
    const app = createApp({ authRequired: false, pool: scopedPool });
    const response = await app.handle(new Request("http://localhost/api/v1/overview?period=2020-01-01"));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { kpis: { invoiceId: string | null; total: { amountUsd: number } } };
    expect(body.kpis.invoiceId).toBeNull();
    expect(body.kpis.total.amountUsd).toBe(0);
  });

  it("GET /overview over HTTP serves the whole screen in one call", async () => {
    const app = createApp({ authRequired: false, pool: scopedPool });
    const response = await app.handle(new Request("http://localhost/api/v1/overview?period=2026-09-03"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = (await response.json()) as {
      kpis: { invoiceId: string };
      trend: unknown[];
      topSpendByDriver: unknown[];
      anomalyDigest: unknown[];
    };
    expect(body.kpis.invoiceId).toBeTruthy();
    expect(Array.isArray(body.trend)).toBe(true);
    expect(body.topSpendByDriver.length).toBeGreaterThan(0);
    expect(body.anomalyDigest.length).toBeGreaterThan(0);
  });

  it("a missing period query param is a 400 problem+json, not a crash", async () => {
    const app = createApp({ authRequired: false, pool: scopedPool });
    const response = await app.handle(new Request("http://localhost/api/v1/overview"));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
});

/**
 * No real fixture covers more than one period, so the trend/top-spend
 * panels are proven against invoices/fuel_stops/fuel_stop_lines inserted
 * directly via SQL — the same pattern T-32's `EXPLAIN` test used for volume.
 * This block needs no local fixture file, only a live database.
 */
describe.skipIf(!hasDatabase)("GET /overview synthetic periods (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_overview_synthetic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  function sha256Hex(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }

  interface SyntheticStop {
    driverName: string;
    cardNumber: string;
    gallons: number;
    retail: number;
    billed: number;
  }

  async function createPeriod(periodStart: string, stops: SyntheticStop[]): Promise<{ invoiceId: string; stopIds: string[] }> {
    const invoiceNumber = `SYN-${periodStart}`;
    let taGallons = 0;
    let taAmount = 0;
    const stopAmounts = stops.map((s) => Math.round(s.gallons * s.billed * 100) / 100);
    for (const amount of stopAmounts) {
      taAmount += amount;
    }
    for (const s of stops) {
      taGallons += s.gallons;
    }

    const { rows: invoiceRows } = await scopedPool.query<{ id: string }>(
      `INSERT INTO invoices (invoice_number, period_start, period_end, invoice_date, due_date, grand_total_usd, status, file_sha256)
       VALUES ($1, $2::date, $2::date, $2::date, $2::date, $3, 'imported', $4)
       RETURNING id`,
      [invoiceNumber, periodStart, taAmount.toFixed(2), sha256Hex(invoiceNumber)],
    );
    const invoiceId = invoiceRows[0]!.id;

    const stopIds: string[] = [];
    const driverIdByName = new Map<string, string>();
    const cardIdByName = new Map<string, string>();
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!;
      const amountUsd = stopAmounts[i]!;

      let driverId = driverIdByName.get(stop.driverName);
      if (!driverId) {
        const { rows: existing } = await scopedPool.query<{ id: string }>(
          "SELECT id FROM drivers WHERE display_name = $1",
          [stop.driverName],
        );
        if (existing[0]) {
          driverId = existing[0].id;
        } else {
          const { rows: driverRows } = await scopedPool.query<{ id: string }>(
            "INSERT INTO drivers (display_name) VALUES ($1) RETURNING id",
            [stop.driverName],
          );
          driverId = driverRows[0]!.id;
        }
        driverIdByName.set(stop.driverName, driverId);
      }

      // One active card per driver (fuel_cards_one_active_per_driver) — a
      // driver reusing the same name in this fixture reuses their one card,
      // same as the real schema requires.
      let cardId = cardIdByName.get(stop.driverName);
      if (!cardId) {
        const { rows: cardRows } = await scopedPool.query<{ id: string }>(
          "INSERT INTO fuel_cards (card_number, driver_id) VALUES ($1, $2) RETURNING id",
          [stop.cardNumber, driverId],
        );
        cardId = cardRows[0]!.id;
        cardIdByName.set(stop.driverName, cardId);
      }

      const { rows: stopRows } = await scopedPool.query<{ id: string }>(
        `INSERT INTO fuel_stops (invoice_id, base_auth_code, occurred_at, card_id, driver_id, unit_raw, driver_name_raw, total_usd)
         VALUES ($1, $2, $3::date, $4, $5, '000', $6, $7)
         RETURNING id`,
        [invoiceId, `SYN-${stop.cardNumber}-${i}`, periodStart, cardId, driverId, stop.driverName, amountUsd],
      );
      const stopId = stopRows[0]!.id;
      stopIds.push(stopId);

      await scopedPool.query(
        `INSERT INTO fuel_stop_lines (fuel_stop_id, product_code, gallons, retail_usd_per_gal, billed_usd_per_gal, amount_usd)
         VALUES ($1, 'TA', $2, $3, $4, $5)`,
        [stopId, stop.gallons, stop.retail, stop.billed, amountUsd],
      );
    }

    await scopedPool.query(
      "INSERT INTO invoice_totals (invoice_id, product_code, gallons, amount_usd) VALUES ($1, 'TA', $2, $3)",
      [invoiceId, taGallons.toFixed(2), taAmount.toFixed(2)],
    );

    return { invoiceId, stopIds };
  }

  it("the trend covers the trailing window and a skipped period is absent, not zero-filled", async () => {
    await createPeriod("2026-01-05", [{ driverName: "A", cardNumber: "T1", gallons: 100, retail: 6, billed: 5 }]);
    // 2026-01-12 deliberately has no invoice.
    await createPeriod("2026-01-19", [{ driverName: "B", cardNumber: "T2", gallons: 100, retail: 6, billed: 5.2 }]);
    // 2026-01-26 deliberately has no invoice.
    await createPeriod("2026-02-02", [{ driverName: "C", cardNumber: "T3", gallons: 100, retail: 6, billed: 5.4 }]);

    const result = await getOverview(scopedPool, "2026-02-02", { trendPeriods: 5 });

    expect(result.trend.map((t) => t.period)).toEqual(["2026-01-05", "2026-01-19", "2026-02-02"]);
    expect(result.trend.map((t) => t.avgBilledUsdPerGal)).toEqual([5, 5.2, 5.4]);
  });

  it("trend respects the trailing-window limit", async () => {
    await createPeriod("2026-01-05", [{ driverName: "A", cardNumber: "L1", gallons: 100, retail: 6, billed: 5 }]);
    await createPeriod("2026-01-12", [{ driverName: "B", cardNumber: "L2", gallons: 100, retail: 6, billed: 5.1 }]);
    await createPeriod("2026-01-19", [{ driverName: "C", cardNumber: "L3", gallons: 100, retail: 6, billed: 5.2 }]);

    const result = await getOverview(scopedPool, "2026-01-19", { trendPeriods: 2 });
    expect(result.trend.map((t) => t.period)).toEqual(["2026-01-12", "2026-01-19"]);
  });

  it("top spend by driver is ordered by spend and gallons-weighted, not a mean of prices", async () => {
    const { invoiceId } = await createPeriod("2026-03-02", [
      { driverName: "Big Spender", cardNumber: "D1", gallons: 100, retail: 6, billed: 5 },
      { driverName: "Big Spender", cardNumber: "D2", gallons: 50, retail: 6, billed: 6 },
      { driverName: "Small Spender", cardNumber: "D3", gallons: 10, retail: 6, billed: 5 },
    ]);
    void invoiceId;

    const result = await getOverview(scopedPool, "2026-03-02");

    expect(result.topSpendByDriver[0]!.driverName).toBe("Big Spender");
    expect(result.topSpendByDriver[0]!.totalUsd).toBeGreaterThan(result.topSpendByDriver[1]!.totalUsd);

    // weighted: (100*5 + 50*6) / 150 = 5.3333..., not the naive mean (5+6)/2 = 5.5
    const bigSpender = result.topSpendByDriver.find((d) => d.driverName === "Big Spender")!;
    expect(bigSpender.gallons).toBe(150);
    expect(bigSpender.avgBilledUsdPerGal).toBeCloseTo(5.3333, 3);
    expect(bigSpender.avgBilledUsdPerGal).not.toBeCloseTo(5.5, 3);
  });

  it("top spend counts a stop's total once, however many product lines it carries", async () => {
    const invoice = await insertInvoice(scopedPool, { number: "T37-LINES", periodStart: "2026-03-16", periodEnd: "2026-03-22" });
    const driver = await insertDriver(scopedPool, "Two Lines");
    const card = await insertCard(scopedPool, { cardNumber: "TWO-LINES", driverId: driver });
    await insertStop(scopedPool, {
      invoiceId: invoice,
      cardId: card,
      driverId: driver,
      occurredAt: "2026-03-17T15:00:00Z",
      lines: [
        { code: "TA", gallons: 100, billed: 5 },
        { code: "DF", gallons: 3, billed: 4 },
      ],
    });

    const result = await getOverview(scopedPool, "2026-03-16");

    // 100 × 5.00 + 3 × 4.00 = 512.00 — the stop's printed total, not 1,024.00.
    expect(result.topSpendByDriver).toHaveLength(1);
    expect(result.topSpendByDriver[0]!.totalUsd).toBe(512);
    expect(result.topSpendByDriver[0]!.gallons).toBe(100);
    expect(result.topSpendByDriver[0]!.avgBilledUsdPerGal).toBe(5);
  });

  it("the anomaly digest carries the fuel stop id, enough to deep-link into Transactions", async () => {
    const { invoiceId, stopIds } = await createPeriod("2026-04-06", [
      { driverName: "Flagged Driver", cardNumber: "A1", gallons: 0.04, retail: 6, billed: 5 },
    ]);
    void invoiceId;
    const stopId = stopIds[0]!;

    await scopedPool.query(
      `INSERT INTO anomalies (subject_type, subject_id, rule, severity, detail)
       VALUES ('fuel_stop', $1, 'sub_gallon', 'red', '{"gallons": 0.04}'::jsonb)`,
      [stopId],
    );

    const result = await getOverview(scopedPool, "2026-04-06");

    expect(result.anomalyDigest).toHaveLength(1);
    expect(result.anomalyDigest[0]!.fuelStopId).toBe(stopId);
    expect(result.anomalyDigest[0]!.rule).toBe("sub_gallon");
    expect(result.anomalyDigest[0]!.severity).toBe("red");

    // Deep-linkable: the id really resolves to a fuel stop in this invoice.
    const { rows } = await scopedPool.query<{ count: string }>(
      "SELECT count(*) FROM fuel_stops WHERE id = $1",
      [result.anomalyDigest[0]!.fuelStopId],
    );
    expect(rows[0]!.count).toBe("1");
  });
});
