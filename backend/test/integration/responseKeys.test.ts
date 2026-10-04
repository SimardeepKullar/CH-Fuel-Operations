import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { DriversResult } from "../../src/actuals/drivers.js";
import type { ListTransactionsResult } from "../../src/actuals/transactions.js";
import type { TrucksResult } from "../../src/actuals/trucks.js";
import { insertAnomaly, insertCard, insertInvoice, insertStation, insertStop, scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, importCa, importUs, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** A field that holds an amount of money — wherever one appears, a currency
 * must sit beside it (T-63: "every money field has a `currency` beside it"). */
const MONEY_KEYS = new Set([
  "amount", "total", "fee", "discount", "scale", "express", "expressFee",
  "preTaxAmount", "hst", "gst", "pst", "qst", "grandTotal",
]);

/** Subtrees whose `total`/`grandTotal` are counts or cents, not money. */
const NOT_MONEY_SUBTREES = new Set(["receiptCompliance", "progress", "coverage", "reconcile"]);

interface Walked {
  /** Every key at every depth, with the JSON path it was found at. */
  keys: Array<{ key: string; path: string }>;
  /** Objects holding a money field with no `currency` on them or an ancestor. */
  moneyWithoutCurrency: string[];
}

/** Walks a parsed response. Nothing is skipped: arrays, nested objects and the
 * free-form anomaly `detail` are all visited. */
function walk(value: unknown, path = "$", currencyAbove = false, out: Walked = { keys: [], moneyWithoutCurrency: [] }): Walked {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, currencyAbove, out));
    return out;
  }
  if (value === null || typeof value !== "object") {
    return out;
  }
  const obj = value as Record<string, unknown>;
  const hasCurrency = currencyAbove || typeof obj.currency === "string";
  // A pagination envelope's `total` is a row count.
  const moneyKeys = Object.keys(obj).filter((k) => MONEY_KEYS.has(k) && !("pageSize" in obj && k === "total"));
  if (moneyKeys.length > 0 && !hasCurrency) {
    out.moneyWithoutCurrency.push(`${path}: ${moneyKeys.join(", ")}`);
  }
  for (const [key, child] of Object.entries(obj)) {
    out.keys.push({ key, path: `${path}.${key}` });
    if (!NOT_MONEY_SUBTREES.has(key)) {
      walk(child, `${path}.${key}`, hasCurrency, out);
    } else {
      walk(child, `${path}.${key}`, true, out);
    }
  }
  return out;
}

describe("walk (the check below is only as good as this)", () => {
  it("finds a key at any depth, in arrays and in free-form objects", () => {
    const walked = walk({ rows: [{ detail: { amountUsd: 1 } }] });
    expect(walked.keys.map((k) => k.path)).toContain("$.rows[0].detail.amountUsd");
  });

  it("flags money with no currency on it or above it, and accepts a currency on either", () => {
    expect(walk({ rows: [{ total: 1 }] }).moneyWithoutCurrency).toEqual(["$.rows[0]: total"]);
    expect(walk({ currency: "CAD", rows: [{ total: 1 }] }).moneyWithoutCurrency).toEqual([]);
    expect(walk({ rows: [{ total: 1, currency: "USD" }] }).moneyWithoutCurrency).toEqual([]);
  });

  it("treats a pagination envelope's total as a count, not money", () => {
    expect(walk({ rows: [], page: 1, pageSize: 25, total: 3 }).moneyWithoutCurrency).toEqual([]);
  });
});

/**
 * T-63 step 63.3: "No response field ends in `Usd`; every money field has a
 * `currency` beside it", asserted by walking the keys of every period-scoped
 * response — the free-form anomaly `detail` included, which stores the legacy
 * US keys and is normalised on the way out.
 */
