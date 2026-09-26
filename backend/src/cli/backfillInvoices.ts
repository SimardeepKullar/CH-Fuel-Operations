import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import {
  backfillInvoiceDirectory,
  type BackfillInvoicesResult,
} from "../invoice/backfillInvoices.js";
import { invoiceGaps } from "../invoice/invoiceGapReport.js";
import { getPool } from "../db/pool.js";

function printResult(result: BackfillInvoicesResult): void {
  const imported = result.files.filter((f) => f.status === "imported").length;
  const duplicate = result.files.filter((f) => f.status === "duplicate").length;
  const quarantined = result.files.filter((f) => f.status === "quarantined").length;
  const conflicts = result.files.filter((f) => f.status === "conflict");
  const skipped = result.files.filter((f) => f.status === "skipped");
  const failed = result.files.filter((f) => f.status === "failed");

  console.log(`files:             ${result.fileCount}`);
  console.log(`imported:          ${imported}`);
  console.log(`duplicate:         ${duplicate}`);
  console.log(`quarantined:       ${quarantined}`);
  console.log(`conflict:          ${conflicts.length}`);
  console.log(`skipped:           ${skipped.length}`);
  console.log(`failed:            ${failed.length}`);

  if (conflicts.length > 0) {
    console.log("conflicts:");
    for (const file of conflicts) {
      console.log(`  ${file.filename}: ${file.message ?? "unknown conflict"}`);
    }
  }
  if (skipped.length > 0) {
    console.log("skipped:");
    for (const file of skipped) {
      console.log(`  ${file.filename}: ${file.message ?? "skipped"}`);
    }
  }
  if (failed.length > 0) {
    console.log("failures:");
    for (const file of failed) {
      console.log(`  ${file.filename}: ${file.error ?? "unknown error"}`);
    }
  }

  const periods = result.files
    .map((f) => f.report)
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  if (periods.length > 0) {
    const start = [...periods].sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0]!
      .periodStart;
    const end = [...periods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))[
      periods.length - 1
    ]!.periodEnd;
    const gaps = invoiceGaps(periods, { start, end });
    console.log(`period range:      ${start} .. ${end}`);
    console.log(`gaps:              ${gaps.length > 0 ? gaps.join(", ") : "none"}`);
  }
}

/**
 * argv and stdout, nothing else — same split as `cli/backfill.ts` and
 * `cli/importInvoice.ts`. A per-file failure, conflict, or skip is reported,
 * not a reason to exit non-zero: that is the entire point of batching
 * (BUILD-PLAN 7.1/48.1), so only a failure to even start the run (bad
 * directory, etc.) fails the process.
 */
export async function runBackfillInvoicesCli(argv: string[], pool: Pool): Promise<number> {
  const dirPath = argv[0];
  if (!dirPath) {
    console.error("usage: backfill-invoices <directory>");
    return 1;
  }

  try {
    const result = await backfillInvoiceDirectory(pool, dirPath);
    printResult(result);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const pool = getPool();
  runBackfillInvoicesCli(process.argv.slice(2), pool)
    .then(async (exitCode) => {
      process.exitCode = exitCode;
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      await pool.end();
    });
}
