import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectPlan, lane } from "../../test/support/optimizer.js";
import { dynamicProgrammingOptimizer } from "../optimizer/dp_v1.js";
import type { OptimizerInput, OptimizerResult, OptimizerStrategy } from "../optimizer/types.js";
import { solveWithRelaxation } from "./relaxation.js";

/** Wraps a strategy and records the floor each call was made with. */
function spy(inner: OptimizerStrategy) {
  const floors: number[] = [];
  const strategy: OptimizerStrategy = {
    id: inner.id,
    description: inner.description,
    solve(input) {
      floors.push(input.fuel.minLegMiles);
      return inner.solve(input);
    },
  };
  return { strategy, floors };
}

// TRUCK (test/support/optimizer.ts): 150 gal, 5 mpg, floor 300, cap 500, reserve 30 gal.

describe("solveWithRelaxation", () => {
  it("a lane feasible at the floor is solved once, is not relaxed, and carries no disclaimer data", () => {
    const { strategy, floors } = spy(dynamicProgrammingOptimizer);
    const outcome = solveWithRelaxation(strategy, lane({ distance: 700, stations: [[350, 3.5]] }));

    expect(floors).toEqual([300]);
    expect(outcome.minLegRelaxed).toBe(false);
    expect(outcome).not.toHaveProperty("shortLegs");
    expect(expectPlan(outcome.result).stops.map((s) => s.positionMiles)).toEqual([350]);
  });

  it("a lane feasible only at 0 relaxes, and names the short leg", () => {
    // The only station is 280 out, under the 300 floor. Origin to destination is 700,
    // over the cap, so the floor is what makes this infeasible.
    const input = lane({ distance: 700, stations: [{ mile: 280, price: 3.5, id: "early" }] });
    const { strategy, floors } = spy(dynamicProgrammingOptimizer);
    expect(dynamicProgrammingOptimizer.solve(input).kind).toBe("infeasible");

    const outcome = solveWithRelaxation(strategy, input);

    expect(floors).toEqual([300, 0]);
    if (!outcome.minLegRelaxed) throw new Error("expected the plan to be relaxed");
    expect(outcome.shortLegs).toEqual([{ fromCandidateId: null, toCandidateId: "early", legMiles: 280, requiredMiles: 300 }]);
    expect(expectPlan(outcome.result).stops).toHaveLength(1);
  });

  it("names every short leg by the stops on either side, and never the final leg", () => {
    // 3 stops at 280 / 400 / 690: the 120-mile and 290-mile legs are short; the
    // 10-mile leg to a destination at 700 is not a leg anyone buys fuel at the end of.
    const input = lane({
      distance: 700,
      stations: [
        { mile: 280, price: 3.0, id: "a" },
        { mile: 400, price: 3.1, id: "b" },
        { mile: 690, price: 3.2, id: "c" },
      ],
    });
    const stub: OptimizerStrategy = {
      id: "stub",
      description: "stub",
      solve: (i) =>
        i.fuel.minLegMiles > 0
          ? { kind: "infeasible", code: "FUEL_INFEASIBLE", detail: { startGallons: 0, tankGallons: 0, reserveGallons: 0, minArrivalGallons: 0 } }
          : fixedPlan(["a", "b", "c"], [280, 400, 690], 700),
    };

    const outcome = solveWithRelaxation(stub, input);

    if (!outcome.minLegRelaxed) throw new Error("expected the plan to be relaxed");
    expect(outcome.shortLegs).toEqual([
      { fromCandidateId: null, toCandidateId: "a", legMiles: 280, requiredMiles: 300 },
      { fromCandidateId: "a", toCandidateId: "b", legMiles: 120, requiredMiles: 300 },
      { fromCandidateId: "b", toCandidateId: "c", legMiles: 290, requiredMiles: 300 },
    ]);
  });

  it("a lane infeasible at both floors stays infeasible with the original reason", () => {
    const input = lane({ distance: 1200, stations: [[100, 3.0]] });
    const { strategy, floors } = spy(dynamicProgrammingOptimizer);
    const original = dynamicProgrammingOptimizer.solve(input);

    const outcome = solveWithRelaxation(strategy, input);

    expect(floors).toEqual([300, 0]);
    expect(outcome.result).toEqual(original);
    expect(outcome.result).toMatchObject({ kind: "infeasible", code: "LEG_GAP", detail: { minLegMiles: 300 } });
    expect(outcome.minLegRelaxed).toBe(false);
    expect(outcome).not.toHaveProperty("shortLegs");
  });

  it("does not retry when the floor is already 0", () => {
    const { strategy, floors } = spy(dynamicProgrammingOptimizer);
    const outcome = solveWithRelaxation(strategy, lane({ distance: 1200, stations: [[100, 3.0]], fuel: { minLegMiles: 0 } }));

    expect(floors).toEqual([0]);
    expect(outcome.result.kind).toBe("infeasible");
    expect(outcome.minLegRelaxed).toBe(false);
  });

  it("changes only the floor between passes, and leaves the caller's input alone", () => {
    const input = lane({ distance: 700, stations: [{ mile: 280, price: 3.5, id: "early" }] });
    const before = structuredClone(input);
    const seen: OptimizerInput[] = [];
    const strategy: OptimizerStrategy = {
      id: "record",
      description: "record",
      solve(i) {
        seen.push(i);
        return dynamicProgrammingOptimizer.solve(i);
      },
    };

    solveWithRelaxation(strategy, input);

    expect(input).toEqual(before);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ ...before, fuel: { ...before.fuel, minLegMiles: 0 } });
  });

  it("a second pass whose plan has no short leg is not called relaxed", () => {
    // A heuristic can fail at the floor and then land on a legal plan anyway; there is
    // nothing to disclaim, so there must be no disclaimer.
    const input = lane({ distance: 700, stations: [{ mile: 350, price: 3.5, id: "mid" }] });
    const stub: OptimizerStrategy = {
      id: "stub",
      description: "stub",
      solve: (i) =>
        i.fuel.minLegMiles > 0
          ? { kind: "infeasible", code: "FUEL_INFEASIBLE", detail: { startGallons: 0, tankGallons: 0, reserveGallons: 0, minArrivalGallons: 0 } }
          : fixedPlan(["mid"], [350], 700),
    };

    const outcome = solveWithRelaxation(stub, input);

    expect(outcome.result.kind).toBe("plan");
    expect(outcome.minLegRelaxed).toBe(false);
  });

  it("a leg within float noise of the floor is not short", () => {
    const input = lane({ distance: 700, stations: [{ mile: 299.9999999, price: 3.5, id: "edge" }] });
    const stub: OptimizerStrategy = {
      id: "stub",
      description: "stub",
      solve: (i) =>
        i.fuel.minLegMiles > 0
          ? { kind: "infeasible", code: "FUEL_INFEASIBLE", detail: { startGallons: 0, tankGallons: 0, reserveGallons: 0, minArrivalGallons: 0 } }
          : fixedPlan(["edge"], [299.9999999], 700),
    };

    expect(solveWithRelaxation(stub, input).minLegRelaxed).toBe(false);
  });

  it("the retry did not leak into the optimiser: no strategy imports the planning layer, routing or I/O", () => {
    const dir = new URL("../optimizer/", import.meta.url);
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(new URL(file, dir), "utf8");
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/planning|routing|db\/|^pg$|node:(fs|http|https|net|child_process)/);
      }
      expect(text, `${file} reads a clock`).not.toMatch(/Date\.now|new Date\(|performance\.now/);
      expect(text, `${file} does I/O`).not.toMatch(/\bfetch\(|\bawait\b/);
    }
  });
});

/** A plan with the given stops, for stubs; only positions and ids matter to relaxation. */
function fixedPlan(ids: string[], miles: number[], distance: number): OptimizerResult {
  let prev = 0;
  return {
    kind: "plan",
    stops: ids.map((candidateId, i) => {
      const positionMiles = miles[i] ?? 0;
      const stop = {
        candidateId,
        positionMiles,
        legMiles: positionMiles - prev,
        unitPriceUsd: 3,
        arrivalGallons: 100,
        purchaseGallons: 10,
        departureGallons: 110,
        fuelCostUsd: 30,
        penaltyUsd: 0,
      };
      prev = positionMiles;
      return stop;
    }),
    startGallons: 150,
    finalLegMiles: distance - prev,
    destinationArrivalGallons: 40,
    totalGallons: ids.length * 10,
    totalFuelCostUsd: ids.length * 30,
    totalCostUsd: ids.length * 30,
  };
}
