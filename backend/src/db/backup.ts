import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { parse } from "pg-connection-string";
import type { AppEnv } from "../config/env.js";
import { isLocalHost } from "./guard.js";

/**
 * `db:backup` and the pre-reset dump of ch_fuel_real (T-100, T-101).
 *
 * The dump is exact and checkable: one REPEATABLE READ transaction exports its
 * snapshot, counts every table, and pg_dump dumps that same snapshot — so the
 * `<dump>.counts.json` sidecar describes precisely the rows in the file, and
 * `db:restore-to-real` can verify a restore against it.
 *
 * Read-only, so not guarded: it may back up any environment, production
 * included. pg_dump never writes through a shell redirect, which PowerShell 5.1
 * re-encodes and so corrupts a binary dump.
 */

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Where dumps go: BACKUP_DIR (set through the T-98 env files or the shell), a
 * relative value resolved against the repo root, default `backups/`. Lets dumps
 * live outside a synced folder such as OneDrive.
 */
export function resolveBackupsDir(env: Readonly<Record<string, string | undefined>>, rootDir: string = ROOT_DIR): string {
  const configured = env.BACKUP_DIR?.trim();
  return configured ? path.resolve(rootDir, configured) : path.join(rootDir, "backups");
}

/** A path inside the repo relative to it; one outside it (a BACKUP_DIR elsewhere) in full. */
export function displayPath(file: string): string {
  const relative = path.relative(ROOT_DIR, file);
  return relative.startsWith("..") || path.isAbsolute(relative) ? file : relative;
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

export interface BackupDeps {
  connect(url: string): Promise<Queryable>;
  /** Runs `docker <args>`, adding `env` to its environment; throws on a non-zero exit. */
  runDocker(args: string[], env?: Record<string, string>): void;
  backupsDir: string;
  /** Creates the directory (and parents) if missing. */
  ensureDir(dir: string): void;
  now(): Date;
  /** 0 when the file does not exist. */
  fileSize(file: string): number;
  writeFile(file: string, contents: string): void;
}

export type TableCounts = Record<string, number>;

export interface BackupResult {
  file: string;
  countsFile: string;
  counts: TableCounts;
}

export function backupFileName(appEnv: AppEnv | undefined, database: string, now: Date): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return `${appEnv ?? "unset"}-${database}-${stamp}.dump`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Exact row counts for every user table, keyed `schema.table`, in the caller's transaction. */
export async function countTables(client: Queryable): Promise<TableCounts> {
  const { rows } = await client.query(
    `SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename`,
  );
  const counts: TableCounts = {};
  for (const row of rows as Array<{ schemaname: string; tablename: string }>) {
    // Identifiers cannot be bind parameters; these come from pg_tables, quoted.
    const result = await client.query(
      `SELECT count(*)::int AS n FROM ${quoteIdent(row.schemaname)}.${quoteIdent(row.tablename)}`,
    );
    counts[`${row.schemaname}.${row.tablename}`] = (result.rows[0] as { n: number }).n;
  }
  return counts;
}

/** Only these reach a `sh -c` string: a snapshot id and our own file name. */
function assertShellSafe(value: string): string {
  if (!/^[\w.-]+$/.test(value)) {
    throw new Error(`refusing to pass "${value}" to a shell`);
  }
  return value;
}

export async function backupDatabase(
  url: string,
  appEnv: AppEnv | undefined,
  deps: BackupDeps,
): Promise<BackupResult> {
  const config = parse(url);
  const host = config.host ?? "";
  const database = config.database ?? "";
  // PgBouncer in transaction mode (Neon's -pooler endpoint) cannot hold the
  // exported snapshot across pg_dump's own connection.
  if (host.includes("-pooler")) {
    throw new Error(`refusing to back up through a pooler host (${host}); use the direct connection string`);
  }
  const local = isLocalHost(host);
  const fileName = backupFileName(appEnv, database, deps.now());
  const file = path.join(deps.backupsDir, fileName);
  const takenAt = deps.now().toISOString();

  deps.ensureDir(deps.backupsDir);
  const client = await deps.connect(url);
  let counts: TableCounts;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = assertShellSafe(
      ((await client.query("SELECT pg_export_snapshot() AS snapshot")).rows[0] as { snapshot: string }).snapshot,
    );
    let major = 0;
    if (!local) {
      const { rows } = await client.query("SELECT current_setting('server_version_num')::int / 10000 AS major");
      major = (rows[0] as { major: number }).major;
    }
    counts = await countTables(client);

    if (local) {
      dumpInComposeContainer(deps, config.user || "ch_fuel", database, snapshot, file);
    } else {
      dumpRemote(deps, url, major, snapshot, fileName);
    }
    await client.query("COMMIT");
  } finally {
    await client.end();
  }

  if (deps.fileSize(file) === 0) {
    throw new Error(`pg_dump produced no file, or an empty one, at ${file}`);
  }
  const countsFile = `${file}.counts.json`;
  deps.writeFile(
    countsFile,
    `${JSON.stringify({ appEnv: appEnv ?? null, host: config.port ? `${host}:${config.port}` : host, database, takenAt, tables: counts }, null, 2)}\n`,
  );
  return { file, countsFile, counts };
}

