import type { Pool } from "pg";
import { type OrsEndpoint, resolveBudgetCeilings } from "../routing/budgetCeilings.js";
import { getPool } from "../db/pool.js";

const ORS_ENDPOINTS: readonly OrsEndpoint[] = ["directions", "matrix", "geocoding"];

export interface HealthMeterOurs {
  /** `provider_usage.call_count` for this endpoint, today (UTC). */
  callsUsed: number;
  ceiling: number;
  remaining: number;
  /** The UTC day this count is for — `provider_usage.period` resets at UTC midnight. */
  period: string;
}

export interface HealthMeterTheirs {
  /** `x-ratelimit-limit`/`-remaining`, as last observed. `null` if this
   * endpoint has never been called, not coerced to a level. */
  limit: number | null;
  remaining: number | null;
  observedAt: string | null;
}

export interface HealthEndpointMeters {
  ours: HealthMeterOurs;
  theirs: HealthMeterTheirs;
}

export interface HealthStatus {
  db: { reachable: boolean };
  provider: {
    name: string | null;
    /** Configuration-level only — whether a known provider is selected and
     * its API key is set. Never a live call: `/health` must not itself spend
     * the metered quota it is reporting on (§8.3's "expected spend: $0"). */
    reachable: boolean;
    /** `null` when the DB is unreachable or the provider isn't "ors" — there
     * is no endpoint set to report meters for. */
    meters: Record<OrsEndpoint, HealthEndpointMeters> | null;
  };
  /** `price_imports.effective_date`, newest completed sheet. `null` if none imported. */
  latestSheetDate: string | null;
  /** A16: `invoices.period_start`, newest successfully imported invoice. `null` if none. */
  latestInvoicePeriod: string | null;
  /**
   * T-39: undismissed `anomalies` rows, system-wide — not scoped to the
   * selected invoice period. This is the shell's standing "Flags" count
   * (A7), deliberately a different scope from `overview.ts`'s
   * `anomaliesFlagged`, which is one invoice's count. `null` when the DB is
   * unreachable, never `0` — a real zero and "couldn't check" must stay
   * distinguishable.
   */
  openAnomalyCount: number | null;
}

function checkProviderConfig(env: Readonly<Record<string, string | undefined>>): {
  name: string | null;
  reachable: boolean;
} {
  const name = env.ROUTING_PROVIDER ?? null;
  if (name === "ors") {
    return { name, reachable: Boolean(env.ORS_API_KEY) };
  }
  return { name, reachable: false };
}

async function loadOrsMeters(
  pool: Pool,
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
): Promise<Record<OrsEndpoint, HealthEndpointMeters>> {
  const ceilings = resolveBudgetCeilings(env);
  const period = now.toISOString().slice(0, 10);

  const [{ rows: usageRows }, { rows: quotaRows }] = await Promise.all([
    pool.query<{ endpoint: string; call_count: number }>(
      `SELECT endpoint, call_count FROM provider_usage WHERE provider = 'ors' AND period = $1::date`,
      [period],
    ),
    pool.query<{ endpoint: string; limit_value: number | null; remaining: number | null; observed_at: Date }>(
      `SELECT endpoint, limit_value, remaining, observed_at FROM provider_quota WHERE provider = 'ors'`,
    ),
  ]);

  const usageByEndpoint = new Map(usageRows.map((row) => [row.endpoint, row.call_count]));
  const quotaByEndpoint = new Map(quotaRows.map((row) => [row.endpoint, row]));

  const meters = {} as Record<OrsEndpoint, HealthEndpointMeters>;
  for (const endpoint of ORS_ENDPOINTS) {
    const callsUsed = usageByEndpoint.get(endpoint) ?? 0;
    const ceiling = ceilings[endpoint];
    const quota = quotaByEndpoint.get(endpoint);
    meters[endpoint] = {
      ours: { callsUsed, ceiling, remaining: Math.max(0, ceiling - callsUsed), period },
      theirs: quota
        ? { limit: quota.limit_value, remaining: quota.remaining, observedAt: quota.observed_at.toISOString() }
        : { limit: null, remaining: null, observedAt: null },
    };
  }
  return meters;
}

async function loadLatestSheetDate(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ effective_on: string }>(
    `SELECT to_char(effective_date, 'YYYY-MM-DD') AS effective_on
     FROM price_imports
     WHERE status = 'completed'
     ORDER BY effective_date DESC
     LIMIT 1`,
  );
  return rows[0]?.effective_on ?? null;
}

async function loadLatestInvoicePeriod(pool: Pool): Promise<string | null> {
  const { rows } = await pool.query<{ period: string }>(
    `SELECT to_char(period_start, 'YYYY-MM-DD') AS period
     FROM invoices
     WHERE status = 'imported'
     ORDER BY period_start DESC
     LIMIT 1`,
  );
  return rows[0]?.period ?? null;
}

async function loadOpenAnomalyCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM anomalies WHERE dismissed_at IS NULL`,
  );
  return Number(rows[0]!.count);
}

/**
 * `GET /health` (§14, A16). Not exempt from auth — enforcement is
 * `frontend/src/proxy.ts`, not here. DB unreachable degrades every
 * DB-dependent field to `false`/`null` rather than throwing: a health
 * endpoint that 500s on the one condition it exists to report is broken by
 * design. Provider reachability is config-only, never a live probe — §8.3's
 * budget guard exists because ordinary use is meant to cost nothing, and a
 * health check polled by the frontend must not itself spend it.
 */
export async function getHealthStatus(
  pool: Pool | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): Promise<HealthStatus> {
  const provider = checkProviderConfig(env);

  let activePool: Pool;
  try {
    activePool = pool ?? getPool();
    await activePool.query("SELECT 1");
  } catch {
    return {
      db: { reachable: false },
      provider: { ...provider, meters: null },
      latestSheetDate: null,
      latestInvoicePeriod: null,
      openAnomalyCount: null,
    };
  }

  const [meters, latestSheetDate, latestInvoicePeriod, openAnomalyCount] = await Promise.all([
    provider.name === "ors" ? loadOrsMeters(activePool, env, now) : Promise.resolve(null),
    loadLatestSheetDate(activePool),
    loadLatestInvoicePeriod(activePool),
    loadOpenAnomalyCount(activePool),
  ]);

  return {
    db: { reachable: true },
    provider: { ...provider, meters },
    latestSheetDate,
    latestInvoicePeriod,
    openAnomalyCount,
  };
}
