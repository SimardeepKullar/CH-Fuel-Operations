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
 * `APP_ENV=production npm run db:migrate:prod [-- --confirm]` (T-103).
 *
 * Applies migrations/real to the production database — and nothing else. It
 * never resets, seeds, drops or truncates: this module reaches only
 * runMigrations, and migrateProd.test.ts proves there is no import path from
 * here to a reset. Without --confirm it prints what it would do and applies
 * nothing.
 *
 * Unit-tested against a fake pool only; not yet run against a real Neon server.
 */

const RECOMMENDED_MAJOR = 16;

/** The slice of pg's Pool this command uses. */
export type ProdPool = Pick<Pool, "query" | "connect" | "end">;

export interface MigrateProdDeps {
  createPool(url: string): ProdPool;
  syntheticDir: string;
  realDir: string;
  log(line: string): void;
  now(): Date;
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
): Promise<MigrateProdResult> {
  const appEnv = resolveAppEnv(env);
  if (appEnv !== "production") {
    throw new Error(
      `db:migrate:prod requires APP_ENV=production (got ${appEnv ?? "unset"}); PowerShell: $env:APP_ENV='production'; npm run db:migrate:prod`,
    );
  }
  if (argv.some((arg) => arg !== "--confirm")) {
    throw new Error("usage: npm run db:migrate:prod [-- --confirm]; --confirm is the only argument");
  }
  const confirmed = argv.includes("--confirm");
  if (!url) {
    throw new Error("DATABASE_URL is not set; create .env.production.local with the Neon direct connection string (it is yours to create)");
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
  migrateProd(process.env.DATABASE_URL, process.env, process.argv.slice(2), realDeps).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
