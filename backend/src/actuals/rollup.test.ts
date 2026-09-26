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

const sums = (overrides: Partial<RollupSums>): RollupSums => ({ ...EMPTY_SUMS, ...overrides });

describe("weightedAverage", () => {
  it("is null, not 0 or NaN, with no gallons to weight over", () => {
    expect(weightedAverage(0, 0)).toBeNull();
  });

  it("weights by gallons: 100 gal at 5 and 100 at 6 is 5.5, 300 gal at 5 and 100 at 6 is 5.25", () => {
    expect(weightedAverage(500 + 600, 200)).toBe(5.5);
    expect(weightedAverage(1500 + 600, 400)).toBe(5.25);
  });
});

describe("toRollup", () => {
  it("a group with no stops is zeros — with a null average, DEF ratio and compliance rate", () => {
    expect(toRollup(EMPTY_SUMS)).toEqual({
      stopCount: 0,
      totalUsd: 0,
      gallons: 0,
      defGallons: 0,
      avgBilledUsdPerGal: null,
      defRatio: null,
      receiptCompliance: { confirmed: 0, total: 0, pct: null },
      anomalyCount: 0,
    });
  });

  it("DEF:diesel is DF gallons over TA gallons", () => {
    expect(toRollup(sums({ stopCount: 1, taGallons: 200, defGallons: 6 })).defRatio).toBe(0.03);
  });

  it("DEF:diesel with DEF but no diesel is null — not Infinity", () => {
    const rollup = toRollup(sums({ stopCount: 1, taGallons: 0, defGallons: 10 }));

    expect(rollup.defRatio).toBeNull();
    expect(rollup.defGallons).toBe(10);
  });

  it("DEF:diesel with diesel but no DEF is 0 — a real zero, distinct from undefined", () => {
    expect(toRollup(sums({ stopCount: 2, taGallons: 100 })).defRatio).toBe(0);
  });

  it("compliance is a 0-100 percentage of stops confirmed", () => {
    expect(toRollup(sums({ stopCount: 3, confirmed: 2 })).receiptCompliance).toEqual({
      confirmed: 2,
      total: 3,
      pct: (2 / 3) * 100,
    });
  });

  it("rounds money and gallons to 2dp so summed floats never leak into the payload", () => {
    const rollup = toRollup(sums({ stopCount: 2, totalUsd: 0.1 + 0.2, taGallons: 0.1 + 0.2, defGallons: 0.1 + 0.2 }));

    expect(rollup.totalUsd).toBe(0.3);
    expect(rollup.gallons).toBe(0.3);
    expect(rollup.defGallons).toBe(0.3);
  });
});

describe("fleetSums", () => {
  it("adds every group, the null (unresolved) group included", () => {
    const groups = new Map<string | null, RollupSums>([
      ["a", sums({ stopCount: 3, totalUsd: 1312, taGallons: 250, taWeightedNum: 1300 })],
      ["b", sums({ stopCount: 1, totalUsd: 1100, taGallons: 200, taWeightedNum: 1100 })],
      [null, sums({ stopCount: 1, totalUsd: 700, taGallons: 100, taWeightedNum: 700 })],
    ]);

    const fleet = fleetSums(groups);

    expect(fleet).toMatchObject({ stopCount: 5, totalUsd: 3112, taGallons: 550, taWeightedNum: 3100 });
    // Gallons-weighted over all 550 gallons, not the mean of the groups' averages (5.2 and 5.5).
    expect(weightedAverage(fleet.taWeightedNum, fleet.taGallons)).toBeCloseTo(3100 / 550, 10);
    expect(weightedAverage(fleet.taWeightedNum, fleet.taGallons)).not.toBeCloseTo((5.2 + 5.5) / 2, 2);
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
