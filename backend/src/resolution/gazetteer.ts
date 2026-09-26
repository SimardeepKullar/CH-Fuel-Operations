import { normalizeCity } from "./cityNormalize.js";

/**
 * Tier 3 of §11.4's resolution ladder: a `place_centroids` row for one
 * (state, normalized city). Pure — the DB read lives in `cli/resolve.ts`,
 * this only does the matching (§7.1's split, same as `operatorExport.ts`).
 */
export interface PlaceCentroid {
  stateUsps: string;
  nameNormalized: string;
  latitude: number;
  longitude: number;
  uncertaintyMiles: number;
}

export interface StationForGazetteerMatch {
  id: string;
  cityRaw: string;
  stateUsps: string;
}

export interface GazetteerMatch {
  resolution: "city";
  resolutionSource: "gazetteer";
  cityNormalized: string;
  uncertaintyMiles: number;
  latitude: number;
  longitude: number;
}

export interface GazetteerMatchResult {
  stationId: string;
  cityNormalized: string;
  match: GazetteerMatch | null;
}

/**
 * Looks up one station's normalized city against the supplied centroids.
 * Never throws on a miss — a station with no gazetteer centroid stays
 * `unresolved`, exactly like tier 1's unmatched stations (T-08).
 */
export function matchToGazetteer(
  cityRaw: string,
  stateUsps: string,
  centroids: readonly PlaceCentroid[],
): GazetteerMatch | null {
  const cityNormalized = normalizeCity(cityRaw);
  const centroid = centroids.find(
    (c) => c.stateUsps === stateUsps && c.nameNormalized === cityNormalized,
  );
  if (!centroid) {
    return null;
  }
  return {
    resolution: "city",
    resolutionSource: "gazetteer",
    cityNormalized,
    uncertaintyMiles: centroid.uncertaintyMiles,
    latitude: centroid.latitude,
    longitude: centroid.longitude,
  };
}

/** Batch form of `matchToGazetteer`, one result per input station, order preserved. */
export function matchStationsToGazetteer(
  stations: readonly StationForGazetteerMatch[],
  centroids: readonly PlaceCentroid[],
): GazetteerMatchResult[] {
  return stations.map((station) => {
    const match = matchToGazetteer(station.cityRaw, station.stateUsps, centroids);
    return {
      stationId: station.id,
      cityNormalized: match?.cityNormalized ?? normalizeCity(station.cityRaw),
      match,
    };
  });
}

/** Miles, like everything else stored (T-52). Was 8 km until 2026-09-20. */
/** Also the widest a station's `uncertainty_miles` can legitimately be (T-16's corridor screening reuses this bound). */
export const CITY_TIER_MAX_UNCERTAINTY_MILES = 5;

/**
 * §11.4 step 3's eligibility rule: a city-tier station is a valid stop only
 * if its uncertainty is under 5 miles *and* the leg has at least 2u of slack —
 * enough room that the true station location, wherever inside the
 * uncertainty circle it actually is, cannot push the leg over the cap.
 * `unresolved` stations never reach this function; they are filtered out
 * upstream by `resolution <> 'unresolved'` (T-11).
 */
export function isCityTierEligible(uncertaintyMiles: number, legSlackMiles: number): boolean {
  return uncertaintyMiles < CITY_TIER_MAX_UNCERTAINTY_MILES && legSlackMiles >= 2 * uncertaintyMiles;
}
