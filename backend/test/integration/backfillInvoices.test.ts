import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backfillInvoiceDirectory,
  backfillInvoiceFiles,
  type BackfillInvoiceFile,
} from "../../src/invoice/backfillInvoices.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixturesDir = path.join(dirname, "../fixtures/invoices");
const hasDatabase = Boolean(process.env.DATABASE_URL);

const BALANCED_CSV = readFileSync(path.join(fixturesDir, "sample-redacted.csv"));
const IMBALANCED_CSV = readFileSync(path.join(fixturesDir, "sample-redacted-imbalanced.csv"));
const BALANCED_CSV_2 = readFileSync(path.join(fixturesDir, "sample-redacted-2.csv"));
const BALANCED_PDF = readFileSync(path.join(fixturesDir, "sample-redacted.pdf"));

function writeTempDir(files: Array<{ name: string; contents: Buffer }>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ch-backfill-invoices-"));
  for (const file of files) {
    writeFileSync(path.join(dir, file.name), file.contents);
  }
  return dir;
}

async function makeScopedPool(): Promise<{ adminPool: Pool; scopedPool: Pool; schema: string }> {
  const schema = `test_backfill_invoices_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const scopedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  await runMigrations(scopedPool, migrationsDir);
  // Synthetic catalog rows matching the fixtures' card/unit numbers, mirroring
  // importInvoice.test.ts — ON CONFLICT DO NOTHING because 0004's real fleet
  // seed happens to include unit "101" already.
  await scopedPool.query(
    "INSERT INTO fuel_cards (card_number) VALUES ('1000001'), ('1000002'), ('1000003') ON CONFLICT DO NOTHING",
  );
  await scopedPool.query(
    "INSERT INTO trucks (unit_number) VALUES ('101'), ('102'), ('103') ON CONFLICT DO NOTHING",
  );
  return { adminPool, scopedPool, schema };
}

async function dropScopedPool(adminPool: Pool, scopedPool: Pool, schema: string): Promise<void> {
  await scopedPool.end();
  await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await adminPool.end();
}

describe.skipIf(!hasDatabase)("backfillInvoiceFiles (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await makeScopedPool());
  });

  afterEach(async () => {
    await dropScopedPool(adminPool, scopedPool, schema);
  });

  it("completes the batch with 2 imported and 1 quarantined when the middle invoice imbalances", async () => {
    const dir = writeTempDir([
      { name: "invoice_100001.csv", contents: BALANCED_CSV },
      { name: "invoice_100002.csv", contents: IMBALANCED_CSV },
      { name: "invoice_100003.csv", contents: BALANCED_CSV_2 },
    ]);
    const files: BackfillInvoiceFile[] = [
      { filename: "invoice_100001.csv", path: path.join(dir, "invoice_100001.csv") },
      { filename: "invoice_100002.csv", path: path.join(dir, "invoice_100002.csv") },
      { filename: "invoice_100003.csv", path: path.join(dir, "invoice_100003.csv") },
    ];

    const result = await backfillInvoiceFiles(scopedPool, files);

    expect(result.fileCount).toBe(3);
    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toMatchObject({ filename: "invoice_100001.csv", status: "imported" });
    expect(result.files[1]).toMatchObject({ filename: "invoice_100002.csv", status: "quarantined" });
    expect(result.files[2]).toMatchObject({ filename: "invoice_100003.csv", status: "imported" });

    const invoices = await scopedPool.query<{ status: string; count: string }>(
      "SELECT status, count(*) FROM invoices GROUP BY status ORDER BY status",
    );
    expect(invoices.rows).toEqual([
      { status: "imported", count: "2" },
      { status: "quarantined", count: "1" },
    ]);
  });

  it("keeps the quarantined invoice's report and rejections, queued for review", async () => {
    const dir = writeTempDir([{ name: "invoice_100002.csv", contents: IMBALANCED_CSV }]);
    const files: BackfillInvoiceFile[] = [
      { filename: "invoice_100002.csv", path: path.join(dir, "invoice_100002.csv") },
    ];

    const result = await backfillInvoiceFiles(scopedPool, files);

    expect(result.files[0]?.status).toBe("quarantined");
    expect(result.files[0]?.report).toBeDefined();
    expect(result.files[0]?.report?.rejections.length).toBeGreaterThanOrEqual(1);

    const { rows } = await scopedPool.query<{ status: string }>("SELECT status FROM invoices");
    expect(rows).toEqual([{ status: "quarantined" }]);

    const rejections = await scopedPool.query("SELECT count(*) FROM invoice_rejections");
    expect(Number(rejections.rows[0]!.count)).toBeGreaterThanOrEqual(1);
  });

  it("produces identical database state regardless of processing order", async () => {
    const dir = writeTempDir([
      { name: "invoice_100001.csv", contents: BALANCED_CSV },
      { name: "invoice_100002.csv", contents: IMBALANCED_CSV },
      { name: "invoice_100003.csv", contents: BALANCED_CSV_2 },
    ]);
    const inOrder: BackfillInvoiceFile[] = [
      { filename: "invoice_100001.csv", path: path.join(dir, "invoice_100001.csv") },
      { filename: "invoice_100002.csv", path: path.join(dir, "invoice_100002.csv") },
      { filename: "invoice_100003.csv", path: path.join(dir, "invoice_100003.csv") },
    ];
    const shuffled: BackfillInvoiceFile[] = [inOrder[2]!, inOrder[0]!, inOrder[1]!];

    const { adminPool: adminPool2, scopedPool: scopedPool2, schema: schema2 } =
      await makeScopedPool();
    try {
      await backfillInvoiceFiles(scopedPool, inOrder);
      await backfillInvoiceFiles(scopedPool2, shuffled);

      const normalize = async (pool: Pool) => {
        const invoices = await pool.query(
          "SELECT invoice_number, status, grand_total FROM invoices ORDER BY invoice_number",
        );
        const stops = await pool.query(
          `SELECT i.invoice_number, fs.base_auth_code, fs.total
             FROM fuel_stops fs JOIN invoices i ON i.id = fs.invoice_id
            ORDER BY i.invoice_number, fs.base_auth_code`,
        );
        return { invoices: invoices.rows, stops: stops.rows };
      };

      const a = await normalize(scopedPool);
      const b = await normalize(scopedPool2);
      expect(a).toEqual(b);
    } finally {
      await dropScopedPool(adminPool2, scopedPool2, schema2);
    }
  });

  it("records a per-file failure without sinking the batch", async () => {
    const dir = writeTempDir([
      { name: "invoice_100001.csv", contents: BALANCED_CSV },
      { name: "not-an-invoice.txt", contents: Buffer.from("nonsense", "utf8") },
    ]);
    const files: BackfillInvoiceFile[] = [
      { filename: "invoice_100001.csv", path: path.join(dir, "invoice_100001.csv") },
      { filename: "not-an-invoice.txt", path: path.join(dir, "not-an-invoice.txt") },
    ];

    const result = await backfillInvoiceFiles(scopedPool, files);

    expect(result.files[0]?.status).toBe("imported");
    expect(result.files[1]?.status).toBe("failed");
    expect(result.files[1]?.error).toBeTruthy();
  });

  it("reports a conflict distinctly from a failure or a duplicate", async () => {
    const dir = writeTempDir([{ name: "invoice_100001.csv", contents: BALANCED_CSV }]);
    await backfillInvoiceFiles(scopedPool, [
      { filename: "invoice_100001.csv", path: path.join(dir, "invoice_100001.csv") },
    ]);

    const differentBytes = Buffer.from(
      BALANCED_CSV.toString("utf8").replace(
        "DF,5.00,22.50,0,0,0,0,0,0,22.50,US,",
        "DF,5.00,22.51,0,0,0,0,0,0,22.51,US,",
      ),
      "utf8",
    );
    writeFileSync(path.join(dir, "invoice_100001b.csv"), differentBytes);
    const result = await backfillInvoiceFiles(scopedPool, [
      { filename: "invoice_100001.csv", path: path.join(dir, "invoice_100001b.csv") },
    ]);

    expect(result.files[0]?.status).toBe("conflict");
    expect(result.files[0]?.message).toBeTruthy();

    const { rows } = await scopedPool.query("SELECT count(*) FROM invoices");
    expect(rows[0]!.count).toBe("1");
  });
});

describe.skipIf(!hasDatabase)("backfillInvoiceDirectory (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    ({ adminPool, scopedPool, schema } = await makeScopedPool());
  });

  afterEach(async () => {
    await dropScopedPool(adminPool, scopedPool, schema);
  });

  it("prefers the PDF over the CSV for the same invoice key, and reports the CSV as skipped rather than a conflict", async () => {
    const dir = writeTempDir([
      { name: "invoice_100001.csv", contents: BALANCED_CSV },
      { name: "invoice_100001.pdf", contents: BALANCED_PDF },
    ]);

    const result = await backfillInvoiceDirectory(scopedPool, dir);

    expect(result.fileCount).toBe(2);
    const pdfResult = result.files.find((f) => f.filename === "invoice_100001.pdf");
    const csvResult = result.files.find((f) => f.filename === "invoice_100001.csv");
    expect(pdfResult?.status).toBe("imported");
    expect(csvResult?.status).toBe("skipped");
    expect(csvResult?.message).toContain("invoice_100001.pdf");

    // Only the PDF's single import landed — the CSV was never attempted, so
    // there is no conflict row either.
    const invoices = await scopedPool.query("SELECT count(*) FROM invoices");
    expect(invoices.rows[0]!.count).toBe("1");
  });

  it("processes an unpaired CSV normally alongside a paired PDF/CSV", async () => {
    const dir = writeTempDir([
      { name: "invoice_100001.csv", contents: BALANCED_CSV },
      { name: "invoice_100001.pdf", contents: BALANCED_PDF },
      { name: "invoice_100003.csv", contents: BALANCED_CSV_2 },
    ]);

    const result = await backfillInvoiceDirectory(scopedPool, dir);

    expect(result.fileCount).toBe(3);
    const statuses = new Map(result.files.map((f) => [f.filename, f.status]));
    expect(statuses.get("invoice_100001.pdf")).toBe("imported");
    expect(statuses.get("invoice_100001.csv")).toBe("skipped");
    expect(statuses.get("invoice_100003.csv")).toBe("imported");

    const invoices = await scopedPool.query("SELECT count(*) FROM invoices");
    expect(invoices.rows[0]!.count).toBe("2");
  });

  it("ignores files that are neither .csv nor .pdf", async () => {
    const dir = writeTempDir([
      { name: "invoice_100001.csv", contents: BALANCED_CSV },
      { name: "README.md", contents: Buffer.from("not an invoice", "utf8") },
    ]);

    const result = await backfillInvoiceDirectory(scopedPool, dir);

    expect(result.fileCount).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.filename).toBe("invoice_100001.csv");
  });
});
