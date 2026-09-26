import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { ingestFile } from "../ingest/ingestFile.js";
import type { IngestReport } from "../ingest/report.js";
import { getPool } from "../db/pool.js";

function printReport(report: IngestReport): void {
  if (report.deduped) {
    console.log(
      `already imported — ${report.sourceFilename} (sha256 ${report.fileSha256}) unchanged`,
    );
  }
  console.log(`file:              ${report.sourceFilename}`);
  console.log(`company id:        ${report.companyId}`);
  console.log(`effective date:    ${report.effectiveDate}`);
  console.log(`rows read:         ${report.rowsRead}`);
  console.log(`rows accepted:     ${report.rowsAccepted}`);
  console.log(`rows rejected:     ${report.rowsRejected}`);

  if (report.rejections.length > 0) {
    console.log("rejections:");
    for (const rejection of report.rejections) {
      console.log(
        `  line ${rejection.lineNumber} (site ${rejection.siteRef ?? "?"}): ` +
          `${rejection.code} — ${rejection.message}`,
      );
    }
  }
  if (report.newStations.length > 0) {
    console.log(`new stations:      ${report.newStations.join(", ")}`);
  }
  if (report.unmappedProducts.length > 0) {
    console.log(`unmapped products: ${report.unmappedProducts.join(", ")}`);
  }
  if (report.vanishedStations.length > 0) {
    console.log(`vanished stations: ${report.vanishedStations.join(", ")}`);
  }
}

/**
 * argv and stdout, nothing else (§13's rule for the API layer applies here
 * too). Returns the process exit code rather than setting it directly, so
 * this is testable without spawning a subprocess.
 */
export async function runIngestCli(argv: string[], pool: Pool): Promise<number> {
  const filePath = argv[0];
  if (!filePath) {
    console.error("usage: ingest <file>");
    return 1;
  }

  try {
    const buffer = readFileSync(filePath);
    const report = await ingestFile(pool, buffer, {
      sourceFilename: path.basename(filePath),
    });
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
  runIngestCli(process.argv.slice(2), pool)
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
