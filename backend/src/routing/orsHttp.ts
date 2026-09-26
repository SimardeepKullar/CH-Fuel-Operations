import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { OrsEndpoint } from "./budgetCeilings.js";
import { withBudgetGuard } from "./budgetGuard.js";
import { parseQuotaHeaders, recordQuota } from "./quotaObserver.js";

/**
 * The guard/quota plumbing §8.3 requires of every ORS endpoint — directions,
 * matrix and geocoding alike. Shared so `OrsRoutingProvider` (POST + JSON
 * body) and `OrsGeocoder` (GET + query string, T-15) meter identically
 * without either adapter re-implementing the other's error-body shape:
 * ORS's directions/matrix errors are `{error:{code,message}},` its geocode
 * errors are `{geocoding:{errors:[...]}}` (recorded 2026-09-21, T-15 live
 * budget) — different enough that response parsing stays with each caller.
 */
export function requestHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export interface OrsCallDeps {
  /** Omit to skip metering entirely (the offline fixture suite does this). */
  pool: Pool | undefined;
  providerName: "ors";
  budgetCeilings: Record<OrsEndpoint, number>;
}

/**
 * Reserves budget (when metered), runs `doFetch`, then records the quota
 * headers on the response — success or failure alike, since a reserved call
 * that then fails downstream still spent an endpoint's daily allowance.
 * Callers still do their own error-body parsing and logging; this only
 * covers the part every ORS endpoint does identically.
 */
export async function callOrsMetered(
  endpoint: OrsEndpoint,
  doFetch: () => Promise<Response>,
  deps: OrsCallDeps,
): Promise<Response> {
  const response = deps.pool
    ? await withBudgetGuard(deps.pool, deps.providerName, endpoint, deps.budgetCeilings[endpoint], doFetch)
    : await doFetch();

  if (deps.pool) {
    await recordQuota(deps.pool, deps.providerName, endpoint, parseQuotaHeaders(response.headers));
  }

  return response;
}
