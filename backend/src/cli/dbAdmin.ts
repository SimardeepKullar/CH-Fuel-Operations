import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Pool } from "pg";
import { parse } from "pg-connection-string";
import { resolveAppEnv, type AppEnv } from "../config/env.js";
import { assertSafeToDestroy, DESTROYABLE_DATABASES } from "../db/guard.js";
import { runMigrations } from "../db/migrate.js";
import { currentTarget } from "../db/pool.js";

/**
 * `dbAdmin create` and `dbAdmin reset <name>` (T-100): one database at a time,
 * through the T-99 guard — never `docker compose down -v`, which deletes every
 * database in the volume.
 */

/**
 * Not template_postgis: it already has PostGIS (and topology, tiger) installed,
 * so a pg_restore of a dump — which carries its own CREATE EXTENSION — fails
 * with "extension already exists". Migrations 0001 and 0003 create postgis and
 * btree_gist themselves.
 */
export const CREATE_TEMPLATE = "template1";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export interface AdminDeps {
  /** A connection to the server's `postgres` maintenance database. */
  connectMaintenance(url: string): Promise<Queryable>;
  migrate(url: string, migrationsDir: string): Promise<void>;
  /** Dumps a database to backups/ and returns the file; throws if anything fails. */
  dump(database: string, url: string): Promise<string>;
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function maintenanceUrl(url: string): string {
  return withDatabase(url, "postgres");
}

export function migrationsDirFor(appEnv: AppEnv | undefined): string {
  return path.join(ROOT_DIR, "migrations", appEnv === "real" ? "real" : "synthetic");
}

/** Database names come only from DESTROYABLE_DATABASES: an identifier cannot be a bind parameter. */
function ident(database: string): string {
  if (!(DESTROYABLE_DATABASES as readonly string[]).includes(database)) {
    throw new Error(`refusing to name database "${database}" in SQL`);
  }
  return `"${database}"`;
}

async function exists(client: Queryable, database: string): Promise<boolean> {
  const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  return rows.length > 0;
}

/** Creates whichever of ch_fuel_dev, ch_fuel_test and ch_fuel_real is missing. Never drops. */
export async function createDatabases(
  url: string,
  env: Readonly<Record<string, string | undefined>>,
  deps: AdminDeps,
): Promise<Array<{ database: string; created: boolean }>> {
  for (const database of DESTROYABLE_DATABASES) {
    assertSafeToDestroy(withDatabase(url, database), env);
  }

  const client = await deps.connectMaintenance(maintenanceUrl(url));
  const results: Array<{ database: string; created: boolean }> = [];
  try {
    for (const database of DESTROYABLE_DATABASES) {
      if (await exists(client, database)) {
        results.push({ database, created: false });
        continue;
      }
      await client.query(`CREATE DATABASE ${ident(database)} TEMPLATE ${CREATE_TEMPLATE}`);
      results.push({ database, created: true });
    }
  } finally {
    await client.end();
  }
  return results;
}

/**
 * Drops and recreates one database, then migrates it. `name` must match
 * DATABASE_URL's database — typing it is the confirmation. ch_fuel_real is
 * dumped to backups/ first, and a failed dump aborts before anything is dropped.
 */
export async function resetDatabase(
  name: string,
  url: string,
  env: Readonly<Record<string, string | undefined>>,
  deps: AdminDeps,
): Promise<{ backup?: string }> {
  assertSafeToDestroy(url, env);
  const database = parse(url).database ?? "";
  if (name !== database) {
    throw new Error(`reset ${name} does not match DATABASE_URL's database "${database}"; check APP_ENV`);
  }

  let backup: string | undefined;
  const client = await deps.connectMaintenance(maintenanceUrl(url));
  try {
    if (database === "ch_fuel_real" && (await exists(client, database))) {
      backup = await deps.dump(database, url);
    }
    await client.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${ident(database)} TEMPLATE ${CREATE_TEMPLATE}`);
  } finally {
    await client.end();
  }

  await deps.migrate(url, migrationsDirFor(resolveAppEnv(env)));
  return { backup };
}

function docker(args: string[]): void {
  const result = spawnSync("docker", ["compose", ...args], { cwd: ROOT_DIR, encoding: "utf8" });
  if (result.error) {
    throw new Error(`docker compose ${args[0]} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`);
  }
}

/**
 * pg_dump runs inside the container and the file is copied out with
 * `docker compose cp` — never through a shell redirect, which PowerShell 5.1
 * re-encodes and so corrupts a binary dump.
 */
async function dockerDump(database: string, url: string): Promise<string> {
  const user = parse(url).user || "ch_fuel";
  const file = `${database}-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
  const inContainer = `/tmp/${file}`;
  const onHost = path.join(ROOT_DIR, "backups", file);

  mkdirSync(path.dirname(onHost), { recursive: true });
  docker(["exec", "-T", "db", "pg_dump", "-U", user, "-d", database, "-Fc", "-f", inContainer]);
  try {
    docker(["cp", `db:${inContainer}`, onHost]);
  } finally {
    docker(["exec", "-T", "db", "rm", "-f", inContainer]);
  }
  if (!existsSync(onHost) || statSync(onHost).size === 0) {
    throw new Error(`pg_dump produced no file at ${onHost}`);
  }
  return path.relative(ROOT_DIR, onHost);
}

const realDeps: AdminDeps = {
  connectMaintenance: async (url) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  },
  migrate: async (url, migrationsDir) => {
    const pool = new Pool({ connectionString: url });
    try {
      for (const result of await runMigrations(pool, migrationsDir)) {
        console.log(`${result.applied ? "applied" : "skipped"}  ${result.filename}`);
      }
    } finally {
      await pool.end();
    }
  },
  dump: async (database, url) => dockerDump(database, url),
};

async function main(argv: readonly string[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const [command, name] = argv;
  if (command === "create" && name === undefined) {
    for (const { database, created } of await createDatabases(url, process.env, realDeps)) {
      console.log(`${created ? "created" : "exists "}  ${database}`);
    }
    return;
  }
  if (command === "reset" && name) {
    const { backup } = await resetDatabase(name, url, process.env, realDeps);
    if (backup) console.log(`backed up ${name} to ${backup}`);
    console.log(`reset ${name}`);
    return;
  }
  throw new Error("usage: dbAdmin create | dbAdmin reset <ch_fuel_dev|ch_fuel_test|ch_fuel_real>");
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  console.error(currentTarget());
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
