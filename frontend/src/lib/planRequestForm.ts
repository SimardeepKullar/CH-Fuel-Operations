import type { CreatePlanRequest } from "@ch/core/domain/planResponse";
import type { PriceBasis } from "@ch/core/db/types";

/**
 * Owns the "blank means null, not 0" rule (CLAUDE.md) at the one boundary
 * where Dev Tools' text inputs turn into `POST /plans` fields. `driverCostPerHour`
 * / `fixedStopMinutes` have no field in the design — §5.2's "v1 default" from
 * PROJECT-SCOPE.md (0, 20) applies unconditionally rather than being invented
 * as editable inputs no wireframe asked for.
 */
export const DEFAULT_DRIVER_COST_PER_HOUR = 0;
export const DEFAULT_FIXED_STOP_MINUTES = 20;

export interface PlanFormState {
  originAddress: string;
  destinationAddress: string;
  /** The real fleet unit (Header's selector) — `plans.truck_id`, required (T-56). */
  truckId: string | null;
  startFuelGallons: string;
  minArrivalGallons: string;
  maxLegMiles: string;
  minLegMiles: string;
  corridorMiles: string;
  maxDetourMiles: string;
  maxStops: string;
  priceBasis: PriceBasis;
  /** `null` = price against the newest sheet. */
  priceEffectiveOn: string | null;
}

export const EMPTY_PLAN_FORM: PlanFormState = {
  originAddress: "",
  destinationAddress: "",
  truckId: null,
  startFuelGallons: "",
  minArrivalGallons: "",
  maxLegMiles: "",
  minLegMiles: "",
  corridorMiles: "",
  maxDetourMiles: "",
  maxStops: "",
  priceBasis: "pump",
  priceEffectiveOn: null,
};

/** `""` (blank) -> `null`; anything else parses as a number. A non-numeric, non-blank string also reads as `null` rather than `NaN` reaching the request body. */
export function parseNullableNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function parseNullableInt(raw: string): number | null {
  const value = parseNullableNumber(raw);
  return value === null ? null : Math.trunc(value);
}

/** `null` when a required field (addresses, truck) is still unset — the caller's cue to disable "Plan route". */
export function buildCreatePlanRequest(form: PlanFormState): CreatePlanRequest | null {
  const origin = form.originAddress.trim();
  const destination = form.destinationAddress.trim();
  if (origin === "" || destination === "" || form.truckId === null) {
    return null;
  }

  return {
    origin: { address: origin },
    destination: { address: destination },
    truckId: form.truckId,
    startFuelGallons: parseNullableNumber(form.startFuelGallons),
    minArrivalGallons: parseNullableNumber(form.minArrivalGallons),
    maxLegMiles: parseNullableNumber(form.maxLegMiles),
    minLegMiles: parseNullableNumber(form.minLegMiles),
    corridorMiles: parseNullableNumber(form.corridorMiles),
    maxDetourMiles: parseNullableNumber(form.maxDetourMiles),
    maxStops: parseNullableInt(form.maxStops),
    priceBasis: form.priceBasis,
    driverCostPerHour: DEFAULT_DRIVER_COST_PER_HOUR,
    fixedStopMinutes: DEFAULT_FIXED_STOP_MINUTES,
    priceEffectiveOn: form.priceEffectiveOn,
    departAt: null,
  };
}
