import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { PeriodWeek } from "../../src/api/routes/periods.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import {
  WEEK_END,
  imbalancedUsInWeek,
  importCa,
  importUs,
  redatedCsv,
  secondUsInWeek,
  seedUsFixtureRoster,
  usInWeek,
} from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const get = (app: App, path: string) => app.handle(new Request(`http://localhost/api/v1${path}`));
const patch = (app: App, id: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost/api/v1/invoices/${id}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

/** T-63 step 63.2 — weeks, not invoices, are listed; an invoice can be moved. */
describe.skipIf(!hasDatabase)("GET /periods and PATCH /invoices/{id} (integration, T-63)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_periods_route"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  const idOf = async (invoiceNumber: string): Promise<string> =>
    (await pool.query<{ id: string }>("SELECT id FROM invoices WHERE invoice_number = $1", [invoiceNumber])).rows[0]!.id;

  const periods = async (): Promise<PeriodWeek[]> =>
    ((await (await get(app, "/periods")).json()) as { weeks: PeriodWeek[] }).weeks;

  it("lists weeks newest first, USD before CAD, with datesDiffer on the CA invoice only", async () => {
    await importUs(pool, redatedCsv("sample-redacted-2.csv", { "2026-01-19": "2026-09-02" }), "invoice_100002.csv");
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    await importCa(pool);

    const weeks = await periods();
    expect(weeks.map((w) => w.weekEnd)).toEqual([WEEK_END, "2026-09-02"]);

    expect(weeks[0]!.invoices).toEqual([
      {
        id: await idOf("100001"),
        invoiceNumber: "100001",
        currency: "USD",
        printedStart: "2026-09-07",
        printedEnd: WEEK_END,
        actualStart: "2026-09-07",
        actualEnd: WEEK_END,
        datesDiffer: false,
      },
      {
        id: await idOf("700001"),
        invoiceNumber: "700001",
        currency: "CAD",
        printedStart: "2026-08-01",
        printedEnd: WEEK_END,
        actualStart: "2026-09-03",
        actualEnd: "2026-09-10",
        datesDiffer: true,
      },
    ]);
    expect(weeks[1]!.invoices).toHaveLength(1);
    expect(weeks[1]!.invoices[0]).toMatchObject({ invoiceNumber: "100002", datesDiffer: false });
  });

  it("offers no week for a quarantined invoice, and an empty list when nothing is imported", async () => {
    expect(await periods()).toEqual([]);
    await importUs(pool, imbalancedUsInWeek(), "invoice_100003.csv");
    expect(await periods()).toEqual([]);
  });

  it("moves an invoice to another week, and /periods follows", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    await importCa(pool);
    const caId = await idOf("700001");

    const response = await patch(app, caId, { billingWeekEnd: "2026-09-16" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: caId,
      billingWeekEnd: "2026-09-16",
      periodEnd: WEEK_END,
      actualStart: "2026-09-03",
      datesDiffer: true,
    });

    const weeks = await periods();
    expect(weeks.map((w) => [w.weekEnd, w.invoices.map((i) => i.invoiceNumber)])).toEqual([
      ["2026-09-16", ["700001"]],
      [WEEK_END, ["100001"]],
    ]);
  });

  it("answers 409 problem+json, naming the holder, when the target week already has an invoice of that currency", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    await importUs(pool, redatedCsv("sample-redacted-2.csv", { "2026-01-19": "2026-09-02" }), "invoice_100002.csv");

    const response = await patch(app, await idOf("100002"), { billingWeekEnd: WEEK_END });
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(((await response.json()) as { detail: string }).detail).toContain("100001");

    expect((await periods()).map((w) => w.weekEnd)).toEqual([WEEK_END, "2026-09-02"]);
  });

  it("lets a US invoice share a week with a CA one, and is a no-op onto its own week", async () => {
    await importUs(pool, secondUsInWeek(), "invoice_100002.csv");
    await importCa(pool);
    expect((await patch(app, await idOf("100002"), { billingWeekEnd: WEEK_END })).status).toBe(200);
    expect((await patch(app, await idOf("700001"), { billingWeekEnd: WEEK_END })).status).toBe(200);
  });

  it("rejects a missing, extra or malformed body with 400, and an unknown id with 404", async () => {
    await importUs(pool, usInWeek(), "invoice_100001.csv");
    const id = await idOf("100001");

    for (const body of [{}, { billingWeekEnd: "2026-9-9" }, { billingWeekEnd: "2026-13-45" }, { billingWeekEnd: WEEK_END, status: "x" }, "not json"]) {
      const response = await patch(app, id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
    }
    expect((await patch(app, "00000000-0000-0000-0000-000000000000", { billingWeekEnd: WEEK_END })).status).toBe(404);
    expect((await patch(app, "not-a-uuid", { billingWeekEnd: WEEK_END })).status).toBe(404);
  });

  it("carries the billing week and actual range on GET /invoices", async () => {
    await importCa(pool);
    const body = (await (await get(app, "/invoices")).json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows[0]).toMatchObject({
      invoiceNumber: "700001",
      currency: "CAD",
      grandTotal: 3839.54,
      billingWeekEnd: WEEK_END,
      actualStart: "2026-09-03",
      actualEnd: "2026-09-10",
      datesDiffer: true,
    });
    expect(body.rows[0]).not.toHaveProperty("grandTotalUsd");
  });
});
