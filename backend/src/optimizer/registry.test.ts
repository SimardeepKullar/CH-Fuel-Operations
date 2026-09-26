import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { lane } from "../../test/support/optimizer.js";
import { DEFAULT_OPTIMIZER_ID, isOptimizerId, OPTIMIZER_IDS, OPTIMIZERS } from "./registry.js";
import type { OptimizerResult, OptimizerStrategy } from "./types.js";

describe("the optimiser registry", () => {
  it("exposes dp_v1 and greedy_v1 under stable ids", () => {
    expect(Object.keys(OPTIMIZERS).sort()).toEqual(["dp_v1", "greedy_v1"]);
    expect([...OPTIMIZER_IDS].sort()).toEqual(["dp_v1", "greedy_v1"]);
  });

  it("keys each strategy by the id it carries, because that id is what plans.optimizer_strategy stores", () => {
    for (const [key, strategy] of Object.entries(OPTIMIZERS)) {
      expect(strategy.id).toBe(key);
      expect(strategy.description.length).toBeGreaterThan(0);
    }
  });

  it("defaults to dp_v1, matching the column default in the schema", () => {
    expect(DEFAULT_OPTIMIZER_ID).toBe("dp_v1");
    const migration = readFileSync(fileURLToPath(new URL("../../../migrations/synthetic/0001_planning_schema.sql", import.meta.url)), "utf8");
    expect(migration).toMatch(/optimizer_strategy\s+text NOT NULL DEFAULT 'dp_v1'/);
  });

  it("accepts only registered ids, and not inherited object properties", () => {
    expect(isOptimizerId("dp_v1")).toBe(true);
    expect(isOptimizerId("greedy_v1")).toBe(true);
    for (const bad of ["", "dp_v2", "DP_V1", "toString", "__proto__", "constructor"]) {
      expect(isOptimizerId(bad), bad).toBe(false);
    }
  });

  it("every registered strategy can solve a trivial lane through the same interface", () => {
    for (const strategy of Object.values<OptimizerStrategy>(OPTIMIZERS)) {
      const result = strategy.solve(lane({ distance: 200 }));
      expect(result.kind, strategy.id).toBe("plan");
    }
  });
});

describe("the strategy seam is pure by construction", () => {
  it("solve() returns a value, not a promise: a strategy cannot do I/O and still satisfy the type", () => {
    expectTypeOf<OptimizerStrategy["solve"]>().returns.toEqualTypeOf<OptimizerResult>();
    expectTypeOf<OptimizerStrategy["solve"]>().returns.not.toMatchTypeOf<PromiseLike<unknown>>();
    for (const strategy of Object.values<OptimizerStrategy>(OPTIMIZERS)) {
      const result: unknown = strategy.solve(lane({ distance: 200 }));
      expect(result, strategy.id).not.toBeInstanceOf(Promise);
      expect((result as { then?: unknown }).then, strategy.id).toBeUndefined();
    }
  });

  // The type stops a strategy returning a promise; it does not stop one reading a clock or
  // opening a socket inside a synchronous function. So say so in a test that would notice.
  it("no optimiser source imports I/O or reads a clock or a random source", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources).toEqual(expect.arrayContaining(["dp_v1.ts", "greedy_v1.ts", "model.ts", "registry.ts", "types.ts"]));

    const forbidden: [string, RegExp][] = [
      ["a node: import", /from\s+["']node:/],
      ["a database import", /from\s+["'](?:pg|\.\.\/db|\.\.\/ingest|\.\.\/invoice|\.\.\/api)/],
      ["a routing import", /from\s+["']\.\.\/routing/],
      ["Date", /\bDate\b/],
      ["performance.now", /\bperformance\b/],
      ["Math.random", /Math\.random/],
      ["fetch", /\bfetch\s*\(/],
      ["process", /\bprocess\./],
      ["timers", /\bset(?:Timeout|Interval|Immediate)\b/],
      ["async", /\basync\b|\bawait\b|\bPromise\b/],
    ];
    for (const file of sources) {
      // Comments may talk about clocks and promises; code may not.
      const code = readFileSync(`${dir}${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const [label, pattern] of forbidden) {
        expect(pattern.test(code), `${file} must not use ${label}`).toBe(false);
      }
    }
  });
});
