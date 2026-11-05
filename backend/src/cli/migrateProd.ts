import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { parse } from "pg-connection-string";
import { describeTarget, formatTarget, resolveAppEnv } from "../config/env.js";
import { runMigrations } from "../db/migrate.js";
import { assertMigrationParity } from "../db/migrationParity.js";
import "../db/pool.js";

/**
 * `APP_ENV=production npm run db:migrate:prod [-- --confirm]` (T-103) and
 * `APP_ENV=preview npm run db:migrate:preview [-- --confirm]` (T-106).
 *
 * Applies migrations/real to one remote Neon database — production or the
 * long-lived `preview` branch — and nothing else. Each script passes its own
 * target, and the target must equal APP_ENV, so neither command can reach the
 * other's database. It never resets, seeds, drops or truncates: this module
 * reaches only runMigrations, and migrateProd.test.ts proves there is no import
 * path from here to a reset. Without --confirm it prints what it would do and
 * applies nothing.
 */

const RECOMMENDED_MAJOR = 18;

/** The slice of pg's Pool this command uses. */
export type ProdPool = Pick<Pool, "query" | "connect" | "end">;

export interface MigrateProdDeps {
  createPool(url: string): ProdPool;
  syntheticDir: string;
  realDir: string;
  log(line: string): void;
  now(): Date;
}

/** The remote databases this command migrates; each has its own npm script. */
export type MigrateTarget = "production" | "preview";

const SCRIPT: Record<MigrateTarget, string> = {
  production: "db:migrate:prod",
  preview: "db:migrate:preview",
};

export function parseTarget(value: string | undefined): MigrateTarget {
  if (value === "production" || value === "preview") return value;
  throw new Error(`migrateProd.ts needs its target as the first argument, production or preview (got ${value ?? "nothing"})`);
}

export interface MigrateProdResult {
  pending: string[];
  applied: string[];
  confirmed: boolean;
}

export async function migrateProd(
  url: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
  deps: MigrateProdDeps,
  target: MigrateTarget = "production",
): Promise<MigrateProdResult> {
  const script = SCRIPT[target];
  const appEnv = resolveAppEnv(env);
  if (appEnv !== target) {
    throw new Error(
      `${script} requires APP_ENV=${target} (got ${appEnv ?? "unset"}); PowerShell: $env:APP_ENV='${target}'; npm run ${script}`,
    );
  }
  if (argv.some((arg) => arg !== "--confirm")) {
    throw new Error(`usage: npm run ${script} [-- --confirm]; --confirm is the only argument`);
  }
  const confirmed = argv.includes("--confirm");
  if (!url) {
    const which = target === "preview" ? "the Neon preview branch's direct connection string" : "the Neon direct connection string";
    throw new Error(`DATABASE_URL is not set; create .env.${target}.local with ${which} (it is yours to create)`);
  }
  const host = parse(url).host ?? "";
  if (host.includes("-pooler")) {
    throw new Error(`refusing a pooler host (${host}); migrations need the direct connection string, not the -pooler one`);
  }
  if (!existsSync(deps.realDir)) {
    throw new Error(`${deps.realDir} does not exist; migrations/real is gitignored, so this runs only from your machine`);
  }
  assertMigrationParity(deps.syntheticDir, deps.realDir);

  deps.log(`target  ${formatTarget(describeTarget(appEnv, url))}`);

  const pool = deps.createPool(url);
  try {
    const version = await serverVersion(pool);
    deps.log(`server  PostgreSQL ${version}`);
    const major = Number.parseInt(version, 10);
    if (major !== RECOMMENDED_MAJOR) {
      deps.log(
        `WARNING: this server is Postgres ${version}, not ${RECOMMENDED_MAJOR}. The local container is ${RECOMMENDED_MAJOR}; ` +
          `a dump from a newer major version cannot be restored into it. This does not block the migration.`,
      );
    }

    const pending = await pendingMigrations(pool, deps.realDir);
    if (pending.length === 0) {
      deps.log("no pending migrations in migrations/real");
    } else {
      deps.log(`pending in migrations/real (${pending.length}):`);
      for (const file of pending) deps.log(`  ${file}`);
    }

    if (!confirmed && target === "preview") {
      deps.log(
        "Nothing applied. Preview is a throwaway copy of production: to undo a migration there, " +
          "use Reset from parent on the preview branch in Neon.\nRe-run with --confirm to apply.",
      );
      return { pending, applied: [], confirmed: false };
    }
    if (!confirmed) {
      const branch = `pre-<ticket>-${deps.now().toISOString().slice(0, 10)}`;
      deps.log(
        `Nothing applied. Before applying, create a Neon snapshot branch from production named ${branch}:\n` +
          `  neon branches create --name ${branch} --parent production\n` +
          `Then re-run with --confirm.`,
      );
      return { pending, applied: [], confirmed: false };
    }

    const applied: string[] = [];
    for (const result of await runMigrations(pool as Pool, deps.realDir)) {
      deps.log(`${result.applied ? "applied" : "skipped"}  ${result.filename}`);
      if (result.applied) applied.push(result.filename);
    }
    return { pending, applied, confirmed: true };
  } finally {
    await pool.end();
  }
}

async function serverVersion(pool: ProdPool): Promise<string> {
  const { rows } = await pool.query<{ server_version: string }>("SHOW server_version");
  return rows[0]?.server_version ?? "unknown";
}

/** migrations/real files not yet in schema_migrations; read-only, and a missing table means all of them. */
async function pendingMigrations(pool: ProdPool, realDir: string): Promise<string[]> {
  const present = await pool.query<{ present: boolean }>("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present");
  const applied = new Set<string>();
  if (present.rows[0]?.present) {
    const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    for (const row of rows) applied.add(row.filename);
  }
  return readdirSync(realDir)
    .filter((file) => file.endsWith(".sql") && !applied.has(file))
    .sort();
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const realDeps: MigrateProdDeps = {
  createPool: (url) => new Pool({ connectionString: url }),
  syntheticDir: path.join(ROOT_DIR, "migrations", "synthetic"),
  realDir: path.join(ROOT_DIR, "migrations", "real"),
  log: (line) => console.log(line),
  now: () => new Date(),
};

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  // package.json passes the target first (db:migrate:prod → production,
  // db:migrate:preview → preview); whatever the user adds after `--` follows it.
  const [targetArg, ...rest] = process.argv.slice(2);
  Promise.resolve()
    .then(() => migrateProd(process.env.DATABASE_URL, process.env, rest, realDeps, parseTarget(targetArg)))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
