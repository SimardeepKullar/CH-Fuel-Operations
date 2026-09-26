import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateUser } from "../../src/catalog/users.js";
import { seedDispatcher } from "../../src/cli/seed.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("authenticateUser (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_users_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    adminPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    scopedPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    await runMigrations(scopedPool, migrationsDir);
    await seedDispatcher(scopedPool, {
      SEED_USER_EMAIL: "dispatch@ch-logistics.example",
      SEED_USER_PASSWORD: "correct horse battery staple",
      SEED_USER_DISPLAY_NAME: "M. Hodson",
    });
  });

  afterEach(async () => {
    await scopedPool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  it("returns the user's identity for correct credentials", async () => {
    const result = await authenticateUser(
      scopedPool,
      "dispatch@ch-logistics.example",
      "correct horse battery staple",
    );
    expect(result).toEqual({
      id: expect.any(String),
      email: "dispatch@ch-logistics.example",
      displayName: "M. Hodson",
      role: "dispatcher",
    });
  });

  it("returns null for a wrong password without throwing", async () => {
    const result = await authenticateUser(
      scopedPool,
      "dispatch@ch-logistics.example",
      "wrong password",
    );
    expect(result).toBeNull();
  });

  it("returns null for an unknown email without throwing", async () => {
    const result = await authenticateUser(scopedPool, "nobody@nowhere.example", "whatever");
    expect(result).toBeNull();
  });

  it("takes comparable time whether the email is unknown or the password is wrong", async () => {
    const start1 = performance.now();
    await authenticateUser(scopedPool, "dispatch@ch-logistics.example", "wrong password");
    const wrongPasswordMs = performance.now() - start1;

    const start2 = performance.now();
    await authenticateUser(scopedPool, "nobody@nowhere.example", "whatever");
    const unknownEmailMs = performance.now() - start2;

    const fast = Math.min(wrongPasswordMs, unknownEmailMs);
    const slow = Math.max(wrongPasswordMs, unknownEmailMs);
    // scrypt dominates both paths; a wide ratio would mean the unknown-email
    // path is skipping the hash comparison and leaking user existence by timing.
    expect(slow / fast).toBeLessThan(4);
  });
});
