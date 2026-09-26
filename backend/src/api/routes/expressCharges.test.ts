import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handleListExpressCharges } from "./expressCharges.js";

/** Fails the test the moment anything on it is called — proves a rejected
 * query never reaches the database (mirrors receipts.test.ts). */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

async function get(query: string): Promise<Response> {
  const url = new URL(`http://localhost/api/v1/express-charges${query}`);
  return handleListExpressCharges(untouchedPool, url);
}

describe("handleListExpressCharges", () => {
  it("400s a missing period without touching the database", async () => {
    const response = await get("");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("400s a period that is not a YYYY-MM-DD date", async () => {
    expect((await get("?period=2026-09")).status).toBe(400);
    expect((await get("?period=last-week")).status).toBe(400);
  });
});