describe.skipIf(!hasDatabase)("response keys across the period-scoped routes (integration, T-63)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_response_keys"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  async function get(pathAndQuery: string): Promise<unknown> {
    const response = await app.handle(new Request(`http://localhost/api/v1${pathAndQuery}`), { userId: "test-user" });
    expect(response.status, pathAndQuery).toBe(200);
    return response.json();
  }

  it("no key in any response contains Usd, and every money field has a currency beside it", async () => {
    const us = await importUs(pool, usInWeek(), "invoice_100001.csv");
    const ca = await importCa(pool);
    expect(us.status).toBe("imported");
    expect(ca.status).toBe("imported");

    // A legacy US finding exactly as T-30's rules stored it, and a station + CA stop for the series.
    const usStop = (await pool.query<{ id: string }>("SELECT fs.id FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id WHERE i.currency = 'USD' LIMIT 1")).rows[0]!.id;
    await insertAnomaly(pool, { fuelStopId: usStop, rule: "sub_gallon", severity: "red" });
    await pool.query(
      `UPDATE anomalies SET detail = '{"productCode":"TA","gallons":"0.50","amountUsd":"2.61","minGallons":"1.00"}'::jsonb WHERE subject_id = $1`,
      [usStop],
    );
    const stationId = await insertStation(pool, { siteRef: "58156", nameRaw: "BVD COMBER", cityRaw: "Comber", stateUsps: "ON" });
    const caWeek = await insertInvoice(pool, { number: "CA-KEYS", periodStart: "2026-09-16", periodEnd: "2026-09-16", currency: "CAD" });
    await insertStop(pool, {
      invoiceId: caWeek,
      cardId: await insertCard(pool, { cardNumber: "9100002" }),
      stationId,
      occurredAt: "2026-09-12T10:00:00Z",
      lines: [{ code: "TA", gallons: 50, billed: 2 }],
    });

    const drivers = (await get(`/drivers?week=${WEEK_END}`)) as DriversResult;
    const trucks = (await get(`/trucks?week=${WEEK_END}`)) as TrucksResult;
    const txs = (await get(`/transactions?week=${WEEK_END}&pageSize=200&includeLines=true`)) as ListTransactionsResult;

    const responses: Record<string, unknown> = {
      "import report (US)": us.status === "imported" ? us.report : null,
      "import report (CA)": ca.status === "imported" ? ca.report : null,
      "/invoices": await get("/invoices"),
      "/periods": await get("/periods"),
      "/overview (US digest carries the legacy finding)": await get(`/overview?week=${WEEK_END}`),
      "/overview?units=metric": await get(`/overview?week=${WEEK_END}&units=metric`),
      "/transactions (both sides)": txs,
      "/transactions CAD": await get(`/transactions?week=${WEEK_END}&currency=CAD&pageSize=200&includeLines=true`),
      "/transactions/{id}": await get(`/transactions/${txs.rows[0]!.id}`),
      "/drivers": drivers,
      "/drivers CAD": await get(`/drivers?week=${WEEK_END}&currency=CAD`),
      "/drivers/{id}": await get(`/drivers/${drivers.rows[0]!.driver.id}?week=${WEEK_END}`),
      "/trucks": trucks,
      "/trucks/{id}": await get(`/trucks/${trucks.rows[0]!.truck.id}?week=${WEEK_END}`),
      "/express-charges": await get(`/express-charges?week=${WEEK_END}`),
      "/express-charges CAD": await get(`/express-charges?week=${WEEK_END}&currency=CAD`),
      "/receipt-queue": await get("/receipt-queue"),
      "/stations/{id}/billed-prices": await get(`/stations/${stationId}/billed-prices`),
    };

    // The legacy finding really is in the response, so the walk is not vacuous.
    const digest = (responses["/overview (US digest carries the legacy finding)"] as { anomalyDigest: Array<{ detail: unknown }> }).anomalyDigest;
    expect(digest.map((d) => d.detail)).toContainEqual({ productCode: "TA", qty: "0.50", amount: "2.61", minGallons: "1.00", currency: "USD", qtyUnit: "gal" });

    for (const [name, body] of Object.entries(responses)) {
      const walked = walk(JSON.parse(JSON.stringify(body)));
      expect(walked.keys.length, `${name} has keys to walk`).toBeGreaterThan(0);
      expect(walked.keys.filter(({ key }) => /usd/i.test(key)).map((k) => k.path), `${name}: keys containing Usd`).toEqual([]);
      expect(walked.moneyWithoutCurrency, `${name}: money with no currency beside it`).toEqual([]);
    }
  });
});
