/**
 * Ramps, frontage roads and no left turns for a 53-foot trailer, applied to the
 * straight-line out-and-back. A guess; `estimatedDetourMiles` is kept beside the
 * measured detour precisely so the gap between them can show it is a bad one.
 */
export const DETOUR_MULTIPLIER = 1.35;

/** 200 m. A station this close is reached from the route itself, at no measurable cost. */
export const DETOUR_FLOOR_MILES = 0.124;

/**
 * §15.4.1 stage 1: a cheap guess at the detour, made before any matrix call is spent.
 *
 * `2 x perp_offset x 1.35`, and 0 strictly below `DETOUR_FLOOR_MILES`. The step at the
 * floor is deliberate (0 below, about 0.33 mi at it) — the floor says "on the route",
 * not "a very small detour".
 *
 * An estimate only: it filters and it is compared against the measured detour, but the
 * measured value is what the optimiser costs and it is never overwritten by this one.
 *
 * Pure. Miles in, miles out.
 */
export function estimateDetourMiles(perpOffsetMiles: number): number {
  if (!Number.isFinite(perpOffsetMiles) || perpOffsetMiles < 0) {
    throw new RangeError(`perpOffsetMiles must be a non-negative number, got ${perpOffsetMiles}`);
  }
  if (perpOffsetMiles < DETOUR_FLOOR_MILES) {
    return 0;
  }
  return 2 * perpOffsetMiles * DETOUR_MULTIPLIER;
}

export type DetourExclusionReason = "detour_unmeasurable" | "detour_estimate_over_cap";

/** A corridor candidate left out of the plan for a detour reason, named so it is never mistaken for a station that was not near the route. */
export interface DetourExclusion {
  id: string;
  reason: DetourExclusionReason;
  estimatedDetourMiles: number;
}

/**
 * §15.4.1 stage 1's job: drop a candidate whose *estimated* detour already exceeds the dispatcher's
 * cap, before a matrix call is spent on it. Nulls are meaningful: `null` is "no cap" and filters
 * nothing, while `0` is a real cap that keeps only stations under the 200 m floor. A station at the
 * cap is kept.
 *
 * A dropped station is returned, not lost: it is a plannable station left out for a stated reason.
 * The estimate is a guess, so this is a filter, not a verdict — the measured detour is still what is
 * costed, and checked against the cap again by whoever owns it (T-16).
 *
 * Keeps the order given; the input is not touched.
 */
export function filterByEstimate<T extends { id: string; perpOffsetMiles: number }>(
  candidates: readonly T[],
  maxDetourMiles: number | null,
): { kept: T[]; dropped: DetourExclusion[] } {
  if (maxDetourMiles !== null && (!Number.isFinite(maxDetourMiles) || maxDetourMiles < 0)) {
    throw new RangeError(`maxDetourMiles must be null or a non-negative number, got ${maxDetourMiles}`);
  }
  const kept: T[] = [];
  const dropped: DetourExclusion[] = [];
  for (const candidate of candidates) {
    const estimatedDetourMiles = estimateDetourMiles(candidate.perpOffsetMiles);
    if (maxDetourMiles !== null && estimatedDetourMiles > maxDetourMiles) {
      dropped.push({ id: candidate.id, reason: "detour_estimate_over_cap", estimatedDetourMiles });
    } else {
      kept.push(candidate);
    }
  }
  return { kept, dropped };
}
