import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { parse } from "pg-connection-string";
import { backupDatabase, countTables, realBackupDeps, ROOT_DIR, type TableCounts } from "../db/backup.js";
import { assertSafeToDestroy } from "../db/guard.js";
import { currentTarget } from "../db/pool.js";
import { databaseExists, maintenanceUrl, migrationsDirFor, recreateDatabase, type Queryable } from "./dbAdmin.js";

/**
 * `npm run db:restore-to-real -- <file>` (T-101): replace ch_fuel_real from a
 * pg_dump archive. Each step must pass before the next one runs:
 *
 *   1. the T-99 guard, and the target must be ch_fuel_real
 *   2. the file exists, starts PGDMP, and `pg_restore --list` reads it
 *   3. the current ch_fuel_real is dumped to backups/ — abort if that fails
 *   4. DROP … WITH (FORCE), CREATE … TEMPLATE template1
 *   5. pg_restore --no-owner --exit-on-error, inside the compose container
 *   6. row counts checked against the dump's .counts.json sidecar, exactly
 *
 * Pending migrations/real files are listed, never applied.
 */

export interface RestoreDeps {
  /** The file's first five bytes, or null when it does not exist. */
  readHeader(file: string): string | null;
  /** The `tables` of `<file>.counts.json`, or null when there is none. */
  readSidecar(file: string): TableCounts | null;
  /** Copies the file into the container; returns its path there. */
  copyIn(file: string): string;
  /** `pg_restore --list` — throws when the archive cannot be read. */
  listArchive(containerPath: string): void;
  removeFromContainer(containerPath: string): void;
  connectMaintenance(url: string): Promise<Queryable>;
  /** Dumps the current ch_fuel_real; returns the file. */
  backup(url: string): Promise<string>;
  restore(containerPath: string, database: string): void;
  countRestored(url: string): Promise<TableCounts>;
  pendingMigrations(url: string): Promise<string[]>;
}

export interface RestoreResult {
  rollback?: string;
  counts: TableCounts;
  /** False when the dump had no sidecar to check against. */
  verified: boolean;
  mismatches: string[];
  pendingMigrations: string[];
}

/** Every table whose count differs, is missing, or was not expected. */
export function compareCounts(expected: TableCounts, restored: TableCounts): string[] {
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(restored)])].sort();
  return tables
    .filter((table) => expected[table] !== restored[table])
    .map(
      (table) =>
        `${table}: expected ${expected[table] ?? "(none)"}, restored ${restored[table] ?? "(missing)"}`,
    );
}

export async function restoreToReal(
  file: string,
  url: string,
  env: Readonly<Record<string, string | undefined>>,
  deps: RestoreDeps,
): Promise<RestoreResult> {
  assertSafeToDestroy(url, env);
  const database = parse(url).database ?? "";
  if (database !== "ch_fuel_real") {
    throw new Error(`db:restore-to-real replaces only ch_fuel_real, not "${database}"; check APP_ENV`);
  }
  const header = deps.readHeader(file);
  if (header === null) {
    throw new Error(`dump file not found: ${file}`);
  }
  if (header !== "PGDMP") {
    throw new Error(`${file} is not a pg_dump custom-format archive (no PGDMP header); make it with \`pg_dump -Fc\``);
  }
  const expected = deps.readSidecar(file);

  const containerPath = deps.copyIn(file);
  let rollback: string | undefined;
  let counts: TableCounts;
  try {
    deps.listArchive(containerPath);

    const client = await deps.connectMaintenance(maintenanceUrl(url));
    try {
      if (await databaseExists(client, database)) {
        rollback = await deps.backup(url);
      }
      await recreateDatabase(client, database);
    } finally {
      await client.end();
    }

    deps.restore(containerPath, database);
    counts = await deps.countRestored(url);
  } finally {
    deps.removeFromContainer(containerPath);
  }

  const mismatches = expected ? compareCounts(expected, counts) : [];
  if (mismatches.length > 0) {
    const undo = rollback
      ? `The previous ch_fuel_real is in ${rollback}; put it back with \`npm run db:restore-to-real -- ${rollback}\`.`
      : "There was no previous ch_fuel_real to keep.";
    throw new Error(`restored row counts differ from ${file}.counts.json:\n  ${mismatches.join("\n  ")}\n${undo}`);
  }
  return { rollback, counts, verified: expected !== null, mismatches, pendingMigrations: await deps.pendingMigrations(url) };
}

// Output is captured, not printed: `pg_restore --list` would print the whole TOC.
const docker = (args: string[]): void => realBackupDeps.runDocker(args);

const realDeps: RestoreDeps = {
  readHeader: (file) => {
    if (!existsSync(file)) return null;
    const fd = openSync(file, "r");
    try {
      const buffer = Buffer.alloc(5);
      const read = readSync(fd, buffer, 0, 5, 0);
      return buffer.subarray(0, read).toString("latin1");
    } finally {
      closeSync(fd);
    }
  },
  readSidecar: (file) => {
    const sidecar = `${file}.counts.json`;
    return existsSync(sidecar) ? (JSON.parse(readFileSync(sidecar, "utf8")) as { tables: TableCounts }).tables : null;
  },
  copyIn: (file) => {
    const containerPath = `/tmp/restore-${path.basename(file)}`;
    docker(["compose", "cp", file, `db:${containerPath}`]);
    return containerPath;
  },
  listArchive: (containerPath) => docker(["compose", "exec", "-T", "db", "pg_restore", "--list", containerPath]),
  removeFromContainer: (containerPath) => docker(["compose", "exec", "-T", "db", "rm", "-f", containerPath]),
  connectMaintenance: async (url) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  },
  backup: async (url) => (await backupDatabase(url, "real", realBackupDeps)).file,
  restore: (containerPath, database) =>
    docker(["compose", "exec", "-T", "db", "pg_restore", "-U", "ch_fuel", "-d", database, "--no-owner", "--exit-on-error", containerPath]),
  countRestored: async (url) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return await countTables(client);
    } finally {
      await client.end();
    }
  },
  pendingMigrations: async (url) => {
    const dir = migrationsDirFor("real");
    if (!existsSync(dir)) return [];
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const present = await client.query<{ present: boolean }>(
        "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present",
      );
      const applied = new Set<string>();
      if (present.rows[0]?.present) {
        const { rows } = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
        for (const row of rows) applied.add(row.filename);
      }
      return readdirSync(dir).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();
    } finally {
      await client.end();
    }
  },
};

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  console.error(currentTarget());
  const [file] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!file || !url) {
    console.error("usage: npm run db:restore-to-real -- <backups/file.dump>");
    process.exitCode = 1;
  } else {
    restoreToReal(path.resolve(ROOT_DIR, file), url, process.env, realDeps)
      .then((result) => {
        if (result.rollback) console.log(`previous ch_fuel_real dumped to ${path.relative(ROOT_DIR, result.rollback)}`);
        for (const [table, n] of Object.entries(result.counts)) console.log(`${String(n).padStart(10)}  ${table}`);
        console.log(
          result.verified
            ? `restored ch_fuel_real: all ${Object.keys(result.counts).length} table counts match the dump's sidecar`
            : "restored ch_fuel_real: no .counts.json beside the dump, so the counts above are unverified",
        );
        if (result.pendingMigrations.length > 0) {
          console.log(`pending in migrations/real (not applied): ${result.pendingMigrations.join(", ")} — run \`npm run db:migrate:real\``);
        }
      })
      .catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
      });
  }
}
