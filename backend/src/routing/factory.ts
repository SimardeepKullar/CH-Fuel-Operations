import { getPool } from "../db/pool.js";
import { resolveBudgetCeilings } from "./budgetCeilings.js";
import type { GeocodingProvider } from "./geocodeProvider.js";
import { OrsGeocoder } from "./orsGeocoder.js";
import { OrsRoutingProvider } from "./ors.js";
import type { RoutingProvider } from "./provider.js";

/**
 * §8.4: `ROUTING_PROVIDER` selects the adapter. Adopting HERE later is one
 * new adapter file plus one case here, with no caller changed. The real
 * pool wires up both meters (§8.3) — the budget guard and quota observer —
 * so production calls are metered; tests construct the adapter directly
 * without a pool to stay off the database.
 */
export function createRoutingProvider(
  providerName: string | undefined = process.env.ROUTING_PROVIDER,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RoutingProvider {
  switch (providerName) {
    case "ors":
      // Resolved before the pool is touched, so a malformed ceiling fails here.
      return new OrsRoutingProvider({ budgetCeilings: resolveBudgetCeilings(env), pool: getPool() });
    default:
      throw new Error(`Unknown routing provider: ${String(providerName)}`);
  }
}

/**
 * The geocoding equivalent (T-15). Reuses `ROUTING_PROVIDER` rather than a
 * separate variable — no vendor beyond ORS is wired up yet, and adopting
 * one later means adding a geocoding case alongside its routing case here,
 * for the same vendor, not a second selector to keep in sync.
 */
export function createGeocodingProvider(
  providerName: string | undefined = process.env.ROUTING_PROVIDER,
  env: Readonly<Record<string, string | undefined>> = process.env,
): GeocodingProvider {
  switch (providerName) {
    case "ors":
      return new OrsGeocoder({ budgetCeilings: resolveBudgetCeilings(env), pool: getPool() });
    default:
      throw new Error(`Unknown geocoding provider: ${String(providerName)}`);
  }
}
