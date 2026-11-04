import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `npm run db:nuke -- --yes-delete-every-local-database` (T-100): the old
 * `docker compose down -v`, kept for a wedged volume but renamed and behind a
 * flag so it is never typed by habit. It deletes every local database —
 * ch_fuel_dev, ch_fuel_test, ch_fuel_real and anything else in the volume.
 * To start one database over, use `db:reset` or `db:reset:real` instead.
 */
export const NUKE_FLAG = "--yes-delete-every-local-database";

export function nukeDecision(argv: readonly string[]): "run" | "refuse" {
  return argv.includes(NUKE_FLAG) ? "run" : "refuse";
}

const WARNING = `WARNING: db:nuke runs \`docker compose down -v\`. It deletes the whole Docker
volume — every local database (ch_fuel_dev, ch_fuel_test, ch_fuel_real and any
other) and every row entered through the app. Nothing here can rebuild data
that did not come from files. To start one database over, use \`npm run db:reset\`
or \`npm run db:reset:real\` instead.`;

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  console.error(WARNING);
  if (nukeDecision(process.argv.slice(2)) === "refuse") {
    console.error(`\nRefusing. Re-run as: npm run db:nuke -- ${NUKE_FLAG}`);
    process.exitCode = 1;
  } else {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const result = spawnSync("docker", ["compose", "down", "-v"], { cwd: rootDir, stdio: "inherit" });
    process.exitCode = result.status ?? 1;
  }
}
