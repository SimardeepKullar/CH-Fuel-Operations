import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

/** A pool that fails the test the moment anything on it is called — proves
 * the 401 path below never reaches the database. */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

describe("createApp", () => {
  it("is callable with no server and no session", async () => {
    const app = createApp();
    const response = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(response.status).toBe(200);
  });

  it("degrades to db.reachable: false rather than a 500 when the pool is unusable", async () => {
    const app = createApp({ pool: untouchedPool });
    const response = await app.handle(new Request("http://localhost/api/v1/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = (await response.json()) as {
      db: { reachable: boolean };
      provider: { meters: unknown };
      latestSheetDate: unknown;
      latestInvoicePeriod: unknown;
      openAnomalyCount: unknown;
    };
    expect(body.db.reachable).toBe(false);
    expect(body.provider.meters).toBeNull();
    expect(body.latestSheetDate).toBeNull();
    expect(body.latestInvoicePeriod).toBeNull();
    expect(body.openAnomalyCount).toBeNull();
  });

  it("returns an unknown path as a 404 problem+json, not HTML", async () => {
    const app = createApp();
    const response = await app.handle(new Request("http://localhost/api/v1/nope"));

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    const body = (await response.json()) as { title: string; status: number };
    expect(body.title).toBe("Not Found");
    expect(body.status).toBe(404);
  });

  it("defaults to authRequired: true", () => {
    const app = createApp();
    expect(app.authRequired).toBe(true);
  });

  it("createApp({ authRequired: false }) serves API tests with no session", async () => {
    const app = createApp({ authRequired: false });
    expect(app.authRequired).toBe(false);

    const response = await app.handle(new Request("http://localhost/api/v1/health"));
    expect(response.status).toBe(200);
  });

  it("GET /receipt-queue with no identity in context is a 401 problem+json, without touching the database", async () => {
    const app = createApp({ pool: untouchedPool });
    const response = await app.handle(new Request("http://localhost/api/v1/receipt-queue"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("POST /receipt-checks with no identity in context is a 401 problem+json, without touching the database", async () => {
    const app = createApp({ pool: untouchedPool });
    const response = await app.handle(
      new Request("http://localhost/api/v1/receipt-checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fuelStopId: "11111111-1111-1111-1111-111111111111", outcome: "confirmed" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("authRequired: false does not exempt the receipt routes from needing an identity — they still 401 with none", async () => {
    // Unlike every other route, the receipt routes need context.userId as
    // data (receipt_checks.checked_by), not just as a boundary check, so
    // requireUser() ignores authRequired entirely (see app.ts).
    const app = createApp({ authRequired: false, pool: untouchedPool });
    const response = await app.handle(new Request("http://localhost/api/v1/receipt-queue"));
    expect(response.status).toBe(401);
  });

  it("PATCH /plans/{id} with no identity in context is a 401 problem+json, without touching the database", async () => {
    const app = createApp({ pool: untouchedPool });
    const id = "11111111-1111-1111-1111-111111111111";
    const response = await app.handle(
      new Request(`http://localhost/api/v1/plans/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sentToDriver: true }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("authRequired: false does not exempt PATCH /plans/{id} from needing an identity — it still 401s with none", async () => {
    const app = createApp({ authRequired: false, pool: untouchedPool });
    const id = "11111111-1111-1111-1111-111111111111";
    const response = await app.handle(
      new Request(`http://localhost/api/v1/plans/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sentToDriver: true }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
