import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import {
  WEEK_END,
  imbalancedUsInWeek,
  importCa,
  importUs,
  secondUsInWeek,
  seedUsFixtureRoster,
  usInWeek,
} from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

/** T-63 step 63.1 — every invoice has a billing week and an actual range. */
describe.skipIf(!hasDatabase)("billing weeks at import (integration, T-63)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_billing_weeks"));
    await seedUsFixtureRoster(pool);
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  const weeks = () =>
    pool.query(
      `SELECT invoice_number, currency, status, period_start::text AS printed_start, period_end::text AS printed_end,
              billing_week_end::text AS week_end, actual_start::text AS actual_start, actual_end::text AS actual_end
       FROM invoices ORDER BY currency DESC`,
    );

  it("lands a US and a CA invoice in one week, each carrying its own actual range", async () => {
    expect((await importUs(pool, usInWeek(), "invoice_100001.csv")).status).toBe("imported");
    expect((await importCa(pool)).status).toBe("imported");
    const { rows } = await weeks();
    expect(rows).toEqual([
      // CSV: printed range is derived from its own transaction dates, so it agrees.
      { invoice_number: "100001", currency: "USD", status: "imported", printed_start: "2026-09-07", printed_end: WEEK_END, week_end: WEEK_END, actual_start: "2026-09-07", actual_end: WEEK_END },
      // CA PDF: prints Aug 1 – Sep 9; its transactions run Sep 3 – Sep 10 (UTC).
      { invoice_number: "700001", currency: "CAD", status: "imported", printed_start: "2026-08-01", printed_end: WEEK_END, week_end: WEEK_END, actual_start: "2026-09-03", actual_end: "2026-09-10" },
    ]);
  });

  it("refuses a second imported invoice of the same currency in an occupied week, naming the reason", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    const second = await importUs(pool, secondUsInWeek(), "invoice_100002.csv");
    expect(second).toMatchObject({ status: "conflict", reason: "billing_week" });
    expect(second.status === "conflict" && second.message).toContain("100001");
    expect((await pool.query("SELECT count(*) FROM invoices")).rows[0].count).toBe("1");
    expect((await pool.query("SELECT count(*) FROM fuel_stops")).rows[0].count).toBe("3");
  });

  it("does not let a quarantined invoice claim a week, or be blocked by one", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    const quarantined = await importUs(pool, imbalancedUsInWeek(), "invoice_100003.csv");
    expect(quarantined.status).toBe("quarantined");
    const { rows } = await pool.query(
      "SELECT invoice_number, status, billing_week_end::text AS week_end FROM invoices ORDER BY invoice_number",
    );
    expect(rows).toEqual([
      { invoice_number: "100001", status: "imported", week_end: WEEK_END },
      { invoice_number: "100003", status: "quarantined", week_end: WEEK_END },
    ]);
  });

  it("enforces one imported invoice per currency and week in the database itself", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    await expect(
      pool.query(
        `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date,
                               currency, qty_unit, grand_total, status, file_sha256)
         VALUES ('X', $1, $1, $1, $1, $1, 'USD', 'gal', 0, 'imported', repeat('a', 64))`,
        [WEEK_END],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "invoices_billing_week_currency" });
  });
});
