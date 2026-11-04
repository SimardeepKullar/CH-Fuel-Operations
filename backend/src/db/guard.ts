import { parse } from "pg-connection-string";
import { resolveAppEnv } from "../config/env.js";

/** The only databases anything destructive may touch (PLAN-dev-prod-environments §2). */
export const DESTROYABLE_DATABASES = ["ch_fuel_dev", "ch_fuel_test", "ch_fuel_real"] as const;

/** IPv6 is compared without brackets: pg-connection-string 2.14.0 kept them, 2.14.1 strips them. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Throws unless connectionString names a local dev, test or real database and
 * APP_ENV is not production or preview. Call it before anything that drops,
 * truncates or resets.
 *
 * The string is parsed by pg-connection-string — the parser pg connects with
 * — so the host checked is the host pg would use: a `?host=` parameter
 * overrides the URL's host, and a URL with no host falls back to PGHOST, so
 * both are judged as pg would see them, not as the URL reads.
 */
export function assertSafeToDestroy(
  connectionString: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const appEnv = resolveAppEnv(env);
  if (appEnv === "production" || appEnv === "preview") {
    throw refusal(`APP_ENV=${appEnv}`);
  }

  const config = parse(connectionString) as ReturnType<typeof parse> & Record<string, unknown>;
  const host = (config.host ?? "").toLowerCase().replace(/^\[(.+)\]$/, "$1");
  const database = config.database ?? "";
  const target = `${host || "(no host)"}/${database || "(no database)"}`;

  for (const key of ["hostaddr", "dbname"]) {
    if (config[key] !== undefined) {
      throw refusal(`the connection string sets ${key}, which can redirect it (${target})`);
    }
  }
  if (!host) {
    // pg would fall back to PGHOST, which this check cannot vouch for.
    throw refusal(`the connection string has no host, so pg would use PGHOST (${target})`);
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw refusal(`${host} is not a local host (${target})`);
  }
  if (host.includes("neon.tech")) {
    throw refusal(`${host} is a Neon host (${target})`);
  }
  const allowed: readonly string[] = DESTROYABLE_DATABASES;
  if (!allowed.includes(database)) {
    throw refusal(`database "${database}" is not one of ${allowed.join(", ")} (${target})`);
  }
}

function refusal(reason: string): Error {
  return new Error(`refusing a destructive operation: ${reason}`);
}
