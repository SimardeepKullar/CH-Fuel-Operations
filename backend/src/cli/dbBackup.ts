import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, formatTarget, resolveAppEnv } from "../config/env.js";
import { backupDatabase, realBackupDeps, ROOT_DIR } from "../db/backup.js";
import "../db/pool.js";

/**
 * `npm run db:backup` (T-101): an exact, counted pg_dump of the current
 * APP_ENV's database into backups/ (gitignored — it holds real data). Read-only,
 * so any environment may be backed up; the target is printed first, never the
 * credentials. A remote (Neon) target is unit-tested only, not yet run against
 * a real Neon server — see db/backup.ts.
 */

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exitCode = 1;
  } else {
    const appEnv = resolveAppEnv(process.env);
    console.error(`backing up ${formatTarget(describeTarget(appEnv, url))}`);
    backupDatabase(url, appEnv, realBackupDeps)
      .then(({ file, countsFile, counts }) => {
        console.log(`dump    ${path.relative(ROOT_DIR, file)}`);
        console.log(`counts  ${path.relative(ROOT_DIR, countsFile)} (${Object.keys(counts).length} tables)`);
      })
      .catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      });
  }
}
