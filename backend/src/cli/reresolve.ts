import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { getPool, currentTarget } from "../db/pool.js";
import { reresolve, type FlagChange, type ReresolveReport } from "../resolve/reresolve.js";

function printReport(report: ReresolveReport): void {
  if (report.dryRun) {
    console.log("dry run — nothing was written");
  }
  console.log(`fuel stops scanned:      ${report.fuelStopsScanned}`);
  console.log(`express charges scanned: ${report.expressChargesScanned}`);
  console.log(`invoices rebuilt:        ${report.invoicesRebuilt}`);
  console.log(`changes:                 ${report.changes.length}`);
  for (const change of report.changes) {
    console.log(
      `  ${change.subjectType} ${change.subjectId}: ${change.field} ${change.before ?? "null"} -> ${change.after ?? "null"}`,
    );
  }
  const count = (kind: FlagChange["change"]) => report.flags.filter((f) => f.change === kind).length;
  console.log(
    `flags:                   ${count("cleared")} cleared, ${count("appeared")} appeared, ${count("changed")} changed`,
  );
  for (const flag of report.flags) {
    console.log(`  ${flag.change} ${flag.rule} on fuel_stop ${flag.stopId}`);
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
 * `cli/backfill.ts`: `[from] [to] [--dry-run]`. A manual tool (D14): the
 * assignment write paths re-resolve their own driver's stops, so a Settings
 * save no longer depends on someone running this. `--dry-run` prints the same
 * diff and writes nothing.
 */
export async function runReresolveCli(argv: string[], pool: Pool): Promise<number> {
  const dryRun = argv.includes("--dry-run");
  const [fromStr, toStr] = argv.filter((arg) => arg !== "--dry-run");

  try {
    const from = parseDateArg(fromStr, "from date");
    const to = parseDateArg(toStr, "to date");
    const report = await reresolve(pool, { from, to, dryRun });
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
  console.error(currentTarget());
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
