import type { Disclaimer } from "../domain/planResponse.js";
import type { TruckAccessible } from "../db/types.js";
import type { ShortLeg } from "./relaxation.js";

/** The minimum a caller needs per stop — deliberately narrower than `PlanStop` so a test fixture is a few fields, not a whole plan. */
export interface DisclaimerStop {
  seq: number;
  station: {
    id: string;
    name: string;
    truckAccessible: TruckAccessible;
  };
}

export interface BuildDisclaimersInput {
  stops: readonly DisclaimerStop[];
  priceAsOf: string;
  minLegRelaxed: boolean;
  /** Present only when `minLegRelaxed` — the legs §5.1's second pass found under the floor. */
  shortLegs?: readonly ShortLeg[];
}

function formatMiles(miles: number): string {
  return Number.isInteger(miles) ? String(miles) : miles.toFixed(1);
}

/**
 * §9.4 / §14: the disclaimers array every plan carries, in the payload rather
 * than the frontend so the frontend cannot drop them (CLAUDE.md).
 *
 * - `GOOGLE_LINK_NOT_TRUCK_LEGAL` and `PRICE_STALENESS` are always present.
 * - `ACCESSIBILITY_UNVERIFIED` fires only when a stop is not
 *   `operator_verified` (§11.5) — a disclaimer that always fires is one
 *   nobody reads.
 * - `MIN_LEG_RELAXED` fires only when §5.1's second pass actually ran and
 *   found a leg under the floor, and names each one.
 *
 * Pure: no I/O, no clock. Wording is pinned by `disclaimers.test.ts`.
 */
export function buildDisclaimers(input: BuildDisclaimersInput): Disclaimer[] {
  const disclaimers: Disclaimer[] = [
    {
      code: "GOOGLE_LINK_NOT_TRUCK_LEGAL",
      message: "The Google Maps link routes between the correct stops but does not check truck restrictions.",
    },
  ];

  const unverified = input.stops.filter((s) => s.station.truckAccessible !== "operator_verified");
  if (unverified.length > 0) {
    disclaimers.push({
      code: "ACCESSIBILITY_UNVERIFIED",
      message: `Truck accessibility is unverified for: ${unverified.map((s) => s.station.name).join(", ")}.`,
    });
  }

  if (input.minLegRelaxed && input.shortLegs && input.shortLegs.length > 0) {
    const floorMiles = formatMiles(input.shortLegs[0]!.requiredMiles);
    const named = input.shortLegs.map((leg) => {
      const stop = input.stops.find((s) => s.station.id === leg.toCandidateId)!;
      return `leg ${stop.seq} into ${stop.station.name} (${formatMiles(leg.legMiles)} mi)`;
    });
    disclaimers.push({
      code: "MIN_LEG_RELAXED",
      message: `The ${floorMiles}-mile minimum leg length was relaxed because no station fit the requested spacing. Short leg(s): ${named.join("; ")}.`,
    });
  }

  disclaimers.push({
    code: "PRICE_STALENESS",
    message: `Prices reflect the BVD sheet effective ${input.priceAsOf}.`,
  });

  return disclaimers;
}
