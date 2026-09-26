import { z } from "zod";
import type { Pool } from "pg";
import type { LatLng } from "../domain/planResponse.js";
import type { GeocodeCandidate, GeocodeResult, GeocodingProvider } from "../routing/geocodeProvider.js";
import { ORS_GEOCODE_ATTRIBUTION } from "../routing/orsGeocoder.js";
import { normalizeAddress } from "./addressNormalize.js";
import {
  getCachedLocationAndTouch,
  purgeExpiredLocations,
  saveGeocodedLocation,
} from "./savedLocations.js";

/**
 * `POST /plans` accepts `{address}` or `{lat,lng}` (§14, T-15 step 15.2).
 * `{lat,lng}` bypasses geocoding entirely, so it is validated on its own —
 * lat ±90, lng ±180 — never coerced and never defaulted to `0` (nulls-are-
 * meaningful rule, CLAUDE.md). `.finite()` rejects `NaN`/`Infinity`, which
 * `z.number()` alone would let through.
 */
const latLngSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();

const addressInputSchema = z
  .object({
    address: z.string().trim().min(1),
  })
  .strict();

export type ParsedLocationInput = { kind: "coordinates"; location: LatLng } | { kind: "address"; address: string };

/** Thrown by `parseLocationInput`, naming the field so `POST /plans` (T-16) can map it onto an RFC 9457 error. */
export class LocationInputError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "LocationInputError";
  }
}

/**
 * Pure: no database, no HTTP, no clock. Distinguishes the two input shapes
 * by which keys are present, then validates whichever shape was given —
 * so a malformed `{address}` never falls through and gets misread as a
 * missing `{lat,lng}`, and vice versa. Both keys present is rejected rather
 * than guessed at.
 */
export function parseLocationInput(input: unknown, field: string): ParsedLocationInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new LocationInputError(field, `${field} must be an object with either "address" or "lat"/"lng"`);
  }
  const obj = input as Record<string, unknown>;
  const hasAddress = "address" in obj;
  const hasLatLng = "lat" in obj || "lng" in obj;

  if (hasAddress && hasLatLng) {
    throw new LocationInputError(field, `${field} must be either "address" or "lat"/"lng", not both`);
  }

  if (hasAddress) {
    const parsed = addressInputSchema.safeParse(obj);
    if (!parsed.success) {
      throw new LocationInputError(`${field}.address`, parsed.error.issues[0]?.message ?? "invalid address");
    }
    return { kind: "address", address: parsed.data.address };
  }

  if (hasLatLng) {
    const parsed = latLngSchema.safeParse(obj);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const subfield = issue?.path[0] !== undefined ? String(issue.path[0]) : "lat/lng";
      throw new LocationInputError(`${field}.${subfield}`, issue?.message ?? "invalid coordinates");
    }
    return { kind: "coordinates", location: parsed.data };
  }

  throw new LocationInputError(field, `${field} must provide either "address" or "lat"/"lng"`);
}

/**
 * Measured, T-15 live budget (2026-09-21): an exact address match returns
 * confidence 1; a street-layer fallback for a nonexistent house number
 * returns 0.8. The floor sits strictly between.
 */
export const MIN_GEOCODE_CONFIDENCE = 0.9;

export type GeocodeRejectionCode = "no_match" | "low_confidence" | "ambiguous";

/** Thrown by `pickCandidate`, never cached (§ savedLocations.ts is only ever called with an already-accepted candidate). */
export class GeocodeError extends Error {
  constructor(
    public readonly code: GeocodeRejectionCode,
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "GeocodeError";
  }
}

/**
 * Accept/reject policy over a geocoder's raw candidates. Pure — tested with
 * a fake `GeocodeResult`, no provider or database — and decided 2026-09-22
 * against six live-recorded cases (`backend/test/fixtures/ors/geocode-*.json`):
 *
 *  - No candidates at all: reject (`no_match`).
 *  - The top candidate's confidence below `MIN_GEOCODE_CONFIDENCE`: reject
 *    (`low_confidence`). Granularity alone is never rejected — a confident
 *    city-centroid match ("Chicago, IL" resolving to the city, not a
 *    specific address) is accepted, only a genuinely unsure one is not.
 *  - Multiple candidates tied at the top confidence: rejected only if they
 *    disagree on `regionCode` (`ambiguous`) — "100 Main St" with no city or
 *    state ties three ways across AR/NV/MA and cannot be resolved without
 *    more input. Two same-state duplicate records (ORS/WhosOnFirst returns
 *    two "Chicago, IL" locality entries ~15 miles apart, one per county) are
 *    not ambiguous in that sense; the top-ranked one is accepted.
 */
