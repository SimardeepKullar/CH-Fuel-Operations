/**
 * Type-level check, not a runtime test: an adapter's route result that omits
 * `legs` must fail to compile. This file contributes no assertions of its
 * own — `npm run typecheck` is what proves it. If `legs` is ever made
 * optional on `RouteResult`, the `@ts-expect-error` below goes unused and
 * typecheck fails, catching the regression.
 */
import type { RouteResult } from "./provider.js";

// @ts-expect-error `legs` is mandatory on RouteResult (§8.4) — this must not compile.
const missingLegs: RouteResult = {
  polyline: "abc",
  distanceMiles: 100,
  durationSeconds: 60,
  providerRaw: null,
};

void missingLegs;
