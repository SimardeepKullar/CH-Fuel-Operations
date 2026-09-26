import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handleGetDriver, handleListDrivers } from "./drivers.js";

/** Fails the test the moment anything on it is called — proves a rejected
 * request never reaches the database (mirrors expressCharges.test.ts). */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

const UNKNOWN_UUID = "3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e";

describe("handleListDrivers", () => {
  const list = (query: string) => handleListDrivers(untouchedPool, new URL(`http://localhost/api/v1/drivers${query}`));

  it("400s a missing period without touching the database", async () => {
    const response = await list("");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("400s a period that is not a YYYY-MM-DD date", async () => {
    expect((await list("?period=2026-09")).status).toBe(400);
    expect((await list("?period=last-week")).status).toBe(400);
  });
});

describe("handleGetDriver", () => {
  const get = (id: string, query: string) =>
    handleGetDriver(untouchedPool, id, new URL(`http://localhost/api/v1/drivers/${id}${query}`));

  it("400s a missing or malformed period without touching the database", async () => {
    expect((await get(UNKNOWN_UUID, "")).status).toBe(400);
    expect((await get(UNKNOWN_UUID, "?period=nope")).status).toBe(400);
  });

  it("404s an id that is not a uuid without touching the database — a typo is not a 500", async () => {
    const response = await get("not-a-uuid", "?period=2026-09-01");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
});
