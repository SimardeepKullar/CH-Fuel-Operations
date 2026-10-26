import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOverview } from "../../src/actuals/overview.js";
import { createApp, type App } from "../../src/api/app.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, importCa, importUs, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const RATE = 1.3712;

const cents = (n: number): number => Math.round(n * 100);

/**
 * T-65 step 65.1: `GET /overview` returns `{ us, ca, combined, fx }`. The
 * synthetic block runs everywhere a database does: sample-redacted.csv (US)
 * and sample-ca.pdf (CA) share the week ending 2026-09-09. The real
 * 999210 + 999217 figures are in overviewPanels.real.test.ts.
 */
describe.skipIf(!hasDatabase)("GET /overview: us, ca, combined, fx (integration, T-65)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_overview_panels"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function bothSides(): Promise<void> {
    expect((await importUs(pool, usInWeek(), "invoice_100001.csv")).status).toBe("imported");
    expect((await importCa(pool)).status).toBe("imported");
  }

  const enterRate = (rate = RATE) =>
    pool.query("UPDATE invoices SET fx_cad_per_usd = $1, fx_entered_at = now() WHERE currency = 'CAD'", [rate]);

  async function get(query: string): Promise<Awaited<ReturnType<typeof getOverview>>> {
    const response = await app.handle(new Request(`http://localhost/api/v1/overview?week=${WEEK_END}${query}`));
    expect(response.status).toBe(200);
    return (await response.json()) as Awaited<ReturnType<typeof getOverview>>;
  }

  it("the CA side's with-tax spend is the invoice's grand total, and before tax + tax = with tax exactly", async () => {
    await bothSides();
    const { ca } = await get("");
    const { rows } = await pool.query<{ grand_total: string; tax: string }>(
      `SELECT i.grand_total, SUM(t.hst + t.gst + t.pst + t.qst) AS tax
       FROM invoices i JOIN invoice_totals t ON t.invoice_id = i.id WHERE i.currency = 'CAD' GROUP BY i.id`,
    );

    expect(ca!.currency).toBe("CAD");
    expect(ca!.qtyUnit).toBe("L");
    expect(ca!.kpis.total.amount).toBe(Number(rows[0]!.grand_total));
    expect(ca!.kpis.tax.withTax).toBe(Number(rows[0]!.grand_total));
    expect(ca!.kpis.tax.tax).toBe(Number(rows[0]!.tax));
    expect(ca!.kpis.tax.tax).toBeGreaterThan(0);
    expect(cents(ca!.kpis.tax.beforeTax) + cents(ca!.kpis.tax.tax)).toBe(cents(ca!.kpis.tax.withTax));
    // HST is the only tax BVD prints on an Ontario invoice.
    expect(ca!.kpis.tax.hst).toBe(ca!.kpis.tax.tax);
    for (const product of [ca!.kpis.diesel, ca!.kpis.def]) {
      expect(cents(product.preTax) + cents(product.tax)).toBe(cents(product.amount));
    }
    // The headline rate is billed (with tax); the before-tax one is lower by the tax.
    expect(ca!.kpis.avgBilledPreTaxPerUnit!).toBeLessThan(ca!.kpis.avgBilledPerUnit!);
  });

  it("a US side carries no tax: before tax is with tax", async () => {
    await bothSides();
    const { us } = await get("");
    expect(us!.kpis.tax).toMatchObject({ tax: 0, hst: 0, gst: 0, pst: 0, qst: 0 });
    expect(us!.kpis.tax.beforeTax).toBe(us!.kpis.tax.withTax);
    expect(us!.kpis.avgBilledPreTaxPerUnit).toBe(us!.kpis.avgBilledPerUnit);
  });

  it("with a rate, combined USD = US total + round(CA total ÷ rate), in cents, and the split still adds up", async () => {
    await bothSides();
    await enterRate();
    const { us, ca, combined, fx } = await get("");

    const expectedWith = cents(us!.kpis.total.amount) + Math.round((cents(ca!.kpis.total.amount) * 10000) / 13712);
    const expectedTax = cents(us!.kpis.tax.tax) + Math.round((cents(ca!.kpis.tax.tax) * 10000) / 13712);
    expect(combined).toMatchObject({ currency: "USD", partial: false, missingSide: null, ratePending: false, qtyUnit: "gal" });
    expect(cents(combined!.spend.withTax!)).toBe(expectedWith);
    expect(cents(combined!.spend.tax!)).toBe(expectedTax);
    expect(cents(combined!.spend.beforeTax!) + cents(combined!.spend.tax!)).toBe(cents(combined!.spend.withTax!));
    expect(fx).toEqual({ rate: RATE, enteredAt: expect.any(String) });
    // Rates: spend over quantity in one unit, before tax below with tax.
    expect(combined!.avgBilledPreTaxPerUnit!).toBeLessThan(combined!.avgBilledPerUnit!);
    expect(combined!.diesel.qty).toBeCloseTo(us!.kpis.diesel.qty + ca!.kpis.diesel.qty / 3.785411784, 3);
  });

  it("usConverted is the US side in CAD/L: each figure converted once at the entered rate, litres without one", async () => {
    await bothSides();
    const pending = await get("");
    expect(pending.usConverted).toMatchObject({ currency: "CAD", qtyUnit: "L", ratePending: true, total: null, avgBilledPerUnit: null });
    // Litres need no rate.
    expect(pending.usConverted!.dieselQty).toBeCloseTo(pending.us!.kpis.diesel.qty * 3.785411784, 2);

    await enterRate();
    const { us, usConverted } = await get("");
    expect(usConverted).toMatchObject({ currency: "CAD", qtyUnit: "L", ratePending: false });
    expect(cents(usConverted!.total!)).toBe(Math.round((cents(us!.kpis.total.amount) * 13712) / 10000));
    expect(cents(usConverted!.discount!)).toBe(Math.round((cents(us!.kpis.discount.total) * 13712) / 10000));
    // A per-gallon USD price is a per-litre CAD one: × rate ÷ litres per gallon.
    expect(usConverted!.avgBilledPerUnit!).toBeCloseTo((us!.kpis.avgBilledPerUnit! * RATE) / 3.785411784, 3);
    // The US side itself is untouched, and it is not a function of ?convertTo.
    expect(us!.currency).toBe("USD");
    expect((await get("&convertTo=CAD")).usConverted).toEqual(usConverted);
  });

  it("?convertTo=CAD converts the US side up instead: CA total + round(US total × rate)", async () => {
    await bothSides();
    await enterRate();
    const { us, ca, combined } = await get("&convertTo=CAD");

    const expectedWith = cents(ca!.kpis.total.amount) + Math.round((cents(us!.kpis.total.amount) * 13712) / 10000);
    expect(combined!.currency).toBe("CAD");
    expect(cents(combined!.spend.withTax!)).toBe(expectedWith);
    // In CAD the combined panel reads in litres, as the CA invoice prints; each side keeps its own unit.
    expect(combined!.qtyUnit).toBe("L");
    expect(us!.qtyUnit).toBe("gal");
    expect(ca!.qtyUnit).toBe("L");
    expect(combined!.diesel.qty).toBeCloseTo(ca!.kpis.diesel.qty + us!.kpis.diesel.qty * 3.785411784, 2);
    expect(cents(combined!.spend.beforeTax!) + cents(combined!.spend.tax!)).toBe(cents(combined!.spend.withTax!));
  });

  it("with no rate every converted figure is null and none is computed — never a 1.0 rate", async () => {
    await bothSides();
    const { combined, fx, us, ca } = await get("");

    expect(fx).toBeNull();
    expect(combined).toMatchObject({ ratePending: true, partial: false });
    expect(combined!.spend).toEqual({ beforeTax: null, tax: null, withTax: null });
    expect(combined!.diesel).toMatchObject({ beforeTax: null, tax: null, withTax: null });
    expect(combined!.def).toMatchObject({ beforeTax: null, tax: null, withTax: null });
    expect(combined!.discount).toBeNull();
    expect(combined!.avgBilledPerUnit).toBeNull();
    expect(combined!.avgBilledPreTaxPerUnit).toBeNull();
    // The sides themselves are unaffected: they are in their own currency.
    expect(us!.kpis.total.amount).toBeGreaterThan(0);
    expect(ca!.kpis.total.amount).toBeGreaterThan(0);
  });

  it("a US-only week: ca is null, combined is partial, and needs no rate", async () => {
    expect((await importUs(pool, usInWeek(), "invoice_100001.csv")).status).toBe("imported");
    const { us, ca, combined, fx } = await get("");

    expect(ca).toBeNull();
    expect(fx).toBeNull();
    expect(combined).toMatchObject({ partial: true, missingSide: "CAD", ratePending: false, currency: "USD" });
    expect(combined!.spend.withTax).toBe(us!.kpis.total.amount);
    // The same week read in CAD would need a rate no CA invoice can carry.
    const inCad = await get("&convertTo=CAD");
    expect(inCad.combined).toMatchObject({ partial: true, ratePending: true });
    expect(inCad.combined!.spend).toEqual({ beforeTax: null, tax: null, withTax: null });
  });

  it("a CA-only week: us is null, combined is partial, and converting waits on the rate", async () => {
    expect((await importCa(pool)).status).toBe("imported");
    const pending = await get("");
    expect(pending.us).toBeNull();
    expect(pending.combined).toMatchObject({ partial: true, missingSide: "USD", ratePending: true });

    await enterRate();
    const { ca, combined } = await get("");
    expect(combined!.ratePending).toBe(false);
    expect(cents(combined!.spend.withTax!)).toBe(Math.round((cents(ca!.kpis.total.amount) * 10000) / 13712));
    // In CAD it is the invoice itself, no rate involved.
    expect((await get("&convertTo=CAD")).combined!.spend.withTax).toBe(ca!.kpis.total.amount);
  });

  it("a week with neither invoice is a well-formed empty payload", async () => {
    expect(await get("")).toEqual({ us: null, usConverted: null, ca: null, combined: null, fx: null });
  });

  it("?units changes per-unit rates and quantities and never money", async () => {
    await bothSides();
    await enterRate();
    const printed = await get("");
    const gallons = await get("&units=imperial");
    const litres = await get("&units=metric");

    // CA, printed in litres, read per gallon: the price scales, the money does not.
    expect(printed.ca!.qtyUnit).toBe("L");
    expect(gallons.ca!.qtyUnit).toBe("gal");
    expect(gallons.ca!.kpis.avgBilledPerUnit!).toBeCloseTo(printed.ca!.kpis.avgBilledPerUnit! * 3.785411784, 4);
    expect(gallons.ca!.kpis.total).toEqual(printed.ca!.kpis.total);
    expect(gallons.ca!.kpis.tax).toEqual(printed.ca!.kpis.tax);
    expect(gallons.ca!.kpis.diesel.amount).toBe(printed.ca!.kpis.diesel.amount);

    // The combined panel is in gallons unless asked for litres; its money is the same either way.
    expect(printed.combined!.qtyUnit).toBe("gal");
    expect(litres.combined!.qtyUnit).toBe("L");
    expect(litres.combined!.spend).toEqual(printed.combined!.spend);
    expect(litres.combined!.diesel.withTax).toBe(printed.combined!.diesel.withTax);
    expect(litres.combined!.avgBilledPerUnit!).toBeCloseTo(printed.combined!.avgBilledPerUnit! / 3.785411784, 4);
    expect(litres.combined!.diesel.qty).toBeCloseTo(printed.combined!.diesel.qty * 3.785411784, 2);
  });

  it("a bad convertTo is a 400 problem+json", async () => {
    const response = await app.handle(new Request(`http://localhost/api/v1/overview?week=${WEEK_END}&convertTo=EUR`));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("each side's trend is its own currency's weeks", async () => {
    await bothSides();
    const { us, ca } = await get("");
    expect(us!.trend.map((p) => p.week)).toEqual([WEEK_END]);
    expect(ca!.trend.map((p) => p.week)).toEqual([WEEK_END]);
    expect(us!.trend[0]!.invoiceId).not.toBe(ca!.trend[0]!.invoiceId);
  });
});
