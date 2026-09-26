import pino from "pino";
import type { Pool } from "pg";
import { DEFAULT_BUDGET_CEILINGS, type OrsEndpoint } from "./budgetCeilings.js";
import {
  GeocodingProviderError,
  type GeocodeCandidate,
  type GeocodeQuery,
  type GeocodeResult,
  type GeocodingProvider,
} from "./geocodeProvider.js";
import { callOrsMetered, requestHash } from "./orsHttp.js";

const ORS_BASE_URL = "https://api.openrouteservice.org";
const GEOCODE_PATH = "/geocode/search";

/**
 * ORS's geocoding attribution terms (recorded 2026-09-21, T-15 live budget —
 * the same URL on every response). Used as the fallback for a malformed
 * response missing `geocoding.attribution`, and reused by
 * `catalog/geocode.ts` for a cache hit, which has no live response to read
 * it from (§17: the coordinates it serves are still provider-sourced).
 */
export const ORS_GEOCODE_ATTRIBUTION = "https://openrouteservice.org/terms-of-service/#attribution-geocode";

/** How many candidates to request — enough to detect a tie (§ catalog/geocode.ts's ambiguity rule) without spending extra quota (one call either way). */
const RESULT_SIZE = 3;

type Logger = Pick<pino.Logger, "info" | "error">;

export interface OrsGeocoderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Same meaning as `OrsRoutingProviderOptions.pool` — omit to stay off the database. */
  pool?: Pool;
  budgetCeilings?: Partial<Record<OrsEndpoint, number>>;
}

interface OrsGeocodeFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    label: string;
    confidence: number;
    layer: string;
    match_type?: string;
    region_a?: string;
    country_a?: string;
  };
}

interface OrsGeocodeResponseBody {
  geocoding?: {
    attribution?: string;
    /** Present on both success and failure; populated only on failure. */
    errors?: string[];
  };
  features: OrsGeocodeFeature[];
}

/**
 * ORS's Pelias-based geocoder (§8.4, §11.6, T-15). Fixtures recorded from
 * the live free tier live in `backend/test/fixtures/ors/geocode-*.json`,
 * committed with ODbL/OpenAddresses/WhosOnFirst attribution (§17) so the
 * suite runs with no network.
 */
export class OrsGeocoder implements GeocodingProvider {
  readonly name = "ors" as const;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly explicitApiKey: string | undefined;
  private readonly pool: Pool | undefined;
  private readonly budgetCeilings: Record<OrsEndpoint, number>;

  constructor(options: OrsGeocoderOptions = {}) {
    this.baseUrl = options.baseUrl ?? ORS_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? pino();
    this.explicitApiKey = options.apiKey;
    this.pool = options.pool;
    this.budgetCeilings = { ...DEFAULT_BUDGET_CEILINGS, ...options.budgetCeilings };
  }

  private apiKey(): string {
    const key = this.explicitApiKey ?? process.env.ORS_API_KEY;
    if (!key) {
      throw new Error("ORS_API_KEY is not set");
    }
    return key;
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    const params = new URLSearchParams({
      text: query.text,
      "boundary.country": "US",
      size: String(RESULT_SIZE),
    });
    const url = `${this.baseUrl}${GEOCODE_PATH}?${params.toString()}`;
    const hash = requestHash({ endpoint: "geocoding", text: query.text });

    const doFetch = (): Promise<Response> =>
      this.fetchImpl(url, {
        method: "GET",
        headers: { Authorization: this.apiKey() },
      });

    let response: Response;
    try {
      response = await callOrsMetered("geocoding", doFetch, {
        pool: this.pool,
        providerName: this.name,
        budgetCeilings: this.budgetCeilings,
      });
    } catch (err) {
      this.logger.error({ provider: "ors", endpoint: "geocoding", requestHash: hash, err }, "ors geocode request failed");
      throw err;
    }

    const status = response.status;
    const body = (await response.json().catch(() => undefined)) as OrsGeocodeResponseBody | undefined;

    if (!response.ok) {
      const errors = body?.geocoding?.errors;
      const message =
        errors && errors.length > 0 ? errors.join("; ") : `ORS geocode request failed with status ${status}`;
      this.logger.info({ provider: "ors", endpoint: "geocoding", requestHash: hash, status }, "ors geocode request completed");
      throw new GeocodingProviderError("ors", status, message);
    }

    this.logger.info({ provider: "ors", endpoint: "geocoding", requestHash: hash, status }, "ors geocode request completed");

    const features = body?.features ?? [];
    const candidates: GeocodeCandidate[] = features.map((feature) => ({
      location: { lat: feature.geometry.coordinates[1], lng: feature.geometry.coordinates[0] },
      label: feature.properties.label,
      confidence: feature.properties.confidence,
      layer: feature.properties.layer,
      matchType: feature.properties.match_type,
      regionCode: feature.properties.region_a,
      countryCode: feature.properties.country_a,
    }));

    return {
      candidates,
      attribution: body?.geocoding?.attribution ?? ORS_GEOCODE_ATTRIBUTION,
      providerRaw: body,
    };
  }
}
