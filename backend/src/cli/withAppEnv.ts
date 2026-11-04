import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, formatTarget, loadEnvFiles, resolveAppEnv, type AppEnv } from "../config/env.js";

/**
 * `tsx backend/src/cli/withAppEnv.ts --set real -- <command…>` (T-100).
 *
 * Runs a command under an APP_ENV, the way `cross-env` would on Windows, and
 * also resolves that environment's .env files into the child's environment.
 * That second half is what keeps the Python scripts honest: they read only the
 * root `.env`, with `setdefault`, so without a DATABASE_URL already set they
 * would write to whatever `.env` names regardless of APP_ENV.
 *
 * --set     always use this environment (db:reset:real, test).
 * --default use it only when APP_ENV is not already set, so `npm run seed`
 *           nested inside a real chain stays real.
 */
export interface WrapperArgs {
  mode: "set" | "default";
  appEnv: AppEnv;
  command: string[];
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const USAGE = "usage: withAppEnv (--set|--default) <APP_ENV> -- <command…>";

export function parseArgs(argv: readonly string[]): WrapperArgs {
  const [flag, value, separator, ...command] = argv;
  if ((flag !== "--set" && flag !== "--default") || separator !== "--" || command.length === 0) {
    throw new Error(USAGE);
  }
  const appEnv = resolveAppEnv({ APP_ENV: value });
  if (!appEnv) {
    throw new Error(USAGE);
  }
  return { mode: flag === "--set" ? "set" : "default", appEnv, command };
}

/** The child's environment: a copy of the parent's, APP_ENV applied, its files resolved. */
export function childEnv(
  args: Pick<WrapperArgs, "mode" | "appEnv">,
  parentEnv: Readonly<Record<string, string | undefined>>,
  rootDir: string = ROOT_DIR,
): Record<string, string | undefined> {
  const env = { ...parentEnv };
  if (args.mode === "set" || !resolveAppEnv(env)) {
    env.APP_ENV = args.appEnv;
  }
  loadEnvFiles(rootDir, env);
  return env;
}

/** Quotes an argument for the shell the command runs in (cmd.exe or sh). */
export function quoteArg(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/** Resolves to the child's exit code; 1 if it was killed by a signal. */
export function runWithAppEnv(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const env = childEnv(args, process.env);
  console.error(formatTarget(describeTarget(resolveAppEnv(env), env.DATABASE_URL)));

  // shell: npm, npx and tsx are .cmd shims on Windows.
  const child = spawn(args.command.map(quoteArg).join(" "), { env, shell: true, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  runWithAppEnv(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
