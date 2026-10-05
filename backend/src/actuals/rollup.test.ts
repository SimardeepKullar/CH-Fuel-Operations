import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { isUuid } from "./ids.js";
import {
  EMPTY_SUMS,
  addSums,
  fleetSums,
  loadRollupSums,
  toRollup,
  weightedAverage,
  type RollupKey,
  type RollupSums,
} from "./rollup.js";
import { qtyConverter } from "./units.js";

const AS_PRINTED_GAL = qtyConverter("gal", null);
const sums = (overrides: Partial<RollupSums>): RollupSums => ({ ...EMPTY_SUMS, ...overrides });

describe("weightedAverage", () => {
  it("is null, not 0 or NaN, with no quantity to weight over", () => {
    expect(weightedAverage(0, 0)).toBeNull();
  });

  it("weights by quantity: 100 gal at 5 and 100 at 6 is 5.5, 300 gal at 5 and 100 at 6 is 5.25", () => {
    expect(weightedAverage(500 + 600, 200)).toBe(5.5);
    expect(weightedAverage(1500 + 600, 400)).toBe(5.25);
  });
});

describe("toRollup", () => {
  it("a group with no stops is zeros — with a null average, DEF ratio and compliance rate", () => {
    expect(toRollup(EMPTY_SUMS, AS_PRINTED_GAL)).toEqual({
      stopCount: 0,
      total: 0,
      qty: 0,
      defQty: 0,
      avgBilledPerUnit: null,
      defRatio: null,
      receiptCompliance: { confirmed: 0, total: 0, pct: null },
      anomalyCount: 0,
    });
  });

  it("DEF:diesel is DF quantity over TA quantity", () => {
    expect(toRollup(sums({ stopCount: 1, taQty: 200, defQty: 6 }), AS_PRINTED_GAL).defRatio).toBe(0.03);
  });

  it("DEF:diesel with DEF but no diesel is null — not Infinity", () => {
    const rollup = toRollup(sums({ stopCount: 1, taQty: 0, defQty: 10 }), AS_PRINTED_GAL);

    expect(rollup.defRatio).toBeNull();
    expect(rollup.defQty).toBe(10);
  });

  it("DEF:diesel with diesel but no DEF is 0 — a real zero, distinct from undefined", () => {
    expect(toRollup(sums({ stopCount: 2, taQty: 100 }), AS_PRINTED_GAL).defRatio).toBe(0);
  });

  it("compliance is a 0-100 percentage of stops confirmed", () => {
    expect(toRollup(sums({ stopCount: 3, confirmed: 2 }), AS_PRINTED_GAL).receiptCompliance).toEqual({
      confirmed: 2,
      total: 3,
      pct: (2 / 3) * 100,
    });
  });

  it("rounds money and quantity to 2dp so summed floats never leak into the payload", () => {
    const rollup = toRollup(sums({ stopCount: 2, total: 0.1 + 0.2, taQty: 0.1 + 0.2, defQty: 0.1 + 0.2 }), AS_PRINTED_GAL);

    expect(rollup.total).toBe(0.3);
    expect(rollup.qty).toBe(0.3);
    expect(rollup.defQty).toBe(0.3);
  });

  it("converts quantity and the per-unit average at the edge, leaves money alone, and never converts the DEF ratio", () => {
    // A CA week as printed: 1,000 L of diesel at 2.0000 CAD/L, 30 L of DEF, CAD 2,000 billed.
    const printed = sums({ stopCount: 2, total: 2000, taQty: 1000, taWeightedNum: 2000, defQty: 30 });
    const asPrinted = toRollup(printed, qtyConverter("L", null));
    expect(asPrinted).toMatchObject({ total: 2000, qty: 1000, defQty: 30, avgBilledPerUnit: 2, defRatio: 0.03 });

    const gallons = toRollup(printed, qtyConverter("L", "imperial"));
    expect(gallons.total).toBe(2000);
    expect(gallons.qty).toBeCloseTo(264.17, 2);
    expect(gallons.defQty).toBeCloseTo(7.93, 2);
    expect(gallons.avgBilledPerUnit).toBeCloseTo(2 * 3.785411784, 5);
    expect(gallons.defRatio).toBe(0.03);
  });

  it("keeps a null average null when converted — a missing price is never 0", () => {
    expect(toRollup(EMPTY_SUMS, qtyConverter("gal", "metric")).avgBilledPerUnit).toBeNull();
  });
});

describe("fleetSums", () => {
  it("adds every group, the null (unresolved) group included", () => {
    const groups = new Map<string | null, RollupSums>([
      ["a", sums({ stopCount: 3, total: 1312, taQty: 250, taWeightedNum: 1300 })],
      ["b", sums({ stopCount: 1, total: 1100, taQty: 200, taWeightedNum: 1100 })],
      [null, sums({ stopCount: 1, total: 700, taQty: 100, taWeightedNum: 700 })],
    ]);

    const fleet = fleetSums(groups);

    expect(fleet).toMatchObject({ stopCount: 5, total: 3112, taQty: 550, taWeightedNum: 3100 });
    // Quantity-weighted over all 550 units, not the mean of the groups' averages (5.2 and 5.5).
    expect(weightedAverage(fleet.taWeightedNum, fleet.taQty)).toBeCloseTo(3100 / 550, 10);
    expect(weightedAverage(fleet.taWeightedNum, fleet.taQty)).not.toBeCloseTo((5.2 + 5.5) / 2, 2);
  });

  it("is EMPTY_SUMS for no groups", () => {
    expect(fleetSums(new Map())).toEqual(EMPTY_SUMS);
    expect(addSums(EMPTY_SUMS, EMPTY_SUMS)).toEqual(EMPTY_SUMS);
  });
});

describe("loadRollupSums", () => {
  it("rejects a group key outside the whitelist before it can reach SQL", async () => {
    const untouchedPool = new Proxy(
      {},
      {
        get(): never {
          throw new Error("touched the database");
        },
      },
    ) as Pool;

    await expect(loadRollupSums(untouchedPool, "inv", "station; DROP TABLE x" as RollupKey)).rejects.toThrow(
      /unknown rollup key/,
    );
  });
});

describe("isUuid", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(isUuid("3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("3f2b7c1e-8a44-4f5b-9c1d-2e6a7b8c9d0e; DROP TABLE x")).toBe(false);
  });
});
