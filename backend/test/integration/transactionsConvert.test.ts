import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { ListTransactionsResult, TransactionListItem } from "../../src/actuals/transactions.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, importCa, importUs, redatedCsv, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** Every money figure a row and its lines carry, by stop id, as the database
 * converts it with `numeric` arithmetic — an oracle independent of the API's
 * own rounding. `round(numeric, n)` rounds half away from zero, as the API does. */
interface Oracle {
  total: string;
  lines: Record<string, { amount: string; preTax: string | null; hst: string; gst: string; pst: string; qst: string; retail: string; billed: string }>;
}

/** T-66 step 66.3 — money in the Transactions conversion, at the entered rate. */
describe.skipIf(!hasDatabase)("GET /transactions?convertTo= (integration, T-66)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;
  let caId: string;

  const get = async (query: string): Promise<ListTransactionsResult> => {
    const response = await app.handle(new Request(`http://localhost/api/v1/transactions?${query}`));
    expect(response.status, query).toBe(200);
    return (await response.json()) as ListTransactionsResult;
  };
  const setRate = (rate: number | null) =>
    app.handle(new Request(`http://localhost/api/v1/invoices/${caId}`, { method: "PATCH", body: JSON.stringify({ fxCadPerUsd: rate }) }));

  const week = `week=${WEEK_END}&pageSize=200&includeLines=true`;
  const byId = (result: ListTransactionsResult) => new Map(result.rows.map((r) => [r.id, r]));

  /** The oracle: `op` is `/` for CAD -> USD and `*` for USD -> CAD; `perUnit` scales a price for a unit change. */
  async function oracle(currency: "USD" | "CAD", op: "/" | "*", rate: string, perUnit = "1"): Promise<Map<string, Oracle>> {
    const { rows } = await pool.query<{ id: string; total: string }>(
      `SELECT fs.id, round(fs.total ${op} $2::numeric, 2)::text AS total
       FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id WHERE i.currency = $1`,
      [currency, rate],
    );
    const out = new Map<string, Oracle>(rows.map((r) => [r.id, { total: r.total, lines: {} }]));
    const { rows: lines } = await pool.query<{ fuel_stop_id: string; product_code: string } & Oracle["lines"][string]>(
      `SELECT fsl.fuel_stop_id, fsl.product_code,
              round(fsl.amount ${op} $2::numeric, 2)::text AS amount,
              round(fsl.pre_tax_amount ${op} $2::numeric, 2)::text AS "preTax",
              round(fsl.hst ${op} $2::numeric, 2)::text AS hst, round(fsl.gst ${op} $2::numeric, 2)::text AS gst,
              round(fsl.pst ${op} $2::numeric, 2)::text AS pst, round(fsl.qst ${op} $2::numeric, 2)::text AS qst,
              round(fsl.retail_per_unit * $3::numeric ${op} $2::numeric, 4)::text AS retail,
              round(fsl.billed_per_unit * $3::numeric ${op} $2::numeric, 4)::text AS billed
       FROM fuel_stop_lines fsl JOIN fuel_stops fs ON fs.id = fsl.fuel_stop_id JOIN invoices i ON i.id = fs.invoice_id
       WHERE i.currency = $1`,
      [currency, rate, perUnit],
    );
    for (const { fuel_stop_id, product_code, ...figures } of lines) {
      out.get(fuel_stop_id)!.lines[product_code] = figures;
    }
    return out;
  }

  function expectConverted(row: TransactionListItem, expected: Oracle) {
    expect(row.total, row.baseAuthCode).toBe(Number(expected.total));
    expect(row.lines!.length).toBe(Object.keys(expected.lines).length);
    for (const line of row.lines!) {
      const want = expected.lines[line.productCode]!;
      expect(line.currency).toBe(row.currency);
      expect(line.amount, `${row.baseAuthCode} ${line.productCode} amount`).toBe(Number(want.amount));
      expect(line.preTaxAmount).toBe(want.preTax === null ? null : Number(want.preTax));
      expect([line.hst, line.gst, line.pst, line.qst]).toEqual([want.hst, want.gst, want.pst, want.qst].map(Number));
      expect(line.retailPerUnit, `${row.baseAuthCode} ${line.productCode} retail`).toBe(Number(want.retail));
      expect(line.billedPerUnit, `${row.baseAuthCode} ${line.productCode} billed`).toBe(Number(want.billed));
    }
    const ta = row.lines!.find((l) => l.productCode === "TA");
    if (ta) {
      expect(row.billedPerUnit).toBe(ta.billedPerUnit);
      expect(row.retailPerUnit).toBe(ta.retailPerUnit);
    }
  }

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_tx_convert"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
    expect((await importUs(pool, usInWeek(), "invoice_100001.csv")).status).toBe("imported");
    const ca = await importCa(pool);
    expect(ca.status).toBe("imported");
    caId = ca.status === "imported" ? ca.invoiceId : "";
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  it("convertTo=USD divides each CAD money field and line by the entered rate, rounded once; the row carries fx and invoiceCurrency", async () => {
    expect((await setRate(1.3712)).status).toBe(200);
    const enteredAt = (await pool.query<{ t: Date }>("SELECT fx_entered_at AS t FROM invoices WHERE id = $1", [caId])).rows[0]!.t.toISOString();

    const result = await get(`${week}&currency=CAD&convertTo=USD`);
    const expected = await oracle("CAD", "/", "1.3712");
    expect(result.rows.length).toBe(expected.size);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row).toMatchObject({ currency: "USD", invoiceCurrency: "CAD", qtyUnit: "L", fx: { rate: 1.3712, enteredAt } });
      expect(row).not.toHaveProperty("ratePending");
      expectConverted(row, expected.get(row.id)!);
    }
    // At least one line carries real tax, so the tax columns were converted, not just zeros.
    expect(result.rows.some((r) => r.lines!.some((l) => (l.hst ?? 0) !== 0))).toBe(true);
  });

  it("beside units=imperial, a price takes the unit factor inside its one rounding; quantities follow units alone", async () => {
    await setRate(1.3712);
    const native = byId(await get(`${week}&currency=CAD&units=imperial`));
    const result = await get(`${week}&currency=CAD&units=imperial&convertTo=USD`);
    const expected = await oracle("CAD", "/", "1.3712", "3.785411784");
    for (const row of result.rows) {
      expect(row.qtyUnit).toBe("gal");
      expect(row.qty).toBe(native.get(row.id)!.qty);
      expectConverted(row, expected.get(row.id)!);
    }
  });

  it("a USD row is unchanged by convertTo=USD", async () => {
    await setRate(1.3712);
    const plain = byId(await get(`${week}&currency=USD`));
    const converted = await get(`${week}&currency=USD&convertTo=USD`);
    expect(converted.rows.length).toBe(plain.size);
    for (const row of converted.rows) {
      expect(row).toEqual(plain.get(row.id));
      expect(row).toMatchObject({ currency: "USD", invoiceCurrency: "USD" });
      expect(row).not.toHaveProperty("fx");
    }
  });

  it("with no entered rate, every CA money figure is null and the row is ratePending — never converted at 1.0", async () => {
    const result = await get(`${week}&currency=CAD&convertTo=USD`);
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row).toMatchObject({ currency: "USD", invoiceCurrency: "CAD", ratePending: true, total: null, billedPerUnit: null, retailPerUnit: null });
      expect(row).not.toHaveProperty("fx");
      expect(row.qty === null || typeof row.qty === "number").toBe(true);
      for (const line of row.lines!) {
        expect([line.amount, line.preTaxAmount, line.hst, line.gst, line.pst, line.qst, line.retailPerUnit, line.billedPerUnit]).toEqual(Array(8).fill(null));
        expect(typeof line.qty).toBe("number");
      }
    }
  });

  it("a corrected rate changes the next read, and nothing stored changes", async () => {
    const snapshot = async () =>
      (await pool.query("SELECT fs.id, fs.total, fsl.* FROM fuel_stops fs JOIN fuel_stop_lines fsl ON fsl.fuel_stop_id = fs.id ORDER BY fs.id, fsl.product_code")).rows;
    const before = await snapshot();

    await setRate(1.3712);
    const first = byId(await get(`${week}&currency=CAD&convertTo=USD`));
    await setRate(1.25);
    const second = await get(`${week}&currency=CAD&convertTo=USD`);
    const expected = await oracle("CAD", "/", "1.25");
    for (const row of second.rows) {
      expect(row.fx!.rate).toBe(1.25);
      expectConverted(row, expected.get(row.id)!);
    }
    // A one-cent stop can round the same at both rates; the rest move.
    expect(second.rows.filter((row) => row.total !== first.get(row.id)!.total).length).toBeGreaterThan(second.rows.length / 2);
    expect(await snapshot()).toEqual(before);
  });

  it("convertTo=CAD multiplies a US row by its week's CA rate, and is rate pending in a week with no CA invoice", async () => {
    await setRate(1.3712);
    const result = await get(`${week}&currency=USD&convertTo=CAD`);
    const expected = await oracle("USD", "*", "1.3712");
    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row).toMatchObject({ currency: "CAD", invoiceCurrency: "USD", fx: { rate: 1.3712 } });
      expectConverted(row, expected.get(row.id)!);
    }

    // Another week, US only: no CA rate to use.
    await importUs(pool, redatedCsv("sample-redacted-2.csv", { "2026-01-19": "2026-09-02" }), "invoice_100002.csv");
    const lonely = await get("week=2026-09-02&pageSize=200&convertTo=CAD");
    expect(lonely.rows.length).toBeGreaterThan(0);
    expect(lonely.rows.every((r) => r.ratePending === true && r.total === null && r.currency === "CAD")).toBe(true);
  });

  it("under All invoices with convertTo=USD every row is in USD, so the money sums in one currency", async () => {
    await setRate(1.3712);
    const all = await get(`${week}&convertTo=USD`);
    expect(new Set(all.rows.map((r) => r.invoiceCurrency))).toEqual(new Set(["USD", "CAD"]));
    expect(all.rows.every((r) => r.currency === "USD" && r.total !== null)).toBe(true);
  });

  it("an unknown convertTo is a 400", async () => {
    for (const value of ["EUR", "usd", ""]) {
      const response = await app.handle(new Request(`http://localhost/api/v1/transactions?${week}&convertTo=${value}`));
      expect(response.status, value).toBe(400);
    }
  });
});
