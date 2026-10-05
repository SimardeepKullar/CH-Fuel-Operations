import type { Pool } from "pg";
import { getPool } from "../db/pool.js";
import { handleGetDriver, handleListDrivers } from "./routes/drivers.js";
import { handleListExpressCharges } from "./routes/expressCharges.js";
import { handleGetInvoice, handleImportInvoice, handleListInvoices, handlePatchInvoice } from "./routes/invoices.js";
import { handleGetHealth } from "./routes/health.js";
import { handleGetOverview } from "./routes/overview.js";
import { handleListPeriods } from "./routes/periods.js";
import { handleGetPlanActual, handleGetPlanActualBacktest } from "./routes/planActual.js";
import { handlePatchPlan } from "./routes/planPatch.js";
import { handleCreatePlan, handleGetPlan, handleListPlans } from "./routes/plans.js";
import { handleListPriceSheets } from "./routes/priceSheets.js";
import { handleGetReceiptQueue, handlePostReceiptChecks } from "./routes/receipts.js";
import { handleGetStationBilledPrices, handleGetStationPrices, handleListStations } from "./routes/stations.js";
import { handleGetTransaction, handleListTransactions } from "./routes/transactions.js";
import { handleGetTruck, handleListTrucks } from "./routes/trucks.js";
import { createGeocodingProvider, createRoutingProvider } from "../routing/factory.js";
import { problemResponse } from "./problem.js";

/**
 * The framework-free API (§13). `handle()` takes a standard `Request` and
 * returns a standard `Response`, so the whole thing mounts in one Next route
 * file and is exercisable in a unit test with no server and no session.
 *
 * `POST /plans` / `GET /plans/{id}` (T-16) are the first routes that pull
 * `planning`, `optimizer` and `routing` through this mount. T-32, T-33, and
 * T-34 add `/transactions`, `/overview`, and `/invoices` directly to this
 * table rather than waiting on T-16 — TICKETS-v2.md's critical path does not
 * route any of them through it.
 */
export interface CreateAppOptions {
  /**
   * Whether the caller is expected to sit behind an authentication
   * boundary. The app is *told* this — it does not check a session itself,
   * since a framework-free module has no cookie/JWT parsing of its own.
   * Real enforcement is frontend/src/proxy.ts (T-05 §13). This option
   * exists so a caller that deliberately runs with no boundary — a unit
   * test, or T-16's `cli/serve.ts` local dev server — can say so, rather
   * than every test needing a session to exist.
   */
  authRequired?: boolean;
  /**
   * Injected for tests (a schema-scoped pool over a fixture). Production
   * (`frontend/src/app/api/v1/[[...path]]/route.ts`) omits this and each
   * DB-backed route resolves `getPool()` lazily instead — so a request for
   * `/health` alone never requires `DATABASE_URL` to be set.
   */
  pool?: Pool;
}

/**
 * Per-request identity. A bare `Request` carries no session of its own
 * (§13's framework-free boundary), so a route that needs to attribute a
 * write to a person — `receipt_checks.checked_by` is the first one — has
 * nowhere else to read it from. `frontend/src/app/api/v1/[[...path]]/
 * route.ts` calls `auth()` server-side and passes the result through here;
 * a bare `handle(request)` (every existing unit/integration test) simply
 * carries no identity.
 */
export interface HandleContext {
  userId?: string;
}

export interface App {
  readonly authRequired: boolean;
  handle(request: Request, context?: HandleContext): Promise<Response>;
}

/**
 * `/receipt-queue`, `/receipt-checks` and `PATCH /plans/{id}` need
 * `context.userId` unconditionally, not gated by `authRequired`: unlike
 * every other route so far, the id isn't just a boundary check. For the
 * receipt routes it's data the write persists (`receipt_checks.checked_by`).
 * `PATCH /plans/{id}` (T-19) is different: `plans` takes no new column for
 * the acting user (PROJECT-SCOPE-v2.md A11), so `userId` is required here
 * only as an auth boundary — there is no meaningful way to attribute a
 * dispatch without *someone* signed in, but nothing about who is stored.
 */
function requireUser(context: HandleContext | undefined, url: URL): Response | null {
  if (context?.userId) {
    return null;
  }
  return problemResponse({
    title: "Unauthorized",
    status: 401,
    detail: `Authentication required for ${url.pathname}`,
    instance: url.pathname,
  });
}

