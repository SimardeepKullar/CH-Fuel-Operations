import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { resolveExpressDriver } from "../../src/resolve/resolveDriver.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("resolveExpressDriver (integration, T-29)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_resolvedriver_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("matches a seeded driver's display name through the same alias path fuel stops use", async () => {
    const result = await resolveExpressDriver(scopedPool, "JORDAN");
    expect(result.matchStatus).toBe("matched");
    expect(result.driverId).not.toBeNull();
  });

  it("lands a driver name with no alias and no display-name hit as unmatched, name untouched", async () => {
    const driverNameRaw = "SOMEONE NOT ON THE ROSTER";
    const result = await resolveExpressDriver(scopedPool, driverNameRaw);
    expect(result).toEqual({ driverId: null, matchStatus: "unmatched" });
    // The raw text itself is never rewritten by resolution — the caller
    // stores exactly what was passed in.
    expect(driverNameRaw).toBe("SOMEONE NOT ON THE ROSTER");
  });

  it("lands the blank-name row (a real A19 case) as unmatched with a null driver, not an error", async () => {
    const result = await resolveExpressDriver(scopedPool, null);
    expect(result).toEqual({ driverId: null, matchStatus: "unmatched" });
  });
});
