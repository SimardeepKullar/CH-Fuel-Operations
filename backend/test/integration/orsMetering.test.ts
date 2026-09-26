import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { OrsRoutingProvider } from "../../src/routing/ors.js";
import { BudgetExceededError } from "../../src/routing/budgetGuard.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dirname, "../../../migrations/synthetic");
const fixturesDir = path.join(dirname, "../fixtures/ors");
const hasDatabase = Boolean(process.env.DATABASE_URL);

interface OrsFixture {
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
}

function loadFixture(name: string): OrsFixture {
  return JSON.parse(readFileSync(path.join(fixturesDir, `${name}.json`), "utf8")) as OrsFixture;
}

function fetchFromFixture(fixture: OrsFixture): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(fixture.responseBody), {
      status: fixture.responseStatus,
      headers: fixture.responseHeaders,
    }),
  ) as unknown as typeof fetch;
}

const truckSpec = {
  grossWeightKg: 36287,
  heightCm: 411,
  widthCm: 259,
  lengthCm: 2250,
  axleCount: 5,
  hazmatClass: null,
};
const origin = { lat: 41.8781, lng: -87.6298 };
const destination = { lat: 32.7767, lng: -96.797 };

describe.skipIf(!hasDatabase)("OrsRoutingProvider metering (integration)", () => {
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

  it("records provider_usage and provider_quota on a real call, and throws before the HTTP call once the ceiling is hit", async () => {
    const fixture = loadFixture("route-single-leg");
    const fetchSpy = fetchFromFixture(fixture);
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchSpy,
      pool: scopedPool,
      budgetCeilings: { directions: 2 },
    });

    await provider.route({ origin, destination, truckSpec });
    await provider.route({ origin, destination, truckSpec });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await expect(provider.route({ origin, destination, truckSpec })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const usage = await scopedPool.query<{ call_count: number }>(
      `SELECT call_count FROM provider_usage WHERE provider = 'ors' AND endpoint = 'directions'`,
    );
    expect(usage.rows).toEqual([{ call_count: 2 }]);

    const quota = await scopedPool.query<{ limit_value: number; remaining: number }>(
      `SELECT limit_value, remaining FROM provider_quota WHERE provider = 'ors' AND endpoint = 'directions'`,
    );
    expect(quota.rows).toEqual([
      { limit_value: Number(fixture.responseHeaders["x-ratelimit-limit"]), remaining: Number(fixture.responseHeaders["x-ratelimit-remaining"]) },
    ]);
  });

  it("blocks every call to an endpoint whose ceiling is 0, before any HTTP call, writing no row", async () => {
    const fetchSpy = fetchFromFixture(loadFixture("route-single-leg"));
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchSpy,
      pool: scopedPool,
      budgetCeilings: { directions: 0 },
    });

    await expect(provider.route({ origin, destination, truckSpec })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const usage = await scopedPool.query(`SELECT * FROM provider_usage`);
    expect(usage.rows).toEqual([]);
  });

  it("keeps the endpoints' allowances apart: an exhausted directions ceiling does not stop a matrix call", async () => {
    const routeFetch = fetchFromFixture(loadFixture("route-single-leg"));
    const matrixFetch = fetchFromFixture(loadFixture("matrix"));
    const ceilings = { directions: 1, matrix: 1 };
    const directionsProvider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: routeFetch,
      pool: scopedPool,
      budgetCeilings: ceilings,
    });
    const matrixProvider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: matrixFetch,
      pool: scopedPool,
      budgetCeilings: ceilings,
    });

    await directionsProvider.route({ origin, destination, truckSpec });
    await expect(directionsProvider.route({ origin, destination, truckSpec })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );

    await expect(
      matrixProvider.matrix({ origins: [origin], destinations: [destination], truckSpec }),
    ).resolves.toBeDefined();
    expect(matrixFetch).toHaveBeenCalledTimes(1);
  });

  it("at the default ceilings fits 25 plans in a UTC day; the 26th plan's first matrix call is refused before any HTTP call", async () => {
    // Only `Date` is faked: pg's timers must keep running, and the day must not
    // roll over mid-test on a run that happens to straddle UTC midnight.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
    try {
      const routeFetch = fetchFromFixture(loadFixture("route-single-leg"));
      const matrixFetch = fetchFromFixture(loadFixture("matrix"));
      const routes = new OrsRoutingProvider({ apiKey: "test-key", fetchImpl: routeFetch, pool: scopedPool });
      const matrices = new OrsRoutingProvider({ apiKey: "test-key", fetchImpl: matrixFetch, pool: scopedPool });
      const matrixRequest = { origins: [origin], destinations: [destination], truckSpec };

      // A plan's ORS calls (TICKETS-v2 T-54): 3 directions and 2 matrix. Geocoding
      // has no adapter yet, so its allowance is exercised in budgetGuard.test.ts.
      for (let plan = 1; plan <= 25; plan += 1) {
        for (let i = 0; i < 3; i += 1) await routes.route({ origin, destination, truckSpec });
        for (let i = 0; i < 2; i += 1) await matrices.matrix(matrixRequest);
      }
      expect(routeFetch).toHaveBeenCalledTimes(75);
      expect(matrixFetch).toHaveBeenCalledTimes(50);

      for (let i = 0; i < 3; i += 1) await routes.route({ origin, destination, truckSpec });
      await expect(matrices.matrix(matrixRequest)).rejects.toBeInstanceOf(BudgetExceededError);
      expect(matrixFetch).toHaveBeenCalledTimes(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still records quota headers for a 4xx response", async () => {
    const fixture = loadFixture("route-error-400");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
      pool: scopedPool,
    });

    await expect(provider.route({ origin, destination, truckSpec })).rejects.toThrow();

    const quota = await scopedPool.query<{ remaining: number }>(
      `SELECT remaining FROM provider_quota WHERE provider = 'ors' AND endpoint = 'directions'`,
    );
    expect(quota.rows).toEqual([{ remaining: Number(fixture.responseHeaders["x-ratelimit-remaining"]) }]);
  });

  it("skips metering entirely when no pool is given", async () => {
    const fixture = loadFixture("route-single-leg");
    const provider = new OrsRoutingProvider({
      apiKey: "test-key",
      fetchImpl: fetchFromFixture(fixture),
    });

    await provider.route({ origin, destination, truckSpec });

    const usage = await scopedPool.query(`SELECT * FROM provider_usage`);
    expect(usage.rows).toEqual([]);
  });
});
