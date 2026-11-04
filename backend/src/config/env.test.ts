import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeTarget,
  envFilesFor,
  formatTarget,
  loadEnvFiles,
  resolveAppEnv,
} from "./env.js";

describe("resolveAppEnv", () => {
  it("is undefined when APP_ENV is unset or empty", () => {
    expect(resolveAppEnv({})).toBeUndefined();
    expect(resolveAppEnv({ APP_ENV: "" })).toBeUndefined();
  });

  it.each(["development", "test", "real", "preview", "production"])("accepts %s", (value) => {
    expect(resolveAppEnv({ APP_ENV: value })).toBe(value);
  });

  it("throws on an unknown value rather than falling back", () => {
    expect(() => resolveAppEnv({ APP_ENV: "prod" })).toThrow(/APP_ENV/);
    expect(() => resolveAppEnv({ APP_ENV: "Production" })).toThrow(/APP_ENV/);
  });
});

describe("envFilesFor", () => {
  it("reads only .env when no environment is selected", () => {
    expect(envFilesFor(undefined)).toEqual([".env"]);
  });

  it("reads .env.<env>.local, then .env.<env>, then .env", () => {
    expect(envFilesFor("production")).toEqual([".env.production.local", ".env.production", ".env"]);
    expect(envFilesFor("development")).toEqual([".env.development.local", ".env.development", ".env"]);
  });
});

describe("loadEnvFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ch-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, contents: string): void {
    writeFileSync(path.join(dir, name), contents);
  }

  it("with APP_ENV unset, loads only .env", () => {
    write(".env", "DATABASE_URL=postgres://localhost:5433/ch_fuel_planner\n");
    write(".env.development", "DATABASE_URL=postgres://localhost:5433/ch_fuel_dev\n");
    const env: Record<string, string | undefined> = {};

    expect(loadEnvFiles(dir, env)).toEqual({ appEnv: undefined, loaded: [".env"] });
    expect(env.DATABASE_URL).toBe("postgres://localhost:5433/ch_fuel_planner");
  });

  it("the first file to set a key wins, and later files fill only the gaps", () => {
    write(".env.development.local", "A=local\n");
    write(".env.development", "A=dev\nB=dev\n");
    write(".env", "A=root\nB=root\nC=root\n");
    const env: Record<string, string | undefined> = { APP_ENV: "development" };

    expect(loadEnvFiles(dir, env).loaded).toEqual([".env.development.local", ".env.development", ".env"]);
    expect(env).toMatchObject({ A: "local", B: "dev", C: "root" });
  });

  it("never overwrites a variable already set in the environment", () => {
    write(".env.test", "DATABASE_URL=postgres://localhost:5433/ch_fuel_test\n");
    const env: Record<string, string | undefined> = {
      APP_ENV: "test",
      DATABASE_URL: "postgres://localhost:5433/from_shell",
    };

    loadEnvFiles(dir, env);
    expect(env.DATABASE_URL).toBe("postgres://localhost:5433/from_shell");
  });

  it("skips a missing file without error", () => {
    write(".env", "A=root\n");
    const env: Record<string, string | undefined> = { APP_ENV: "real" };

    expect(loadEnvFiles(dir, env).loaded).toEqual([".env"]);
    expect(env.A).toBe("root");
  });

  it("an APP_ENV line inside .env neither selects files nor sets APP_ENV", () => {
    write(".env", "APP_ENV=production\nA=root\n");
    write(".env.production.local", "DATABASE_URL=postgres://u:p@ep-x.neon.tech/neondb\n");
    const env: Record<string, string | undefined> = {};

    expect(loadEnvFiles(dir, env)).toEqual({ appEnv: undefined, loaded: [".env"] });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.APP_ENV).toBeUndefined();
    expect(env.A).toBe("root");
  });

  it("reads .env.production.local only when APP_ENV=production is set explicitly", () => {
    write(".env.production.local", "DATABASE_URL=postgres://u:p@ep-x.neon.tech/neondb\n");
    const env: Record<string, string | undefined> = { APP_ENV: "production" };

    expect(loadEnvFiles(dir, env).loaded).toEqual([".env.production.local"]);
    expect(env.DATABASE_URL).toBe("postgres://u:p@ep-x.neon.tech/neondb");
  });

  it("ignores comments, blank lines and lines without '=', and tolerates CRLF", () => {
    write(".env", "# comment\r\n\r\nNOEQUALS\r\nA=1\r\nB = two \r\n");
    const env: Record<string, string | undefined> = {};

    loadEnvFiles(dir, env);
    expect(env).toEqual({ A: "1", B: "two" });
  });

  it("throws on an unknown APP_ENV before reading any file", () => {
    write(".env", "A=root\n");
    const env: Record<string, string | undefined> = { APP_ENV: "staging" };

    expect(() => loadEnvFiles(dir, env)).toThrow(/APP_ENV/);
    expect(env.A).toBeUndefined();
  });
});

describe("describeTarget / formatTarget", () => {
  it("names the environment, host and database, and never the credentials", () => {
    const target = describeTarget("development", "postgres://ch_fuel:s3cret@localhost:5433/ch_fuel_dev");

    expect(target).toEqual({ appEnv: "development", host: "localhost:5433", database: "ch_fuel_dev" });
    const line = formatTarget(target);
    expect(line).toBe("env=development db=localhost:5433/ch_fuel_dev");
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("ch_fuel:");
  });

  it("strips credentials and query parameters from a Neon-style URL", () => {
    const url =
      "postgresql://neondb_owner:npg_AbCdEf123@ep-cool-name-a1b2c3-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const line = formatTarget(describeTarget("production", url));

    expect(line).toBe("env=production db=ep-cool-name-a1b2c3-pooler.us-east-1.aws.neon.tech/neondb");
    expect(line).not.toContain("npg_AbCdEf123");
    expect(line).not.toContain("neondb_owner");
    expect(line).not.toContain("sslmode");
  });

  it("reports an unset environment and an unset or unparseable URL instead of throwing", () => {
    expect(formatTarget(describeTarget(undefined, undefined))).toBe("env=(unset) db=(DATABASE_URL unset)");
    const line = formatTarget(describeTarget(undefined, "not a url :pass@"));
    expect(line).toBe("env=(unset) db=(unparseable DATABASE_URL)");
    expect(line).not.toContain("pass");
  });
});
