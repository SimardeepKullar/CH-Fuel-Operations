/** The ORS endpoints the budget guard meters, each with its own daily allowance. */
export type OrsEndpoint = "directions" | "matrix" | "geocoding";

/**
 * §8.3, measured against the live free tier on 2026-09-14: 200 directions,
 * 50 matrix and 100 geocoding calls **per day**, each endpoint its own pool —
 * the "unverified" v3.4 figures, confirmed, not the 2,000/500 the
 * documentation quotes. The budget guard counts per endpoint per UTC day
 * against these, so its ceiling is the provider's own limit and adds no
 * tighter one. `OrsGeocoder` (T-15) takes its ceiling from here rather than
 * inventing one.
 */
export const DEFAULT_BUDGET_CEILINGS: Record<OrsEndpoint, number> = {
  directions: 200,
  matrix: 50,
  geocoding: 100,
};

const CEILING_ENV_VARS: Record<OrsEndpoint, string> = {
  directions: "ORS_DAILY_LIMIT_DIRECTIONS",
  matrix: "ORS_DAILY_LIMIT_MATRIX",
  geocoding: "ORS_DAILY_LIMIT_GEOCODING",
};

/** The guard compares against an `integer` column, so a larger figure would fail at call time. */
const MAX_CEILING = 2_147_483_647;

/**
 * The ceilings in force: the measured defaults, with any endpoint's daily
 * limit overridden by its environment variable, so a paid tier or a raised
 * limit is a setting rather than a code change.
 *
 * An unset variable keeps the default. A set one must be a non-negative
 * integer, or this throws naming the variable — a typo must fail at startup,
 * not silently disable the guard. `0` is a real value that blocks every call;
 * an empty string is malformed, not "unset".
 */
export function resolveBudgetCeilings(
  env: Readonly<Record<string, string | undefined>>,
): Record<OrsEndpoint, number> {
  const ceilings = { ...DEFAULT_BUDGET_CEILINGS };
  for (const endpoint of Object.keys(CEILING_ENV_VARS) as OrsEndpoint[]) {
    const name = CEILING_ENV_VARS[endpoint];
    const raw = env[name];
    if (raw === undefined) {
      continue;
    }
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(value) || value > MAX_CEILING) {
      throw new Error(
        `${name} must be a whole number of calls between 0 and ${MAX_CEILING}, got ${JSON.stringify(raw)}`,
      );
    }
    ceilings[endpoint] = value;
  }
  return ceilings;
}
