import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { backfillDirectory, type BackfillResult } from "../ingest/backfill.js";
import { findGaps } from "../ingest/gapReport.js";
import { getPool } from "../db/pool.js";

function printResult(result: BackfillResult): void {
  const completed = result.files.filter((f) => f.status === "completed").length;
  const deduped = result.files.filter((f) => f.status === "deduped").length;
  const failed = result.files.filter((f) => f.status === "failed");

  console.log(`files:             ${result.fileCount}`);
  console.log(`completed:         ${completed}`);
  console.log(`deduped:           ${deduped}`);
  console.log(`failed:            ${failed.length}`);

  if (failed.length > 0) {
    console.log("failures:");
    for (const file of failed) {
      console.log(`  ${file.filename}: ${file.error ?? "unknown error"}`);
    }
  }

  const effectiveDates = result.files
    .map((f) => f.report?.effectiveDate)
    .filter((date): date is string => Boolean(date));

  if (effectiveDates.length > 0) {
    const sorted = [...effectiveDates].sort();
    const start = sorted[0]!;
    const end = sorted[sorted.length - 1]!;
    const gaps = findGaps(effectiveDates, { start, end });
    console.log(`date range:        ${start} .. ${end}`);
    console.log(`gaps:              ${gaps.length > 0 ? gaps.join(", ") : "none"}`);
  }
}

/**
 * argv and stdout, nothing else — same split as `cli/ingest.ts`. A per-file
 * failure is reported, not a reason to exit non-zero: that is the entire
 * point of batching (BUILD-PLAN 7.1), so only a failure to even start the
 * run (bad directory, etc.) fails the process.
 */
export async function runBackfillCli(argv: string[], pool: Pool): Promise<number> {
  const dirPath = argv[0];
  if (!dirPath) {
    console.error("usage: backfill <directory>");
    return 1;
  }

  try {
    const result = await backfillDirectory(pool, dirPath);
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
  runBackfillCli(process.argv.slice(2), pool)
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
