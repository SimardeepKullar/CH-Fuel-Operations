import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handlePostReceiptChecks } from "./receipts.js";

/** A pool that fails the test the moment anything on it is called — proves
 * a rejected body never reaches the database (mirrors invoices.test.ts). */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v1/receipt-checks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CHECKED_BY = "11111111-1111-1111-1111-111111111111";

describe("handlePostReceiptChecks", () => {
  it("400s a non-JSON body without touching the database", async () => {
    const request = new Request("http://localhost/api/v1/receipt-checks", {
      method: "POST",
      body: "not json",
    });
    const response = await handlePostReceiptChecks(untouchedPool, request, new URL(request.url), CHECKED_BY);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("400s a body with neither fuelStopId nor driverId", async () => {
    const request = postRequest({ outcome: "confirmed" });
    const response = await handlePostReceiptChecks(untouchedPool, request, new URL(request.url), CHECKED_BY);
    expect(response.status).toBe(400);
  });

  it('400s "skip" as an outcome — skip is not a valid outcome, so it never writes a row (T-35 DoD)', async () => {
    const request = postRequest({ fuelStopId: "22222222-2222-2222-2222-222222222222", outcome: "skip" });
    const response = await handlePostReceiptChecks(untouchedPool, request, new URL(request.url), CHECKED_BY);
    expect(response.status).toBe(400);
  });

  it("400s a batch confirm body with a non-uuid driverId, without touching the database", async () => {
    const request = postRequest({ driverId: "not-a-uuid", outcome: "confirmed" });
    const response = await handlePostReceiptChecks(untouchedPool, request, new URL(request.url), CHECKED_BY);
    expect(response.status).toBe(400);
  });

  it('400s "missing" as a batch outcome — batch confirm is confirm-only', async () => {
    const request = postRequest({ driverId: "22222222-2222-2222-2222-222222222222", outcome: "missing" });
    const response = await handlePostReceiptChecks(untouchedPool, request, new URL(request.url), CHECKED_BY);
    expect(response.status).toBe(400);
  });
});
