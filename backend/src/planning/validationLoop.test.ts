import { describe, expect, it } from "vitest";
import { expectPlan, lane, type LaneSpec } from "../../test/support/optimizer.js";
import { dynamicProgrammingOptimizer } from "../optimizer/dp_v1.js";
import type { OptimizerInput, OptimizerResult, OptimizerStrategy } from "../optimizer/types.js";
import type { LatLng } from "../domain/planResponse.js";
import { RoutingProviderError, type RouteRequest, type RouteResult, type TruckSpec } from "../routing/provider.js";
import { MAX_VALIDATION_ITERATIONS, runValidationLoop, type ValidationLoopInput } from "./validationLoop.js";

const TRUCK_SPEC: TruckSpec = { grossWeightKg: null, heightCm: null, widthCm: null, lengthCm: null, axleCount: null, hazmatClass: null };
const ORIGIN: LatLng = { lat: 41.88, lng: -87.63 };
const DESTINATION: LatLng = { lat: 32.78, lng: -96.8 };

/** Each candidate id gets its own coordinate, so a routed `via` can be read back as ids. */
function locationsFor(input: OptimizerInput): Map<string, LatLng> {
  return new Map(input.candidates.map((c, i) => [c.id, { lat: 30 + i, lng: -90 - i }]));
}

/**
 * A routing provider that answers from a table keyed by the stops it was asked to visit,
 * and counts its calls. Never the network: the budget guard is a real spend ceiling.
 */
function fakeProvider(locations: Map<string, LatLng>, legsFor: (viaIds: string[]) => Array<[miles: number, seconds?: number]>) {
  const requests: RouteRequest[] = [];
  const idAt = new Map([...locations].map(([id, at]) => [`${at.lat},${at.lng}`, id]));
  return {
    requests,
    provider: {
      name: "ors" as const,
      async route(req: RouteRequest): Promise<RouteResult> {
        requests.push(req);
        const viaIds = (req.via ?? []).map((v) => idAt.get(`${v.lat},${v.lng}`) ?? "?");
        const legs = legsFor(viaIds).map(([miles, seconds]) => ({ distanceMiles: miles, durationSeconds: seconds ?? miles * 60 }));
        return {
          polyline: `poly:${viaIds.join(",")}`,
          distanceMiles: legs.reduce((sum, l) => sum + l.distanceMiles, 0),
          durationSeconds: legs.reduce((sum, l) => sum + l.durationSeconds, 0),
          legs,
          providerRaw: {},
        };
      },
      async matrix(): Promise<never> {
        throw new Error("the validation loop never asks for a matrix");
      },
    },
  };
}

function setup(spec: LaneSpec, legsFor: (viaIds: string[]) => Array<[number, number?]>, strategy: OptimizerStrategy = dynamicProgrammingOptimizer) {
  const input = lane(spec);
  const locations = locationsFor(input);
  const fake = fakeProvider(locations, legsFor);
  const loopInput: ValidationLoopInput = {
    provider: fake.provider,
    strategy,
    lane: input,
    locations,
    origin: ORIGIN,
    destination: DESTINATION,
    truckSpec: TRUCK_SPEC,
    baselineDurationSeconds: input.totalDistanceMiles * 60,
  };
  return { input, locations, fake, loopInput };
}

/** Wraps a strategy, recording each lane it was asked about. */
function recording(inner: OptimizerStrategy) {
  const seen: OptimizerInput[] = [];
  const strategy: OptimizerStrategy = {
    id: inner.id,
    description: inner.description,
    solve(input) {
      seen.push(input);
      return inner.solve(input);
    },
  };
  return { strategy, seen };
}

type LoopResult = Awaited<ReturnType<typeof runValidationLoop>>;

function stopIds(result: LoopResult): string[] {
  if (result.kind !== "plan") throw new Error(`expected a plan, got ${JSON.stringify(result)}`);
  return result.plan.stops.map((s) => s.candidateId);
}

// TRUCK (test/support/optimizer.ts): 150 gal, 5 mpg, cap 500, floor 300, reserve and arrival minimum 30 gal.

