import type { Pool } from "pg";

/**
 * Thrown instead of making the call. §8.3: the real risk is a retry loop,
 * not ordinary use — an error that stops the call, not a log line. It says
 * which endpoint's allowance is spent and when it comes back, so the planning
 * service can tell a dispatcher when to retry.
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly provider: string,
    public readonly endpoint: string,
    /** The UTC day, `YYYY-MM-DD`. */
    public readonly period: string,
    public readonly ceiling: number,
    /** The next UTC midnight, when this endpoint's counter starts again. */
    public readonly resetsAt: Date,
  ) {
    super(
      `Daily budget ceiling of ${ceiling} calls exceeded for provider "${provider}" endpoint "${endpoint}" ` +
        `(UTC day ${period}); resets at ${resetsAt.toISOString()}`,
    );
    this.name = "BudgetExceededError";
  }
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Ours (§8.3): a ceiling per endpoint, counted per UTC day. Reserves the call
 * by incrementing `provider_usage` for `(provider, day, endpoint)` *before*
 * the caller's HTTP request runs, so a call that is reserved and then fails
 * downstream still counts — it consumed quota.
 *
 * The reservation is one statement, so two callers racing for the last free
 * slot cannot both take it: the `WHERE` is re-checked against the row the
 * other one just wrote. No returned row means the ceiling was hit.
 */
export async function reserveProviderCall(
  pool: Pool,
  provider: string,
  endpoint: string,
  ceilingCalls: number,
  now: Date = new Date(),
): Promise<void> {
  const period = utcDay(now);

  // The insert half of the statement below would write a first call before the
  // `WHERE` could refuse it, so a ceiling of 0 is refused here instead. Written
  // as a negated `>=` so a NaN ceiling blocks rather than passes.
  if (!(ceilingCalls >= 1)) {
    throw new BudgetExceededError(provider, endpoint, period, ceilingCalls, nextUtcMidnight(now));
  }

  const { rowCount } = await pool.query(
    `INSERT INTO provider_usage (provider, period, endpoint, call_count)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (provider, period, endpoint)
     DO UPDATE SET call_count = provider_usage.call_count + 1
     WHERE provider_usage.call_count < $4
     RETURNING call_count`,
    [provider, period, endpoint, ceilingCalls],
  );

  if (rowCount === 0) {
    throw new BudgetExceededError(provider, endpoint, period, ceilingCalls, nextUtcMidnight(now));
  }
}

/**
 * Reserves quota, then runs `fn`. The reservation is not rolled back if
 * `fn` throws — a reserved-then-failed call still consumed the quota it
 * reserved.
 */
export async function withBudgetGuard<T>(
  pool: Pool,
  provider: string,
  endpoint: string,
  ceilingCalls: number,
  fn: () => Promise<T>,
  now: Date = new Date(),
): Promise<T> {
  await reserveProviderCall(pool, provider, endpoint, ceilingCalls, now);
  return fn();
}
