import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { detectInvoiceFormat } from "./detectFormat.js";
import { importInvoice } from "./importInvoice.js";
import { parseInvoicePdf } from "./parseInvoicePdf.js";
import type { ImportReport } from "./report.js";

export interface BackfillInvoiceFile {
  filename: string;
  path: string;
}

export interface BackfillInvoiceFileResult {
  filename: string;
  status: "imported" | "duplicate" | "quarantined" | "conflict" | "skipped" | "failed";
  report?: ImportReport;
  /** Set on "conflict" (the reason from `importInvoice`) and on "skipped"
   * (why this file lost the PDF/CSV pairing preference). */
  message?: string;
  /** Set on "failed" — a thrown error, not a returned `importInvoice` status. */
  error?: string;
}

export interface BackfillInvoicesResult {
  fileCount: number;
  files: BackfillInvoiceFileResult[];
}

/**
 * Runs a batch of already-resolved invoice files through `importInvoice`,
 * one at a time, recording a per-file result instead of letting one bad or
 * conflicting invoice throw out of the whole run — the same shape as
 * `ingest/backfill.ts`'s `backfillFiles` (T-07), minus a batch row: invoices
 * have no `import_batches` equivalent, and none is needed (T-48 DoD).
 *
 * Order independence comes from `importInvoice`'s own content-hash
 * (`file_sha256`) and invoice-number keying, not from anything here — each
 * file is looked up by its own hash and its own parsed invoice number
 * regardless of what order files arrive in, so a shuffled directory produces
 * identical database state (verified in backfillInvoices.test.ts).
 */
export async function backfillInvoiceFiles(
  pool: Pool,
  files: readonly BackfillInvoiceFile[],
): Promise<BackfillInvoicesResult> {
  const results: BackfillInvoiceFileResult[] = [];

  for (const file of files) {
    try {
      const buffer = readFileSync(file.path);
      const format = detectInvoiceFormat(file.filename, buffer);
      if (format === null) {
        results.push({
          filename: file.filename,
          status: "failed",
          error: `${file.filename}: neither a CSV nor a PDF invoice export`,
        });
        continue;
      }

      const result = await importInvoice(
        pool,
        buffer,
        { sourceFilename: file.filename },
        format === "pdf" ? { parse: parseInvoicePdf } : undefined,
      );

      if (result.status === "conflict") {
        results.push({ filename: file.filename, status: "conflict", message: result.message });
      } else {
        results.push({ filename: file.filename, status: result.status, report: result.report });
      }
    } catch (err) {
      results.push({
        filename: file.filename,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { fileCount: files.length, files: results };
}

/** The last run of digits before the extension — "invoice_999210.csv",
 * "999210.pdf" and "BVD_invoice_999210.pdf" all key to "999210". Best-effort:
 * used only to pair a PDF with its CSV twin, never to derive the invoice
 * number that gets stored (that's `importInvoice`'s own job, per format). */
function invoiceKeyFromFilename(filename: string): string | null {
  const base = filename.replace(/^.*[\\/]/, "");
  return /(\d+)(?=\.[^.]*$)/.exec(base)?.[1] ?? null;
}

interface FormatPair {
  csv?: string;
  pdf?: string;
}

/**
 * Walks a directory of BVD invoice exports and runs them through
 * `backfillInvoiceFiles`. Filenames are grouped by `invoiceKeyFromFilename`
 * first: BVD sends both a PDF and a CSV for the same invoice, and importing
 * both would land the second as a `conflict` (same `invoice_number`,
 * different `file_sha256`) rather than a harmless duplicate — noise that
 * would swamp the real conflicts in the summary. The PDF is the fuller
 * export (D13: it alone carries express tractor/driver and the invoice's own
 * header dates), so where both exist for one key, only the PDF is imported
 * and the CSV is recorded as "skipped" with a reason — never silently
 * dropped, just never attempted.
 *
 * A filename with no discoverable digit run (an oddly-named CSV, say) is
 * processed anyway and left to fail on its own terms — `parseInvoiceCsv`
 * needs the invoice number from the filename and rejects it if it can't find
 * one, which is the correct, reportable outcome (CLAUDE.md: never guessed).
 */
export async function backfillInvoiceDirectory(
  pool: Pool,
  dirPath: string,
): Promise<BackfillInvoicesResult> {
  const filenames = readdirSync(dirPath)
    .filter((name) => {
      const lower = name.toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".pdf");
    })
    .sort();

  const byKey = new Map<string, FormatPair>();
  const unkeyed: string[] = [];

  for (const filename of filenames) {
    const key = invoiceKeyFromFilename(filename);
    if (key === null) {
      unkeyed.push(filename);
      continue;
    }
    const pair = byKey.get(key) ?? {};
    if (filename.toLowerCase().endsWith(".pdf")) {
      pair.pdf = filename;
    } else {
      pair.csv = filename;
    }
    byKey.set(key, pair);
  }

  const files: BackfillInvoiceFile[] = [];
  const skipped: BackfillInvoiceFileResult[] = [];

  for (const key of [...byKey.keys()].sort()) {
    const pair = byKey.get(key)!;
    if (pair.pdf && pair.csv) {
      files.push({ filename: pair.pdf, path: path.join(dirPath, pair.pdf) });
      skipped.push({
        filename: pair.csv,
        status: "skipped",
        message: `${pair.pdf} covers the same invoice (key "${key}") and carries more data — preferred over ${pair.csv}`,
      });
    } else if (pair.pdf) {
      files.push({ filename: pair.pdf, path: path.join(dirPath, pair.pdf) });
    } else if (pair.csv) {
      files.push({ filename: pair.csv, path: path.join(dirPath, pair.csv) });
    }
  }
  for (const filename of unkeyed) {
    files.push({ filename, path: path.join(dirPath, filename) });
  }

  const result = await backfillInvoiceFiles(pool, files);
  return {
    fileCount: result.fileCount + skipped.length,
    files: [...result.files, ...skipped],
  };
}
