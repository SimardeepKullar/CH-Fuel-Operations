import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { ExpressChargesResult } from "../../src/actuals/otherCharges.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";
import { normalizeName } from "../../src/resolve/normalizeName.js";
import { realName } from "../support/realNames.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realCsvPath = path.join(dirname, "../../../data/bvd-invoices/invoice_999210.csv");
const realPdfPath = path.join(dirname, "../../../data/bvd-invoices/BVD_invoice_999210.pdf");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealFixtures = existsSync(realCsvPath) && existsSync(realPdfPath);

async function scopedSchema(
  prefix: string,
  dir: string = migrationsDir,
): Promise<{ adminPool: Pool; scopedPool: Pool; schema: string }> {
  const schema = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scopedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  await runMigrations(scopedPool, dir);
  return { adminPool, scopedPool, schema };
}

async function teardown(adminPool: Pool, scopedPool: Pool, schema: string): Promise<void> {
  await scopedPool.end();
  await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
}

async function getExpressCharges(app: App, week: string): Promise<ExpressChargesResult> {
  const response = await app.handle(new Request(`http://localhost/api/v1/express-charges?week=${week}`));
  expect(response.status).toBe(200);
  return (await response.json()) as ExpressChargesResult;
}

/**
 * Hand-built rows, not an import: this is about how the endpoint *shapes*
 * what is stored, so each row is exactly the state under test. Resolution
 * itself is `importInvoice`'s job and is exercised in the 999210 block below.
 */
describe.skipIf(!hasDatabase)("GET /express-charges (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let driverId: string;
  let truckId: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_express_charges"));
    app = createApp({ pool: scopedPool });

    await scopedPool.query(
      `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date, currency, qty_unit, grand_total, status, file_sha256)
       VALUES ('T36-TEST', '2026-03-01', '2026-03-07', '2026-03-07', '2026-03-08', '2026-03-09', 'USD', 'gal', 0, 'imported', repeat('0', 64))`,
    );
    const invoiceId = (await scopedPool.query<{ id: string }>("SELECT id FROM invoices WHERE invoice_number = 'T36-TEST'"))
      .rows[0]!.id;
    driverId = (
      await scopedPool.query<{ id: string }>("INSERT INTO drivers (display_name) VALUES ('T36 DRIVER') RETURNING id")
    ).rows[0]!.id;
    truckId = (await scopedPool.query<{ id: string }>("INSERT INTO trucks (unit_number) VALUES ('T36-1') RETURNING id"))
      .rows[0]!.id;

    // Later row first, so the ordering assertion can't pass by insertion order.
    await scopedPool.query(
      `INSERT INTO express_charges
         (invoice_id, express_code, occurred_at, truck_id, unit_raw, driver_id, driver_name_raw,
          amount, fee, total, payee, note, category, match_status)
       VALUES
         ($1, 'X2', '2026-03-03T10:00:00Z', NULL, NULL, NULL, NULL, 200.00, 3.00, 203.00, 'lumper fees', '  Lumper ', NULL, 'unmatched'),
         ($1, 'X1', '2026-03-02T10:00:00Z', $2, '  T36-1 ', $3, 'T36 driver', 110.00, 3.00, 113.00, NULL, 'repair', 'Repairs', 'matched')`,
      [invoiceId, truckId, driverId],
    );
    await scopedPool.query(
      "UPDATE express_charges SET trailer_raw = 'TR-9', cdl_raw = 'CDL-1', trip_number_raw = '4455' WHERE express_code = 'X1'",
    );
  });

  afterEach(async () => {
    await teardown(adminPool, scopedPool, schema);
  });

  it("returns rows oldest-first with the driver resolved on a matched row", async () => {
    const result = await getExpressCharges(app, "2026-03-07");

    expect(result.week).toBe("2026-03-07");
    expect(result.currency).toBe("USD");
    expect(result.rows.map((r) => r.expressCode)).toEqual(["X1", "X2"]);
    expect(result.rows[0]).toMatchObject({
      matchStatus: "matched",
      driver: { id: driverId, displayName: "T36 DRIVER" },
      driverNameRaw: "T36 driver",
      truck: { id: truckId, unitNumber: "T36-1" },
    });
  });

  it("a blank driver is a null driver and null raw name, unmatched — never a guess", async () => {
    const blank = (await getExpressCharges(app, "2026-03-07")).rows[1]!;

    expect(blank.driver).toBeNull();
    expect(blank.driverNameRaw).toBeNull();
    expect(blank.matchStatus).toBe("unmatched");
  });

  it("a null truck is passed through as null — a CSV import's property, not an error", async () => {
    const blank = (await getExpressCharges(app, "2026-03-07")).rows[1]!;

    expect(blank.truck).toBeNull();
    expect(blank.unitRaw).toBeNull();
  });

  it("keeps the fee separate: per row, and as its own total beside the amount total", async () => {
    const result = await getExpressCharges(app, "2026-03-07");

    expect(result.rows[1]).toMatchObject({ amount: 200, fee: 3, total: 203 });
    expect(result.totals).toEqual({ count: 2, amount: 310, fee: 6, total: 316, currency: "USD" });
  });

  it("returns note, category and payee verbatim — including surrounding whitespace, and null category", async () => {
    const [x1, x2] = (await getExpressCharges(app, "2026-03-07")).rows;

    expect(x1).toMatchObject({ note: "repair", category: "Repairs", payee: null });
    expect(x2).toMatchObject({ note: "  Lumper ", category: null, payee: "lumper fees" });
  });

  it("surfaces trailer, CDL and trip number rather than dropping the columns", async () => {
    const [x1, x2] = (await getExpressCharges(app, "2026-03-07")).rows;

    expect(x1).toMatchObject({ trailerRaw: "TR-9", cdlRaw: "CDL-1", tripNumberRaw: "4455" });
    expect(x2).toMatchObject({ trailerRaw: null, cdlRaw: null, tripNumberRaw: null });
  });

  it("a period with no invoice is empty with zero totals, not an error", async () => {
    const result = await getExpressCharges(app, "2026-04-07");

    expect(result).toEqual({
      week: "2026-04-07",
      currency: "USD",
      invoiceId: null,
      rows: [],
      totals: { count: 0, amount: 0, fee: 0, total: 0, currency: "USD" },
    });
  });

  it("400s a malformed period through the app", async () => {
    const response = await app.handle(new Request("http://localhost/api/v1/express-charges?week=nope"));
    expect(response.status).toBe(400);
  });
});

