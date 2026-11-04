import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Which environment a process is running in. `preview` is a Vercel preview
 * deployment (T-49) and is treated like `production` wherever data could be
 * destroyed. Unset means "no environment chosen": only the root `.env` is
 * read, exactly as before APP_ENV existed.
 */
export const APP_ENVS = ["development", "test", "real", "preview", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

type Env = Record<string, string | undefined>;

/** Throws on an unknown value — a typo must never fall back to some default target. */
export function resolveAppEnv(env: Readonly<Env>): AppEnv | undefined {
  const value = env.APP_ENV;
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!(APP_ENVS as readonly string[]).includes(value)) {
    throw new Error(`APP_ENV="${value}" is not one of ${APP_ENVS.join(", ")}`);
  }
  return value as AppEnv;
}

/** Highest priority first: the first file to set a key wins. */
export function envFilesFor(appEnv: AppEnv | undefined): string[] {
  return appEnv ? [`.env.${appEnv}.local`, `.env.${appEnv}`, ".env"] : [".env"];
}

/**
 * Loads `envFilesFor(APP_ENV)` from rootDir into env. A key already set is
 * never overwritten. APP_ENV is read from the real environment only, and an
 * APP_ENV line in a file is ignored — so `.env.production.local` is read only
 * when APP_ENV=production was set explicitly, never because a file said so.
 */
export function loadEnvFiles(
  rootDir: string,
  env: Env = process.env,
): { appEnv: AppEnv | undefined; loaded: string[] } {
  const appEnv = resolveAppEnv(env);
  const loaded: string[] = [];

  for (const name of envFilesFor(appEnv)) {
    const filePath = path.join(rootDir, name);
    if (!existsSync(filePath)) {
      continue;
    }
    loaded.push(name);

    const contents = readFileSync(filePath, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key && key !== "APP_ENV" && !(key in env)) {
        env[key] = value;
      }
    }
  }

  return { appEnv, loaded };
}

export interface Target {
  appEnv: AppEnv | undefined;
  /** host[:port], or a placeholder when the URL is unset or unparseable. */
  host: string;
  database: string;
}

/** Where a connection string points, without its user, password or query string. */
export function describeTarget(appEnv: AppEnv | undefined, databaseUrl: string | undefined): Target {
  if (!databaseUrl) {
    return { appEnv, host: "(DATABASE_URL unset)", database: "" };
  }
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { appEnv, host: "(unparseable DATABASE_URL)", database: "" };
  }
  return { appEnv, host: url.host, database: decodeURIComponent(url.pathname.replace(/^\//, "")) };
}

/** The one startup line: `env=development db=localhost:5433/ch_fuel_dev`. */
export function formatTarget(target: Target): string {
  const db = target.database ? `${target.host}/${target.database}` : target.host;
  return `env=${target.appEnv ?? "(unset)"} db=${db}`;
}