export function createApp(options: CreateAppOptions = {}): App {
  const authRequired = options.authRequired ?? true;

  return {
    authRequired,
    async handle(request: Request, context?: HandleContext): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v1/, "") || "/";

      if (path === "/health" && request.method === "GET") {
        // Deliberately `options.pool` alone, not `options.pool ?? getPool()`
        // — that would throw synchronously on a missing `DATABASE_URL`
        // before `getHealthStatus` gets a chance to degrade `db.reachable`
        // instead of crashing the request.
        return handleGetHealth(options.pool);
      }

      if (path === "/transactions" && request.method === "GET") {
        return handleListTransactions(options.pool ?? getPool(), url);
      }

      const transactionDetailMatch = /^\/transactions\/([^/]+)$/.exec(path);
      if (transactionDetailMatch && request.method === "GET") {
        return handleGetTransaction(options.pool ?? getPool(), transactionDetailMatch[1]!, url);
      }

      if (path === "/overview" && request.method === "GET") {
        return handleGetOverview(options.pool ?? getPool(), url);
      }

      if (path === "/plan-actual/backtest" && request.method === "GET") {
        return handleGetPlanActualBacktest(options.pool ?? getPool(), url);
      }

      if (path === "/plan-actual" && request.method === "GET") {
        return handleGetPlanActual(options.pool ?? getPool(), url);
      }

      if (path === "/express-charges" && request.method === "GET") {
        return handleListExpressCharges(options.pool ?? getPool(), url);
      }

      if (path === "/drivers" && request.method === "GET") {
        return handleListDrivers(options.pool ?? getPool(), url);
      }

      const driverDetailMatch = /^\/drivers\/([^/]+)$/.exec(path);
      if (driverDetailMatch && request.method === "GET") {
        return handleGetDriver(options.pool ?? getPool(), driverDetailMatch[1]!, url);
      }

      if (path === "/trucks" && request.method === "GET") {
        return handleListTrucks(options.pool ?? getPool(), url);
      }

      const truckDetailMatch = /^\/trucks\/([^/]+)$/.exec(path);
      if (truckDetailMatch && request.method === "GET") {
        return handleGetTruck(options.pool ?? getPool(), truckDetailMatch[1]!, url);
      }

      const stationBilledPricesMatch = /^\/stations\/([^/]+)\/billed-prices$/.exec(path);
      if (stationBilledPricesMatch && request.method === "GET") {
        return handleGetStationBilledPrices(options.pool ?? getPool(), stationBilledPricesMatch[1]!, url);
      }

      const stationPricesMatch = /^\/stations\/([^/]+)\/prices$/.exec(path);
      if (stationPricesMatch && request.method === "GET") {
        return handleGetStationPrices(options.pool ?? getPool(), stationPricesMatch[1]!, url);
      }

      if (path === "/stations" && request.method === "GET") {
        return handleListStations(options.pool ?? getPool(), url);
      }

      if (path === "/invoices/import" && request.method === "POST") {
        return handleImportInvoice(options.pool ?? getPool(), request, url);
      }

      if (path === "/invoices" && request.method === "GET") {
        return handleListInvoices(options.pool ?? getPool(), url);
      }

      const invoiceDetailMatch = /^\/invoices\/([^/]+)$/.exec(path);
      if (invoiceDetailMatch && request.method === "GET") {
        return handleGetInvoice(options.pool ?? getPool(), invoiceDetailMatch[1]!, url);
      }

      if (invoiceDetailMatch && request.method === "PATCH") {
        return handlePatchInvoice(options.pool ?? getPool(), invoiceDetailMatch[1]!, request, url);
      }

      if (path === "/periods" && request.method === "GET") {
        return handleListPeriods(options.pool ?? getPool());
      }

      if (path === "/price-sheets" && request.method === "GET") {
        return handleListPriceSheets(options.pool ?? getPool());
      }

      if (path === "/plans" && request.method === "GET") {
        return handleListPlans(options.pool ?? getPool(), url);
      }

      if (path === "/plans" && request.method === "POST") {
        return handleCreatePlan(
          options.pool ?? getPool(),
          request,
          url,
          { routingProvider: createRoutingProvider(), geocoder: createGeocodingProvider(), now: new Date() },
          context?.userId ?? null,
        );
      }

      const planDetailMatch = /^\/plans\/([^/]+)$/.exec(path);
      if (planDetailMatch && request.method === "GET") {
        return handleGetPlan(options.pool ?? getPool(), planDetailMatch[1]!, url);
      }

      if (planDetailMatch && request.method === "PATCH") {
        const unauthorized = requireUser(context, url);
        if (unauthorized) {
          return unauthorized;
        }
        return handlePatchPlan(options.pool ?? getPool(), planDetailMatch[1]!, request, url, context!.userId!);
      }

      if (path === "/receipt-queue" && request.method === "GET") {
        const unauthorized = requireUser(context, url);
        if (unauthorized) {
          return unauthorized;
        }
        return handleGetReceiptQueue(options.pool ?? getPool(), url);
      }

      if (path === "/receipt-checks" && request.method === "POST") {
        const unauthorized = requireUser(context, url);
        if (unauthorized) {
          return unauthorized;
        }
        return handlePostReceiptChecks(options.pool ?? getPool(), request, url, context!.userId!);
      }

      return problemResponse({
        title: "Not Found",
        status: 404,
        detail: `No route for ${request.method} ${path}`,
        instance: url.pathname,
      });
    },
  };
}
