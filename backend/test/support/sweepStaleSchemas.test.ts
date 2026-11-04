import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import setup, { MIN_STALE_AGE_MS, staleTestSchemas } from "./sweepStaleSchemas.js";

// Pool is mocked so a test can prove setup() refused before connecting.
vi.mock("pg", () => ({ Pool: vi.fn() }));

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const at = (msAgo: number) => String(NOW - msAgo);

describe("staleTestSchemas (T-50)", () => {
  it("selects every throwaway schema shape the tests create, old enough to be orphaned", () => {
    const names = [
      `test_drivers_${at(MIN_STALE_AGE_MS)}_k3j9x2`,
      `plan_actual_${at(60 * 60_000)}_a1b2c3`,
      `test_express_charges_999210_${at(24 * 60 * 60_000)}_zz9`,
    ];
    expect(staleTestSchemas(names, NOW)).toEqual(names);
  });

  it("leaves a schema younger than the cut-off — it may belong to a run in another terminal", () => {
    expect(staleTestSchemas([`test_drivers_${at(MIN_STALE_AGE_MS - 1)}_k3j9x2`], NOW)).toEqual([]);
  });

  it("never selects a schema without the <prefix>_<13-digit ms>_<base36> shape", () => {
    const names = [
      "public",
      "information_schema",
      "pg_catalog",
      "tiger",
      "topology",
      `Test_drivers_${at(MIN_STALE_AGE_MS)}_k3j9x2`,
      `test_drivers_${at(MIN_STALE_AGE_MS).slice(1)}_k3j9x2`,
      `test_drivers_${at(MIN_STALE_AGE_MS)}`,
      `test_drivers_${at(MIN_STALE_AGE_MS)}_K3J9`,
    ];
    expect(staleTestSchemas(names, NOW)).toEqual([]);
  });
});

describe("globalSetup refuses a non-local target (T-99)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(Pool).mockClear();
  });

  it("throws before connecting when DATABASE_URL is not a local dev/test/real database", async () => {
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require");
    await expect(setup()).rejects.toThrow(/refusing/);
    expect(Pool).not.toHaveBeenCalled();
  });

  it("throws before connecting under APP_ENV=production, even with a local URL", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_test");
    await expect(setup()).rejects.toThrow(/APP_ENV/);
    expect(Pool).not.toHaveBeenCalled();
  });

  it("skips without connecting when DATABASE_URL is unset — unit tests need no database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(setup()).resolves.toBeUndefined();
    expect(Pool).not.toHaveBeenCalled();
  });
});