export function pickCandidate(result: GeocodeResult, field: string): GeocodeCandidate {
  const { candidates } = result;
  const top = candidates[0];
  if (!top) {
    throw new GeocodeError("no_match", field, `${field}: no geocoding match`);
  }

  if (top.confidence < MIN_GEOCODE_CONFIDENCE) {
    throw new GeocodeError(
      "low_confidence",
      field,
      `${field}: best match "${top.label}" has confidence ${top.confidence}, below the ${MIN_GEOCODE_CONFIDENCE} floor`,
    );
  }

  const tied = candidates.filter((candidate) => candidate.confidence >= top.confidence);
  const disagreesOnState = tied.some((candidate) => candidate.regionCode !== top.regionCode);
  if (tied.length > 1 && disagreesOnState) {
    const regions = tied.map((candidate) => candidate.regionCode ?? "unknown").join(", ");
    throw new GeocodeError(
      "ambiguous",
      field,
      `${field}: ${tied.length} equally confident matches disagree on state (${regions})`,
    );
  }

  return top;
}

export interface LocationResolution {
  /** The provider's resolved text for a geocoded address; `null` for a `{lat,lng}` bypass, which typed no address to resolve. */
  label: string | null;
  location: LatLng;
  source: "coordinates" | "cache" | "geocoded";
  /**
   * The geocoding provider's attribution terms — `null` only when `source`
   * is `"coordinates"`, since then no provider was ever called. A `"cache"`
   * hit still carries it: the coordinates it serves were provider-sourced,
   * the same reasoning §17 applies to a re-served `routes` cache row.
   */
  attribution: string | null;
}

export interface ResolveLocationDeps {
  pool: Pool;
  geocoder: GeocodingProvider;
  now: Date;
}

/**
 * Resolves one `POST /plans` endpoint (origin or destination) through the
 * cache, geocoding on a miss and storing the result (§11.6, T-15). Only the
 * geocode is cached, never the plan — §11.6, §4.3: yesterday's cheapest
 * route for the same lane is not today's.
 */
export async function resolveAddress(
  addressRaw: string,
  field: string,
  deps: ResolveLocationDeps,
): Promise<LocationResolution> {
  const addressNorm = normalizeAddress(addressRaw);

  const cached = await getCachedLocationAndTouch(deps.pool, addressNorm, deps.now);
  if (cached) {
    return {
      label: cached.matchedLabel ?? cached.addressRaw,
      location: cached.location,
      source: "cache",
      // ORS is the only geocoding provider today; the attribution string is
      // provider-specific, not generic, so a future provider needs its own
      // case here rather than a silent fallback (§8.4's factory pattern).
      attribution: deps.geocoder.name === "ors" ? ORS_GEOCODE_ATTRIBUTION : null,
    };
  }

  await purgeExpiredLocations(deps.pool, deps.now);

  const result = await deps.geocoder.geocode({ text: addressRaw });
  const candidate = pickCandidate(result, field);

  await saveGeocodedLocation(
    deps.pool,
    {
      addressRaw,
      addressNorm,
      matchedLabel: candidate.label,
      location: candidate.location,
      source: deps.geocoder.name,
    },
    deps.now,
  );

  return {
    label: candidate.label,
    location: candidate.location,
    source: "geocoded",
    attribution: result.attribution,
  };
}

/**
 * Both input shapes, in one call (T-15 step 15.2). `{lat,lng}` never
 * touches the geocoder, the cache or the database.
 */
export async function resolveLocation(
  input: unknown,
  field: string,
  deps: ResolveLocationDeps,
): Promise<LocationResolution> {
  const parsed = parseLocationInput(input, field);
  if (parsed.kind === "coordinates") {
    return { label: null, location: parsed.location, source: "coordinates", attribution: null };
  }
  return resolveAddress(parsed.address, field, deps);
}
