import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("runMigrations (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_migrate_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("applies migrations in filename order and a second run is a no-op", async () => {
    const dir = path.join(dirname, "../fixtures/migrations-ok");

    const first = await runMigrations(scopedPool, dir);
    expect(first).toEqual([
      { filename: "0001_create_alpha.sql", applied: true },
      { filename: "0002_create_beta.sql", applied: true },
    ]);

    const second = await runMigrations(scopedPool, dir);
    expect(second).toEqual([
      { filename: "0001_create_alpha.sql", applied: false },
      { filename: "0002_create_beta.sql", applied: false },
    ]);
  });

  it("rolls back a failing migration and leaves it unrecorded", async () => {
    const dir = path.join(dirname, "../fixtures/migrations-broken");

    await expect(runMigrations(scopedPool, dir)).rejects.toThrow();

    const { rows } = await scopedPool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    expect(rows.map((row) => row.filename)).toEqual(["0001_ok.sql"]);

    const { rows: deltaCheck } = await scopedPool.query<{ reg: string | null }>(
      `SELECT to_regclass('${schema}.delta') AS reg`,
    );
    expect(deltaCheck[0]?.reg).toBeNull();

    // A retry attempts the unrecorded file again rather than skipping it silently.
    await expect(runMigrations(scopedPool, dir)).rejects.toThrow();
  });

  it("refuses a database that recorded a migration no longer on disk, applying nothing", async () => {
    const dir = path.join(dirname, "../fixtures/migrations-ok");
    await runMigrations(scopedPool, dir);
    await scopedPool.query("INSERT INTO schema_migrations (filename) VALUES ('0003_squashed_away.sql')");
    await scopedPool.query("DELETE FROM schema_migrations WHERE filename = '0002_create_beta.sql'");
    await scopedPool.query("DROP TABLE beta");

    await expect(runMigrations(scopedPool, dir)).rejects.toThrow(/0003_squashed_away\.sql.*db:reset/s);

    // 0002 was unrecorded, so it would have been re-applied had the guard not fired first.
    const { rows } = await scopedPool.query<{ reg: string | null }>(
      `SELECT to_regclass('${schema}.beta') AS reg`,
    );
    expect(rows[0]?.reg).toBeNull();
  });
});
