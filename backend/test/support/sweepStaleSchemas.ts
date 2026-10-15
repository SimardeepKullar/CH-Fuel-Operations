import { Pool } from "pg";
// Side effect: loads the root .env into process.env, exactly as the
// integration tests get DATABASE_URL.
import "../../src/db/pool.js";

/** Every throwaway test schema is named `<prefix>_<Date.now()>_<base36>` —
 * `test_drivers_…`, `plan_actual_…` — so the shape, not the prefix, marks one. */
const TEST_SCHEMA = /^[a-z][a-z0-9_]*?_(\d{13})_[a-z0-9]+$/;

/** Younger than this, a schema may belong to a run still going in another
 * terminal; the next run sweeps it instead. */
export const MIN_STALE_AGE_MS = 10 * 60_000;

/**
 * The throwaway schemas a crashed worker left behind. A worker that dies
 * mid-file never reaches its `afterEach`, so its schema outlives the run (T-50).
 */
export function staleTestSchemas(names: readonly string[], nowMs: number, minAgeMs = MIN_STALE_AGE_MS): string[] {
  return names.filter((name) => {
    const match = TEST_SCHEMA.exec(name);
    return match !== null && nowMs - Number(match[1]) >= minAgeMs;
  });
}

/** Vitest globalSetup: sweep stale test schemas once, before any file runs. */
export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const pool = new Pool({ connectionString });
  try {
    const { rows } = await pool.query<{ nspname: string }>("SELECT nspname FROM pg_namespace");
    const stale = staleTestSchemas(rows.map((r) => r.nspname), Date.now());
    for (const schema of stale) {
      // An identifier cannot be a bind parameter; the name is constrained to
      // [a-z0-9_] by TEST_SCHEMA above.
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    if (stale.length > 0) console.log(`swept ${stale.length} stale test schema(s)`);
  } catch (err) {
    // A database that is down fails the integration tests on its own; the
    // unit tests (pre-commit) must not fail here.
    console.warn(`stale test schema sweep skipped: ${(err as Error).message}`);
  } finally {
    await pool.end();
  }
}
