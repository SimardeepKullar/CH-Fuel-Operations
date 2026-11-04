import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnv, parseArgs, quoteArg, runWithAppEnv } from "./withAppEnv.js";

describe("parseArgs", () => {
  it("reads --set or --default, an environment, and the command after --", () => {
    expect(parseArgs(["--set", "real", "--", "tsx", "x.ts", "a b"])).toEqual({
      mode: "set",
      appEnv: "real",
      command: ["tsx", "x.ts", "a b"],
    });
    expect(parseArgs(["--default", "development", "--", "npm", "run", "seed"]).mode).toBe("default");
  });

  it("rejects a missing mode, an unknown environment, or no command", () => {
    expect(() => parseArgs(["real", "--", "tsx"])).toThrow(/usage/);
    expect(() => parseArgs(["--set", "staging", "--", "tsx"])).toThrow(/APP_ENV/);
    expect(() => parseArgs(["--set", "real", "--"])).toThrow(/usage/);
    expect(() => parseArgs(["--set", "real", "tsx"])).toThrow(/usage/);
  });
});

describe("childEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ch-withappenv-"));
    writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://localhost:5433/from_root\nAUTH_SECRET=s\n");
    writeFileSync(path.join(dir, ".env.real"), "DATABASE_URL=postgres://localhost:5433/ch_fuel_real\n");
    writeFileSync(path.join(dir, ".env.development"), "DATABASE_URL=postgres://localhost:5433/ch_fuel_dev\n");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("--set overrides an inherited APP_ENV and resolves that environment's files", () => {
    const env = childEnv({ mode: "set", appEnv: "real" }, { APP_ENV: "development" }, dir);
    expect(env.APP_ENV).toBe("real");
    expect(env.DATABASE_URL).toBe("postgres://localhost:5433/ch_fuel_real");
    expect(env.AUTH_SECRET).toBe("s");
  });

  it("--default keeps an inherited APP_ENV — a seed nested in a real chain stays real", () => {
    const env = childEnv({ mode: "default", appEnv: "development" }, { APP_ENV: "real" }, dir);
    expect(env.APP_ENV).toBe("real");
    expect(env.DATABASE_URL).toBe("postgres://localhost:5433/ch_fuel_real");
  });

  it("--default applies when APP_ENV is unset or empty", () => {
    for (const parent of [{}, { APP_ENV: "" }]) {
      const env = childEnv({ mode: "default", appEnv: "development" }, parent, dir);
      expect(env.APP_ENV).toBe("development");
      expect(env.DATABASE_URL).toBe("postgres://localhost:5433/ch_fuel_dev");
    }
  });

  it("passes the resolved DATABASE_URL down, so a child that reads only .env with setdefault (the Python scripts) cannot fall back to it", () => {
    const env = childEnv({ mode: "set", appEnv: "real" }, {}, dir);
    expect(env.DATABASE_URL).not.toContain("from_root");
  });

  it("never overwrites a DATABASE_URL already set in the shell", () => {
    const env = childEnv({ mode: "set", appEnv: "real" }, { DATABASE_URL: "postgres://localhost:5433/ch_fuel_test" }, dir);
    expect(env.DATABASE_URL).toBe("postgres://localhost:5433/ch_fuel_test");
  });

  it("does not modify the parent environment", () => {
    const parent: Record<string, string | undefined> = {};
    childEnv({ mode: "set", appEnv: "real" }, parent, dir);
    expect(parent).toEqual({});
  });

  it("--default with an inherited unknown APP_ENV fails rather than guessing", () => {
    expect(() => childEnv({ mode: "default", appEnv: "development" }, { APP_ENV: "prod" }, dir)).toThrow(/APP_ENV/);
  });
});

describe("quoteArg", () => {
  it("leaves plain arguments alone and quotes ones with spaces", () => {
    expect(quoteArg("./data/bvd-prices/x.csv")).toBe("./data/bvd-prices/x.csv");
    expect(quoteArg("./data/my file.pdf")).toBe('"./data/my file.pdf"');
  });
});

describe("runWithAppEnv", () => {
  it("runs the command and passes its exit code through", async () => {
    const code = await runWithAppEnv(["--set", "test", "--", "node", "-e", "process.exit(3)"]);
    expect(code).toBe(3);
  });

  it("gives the child the chosen APP_ENV", async () => {
    const code = await runWithAppEnv([
      "--set",
      "real",
      "--",
      "node",
      "-e",
      "process.exit(process.env.APP_ENV === 'real' ? 0 : 1)",
    ]);
    expect(code).toBe(0);
  });
});
