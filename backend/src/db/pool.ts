import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type QueryResultRow } from "pg";
import { describeTarget, formatTarget, loadEnvFiles, type AppEnv } from "../config/env.js";

// The repo root, from both src/db (tsx) and dist/db (the Next bundle's import).
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const { appEnv } = loadEnvFiles(ROOT_DIR);

/** The environment this process selected with APP_ENV, if any. */
export function currentAppEnv(): AppEnv | undefined {
  return appEnv;
}

/**
 * The one startup line — environment, database host and name, never the
 * credentials. Returned, not printed: entry points write it to stderr.
 */
export function currentTarget(): string {
  return formatTarget(describeTarget(appEnv, process.env.DATABASE_URL));
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
