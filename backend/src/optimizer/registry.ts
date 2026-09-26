import { dynamicProgrammingOptimizer } from "./dp_v1.js";
import { greedyOptimizer } from "./greedy_v1.js";
import type { OptimizerStrategy } from "./types.js";

/**
 * §13.1. Keyed by the id persisted to `plans.optimizer_strategy`, so a historical
 * plan names the code that produced it. Adding a strategy is a new file and an
 * entry here; nothing else changes. Never rename or reuse a key.
 */
export const OPTIMIZERS = {
  dp_v1: dynamicProgrammingOptimizer,
  greedy_v1: greedyOptimizer,
} as const satisfies Record<string, OptimizerStrategy>;

export type OptimizerId = keyof typeof OPTIMIZERS;

/** Matches `plans.optimizer_strategy DEFAULT 'dp_v1'` in `migrations/0001_planning_schema.sql`. */
export const DEFAULT_OPTIMIZER_ID: OptimizerId = "dp_v1";

/** The ids as a non-empty tuple, the shape `z.enum` takes for the request's `optimizerStrategy`. */
export const OPTIMIZER_IDS = Object.keys(OPTIMIZERS) as [OptimizerId, ...OptimizerId[]];

/** A registered id, and not an inherited property such as `toString`. */
export function isOptimizerId(id: string): id is OptimizerId {
  return Object.hasOwn(OPTIMIZERS, id);
}
