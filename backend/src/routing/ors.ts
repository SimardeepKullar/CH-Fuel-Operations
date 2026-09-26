import pino from "pino";
import type { Pool } from "pg";
import type { LatLng } from "../domain/planResponse.js";
import { metersToMiles } from "../domain/units.js";
import { DEFAULT_BUDGET_CEILINGS, type OrsEndpoint } from "./budgetCeilings.js";
import { callOrsMetered, requestHash } from "./orsHttp.js";
import {
  RoutingProviderError,
  type MatrixRequest,
  type MatrixResult,
  type RouteRequest,
  type RouteResult,
  type RoutingProvider,
  type TruckSpec,
} from "./provider.js";

const ORS_BASE_URL = "https://api.openrouteservice.org";
const DIRECTIONS_PATH = "/v2/directions/driving-hgv/json";
const MATRIX_PATH = "/v2/matrix/driving-hgv";

/**
 * The most routes (sources x destinations) one matrix request may ask for. Measured 2026-09-21 (T-14
 * step 14.3): a 60 x 60 request was refused with error 6004, "Only a total of 3500 routes are
 * allowed", and a 50 x 50 one was accepted. That is 3,500, not the 2,500 v3.4 carried; the largest
 * square is 59 x 59. The fixtures are `test/fixtures/ors/detour-matrix-*.json`.
 */
export const ORS_MATRIX_MAX_ROUTES = 3500;

/** §17: the exact attribution strings a plan response must carry when routing comes from ORS. Decided text, not T-17's to invent. */
export const ORS_ROUTING_ATTRIBUTION = "© openrouteservice.org (HeiGIT)";
export const OSM_PLACE_DATA_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

type Logger = Pick<pino.Logger, "info" | "error">;

export interface OrsRoutingProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /**
   * Both meters (§8.3) need somewhere to persist. Omit it to skip metering
   * entirely — the offline fixture suite does this so it stays free of a
   * database dependency; the factory wires a real pool for production use.
   */
  pool?: Pool;
  /** Daily calls allowed per endpoint; overrides `DEFAULT_BUDGET_CEILINGS`, per endpoint. */
  budgetCeilings?: Partial<Record<OrsEndpoint, number>>;
}

interface OrsRouteResponseBody {
  routes: Array<{
    summary: { distance: number; duration: number };
    geometry: string;
    segments: Array<{ distance: number; duration: number }>;
  }>;
}

/**
 * ORS answers in metres, so the response body types stay metres. The adapter
 * converts to miles once, where it parses them; nothing it returns is metric.
 */
interface OrsMatrixResponseBody {
  /** `null` is an unreachable pair. */
  distances: Array<Array<number | null>>;
  durations: number[][];
}

interface OrsErrorBody {
  error?: { code?: string | number; message?: string } | string;
}

function toLngLat(point: LatLng): [number, number] {
  return [point.lng, point.lat];
}

/**
 * ORS HGV restrictions: length/width/height in metres, weight/axleload in
 * tonnes. `axleload` is the provider's per-axle limit, not our `axleCount` —
 * approximated as the average load per axle from gross weight, since
 * §16's profile carries no per-axle figure. Omitted keys mean "unspecified,"
 * left to the provider's own default, never `0` (§6 decision 16's nulls rule
 * applies to inputs generally).
 */
function buildRestrictions(spec: TruckSpec): Record<string, number | boolean> | undefined {
  const restrictions: Record<string, number | boolean> = {};
  if (spec.lengthCm != null) {
    restrictions.length = spec.lengthCm / 100;
  }
  if (spec.widthCm != null) {
    restrictions.width = spec.widthCm / 100;
  }
  if (spec.heightCm != null) {
    restrictions.height = spec.heightCm / 100;
  }
  if (spec.grossWeightKg != null) {
    restrictions.weight = spec.grossWeightKg / 1000;
    if (spec.axleCount) {
      restrictions.axleload = spec.grossWeightKg / 1000 / spec.axleCount;
    }
  }
  if (spec.hazmatClass != null) {
    restrictions.hazmat = true;
  }
  return Object.keys(restrictions).length > 0 ? restrictions : undefined;
}

/**
 * `driving-hgv` truck-legal routing (§8.4). Fixtures recorded from the live
 * free tier live in `backend/test/fixtures/ors/`, committed with ODbL
 * attribution (§17) so the suite runs with no network.
 */
export class OrsRoutingProvider implements RoutingProvider {
  readonly name = "ors" as const;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly explicitApiKey: string | undefined;
  private readonly pool: Pool | undefined;
  private readonly budgetCeilings: Record<OrsEndpoint, number>;

  constructor(options: OrsRoutingProviderOptions = {}) {
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

  async route(req: RouteRequest): Promise<RouteResult> {
    const coordinates = [
      toLngLat(req.origin),
      ...(req.via ?? []).map(toLngLat),
      toLngLat(req.destination),
    ];
    const restrictions = buildRestrictions(req.truckSpec);
    const body: Record<string, unknown> = { coordinates };
    if (restrictions) {
      body.options = { profile_params: { restrictions } };
    }

    const parsed = await this.call<OrsRouteResponseBody>("directions", DIRECTIONS_PATH, body);
    const route = parsed.routes[0];
    if (!route) {
      throw new RoutingProviderError("ors", 200, undefined, "ORS returned no routes");
    }
    return {
      polyline: route.geometry,
      distanceMiles: metersToMiles(route.summary.distance),
      durationSeconds: route.summary.duration,
      legs: route.segments.map((segment) => ({
        distanceMiles: metersToMiles(segment.distance),
        durationSeconds: segment.duration,
      })),
      providerRaw: parsed,
    };
  }

  async matrix(req: MatrixRequest): Promise<MatrixResult> {
    const locations = [...req.origins, ...req.destinations].map(toLngLat);
    const sources = req.origins.map((_, index) => index);
    const destinations = req.destinations.map((_, index) => req.origins.length + index);
    const body = { locations, sources, destinations, metrics: ["distance", "duration"] };

    const parsed = await this.call<OrsMatrixResponseBody>("matrix", MATRIX_PATH, body);
    return {
      distanceMiles: parsed.distances.map((row) =>
        row.map((meters) => (meters === null ? null : metersToMiles(meters))),
      ),
      durationSeconds: parsed.durations,
    };
  }

  private async call<T>(endpoint: OrsEndpoint, path: string, body: Record<string, unknown>): Promise<T> {
    const hash = requestHash({ endpoint, body });
    const url = `${this.baseUrl}${path}`;

    const doFetch = (): Promise<Response> =>
      this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: this.apiKey(),
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });

    let response: Response;
    try {
      response = await callOrsMetered(endpoint, doFetch, {
        pool: this.pool,
        providerName: this.name,
        budgetCeilings: this.budgetCeilings,
      });
    } catch (err) {
      this.logger.error({ provider: "ors", endpoint, requestHash: hash, err }, "ors request failed");
      throw err;
    }

    const status = response.status;
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => undefined)) as OrsErrorBody | undefined;
      const errorInfo = errorBody?.error;
      const message =
        typeof errorInfo === "string"
          ? errorInfo
          : (errorInfo?.message ?? `ORS request failed with status ${status}`);
      const code = typeof errorInfo === "string" ? undefined : errorInfo?.code;
      this.logger.info({ provider: "ors", endpoint, requestHash: hash, status }, "ors request completed");
      throw new RoutingProviderError("ors", status, code, message);
    }

    const parsed = (await response.json()) as T;
    this.logger.info({ provider: "ors", endpoint, requestHash: hash, status }, "ors request completed");
    return parsed;
  }
}
