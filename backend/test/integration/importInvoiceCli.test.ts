import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixturesDir = path.join(dirname, "../fixtures/invoices");
const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * The CSV export names the invoice nowhere in its contents, so the filename
 * is the only source of the invoice number. The committed fixtures are named
 * for what they demonstrate rather than for an invoice, so they are copied to
 * BVD-style names here — which is also what the CLI will be handed in real
 * use.
 */
let tempDir: string;
let BALANCED_PATH: string;
let IMBALANCED_PATH: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "ch-import-cli-"));
  BALANCED_PATH = path.join(tempDir, "invoice_100001.csv");
  IMBALANCED_PATH = path.join(tempDir, "invoice_100002.csv");
  copyFileSync(path.join(fixturesDir, "sample-redacted.csv"), BALANCED_PATH);
  copyFileSync(path.join(fixturesDir, "sample-redacted-imbalanced.csv"), IMBALANCED_PATH);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe.skipIf(!hasDatabase)("runImportInvoiceCli (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    schema = `test_import_invoice_cli_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);

    // Synthetic catalog rows matching the fixtures' card/unit numbers, so
    // fuel_stops.card_id / express_charges.truck_id resolve (same setup as
    // importInvoice.test.ts). ON CONFLICT DO NOTHING because 0004's real
    // fleet seed already includes unit "101".
    await scopedPool.query(
      "INSERT INTO fuel_cards (card_number) VALUES ('1000001'), ('1000002'), ('1000003') ON CONFLICT DO NOTHING",
    );
    await scopedPool.query(
      "INSERT INTO trucks (unit_number) VALUES ('101'), ('102') ON CONFLICT DO NOTHING",
    );

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("prints the report and exits 0 on a balanced file", async () => {
    const exitCode = await runImportInvoiceCli([BALANCED_PATH], scopedPool);

    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("balanced:            true");
  });

  it("exits non-zero with the imbalance on stderr for a quarantined file", async () => {
    const exitCode = await runImportInvoiceCli([IMBALANCED_PATH], scopedPool);

    expect(exitCode).not.toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
    const printedErr = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printedErr).toContain("AMOUNT_IMBALANCE");
    expect(printedErr).toContain("DF");
  });

  it("exits 0 and says so on a duplicate", async () => {
    const first = await runImportInvoiceCli([BALANCED_PATH], scopedPool);
    expect(first).toBe(0);
    logSpy.mockClear();

    const second = await runImportInvoiceCli([BALANCED_PATH], scopedPool);

    expect(second).toBe(0);
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed.toLowerCase()).toContain("already imported");
  });
});