describe("runValidationLoop", () => {
  it("caps at three iterations", () => {
    expect(MAX_VALIDATION_ITERATIONS).toBe(3);
  });

  describe("a stable lane", () => {
    const spec: LaneSpec = { distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] };

    it("converges on iteration 1 with exactly one extra route call, routed through the stop", async () => {
      const { fake, loopInput } = setup(spec, () => [[400], [400]]);
      const result = await runValidationLoop(loopInput);

      expect(result).toMatchObject({ kind: "plan", iterations: 1, routeCalls: 1, minLegRelaxed: false });
      expect(fake.requests).toHaveLength(1);
      expect(fake.requests[0]).toMatchObject({ origin: ORIGIN, destination: DESTINATION, truckSpec: TRUCK_SPEC });
      expect(fake.requests[0]?.via).toEqual([{ lat: 30, lng: -90 }]);
      expect(stopIds(result)).toEqual(["A"]);
    });

    it("returns the routed result, so the caller persists the route that was actually checked", async () => {
      const { loopInput } = setup(spec, () => [[400], [400]]);
      const result = await runValidationLoop(loopInput);
      if (result.kind !== "plan") throw new Error("expected a plan");
      expect(result.route?.polyline).toBe("poly:A");
      expect(result.route?.legs).toHaveLength(2);
    });

    it("final totals come from the real route, not the baseline", async () => {
      // The route measured 410 + 395 = 805 against a baseline of 800.
      const { loopInput } = setup(spec, () => [
        [410, 24_000],
        [395, 23_000],
      ]);
      const result = await runValidationLoop(loopInput);
      if (result.kind !== "plan") throw new Error("expected a plan");

      const { plan } = result;
      expect(plan.totalDistanceMiles).toBe(805);
      expect(plan.totalDurationSeconds).toBe(47_000);
      expect(plan.stops[0]).toMatchObject({ positionMiles: 410, baselinePositionMiles: 400, legMiles: 410, cumulativeDurationSeconds: 24_000, arrivalGallons: 68, purchaseGallons: 42 });
      expect(plan.finalLegMiles).toBe(395);
      expect(plan.totalGallons).toBe(42);
      // 42 gal at $3.00, where the baseline DP's 40 gal would have said $120.
      expect(plan.totalFuelCostUsd).toBeCloseTo(126, 9);
      expect(plan.totalCostUsd).toBeCloseTo(126, 9);
    });

    it("routes the vias in position order for a multi-stop plan", async () => {
      const { fake, loopInput } = setup({ distance: 1000, stations: [{ mile: 450, price: 3.0, id: "p" }, { mile: 900, price: 3.0, id: "q" }] }, () => [[450], [450], [100]]);
      const result = await runValidationLoop(loopInput);

      expect(stopIds(result)).toEqual(["p", "q"]);
      expect(fake.requests[0]?.via).toEqual([{ lat: 30, lng: -90 }, { lat: 31, lng: -91 }]);
      expect(result).toMatchObject({ iterations: 1, routeCalls: 1 });
    });
  });

  describe("a lane whose real legs differ", () => {
    // A is the cheapest and baseline-optimal. Routed through A the first leg measures
    // 520 (the router took another highway): over the cap. C sits at 380 baseline miles
    // and rescales to 494, still legal.
    const spec: LaneSpec = {
      distance: 800,
      stations: [
        { mile: 380, price: 3.2, id: "C" },
        { mile: 400, price: 3.0, id: "A" },
        { mile: 420, price: 3.5, id: "B" },
      ],
    };
    const legsFor = (via: string[]): Array<[number, number?]> => (via.join() === "A" ? [[520], [400]] : [[385], [395]]);

    it("converges on iteration 2, re-running the DP on real distances and routing the new stop set", async () => {
      const { strategy, seen } = recording(dynamicProgrammingOptimizer);
      const { fake, loopInput } = setup(spec, legsFor, strategy);
      const result = await runValidationLoop(loopInput);

      expect(result).toMatchObject({ kind: "plan", iterations: 2, routeCalls: 2 });
      expect(stopIds(result)).toEqual(["C"]);
      expect(fake.requests.map((r) => r.via?.length)).toEqual([1, 1]);

      // The first solve saw the baseline; the second saw it rescaled by the first route.
      expect(seen[0]?.totalDistanceMiles).toBe(800);
      expect(seen[1]?.totalDistanceMiles).toBe(920);
      expect(seen[1]?.candidates.find((c) => c.id === "A")?.positionMiles).toBe(520);
      expect(seen[1]?.candidates.find((c) => c.id === "C")?.positionMiles).toBeCloseTo(494, 9);
    });

    it("totals derive from the second route, not the first and not the baseline", async () => {
      const { loopInput } = setup(spec, legsFor);
      const result = await runValidationLoop(loopInput);
      if (result.kind !== "plan") throw new Error("expected a plan");
      expect(result.plan.totalDistanceMiles).toBe(780);
      expect(result.plan.stops[0]).toMatchObject({ positionMiles: 385, baselinePositionMiles: 380 });
      expect(result.route?.polyline).toBe("poly:C");
    });

    it("a real leg over 500 after waypointing is recomputed, never passed", async () => {
      const { loopInput } = setup(spec, legsFor);
      const result = await runValidationLoop(loopInput);
      if (result.kind !== "plan") throw new Error("expected a plan");
      for (const stop of result.plan.stops) expect(stop.legMiles).toBeLessThanOrEqual(500);
      expect(result.plan.finalLegMiles).toBeLessThanOrEqual(500);
      expect(stopIds(result)).not.toContain("A");
    });

    it("with no way round the over-cap leg it is infeasible, not a plan that breaks the cap", async () => {
      const { fake, loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] }, () => [[520], [400]]);
      const result = await runValidationLoop(loopInput);

      expect(result.kind).toBe("infeasible");
      expect(result).toMatchObject({ code: "LEG_GAP" });
      expect(fake.requests).toHaveLength(1);
    });
  });

  describe("an oscillating lane", () => {
    /** Alternates between two stop sets whatever it is asked, so the loop's cap is the only thing that ends it. */
    function alternating(ids: [string, string]): OptimizerStrategy {
      let calls = 0;
      return {
        id: "alternating",
        description: "alternates",
        solve(input): OptimizerResult {
          const id = ids[calls++ % 2] as string;
          const candidate = input.candidates.find((c) => c.id === id);
          if (!candidate) throw new Error(`no candidate ${id}`);
          return {
            kind: "plan",
            stops: [
              {
                candidateId: id,
                positionMiles: candidate.positionMiles,
                legMiles: candidate.positionMiles,
                unitPriceUsd: candidate.unitPriceUsd,
                arrivalGallons: 70,
                purchaseGallons: 40,
                departureGallons: 110,
                fuelCostUsd: 40 * candidate.unitPriceUsd,
                penaltyUsd: 0,
              },
            ],
            startGallons: 150,
            finalLegMiles: input.totalDistanceMiles - candidate.positionMiles,
            destinationArrivalGallons: 30,
            totalGallons: 40,
            totalFuelCostUsd: 40 * candidate.unitPriceUsd,
            totalCostUsd: 40 * candidate.unitPriceUsd,
          };
        },
      };
    }
    const spec: LaneSpec = { distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }, { mile: 410, price: 3.1, id: "B" }] };

    it("hits the cap and returns NO_STABLE_PLAN, with the route-call count stopping at 3", async () => {
      const { fake, loopInput } = setup(spec, () => [[520], [400]], alternating(["A", "B"]));
      const result = await runValidationLoop(loopInput);

      expect(fake.requests).toHaveLength(3);
      expect(result).toMatchObject({ kind: "infeasible", code: "NO_STABLE_PLAN", detail: { iterations: 3, routeCalls: 3 } });
      if (result.kind !== "infeasible" || result.code !== "NO_STABLE_PLAN") throw new Error("expected NO_STABLE_PLAN");
      expect(result.detail.attempts.map((a) => a.stopIds)).toEqual([["A"], ["B"], ["A"]]);
      expect(result.detail.attempts.every((a) => a.violations.some((v) => v.kind === "LEG_OVER_CAP"))).toBe(true);
    });

    it("never routes a fourth time however long the fixture would go on", async () => {
      const { fake, loopInput } = setup(spec, () => [[520], [400]], alternating(["A", "B"]));
      await runValidationLoop(loopInput);
      await runValidationLoop({ ...loopInput, strategy: alternating(["A", "B"]) });
      expect(fake.requests).toHaveLength(6);
    });

    it("when the DP re-chooses the very stops that just failed, it stops without spending another route call", async () => {
      const same = alternating(["A", "A"]);
      const { fake, loopInput } = setup(spec, () => [[520], [400]], same);
      const result = await runValidationLoop(loopInput);

      expect(fake.requests).toHaveLength(1);
      expect(result).toMatchObject({ kind: "infeasible", code: "NO_STABLE_PLAN", detail: { iterations: 2, routeCalls: 1 } });
    });
  });

  describe("§5.1 relaxation inside the loop", () => {
    const spec: LaneSpec = { distance: 700, stations: [{ mile: 280, price: 3.5, id: "early" }] };

    it("a lane feasible only after relaxation is relaxed, with the short legs named from the real legs", async () => {
      const { loopInput } = setup(spec, () => [[285], [415]]);
      const result = await runValidationLoop(loopInput);

      expect(result).toMatchObject({
        kind: "plan",
        minLegRelaxed: true,
        shortLegs: [{ fromCandidateId: null, toCandidateId: "early", legMiles: 285, requiredMiles: 300 }],
      });
    });

    it("is not relaxed when the real leg turns out to meet the floor after all", async () => {
      const { loopInput } = setup(spec, () => [[305], [395]]);
      const result = await runValidationLoop(loopInput);

      expect(result).toMatchObject({ kind: "plan", minLegRelaxed: false });
      expect(result).not.toHaveProperty("shortLegs");
    });

    it("a feasible lane is not relaxed", async () => {
      const { loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] }, () => [[400], [400]]);
      expect(await runValidationLoop(loopInput)).toMatchObject({ kind: "plan", minLegRelaxed: false });
    });
  });

  describe("edges", () => {
    it("an infeasible lane is returned as the optimiser's own result, and nothing is routed", async () => {
      const { fake, loopInput } = setup({ distance: 1200, stations: [[100, 3.0]] }, () => [[1]]);
      const result = await runValidationLoop(loopInput);

      expect(result).toMatchObject({ kind: "infeasible", code: "LEG_GAP" });
      expect(fake.requests).toHaveLength(0);
    });

    it("a plan with no stops has nothing to waypoint: no route call, judged on the baseline", async () => {
      const { fake, loopInput } = setup({ distance: 400 }, () => [[1]]);
      const result = await runValidationLoop({ ...loopInput, baselineDurationSeconds: 24_000 });

      expect(fake.requests).toHaveLength(0);
      expect(result).toMatchObject({ kind: "plan", iterations: 1, routeCalls: 0, route: null, minLegRelaxed: false });
      if (result.kind !== "plan") throw new Error("expected a plan");
      expect(result.plan).toMatchObject({ stops: [], totalDistanceMiles: 400, totalDurationSeconds: 24_000, finalLegMiles: 400 });
    });

    it("a provider that returns the wrong number of legs is an error, not a silent pass", async () => {
      const { loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] }, () => [[800]]);
      await expect(runValidationLoop(loopInput)).rejects.toBeInstanceOf(RoutingProviderError);
    });

    it("a provider failure propagates as it came", async () => {
      const { loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] }, () => [[1]]);
      const failure = new RoutingProviderError("ors", 429, 2004, "rate limited");
      const provider = { ...loopInput.provider, route: () => Promise.reject(failure) };
      await expect(runValidationLoop({ ...loopInput, provider })).rejects.toBe(failure);
    });

    it("a stop with no location is a programming error, raised before any route call", async () => {
      const { fake, loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] }, () => [[400], [400]]);
      await expect(runValidationLoop({ ...loopInput, locations: new Map() })).rejects.toThrow(/no location for candidate A/);
      expect(fake.requests).toHaveLength(0);
    });

    it("forwards departAt to the provider only when given", async () => {
      const { fake, loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }] }, () => [[400], [400]]);
      await runValidationLoop(loopInput);
      const at = new Date("2026-09-21T12:00:00Z");
      await runValidationLoop({ ...loopInput, departAt: at });
      expect(fake.requests[0]).not.toHaveProperty("departAt");
      expect(fake.requests[1]?.departAt).toEqual(at);
    });

    it("does not modify the lane it was given", async () => {
      const { input, loopInput } = setup({ distance: 800, stations: [{ mile: 400, price: 3.0, id: "A" }, { mile: 380, price: 3.2, id: "C" }] }, (via) => (via.join() === "A" ? [[520], [400]] : [[385], [395]]));
      const before = structuredClone(input);
      await runValidationLoop(loopInput);
      expect(input).toEqual(before);
    });

    it("the optimiser is still pure: a plan from it needs no provider at all", () => {
      expect(expectPlan(dynamicProgrammingOptimizer.solve(lane({ distance: 800, stations: [[400, 3.0]] }))).stops).toHaveLength(1);
    });
  });
});