/** pg_dump inside the compose `db` container, then `docker compose cp` out. */
function dumpInComposeContainer(deps: BackupDeps, user: string, database: string, snapshot: string, file: string): void {
  const inContainer = `/tmp/${path.basename(file)}`;
  deps.runDocker(["compose", "exec", "-T", "db", "pg_dump", "-U", user, "-d", database, "-Fc", `--snapshot=${snapshot}`, "-f", inContainer]);
  try {
    deps.runDocker(["compose", "cp", `db:${inContainer}`, file]);
  } finally {
    deps.runDocker(["compose", "exec", "-T", "db", "rm", "-f", inContainer]);
  }
}

/** The major of the compose `db` image (`postgis/postgis:16-…`); backup.test.ts keeps the two in step. */
export const LOCAL_PG_MAJOR = 16;

/**
 * On the local major, pg_dump runs in the compose `db` container: the same
 * binary as the pg_restore db:restore-to-real uses. A newer minor's pg_dump
 * (`postgres:16` is 16.15, the container 16.4) can write an archive format the
 * older pg_restore rejects.
 *
 * On a newer major, pg_dump refuses the server, so it runs from a throwaway
 * `postgres:<server major>` container, writing into a bind-mounted backups/;
 * that dump cannot be restored locally either way.
 *
 * Either way the URL goes in as DUMP_URL, passed by name (`-e DUMP_URL`), so
 * the password is never in any process's argument list.
 */
function dumpRemote(deps: BackupDeps, url: string, major: number, snapshot: string, fileName: string): void {
  const command = `pg_dump -d "$DUMP_URL" -Fc --snapshot=${snapshot} -f`;
  if (major === LOCAL_PG_MAJOR) {
    const inContainer = `/tmp/${assertShellSafe(fileName)}`;
    deps.runDocker(["compose", "exec", "-T", "-e", "DUMP_URL", "db", "sh", "-c", `${command} ${inContainer}`], { DUMP_URL: url });
    try {
      deps.runDocker(["compose", "cp", `db:${inContainer}`, path.join(deps.backupsDir, fileName)]);
    } finally {
      deps.runDocker(["compose", "exec", "-T", "db", "rm", "-f", inContainer]);
    }
    return;
  }
  deps.runDocker(
    [
      "run",
      "--rm",
      "-e",
      "DUMP_URL",
      "-v",
      `${deps.backupsDir}:/backups`,
      `postgres:${major}`,
      "sh",
      "-c",
      `${command} /backups/${assertShellSafe(fileName)}`,
    ],
    { DUMP_URL: url },
  );
}

export const realBackupDeps: BackupDeps = {
  connect: async (url) => {
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  },
  runDocker: (args, env) => {
    const result = spawnSync("docker", args, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      env: env ? { ...process.env, ...env } : process.env,
    });
    if (result.error) {
      throw new Error(`docker ${args[0]} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      // args never hold a credential, so they are safe to show.
      throw new Error(`docker ${args.slice(0, 4).join(" ")} … exited ${result.status}: ${result.stderr.trim()}`);
    }
  },
  // A getter, read when used: this module can load before the env files do.
  get backupsDir() {
    return resolveBackupsDir(process.env);
  },
  ensureDir: (dir) => {
    mkdirSync(dir, { recursive: true });
  },
  now: () => new Date(),
  fileSize: (file) => {
    try {
      return statSync(file).size;
    } catch {
      return 0;
    }
  },
  writeFile: (file, contents) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  },
};
