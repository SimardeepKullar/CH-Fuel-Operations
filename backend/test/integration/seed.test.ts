import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedDispatcher } from "../../src/cli/seed.js";
import { verifyPassword } from "../../src/domain/password.js";
import { runMigrations } from "../../src/db/migrate.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("seedDispatcher (integration)", () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schema: string;

  beforeEach(async () => {
    schema = `test_seed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

  it("creates one user whose stored hash is not the plaintext password", async () => {
    const result = await seedDispatcher(scopedPool, {
      SEED_USER_EMAIL: "dispatch@ch-logistics.example",
      SEED_USER_PASSWORD: "correct horse battery staple",
    });
    expect(result).toEqual({
      status: "created",
      email: "dispatch@ch-logistics.example",
    });

    const { rows } = await scopedPool.query<{
      email: string;
      password_hash: string;
      display_name: string;
      role: string;
    }>("SELECT email, password_hash, display_name, role FROM users");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("dispatch@ch-logistics.example");
    expect(rows[0]?.password_hash).not.toBe("correct horse battery staple");
    expect(rows[0]?.role).toBe("dispatcher");
    expect(
      verifyPassword("correct horse battery staple", rows[0]?.password_hash ?? ""),
    ).toBe(true);
  });

  it("is a no-op on a repeat email and does not duplicate or overwrite", async () => {
    await seedDispatcher(scopedPool, {
      SEED_USER_EMAIL: "dispatch@ch-logistics.example",
      SEED_USER_PASSWORD: "first-password",
    });

    const second = await seedDispatcher(scopedPool, {
      SEED_USER_EMAIL: "dispatch@ch-logistics.example",
      SEED_USER_PASSWORD: "second-password",
    });
    expect(second).toEqual({
      status: "already_exists",
      email: "dispatch@ch-logistics.example",
    });

    const { rows } = await scopedPool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users",
    );
    expect(rows).toHaveLength(1);
    expect(verifyPassword("first-password", rows[0]?.password_hash ?? "")).toBe(
      true,
    );
  });

  it("fails fast on missing env vars without touching the database", async () => {
    const result = await seedDispatcher(scopedPool, {});
    expect(result).toEqual({
      status: "missing_env",
      missing: ["SEED_USER_EMAIL", "SEED_USER_PASSWORD"],
    });

    const { rows } = await scopedPool.query<{ count: string }>(
      "SELECT count(*) FROM users",
    );
    expect(rows[0]?.count).toBe("0");
  });
});
