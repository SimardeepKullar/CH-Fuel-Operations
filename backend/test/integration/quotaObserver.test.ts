import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { recordQuota } from "../../src/routing/quotaObserver.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("recordQuota (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_schema_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("persists headers with observed_at, moving the prior reading to prev_*", async () => {
    const first = new Date("2026-09-14T10:00:00Z");
    const second = new Date("2026-09-14T11:00:00Z");

    const firstRow = await recordQuota(
      scopedPool,
      "ors",
      "directions",
      { limit: 200, remaining: 198 },
      first,
    );
    expect(firstRow).toMatchObject({
      provider: "ors",
      endpoint: "directions",
      limit_value: 200,
      remaining: 198,
      prev_remaining: null,
      prev_observed_at: null,
    });
    expect(firstRow.observed_at).toEqual(first);

    const secondRow = await recordQuota(
      scopedPool,
      "ors",
      "directions",
      { limit: 200, remaining: 195 },
      second,
    );
    expect(secondRow).toMatchObject({
      provider: "ors",
      endpoint: "directions",
      limit_value: 200,
      remaining: 195,
      prev_remaining: 198,
    });
    expect(secondRow.observed_at).toEqual(second);
    expect(secondRow.prev_observed_at).toEqual(first);
  });
});
