import type { LatLng } from "../domain/planResponse.js";

/**
 * Deliberately not folded into `RoutingProvider` (§8.4, decided 2026-09-22
 * for T-15): that interface's `route`/`matrix` shape is POST + JSON, ORS
 * geocoding (Pelias `/geocode/search`) is GET + query string, and forcing
 * every routing adapter (and every routing test double) to also implement
 * geocoding would couple two vendor choices that are independent in
 * practice. Both interfaces still go through the same budget guard and
 * quota observer, on their own `geocoding` endpoint pool (§8.3) — see
 * `orsHttp.ts`'s `callOrsMetered`, shared by both adapters.
 */
export interface GeocodeCandidate {
  location: LatLng;
  /** The provider's own formatted match — what `saved_locations.matched_label` stores. */
  label: string;
  /** 0–1. ORS/Pelias returns 1 for an exact address match; 0.8 for a fallback match one layer up (measured, T-15 live budget). */
  confidence: number;
  /** Pelias layer: `address`, `street`, `locality`, `region`, ... */
  layer: string;
  matchType: string | undefined;
  /** ISO 3166-2 state/region code (`region_a`), used to tell a genuine cross-state tie from a same-state duplicate record. */
  regionCode: string | undefined;
  countryCode: string | undefined;
}

export interface GeocodeResult {
  candidates: GeocodeCandidate[];
  /** Attribution terms for this response — ORS's geocoding terms, not the routing ODbL string (§17). */
  attribution: string;
  providerRaw: unknown;
}

export interface GeocodeQuery {
  text: string;
}

export interface GeocodingProvider {
  readonly name: "ors" | "here" | "google" | "graphhopper";
  geocode(query: GeocodeQuery): Promise<GeocodeResult>;
}

/** A provider's non-2xx geocoding response, mapped to a typed shape — mirrors `RoutingProviderError` but geocoding's error body shape differs from directions/matrix (§ orsHttp.ts). */
export class GeocodingProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GeocodingProviderError";
  }
}
