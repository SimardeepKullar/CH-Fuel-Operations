import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { getPool } from "../db/pool.js";
import { reresolve, type ReresolveReport } from "../resolve/reresolve.js";

function printReport(report: ReresolveReport): void {
  console.log(`fuel stops scanned:      ${report.fuelStopsScanned}`);
  console.log(`express charges scanned: ${report.expressChargesScanned}`);
  console.log(`changes:                 ${report.changes.length}`);
  for (const change of report.changes) {
    console.log(
      `  ${change.subjectType} ${change.subjectId}: ${change.field} ${change.before ?? "null"} -> ${change.after ?? "null"}`,
    );
  }
}

function parseDateArg(raw: string | undefined, label: string): Date | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`invalid ${label}: "${raw}"`);
  }
  return date;
}

/**
 * argv and stdout, nothing else — same split as `cli/ingest.ts` and
 * `cli/backfill.ts`. Re-resolution is deliberate (D14): this is the only
 * caller of `reresolve()`, and it never runs implicitly.
 */
export async function runReresolveCli(argv: string[], pool: Pool): Promise<number> {
  const [fromStr, toStr] = argv;

  try {
    const from = parseDateArg(fromStr, "from date");
    const to = parseDateArg(toStr, "to date");
    const report = await reresolve(pool, { from, to });
    printReport(report);
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
  runReresolveCli(process.argv.slice(2), pool)
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
