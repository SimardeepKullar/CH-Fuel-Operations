import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Pool } from "pg";
import { hashPassword } from "../domain/password.js";
import { getPool } from "../db/pool.js";

const REQUIRED_KEYS = ["SEED_USER_EMAIL", "SEED_USER_PASSWORD"] as const;

export interface SeedEnv {
  SEED_USER_EMAIL?: string;
  SEED_USER_PASSWORD?: string;
  SEED_USER_DISPLAY_NAME?: string;
}

export type SeedResult =
  | { status: "created"; email: string }
  | { status: "already_exists"; email: string }
  | { status: "missing_env"; missing: string[] };

/**
 * Creates the one CH Logistics dispatcher account from env. Refuses to
 * overwrite an existing user — a seed script that silently resets a
 * password on re-run is a foot-gun. Validates env before touching the
 * database, so a missing var never reaches a blank-password insert.
 */
export async function seedDispatcher(
  pool: Pool,
  env: SeedEnv,
): Promise<SeedResult> {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    return { status: "missing_env", missing };
  }

  const email = env.SEED_USER_EMAIL!;
  const password = env.SEED_USER_PASSWORD!;
  const displayName = env.SEED_USER_DISPLAY_NAME || "Dispatcher";

  const { rows: existing } = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [email],
  );
  if (existing.length > 0) {
    return { status: "already_exists", email };
  }

  const passwordHash = hashPassword(password);
  await pool.query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'dispatcher')`,
    [email, passwordHash, displayName],
  );

  return { status: "created", email };
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const pool = getPool();
  seedDispatcher(pool, process.env)
    .then(async (result) => {
      switch (result.status) {
        case "created":
          console.log(`created dispatcher account ${result.email}`);
          break;
        case "already_exists":
          console.error(
            `a user with email ${result.email} already exists; refusing to overwrite`,
          );
          process.exitCode = 1;
          break;
        case "missing_env":
          console.error(
            `missing required environment variables: ${result.missing.join(", ")}`,
          );
          process.exitCode = 1;
          break;
      }
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      await pool.end();
      process.exitCode = 1;
    });
}
