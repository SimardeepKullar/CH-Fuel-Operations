import type { Pool } from "pg";
import { z } from "zod";
import { GeocodeError, LocationInputError } from "../../catalog/geocode.js";
import { CorridorError } from "../../planning/corridor.js";
import { convertPlanResponseUnits } from "../../domain/planResponseUnits.js";
import type { CreatePlanRequest, Units } from "../../domain/planResponse.js";
import { createPlan, getPlan, PlanServiceError, type PlanServiceDeps } from "../../planning/planService.js";
import { listPlans } from "../../planning/planPersistence.js";
import { BudgetExceededError } from "../../routing/budgetGuard.js";
import { RoutingProviderError } from "../../routing/provider.js";
import { GeocodingProviderError } from "../../routing/geocodeProvider.js";
import { problemResponse } from "../problem.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Every "null = default" field on `CreatePlanRequest` is required, not
 * `.optional()`: a caller must say `null` on purpose (CLAUDE.md's
 * nulls-are-meaningful rule) rather than the key simply being missing and
 * silently reading as the same thing. `optimizerStrategy`/`priceEffectiveOn`
 * are the two genuinely optional keys, matching the domain type's `?`.
 */
const createPlanRequestSchema = z
  .object({
    origin: z.unknown(),
    destination: z.unknown(),
    truckId: z.string().uuid(),
    startFuelGallons: z.number().finite().nullable(),
    minArrivalGallons: z.number().finite().nullable(),
    maxLegMiles: z.number().finite().nullable(),
    minLegMiles: z.number().finite().nullable(),
    corridorMiles: z.number().finite().nullable(),
    maxDetourMiles: z.number().finite().nullable(),
    maxStops: z.number().int().nullable(),
    priceBasis: z.enum(["pump", "ifta_net", "total_cost"]),
    driverCostPerHour: z.number().finite(),
    fixedStopMinutes: z.number().finite(),
    optimizerStrategy: z.string().min(1).optional(),
    priceEffectiveOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "priceEffectiveOn must be YYYY-MM-DD")
      .nullable()
      .optional(),
    departAt: z.string().nullable(),
  })
  .strict();

const unitsSchema = z.enum(["imperial", "metric"]).default("imperial");

function parseUnits(url: URL): Units | null {
  const raw = url.searchParams.get("units");
  const parsed = unitsSchema.safeParse(raw ?? undefined);
  return parsed.success ? parsed.data : null;
}

/**
 * `POST /plans` (§14). Synchronous — the whole pipeline runs in this one
 * request and the response is the finished plan, never a job reference
 * (§6 decision 19, §10). A technical failure below maps to an RFC 9457
 * error and persists nothing; only a DP-produced `infeasible` result is a
 * 200 (§12.2 — it is a legitimate answer, not an error).
 */
export async function handleCreatePlan(pool: Pool, request: Request, url: URL, deps: Omit<PlanServiceDeps, "pool">, createdBy: string | null): Promise<Response> {
  const units = parseUnits(url);
  if (units === null) {
    return problemResponse({ title: "Bad Request", status: 400, detail: '"units" must be "imperial" or "metric"', instance: url.pathname });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemResponse({ title: "Bad Request", status: 400, detail: "expected a JSON body", instance: url.pathname });
  }

  const parsed = createPlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }
  // origin/destination are validated by resolveLocation() inside createPlan
  // (parseLocationInput accepts unknown and rejects a malformed shape with
  // LocationInputError) — the schema above deliberately doesn't duplicate
  // that check.
  const planRequest = parsed.data as unknown as CreatePlanRequest;

  try {
    const response = await createPlan(planRequest, { ...deps, pool }, createdBy);
    // A completed plan is a new resource (201); an infeasible one is still
    // persisted but is a legitimate answer, not a created resource in the
    // same sense — §12.2, BUILD-PLAN 16.3: 200, never a 4xx.
    const status = response.status === "completed" ? 201 : 200;
    return jsonResponse(convertPlanResponseUnits(response, units), status);
  } catch (err) {
    return planServiceErrorResponse(err, url);
  }
}

/**
 * `GET /plans/{id}` (§14) — a re-fetch, never a poll: `plans.status` has no
 * in-progress state, so this always returns the finished body or 404.
 */
export async function handleGetPlan(pool: Pool, id: string, url: URL): Promise<Response> {
  const units = parseUnits(url);
  if (units === null) {
    return problemResponse({ title: "Bad Request", status: 400, detail: '"units" must be "imperial" or "metric"', instance: url.pathname });
  }
  if (!z.string().uuid().safeParse(id).success) {
    return problemResponse({ title: "Not Found", status: 404, detail: `No plan with id ${id}`, instance: url.pathname });
  }

  try {
    const response = await getPlan(pool, id);
    if (!response) {
      return problemResponse({ title: "Not Found", status: 404, detail: `No plan with id ${id}`, instance: url.pathname });
    }
    return jsonResponse(convertPlanResponseUnits(response, units));
  } catch (err) {
    return planServiceErrorResponse(err, url);
  }
}

const listPlansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/** `GET /plans` (T-18 step 18.3, UI contract §4) — the Recent table's list projection. */
export async function handleListPlans(pool: Pool, url: URL): Promise<Response> {
  const parsed = listPlansQuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }
  const result = await listPlans(pool, parsed.data);
  return jsonResponse(result);
}

const PLAN_SERVICE_ERROR_STATUS: Record<PlanServiceError["code"], number> = {
  TRUCK_NOT_FOUND: 400,
  TRUCK_SPEC_INCOMPLETE: 400,
  NO_PRICE_SHEET: 409,
  UNKNOWN_OPTIMIZER_STRATEGY: 400,
};

/**
 * Maps every technical or request-shaped failure `createPlan`/`getPlan` can
 * throw onto RFC 9457. Nothing here persists anything — by the time any of
 * these throw, `createPlan` has either not reached its persist step yet, or
 * has already returned (§12.2's "a technical failure persists nothing").
 *
 * Catches everything, including a genuinely unrecognised exception: the
 * ticket is explicit that "provider timeout, budget guard, unhandled
 * exception" all return an RFC 9457 error, not just the cases named below.
 */
function planServiceErrorResponse(err: unknown, url: URL): Response {
  if (err instanceof LocationInputError) {
    return problemResponse({ title: "Bad Request", status: 400, detail: err.message, instance: url.pathname });
  }
  if (err instanceof GeocodeError) {
    return problemResponse({ title: "Unprocessable Location", status: 422, detail: err.message, instance: url.pathname });
  }
  if (err instanceof PlanServiceError) {
    return problemResponse({ title: "Bad Request", status: PLAN_SERVICE_ERROR_STATUS[err.code], detail: err.message, instance: url.pathname });
  }
  if (err instanceof BudgetExceededError) {
    return problemResponse({ title: "Too Many Requests", status: 429, detail: err.message, instance: url.pathname });
  }
  if (err instanceof RoutingProviderError || err instanceof GeocodingProviderError) {
    return problemResponse({ title: "Upstream Provider Error", status: 502, detail: err.message, instance: url.pathname });
  }
  if (err instanceof CorridorError) {
    // Would mean the route this request just inserted has no geometry or
    // vanished before the corridor query ran — an internal bug, not a
    // request problem.
    return problemResponse({ title: "Internal Server Error", status: 500, detail: err.message, instance: url.pathname });
  }
  const detail = err instanceof Error ? err.message : String(err);
  return problemResponse({ title: "Internal Server Error", status: 500, detail, instance: url.pathname });
}
