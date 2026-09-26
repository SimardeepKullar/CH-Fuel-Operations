import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handleGetStationBilledPrices } from "./stations.js";

/** Fails the test the moment anything on it is called — proves a request that
 * can't name a station never reaches the database. */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

describe("handleGetStationBilledPrices", () => {
  it("404s an id that is not a uuid — a site_ref like 25334 is not a station id — without touching the database", async () => {
    const response = await handleGetStationBilledPrices(
      untouchedPool,
      "25334",
      new URL("http://localhost/api/v1/stations/25334/billed-prices"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
});
