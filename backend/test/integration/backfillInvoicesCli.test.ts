import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBackfillInvoicesCli } from "../../src/cli/backfillInvoices.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const realMigrationsDir = path.join(dirname, "../../../migrations/real");
const realDataDir = path.join(dirname, "../../../data/bvd-invoices");
const hasDatabase = Boolean(process.env.DATABASE_URL);
const hasRealCorpus =
  existsSync(path.join(realDataDir, "invoice_999210.csv")) && existsSync(path.join(realDataDir, "BVD_invoice_999210.pdf"));

/**
 * A minimal, always-balanced one-line CSV invoice for a given transaction
 * date — enough to exercise `periodStart`/`periodEnd` and gap arithmetic
 * without pulling in a full fixture per date. Every call uses the same
 * card/unit (seeded below) and a fresh auth code so distinct dates never
 * collide inside one invoice.
 */
function makeMinimalInvoiceCsv(dateIso: string): Buffer {
  return Buffer.from(
    [
      "Fuel Card Transactions",
      "Transactions for Card # 1000001",
      "Auth Code, Driver Name, Unit #, Date, Site #, Site Name, Site City, Prov/ST, Prod, QTY, Retail, Billed, Pre Tax AMT, HST, GST, PST, QST, Disc Rate, Disc AMT, Final AMT, CUR",
      `A1-TA,DRIVER ONE,101,${dateIso} 10:00:00,90001,SAMPLE #1,SAMPLETON,TX,TA,20.00,5.0000,5.0000,100.00,0,0,0,0,0,0,100.00,US,`,
      ",,,,,Transaction Subtotal,,,,20.00,,,100.00,0,0,0,0,,0,100.00,,",
      ",,,,,Card Subtotal,TA,,,20.00,,,100.00,0,0,0,0,0,0,100.00,US,",
      ",,,,,,TF,,,0,,,0,0,0,0,0,0,0,0,US,",
      ",,,,,,Fuel Totals,,,20.00,,,100.00,0,0,0,0,0,0,100.00,US,",
      ",,,,,,DF,,,0,,,0,0,0,0,0,0,0,0,US,",
      ",,,,,,Sub Total,,,,,,100.00,0,0,0,0,,0,100.00,US,",
      "Express Codes",
      "DATE,EXPRESS CODE NUMBER, AUTH CODES, AMOUNT CASHED, FEE, TOTAL, CUR, PAYEE, NOTES",
      "Grand Totals",
      "PRODUCT, QTY, PRE TAX AMT, HST, GST, PST, QST, DISC RATE, DISC AMT, FINAL AMOUNT, CUR",
      "TA,20.00,100.00,0,0,0,0,0,0,100.00,US,",
      "Grand Total,20.00,100.00,0,0,0,0,0,0,100.00,US,",
    ].join("\n"),
    "utf8",
  );
}

/** A structurally wrong fuel-section header — stands in for an older year's
 * sheet shape (A18 Q6). Named with a leading "2016" invoice number so a
 * per-file failure names the year, the way BUILD-PLAN Step 48.2 asks for. */
function shapeShiftedInvoiceCsv(): Buffer {
  return Buffer.from(
    [
      "Fuel Card Transactions",
      "Transactions for Card # 1000001",
      "AUTH,DRIVER,UNIT,DATE,SITE,NAME,CITY,ST,PRODUCT_TYPO,QTY",
      "A1-TA,DRIVER ONE,101,2016-01-05 10:00:00,90001,SAMPLE #1,SAMPLETON,TX,TA,20.00",
    ].join("\n"),
    "utf8",
  );
}

function writeTempDir(files: Array<{ name: string; contents: Buffer }>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ch-backfill-invoices-cli-"));
  for (const file of files) {
    writeFileSync(path.join(dir, file.name), file.contents);
  }
  return dir;
}

