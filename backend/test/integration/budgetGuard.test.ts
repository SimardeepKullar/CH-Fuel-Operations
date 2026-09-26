import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { BudgetExceededError, withBudgetGuard } from "../../src/routing/budgetGuard.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const hasDatabase = Boolean(process.env.DATABASE_URL);

/** §8.3: ORS's measured free-tier limits, each its own pool, per day. */
const DAILY_LIMITS = { directions: 200, matrix: 50, geocoding: 100 } as const;

describe.skipIf(!hasDatabase)("budgetGuard (integration)", () => {
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

  // Mid-day, so no test here sits on a boundary by accident.
  const NOON = new Date("2026-09-15T12:00:00Z");

  async function usage(): Promise<Array<{ period: string; endpoint: string; call_count: number }>> {
    const { rows } = await scopedPool.query<{ period: string; endpoint: string; call_count: number }>(
      `SELECT to_char(period, 'YYYY-MM-DD') AS period, endpoint, call_count
       FROM provider_usage WHERE provider = 'ors' ORDER BY period, endpoint`,
    );
    return rows;
  }

  it("lets calls up to the ceiling succeed; N+1 throws and the HTTP call is not made", async () => {
    const fetchSpy = vi.fn(async () => "ok");

    await withBudgetGuard(scopedPool, "ors", "directions", 3, fetchSpy, NOON);
    await withBudgetGuard(scopedPool, "ors", "directions", 3, fetchSpy, NOON);
    await withBudgetGuard(scopedPool, "ors", "directions", 3, fetchSpy, NOON);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    await expect(
      withBudgetGuard(scopedPool, "ors", "directions", 3, fetchSpy, NOON),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(await usage()).toEqual([{ period: "2026-09-15", endpoint: "directions", call_count: 3 }]);
  });

  it("counts each endpoint on its own: a day of directions calls leaves the matrix allowance untouched", async () => {
    const fetchSpy = vi.fn(async () => "ok");

    for (let i = 0; i < DAILY_LIMITS.directions; i += 1) {
      await withBudgetGuard(scopedPool, "ors", "directions", DAILY_LIMITS.directions, fetchSpy, NOON);
    }
    await expect(
      withBudgetGuard(scopedPool, "ors", "directions", DAILY_LIMITS.directions, fetchSpy, NOON),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    await expect(
      withBudgetGuard(scopedPool, "ors", "matrix", DAILY_LIMITS.matrix, fetchSpy, NOON),
    ).resolves.toBe("ok");
    expect(await usage()).toEqual([
      { period: "2026-09-15", endpoint: "directions", call_count: 200 },
      { period: "2026-09-15", endpoint: "matrix", call_count: 1 },
    ]);
  });

  it("fits 25 plans in one UTC day at the daily limits; the 26th plan's first matrix call is refused", async () => {
    const fetchSpy = vi.fn(async () => "ok");
    const call = (endpoint: keyof typeof DAILY_LIMITS) =>
      withBudgetGuard(scopedPool, "ors", endpoint, DAILY_LIMITS[endpoint], fetchSpy, NOON);

    // A plan (TICKETS-v2 T-54): 3 directions, 2 matrix, 2 geocoding.
    for (let plan = 1; plan <= 25; plan += 1) {
      for (let i = 0; i < 3; i += 1) await call("directions");
      for (let i = 0; i < 2; i += 1) await call("matrix");
      for (let i = 0; i < 2; i += 1) await call("geocoding");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(25 * 7);

    // Plan 26: directions (75 used of 200) and geocoding (50 of 100) still have room; matrix is spent.
    for (let i = 0; i < 3; i += 1) await call("directions");
    await expect(call("matrix")).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchSpy).toHaveBeenCalledTimes(25 * 7 + 3);
  });

  it("still counts a reserved call whose HTTP request subsequently fails", async () => {
    const failingCall = vi.fn(async () => {
      throw new Error("network blip");
    });

    await expect(
      withBudgetGuard(scopedPool, "ors", "directions", 5, failingCall, NOON),
    ).rejects.toThrow("network blip");

    expect(await usage()).toEqual([{ period: "2026-09-15", endpoint: "directions", call_count: 1 }]);
  });

  it("counts 23:59:59 UTC and 00:00:00 UTC the next day against different days", async () => {
    const fetchSpy = vi.fn(async () => "ok");
    const lastSecond = new Date("2026-09-15T23:59:59Z");
    const midnight = new Date("2026-09-16T00:00:00Z");

    await withBudgetGuard(scopedPool, "ors", "directions", 1, fetchSpy, lastSecond);
    await expect(
      withBudgetGuard(scopedPool, "ors", "directions", 1, fetchSpy, lastSecond),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    // The new day's counter starts fresh even though the previous day is spent.
    await expect(
      withBudgetGuard(scopedPool, "ors", "directions", 1, fetchSpy, midnight),
    ).resolves.toBe("ok");
    expect(await usage()).toEqual([
      { period: "2026-09-15", endpoint: "directions", call_count: 1 },
      { period: "2026-09-16", endpoint: "directions", call_count: 1 },
    ]);
  });

  it("names the provider, endpoint, day, ceiling and next UTC midnight in the error", async () => {
    const fetchSpy = vi.fn(async () => "ok");
    const lateEvening = new Date("2026-09-15T22:30:00Z");
    await withBudgetGuard(scopedPool, "ors", "matrix", 1, fetchSpy, lateEvening);

    const error = await withBudgetGuard(scopedPool, "ors", "matrix", 1, fetchSpy, lateEvening).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(BudgetExceededError);
    const exceeded = error as BudgetExceededError;
    expect(exceeded).toMatchObject({
      provider: "ors",
      endpoint: "matrix",
      period: "2026-09-15",
      ceiling: 1,
      resetsAt: new Date("2026-09-16T00:00:00Z"),
    });
    expect(exceeded.message).not.toMatch(/monthly/i);
    expect(exceeded.message).toContain("matrix");
    expect(exceeded.message).toContain("2026-09-15");
  });

  it("admits exactly one of several reservations racing for the last free slot", async () => {
    const fetchSpy = vi.fn(async () => "ok");
    await withBudgetGuard(scopedPool, "ors", "matrix", 3, fetchSpy, NOON);
    await withBudgetGuard(scopedPool, "ors", "matrix", 3, fetchSpy, NOON);
    fetchSpy.mockClear();

    // Open every connection first: pool connections are made lazily, and racers
    // that wait on a fresh connection arrive one at a time instead of together.
    const warm = await Promise.all(Array.from({ length: 10 }, () => scopedPool.connect()));
    warm.forEach((client) => client.release());

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => withBudgetGuard(scopedPool, "ors", "matrix", 3, fetchSpy, NOON)),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(9);
    for (const r of refused) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExceededError);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await usage()).toEqual([{ period: "2026-09-15", endpoint: "matrix", call_count: 3 }]);
  });

  it("blocks the very first call at a ceiling of 0 and writes no row", async () => {
    const fetchSpy = vi.fn(async () => "ok");

    await expect(
      withBudgetGuard(scopedPool, "ors", "directions", 0, fetchSpy, NOON),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await usage()).toEqual([]);
  });
});
