import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handleGetDriver, handleListDrivers } from "./drivers.js";
import { handleListExpressCharges } from "./expressCharges.js";
import { handleGetOverview } from "./overview.js";
import { handleGetPlanActual } from "./planActual.js";
import { handleGetReceiptQueue } from "./receipts.js";
import { handleGetStationBilledPrices } from "./stations.js";
import { handleGetTransaction, handleListTransactions } from "./transactions.js";
import { handleGetTruck, handleListTrucks } from "./trucks.js";

/** Fails the moment anything on it is called: a rejected request must never
 * reach the database. */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

const ID = "3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e";
const urlOf = (path: string, query: string) => new URL(`http://localhost/api/v1${path}${query}`);

type Handler = (query: string) => Promise<Response>;

/** Every route that takes `?week=` as a *required* key (T-63). */
const WEEK_REQUIRED: Array<[string, Handler]> = [
  ["GET /drivers", (q) => handleListDrivers(untouchedPool, urlOf("/drivers", q))],
  ["GET /drivers/{id}", (q) => handleGetDriver(untouchedPool, ID, urlOf(`/drivers/${ID}`, q))],
  ["GET /trucks/{id}", (q) => handleGetTruck(untouchedPool, ID, urlOf(`/trucks/${ID}`, q))],
  ["GET /express-charges", (q) => handleListExpressCharges(untouchedPool, urlOf("/express-charges", q))],
  ["GET /overview", (q) => handleGetOverview(untouchedPool, urlOf("/overview", q))],
  ["GET /plan-actual", (q) => handleGetPlanActual(untouchedPool, urlOf("/plan-actual", q))],
];

/** Routes where `week` is optional (a roster picker, a history, a standing
 * queue) but must still be well-formed when it is sent. */
const WEEK_OPTIONAL: Array<[string, Handler]> = [
  ["GET /trucks", (q) => handleListTrucks(untouchedPool, urlOf("/trucks", q))],
  ["GET /transactions", (q) => handleListTransactions(untouchedPool, urlOf("/transactions", q))],
  ["GET /receipt-queue", (q) => handleGetReceiptQueue(untouchedPool, urlOf("/receipt-queue", q))],
];

async function expectProblem400(response: Response): Promise<void> {
  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toBe("application/problem+json");
}

describe("period-scoped routes: week, currency and units are validated before anything is looked up (T-63)", () => {
  describe.each(WEEK_REQUIRED)("%s", (_name, call) => {
    it("400s a missing week", async () => {
      await expectProblem400(await call(""));
    });
    it.each(["nope", "2026-09", "2026-9-9", "2026-13-45", "2026-02-30", ""])("400s a malformed week %j", async (week) => {
      await expectProblem400(await call(`?week=${week}`));
    });
  });

  describe.each(WEEK_OPTIONAL)("%s", (_name, call) => {
    it.each(["nope", "2026-09", "2026-13-45"])("400s a malformed week %j when one is sent", async (week) => {
      await expectProblem400(await call(`?week=${week}`));
    });
  });

  // Plan vs Actual is US-only and takes no currency at all.
  describe.each([...WEEK_REQUIRED.filter(([name]) => name !== "GET /plan-actual"), ...WEEK_OPTIONAL])("%s", (_name, call) => {
    it.each(["EUR", "usd", "CA", "CN", ""])("400s an unknown currency %j", async (currency) => {
      await expectProblem400(await call(`?week=2026-09-09&currency=${currency}`));
    });
  });

  // The receipt queue and Plan vs Actual are money only, so they take no `units`.
  describe.each([...WEEK_REQUIRED, ...WEEK_OPTIONAL].filter(([name]) => name !== "GET /receipt-queue" && name !== "GET /plan-actual"))("%s", (_name, call) => {
    it("400s an unknown units value", async () => {
      await expectProblem400(await call("?week=2026-09-09&units=furlongs"));
    });
  });

  it("GET /stations/{id}/billed-prices 400s an unknown currency or units", async () => {
    await expectProblem400(await handleGetStationBilledPrices(untouchedPool, ID, urlOf(`/stations/${ID}/billed-prices`, "?currency=EUR")));
    await expectProblem400(await handleGetStationBilledPrices(untouchedPool, ID, urlOf(`/stations/${ID}/billed-prices`, "?units=x")));
  });

  it("GET /transactions/{id} 400s an unknown units value", async () => {
    await expectProblem400(await handleGetTransaction(untouchedPool, ID, urlOf(`/transactions/${ID}`, "?units=x")));
  });
});