describe.skipIf(!hasDatabase)("runBackfillInvoicesCli (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    schema = `test_backfill_invoices_cli_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, hasRealCorpus ? realMigrationsDir : migrationsDir);
    await scopedPool.query(
      "INSERT INTO fuel_cards (card_number) VALUES ('1000001') ON CONFLICT DO NOTHING",
    );
    await scopedPool.query("INSERT INTO trucks (unit_number) VALUES ('101') ON CONFLICT DO NOTHING");
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

  it("reports two separated gaps across three invoices' periods", async () => {
    const dir = writeTempDir([
      { name: "invoice_200001.csv", contents: makeMinimalInvoiceCsv("2026-02-01") },
      { name: "invoice_200002.csv", contents: makeMinimalInvoiceCsv("2026-02-10") },
      { name: "invoice_200003.csv", contents: makeMinimalInvoiceCsv("2026-02-20") },
    ]);

    const exitCode = await runBackfillInvoicesCli([dir], scopedPool);
    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("files:             3");
    expect(printed).toContain("imported:          3");
    expect(printed).toContain("period range:      2026-02-01 .. 2026-02-20");
    expect(printed).toContain("gaps:");
    // The two gap blocks: 02-02..02-09 and 02-11..02-19.
    expect(printed).toContain("2026-02-02");
    expect(printed).toContain("2026-02-09");
    expect(printed).toContain("2026-02-11");
    expect(printed).toContain("2026-02-19");
    // Covered dates never appear as gaps.
    expect(printed).not.toContain("gaps:              2026-02-01,");
  });

  it("reports no gaps for a contiguous range of periods", async () => {
    const dir = writeTempDir([
      { name: "invoice_300001.csv", contents: makeMinimalInvoiceCsv("2026-03-01") },
      { name: "invoice_300002.csv", contents: makeMinimalInvoiceCsv("2026-03-02") },
      { name: "invoice_300003.csv", contents: makeMinimalInvoiceCsv("2026-03-03") },
    ]);

    const exitCode = await runBackfillInvoicesCli([dir], scopedPool);
    expect(exitCode).toBe(0);

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("period range:      2026-03-01 .. 2026-03-03");
    expect(printed).toContain("gaps:              none");
  });

  it("reports a shape-shifted older-year file as a per-file parse failure naming the year, without failing the run", async () => {
    const dir = writeTempDir([
      { name: "invoice_400001.csv", contents: makeMinimalInvoiceCsv("2026-04-01") },
      { name: "invoice_2016005.csv", contents: shapeShiftedInvoiceCsv() },
    ]);

    const exitCode = await runBackfillInvoicesCli([dir], scopedPool);
    expect(exitCode).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("files:             2");
    expect(printed).toContain("imported:          1");
    expect(printed).toContain("failed:            1");
    expect(printed).toContain("failures:");
    expect(printed).toContain("invoice_2016005.csv");
  });

  it("changes nothing on a re-run of the whole directory", async () => {
    const dir = writeTempDir([
      { name: "invoice_500001.csv", contents: makeMinimalInvoiceCsv("2026-05-01") },
      { name: "invoice_500002.csv", contents: makeMinimalInvoiceCsv("2026-05-08") },
    ]);

    const first = await runBackfillInvoicesCli([dir], scopedPool);
    expect(first).toBe(0);

    const countAfterFirst = await scopedPool.query("SELECT count(*) FROM invoices");
    expect(countAfterFirst.rows[0]!.count).toBe("2");

    logSpy.mockClear();
    const second = await runBackfillInvoicesCli([dir], scopedPool);
    expect(second).toBe(0);

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toContain("duplicate:         2");

    const countAfterSecond = await scopedPool.query("SELECT count(*) FROM invoices");
    expect(countAfterSecond.rows[0]!.count).toBe("2");
  });

  describe.skipIf(!hasRealCorpus)("real invoice directory (local fixtures only)", () => {
    it("prefers BVD_invoice_999210.pdf over invoice_999210.csv when both are dropped in data/bvd-invoices", async () => {
      const exitCode = await runBackfillInvoicesCli([realDataDir], scopedPool);
      expect(exitCode).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();

      const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(printed).toContain("skipped:           1");
      expect(printed).toContain("invoice_999210.csv");

      // Asserted per invoice, not as a directory-wide count: other real
      // invoices sit beside it (999217, a CA invoice, imports since T-61).
      const pdfSha = createHash("sha256")
        .update(readFileSync(path.join(realDataDir, "BVD_invoice_999210.pdf")))
        .digest("hex");
      const { rows } = await scopedPool.query<{ file_sha256: string }>(
        "SELECT file_sha256 FROM invoices WHERE invoice_number = '999210'",
      );
      expect(rows).toEqual([{ file_sha256: pdfSha }]);
    });
  });
});
