import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handleGetTruck, handleListTrucks } from "./trucks.js";

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

describe("handleListTrucks", () => {
  const list = (query: string) => handleListTrucks(untouchedPool, new URL(`http://localhost/api/v1/trucks${query}`));

  // A missing period is no longer 400 — it's the D23 roster picker path,
  // which does reach the database. Covered against a real DB in
  // test/integration/trucks.test.ts.

  it("400s a period that is not a YYYY-MM-DD date", async () => {
    expect((await list("?period=2026-09")).status).toBe(400);
  });
});

describe("handleGetTruck", () => {
  const get = (id: string, query: string) =>
    handleGetTruck(untouchedPool, id, new URL(`http://localhost/api/v1/trucks/${id}${query}`));

  it("400s a missing or malformed period without touching the database", async () => {
    expect((await get(UNKNOWN_UUID, "")).status).toBe(400);
    expect((await get(UNKNOWN_UUID, "?period=nope")).status).toBe(400);
  });

  it("404s an id that is not a uuid without touching the database", async () => {
    const response = await get("072", "?period=2026-09-01");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });
});