/**
 * The real invoice. Migration 0004 seeds a driver roster but *no aliases*, so
 * what resolves on the PDF is exactly what matches a `drivers.display_name`
 * after normalisation — and this block asserts that, not an assumed alias.
 */
describe.skipIf(!hasDatabase || !hasRealFixtures)("GET /express-charges on 999210 (integration, local fixture only)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let app: App;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await scopedSchema("test_express_charges_999210", realMigrationsDir));
    app = createApp({ pool: scopedPool });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await teardown(adminPool, scopedPool, schema);
  });

  async function importPdf(): Promise<ExpressChargesResult> {
    expect(await runImportInvoiceCli([realPdfPath], scopedPool)).toBe(0);
    return getExpressCharges(app, await importedPeriod());
  }

  async function importedPeriod(): Promise<string> {
    const { rows } = await scopedPool.query<{ week: string }>(
      "SELECT to_char(billing_week_end, 'YYYY-MM-DD') AS week FROM invoices",
    );
    return rows[0]!.week;
  }

  it("six rows summing to $1,543.13 — the invoice's printed express total — with $18.00 of fees held apart", async () => {
    const result = await importPdf();

    expect(result.rows).toHaveLength(6);
    expect(result.totals).toEqual({
      count: 6,
      amount: 1525.13,
      fee: 18,
      total: 1543.13,
      currency: "USD",
    });
    for (const row of result.rows) {
      expect(row.fee).toBe(3);
      expect(row.total).toBeCloseTo(row.amount + row.fee, 2);
    }
  });

  it("the blank-driver row (tractor 073, $200.00 + $3.00 = $203.00) has a null driver and is unmatched", async () => {
    const result = await importPdf();
    const blank = result.rows.find((r) => r.driverNameRaw === null)!;

    expect(result.rows.filter((r) => r.driverNameRaw === null)).toHaveLength(1);
    expect(blank).toMatchObject({
      driver: null,
      matchStatus: "unmatched",
      unitRaw: "073",
      amount: 200,
      fee: 3,
      total: 203,
    });
    // On the real PDF, "lumper" / "repair" arrive in the Payee column: `note`
    // and `category` are null on all six rows. The endpoint returns each
    // column as stored rather than promoting one into the other.
    expect(blank.payee).toBe("lumper");
    expect(blank.note).toBeNull();
  });

  it("with no aliases seeded, only a name equal to a roster display name resolves; the two express names spelled otherwise do not", async () => {
    const result = await importPdf();
    const byName = new Map(result.rows.map((r) => [r.driverNameRaw, r]));

    expect(byName.get(realName("expressCharges.rosterSpelledDriver"))).toMatchObject({
      matchStatus: "matched",
      driver: { displayName: realName("expressCharges.rosterDisplayName") },
    });
    expect(byName.get(realName("expressCharges.aliasedRawName"))).toMatchObject({ matchStatus: "unmatched", driver: null, unitRaw: "1017", payee: "repair" });
    expect(byName.get(realName("pdf999210.expressDriver6552061"))).toMatchObject({ matchStatus: "unmatched", driver: null, unitRaw: "1019" });
  });

  it("an alias added before import resolves one of those names; the other stays flagged, and the raw text is untouched", async () => {
    const { rows } = await scopedPool.query<{ id: string }>("SELECT id FROM drivers WHERE display_name = $1", [realName("expressCharges.aliasTargetDriver")]);
    await scopedPool.query(
      "INSERT INTO driver_aliases (alias_normalized, driver_id, source, confirmed_at) VALUES ($1, $2, 'test', now())",
      [normalizeName(realName("expressCharges.aliasedRawName")), rows[0]!.id],
    );

    const result = await importPdf();
    const byName = new Map(result.rows.map((r) => [r.driverNameRaw, r]));

    expect(byName.get(realName("expressCharges.aliasedRawName"))).toMatchObject({
      driverNameRaw: realName("expressCharges.aliasedRawName"),
      matchStatus: "matched",
      driver: { id: rows[0]!.id, displayName: realName("expressCharges.aliasTargetDriver") },
    });
    expect(byName.get(realName("pdf999210.expressDriver6552061"))).toMatchObject({ matchStatus: "unmatched", driver: null });
  });

  it("a CSV import returns the same six rows and $1,543.13, with every truck and driver null — a property of the file", async () => {
    expect(await runImportInvoiceCli([realCsvPath], scopedPool)).toBe(0);

    const result = await getExpressCharges(app, await importedPeriod());

    expect(result.totals.total).toBe(1543.13);
    expect(result.rows).toHaveLength(6);
    for (const row of result.rows) {
      expect(row.truck).toBeNull();
      expect(row.unitRaw).toBeNull();
      expect(row.driver).toBeNull();
      expect(row.matchStatus).toBe("unmatched");
    }
  });
});
