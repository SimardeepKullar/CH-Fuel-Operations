import type { Pool } from "pg";
import type { ProviderQuotaRow } from "../db/types.js";

export interface QuotaHeaders {
  limit: number | null;
  remaining: number | null;
}

/**
 * `x-ratelimit-limit`/`-remaining` are bare numbers with no stated window
 * (§8.3), so parsing does not attach one — a missing header is `null`, never
 * coerced to `0`.
 */
export function parseQuotaHeaders(headers: Headers): QuotaHeaders {
  const limitRaw = headers.get("x-ratelimit-limit");
  const remainingRaw = headers.get("x-ratelimit-remaining");
  return {
    limit: limitRaw !== null ? Number(limitRaw) : null,
    remaining: remainingRaw !== null ? Number(remainingRaw) : null,
  };
}

/**
 * Theirs (§8.3): persist the latest reading into `provider_quota`, moving
 * the current reading to `prev_*` first so drift can compare the two most
 * recent observations. No period is stored — the provider states none.
 */
export async function recordQuota(
  pool: Pool,
  provider: string,
  endpoint: string,
  headers: QuotaHeaders,
  observedAt: Date = new Date(),
): Promise<ProviderQuotaRow> {
  const { rows } = await pool.query<ProviderQuotaRow>(
    `INSERT INTO provider_quota (provider, endpoint, limit_value, remaining, observed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (provider, endpoint) DO UPDATE
     SET prev_remaining = provider_quota.remaining,
         prev_observed_at = provider_quota.observed_at,
         remaining = EXCLUDED.remaining,
         limit_value = EXCLUDED.limit_value,
         observed_at = EXCLUDED.observed_at
     RETURNING *`,
    [provider, endpoint, headers.limit, headers.remaining, observedAt],
  );
  return rows[0]!;
}

/**
 * Drift is a rate, not a level (§8.3): compare the two most recent
 * observations as (their fall) − (our permitted calls), floored at zero.
 * One reading says nothing, so a missing previous reading reports `null`.
 * A reset on either side — theirs at a window boundary (their remaining
 * rises), ours at UTC midnight (our call count falls) — starts a fresh
 * baseline rather than reporting drift.
 */
export function computeDrift(
  currentRemaining: number | null,
  previousRemaining: number | null,
  ourCallsMade: number,
): number | null {
  if (currentRemaining === null || previousRemaining === null) {
    return null;
  }

  const theirFall = previousRemaining - currentRemaining;
  if (theirFall < 0) {
    return 0;
  }
  if (ourCallsMade < 0) {
    return 0;
  }
  return Math.max(0, theirFall - ourCallsMade);
}

/** Convenience: drift straight from a `provider_quota` row. */
export function driftFromQuotaRow(row: ProviderQuotaRow, ourCallsMade: number): number | null {
  return computeDrift(row.remaining, row.prev_remaining, ourCallsMade);
}
