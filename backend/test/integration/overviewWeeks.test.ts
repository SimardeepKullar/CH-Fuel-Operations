import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OverviewResult } from "../../src/actuals/overview.js";
import type { OverviewWeeksResult } from "../../src/actuals/overviewWeeks.js";
import { createApp, type App } from "../../src/api/app.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, importCa, importUs, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** T-70: `GET /overview/weeks` serves the per-week figures the client aggregates over any scope. */
describe.skipIf(!hasDatabase)("GET /overview/weeks (integration, T-70)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_overview_weeks"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  const getJson = async <T>(path: string): Promise<T> => {
    const response = await app.handle(new Request(`http://localhost/api/v1${path}`));
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  };

  it("is empty with nothing imported", async () => {
    expect(await getJson<OverviewWeeksResult>("/overview/weeks")).toEqual({ weeks: [] });
  });

  it("carries the same figures as the single-week overview, each side as printed", async () => {
    expect((await importUs(pool, usInWeek(), "invoice_100001.csv")).status).toBe("imported");
    expect((await importCa(pool)).status).toBe("imported");
    await pool.query("UPDATE invoices SET fx_cad_per_usd = 1.3712, fx_entered_at = now() WHERE currency = 'CAD'");

    const { weeks } = await getJson<OverviewWeeksResult>("/overview/weeks");
    const { us, ca } = await getJson<OverviewResult>(`/overview?week=${WEEK_END}`);
    expect(weeks).toHaveLength(1);
    const week = weeks[0]!;

    expect(week.weekEnd).toBe(WEEK_END);
    expect(week.fx).toBe(1.3712);
    expect(week.start <= week.end).toBe(true);
    expect(week.us).toMatchObject({
      invoice: expect.stringMatching(/^\d+$/),
      gal: us!.kpis.diesel.qty,
      diesel: us!.kpis.diesel.amount,
      def: us!.kpis.def.amount,
      defGal: us!.kpis.def.qty,
      other: us!.kpis.otherCharges.total,
      disc: us!.kpis.discount.total,
      stops: us!.kpis.receiptCompliance.total,
      receiptsConfirmed: us!.kpis.receiptCompliance.confirmed,
      anomalies: us!.kpis.anomaliesFlagged,
    });
    expect(week.ca).toMatchObject({
      invoice: expect.stringMatching(/^\d+$/),
      litres: ca!.kpis.diesel.qty,
      dieselWithTax: ca!.kpis.diesel.amount,
      dieselPreTax: ca!.kpis.diesel.preTax,
      defWithTax: ca!.kpis.def.amount,
      defPreTax: ca!.kpis.def.preTax,
      defLitres: ca!.kpis.def.qty,
    });
    expect(week.ca!.dieselWithTax).toBeGreaterThan(week.ca!.dieselPreTax);
  });

  it("has a null rate until one is entered, and a missing side is null", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    const { weeks } = await getJson<OverviewWeeksResult>("/overview/weeks");
    expect(weeks[0]).toMatchObject({ weekEnd: WEEK_END, fx: null, ca: null });
    expect(weeks[0]!.us).not.toBeNull();
  });

  it("lists every driver once, folding both sides' spend into one row", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    await importCa(pool);
    const { weeks } = await getJson<OverviewWeeksResult>("/overview/weeks");
    const { drivers, ca } = weeks[0]!;
    const keys = drivers.map((d) => d.driverId ?? "");
    expect(new Set(keys).size).toBe(keys.length);
    // Every driver's spend is accounted for: the sums are the stops' totals, not a top-ten cut.
    const usTotal = await pool.query<{ t: string }>(
      "SELECT COALESCE(SUM(fs.total), 0) AS t FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id WHERE i.currency = 'USD'",
    );
    const caTotal = await pool.query<{ t: string }>(
      "SELECT COALESCE(SUM(fs.total), 0) AS t FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id WHERE i.currency = 'CAD'",
    );
    expect(drivers.reduce((t, d) => t + d.usd, 0)).toBeCloseTo(Number(usTotal.rows[0]!.t), 2);
    expect(drivers.reduce((t, d) => t + d.cad, 0)).toBeCloseTo(Number(caTotal.rows[0]!.t), 2);
    expect(ca).not.toBeNull();
  });
});
