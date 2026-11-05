import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateProd, parseTarget, type MigrateProdDeps } from "./migrateProd.js";

const DIRECT = "postgresql://neondb_owner:npg_S3cretPw@ep-cool-a1b2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const POOLED = "postgresql://neondb_owner:npg_S3cretPw@ep-cool-a1b2-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const PROD = { APP_ENV: "production" };
const PREVIEW = { APP_ENV: "preview" };
const TODAY = new Date(Date.UTC(2026, 10, 5, 12));

const made: string[] = [];
function dirWith(...files: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "migrate-prod-"));
  made.push(dir);
  for (const file of files) writeFileSync(path.join(dir, file), `-- ${file}\nSELECT 1;\n`);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILES = ["0001_a.sql", "0002_b.sql", "0003_c.sql"];

type FakeClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void };

/** A fake pool: records every statement; `applied` is what schema_migrations already holds (null: no table). */
function fakeDeps(options: { version?: string; applied?: string[] | null; synthetic?: string[]; real?: string[] } = {}) {
  const statements: string[] = [];
  const out: string[] = [];
  const connected: string[] = [];
  let ended = 0;
  const applied = options.applied === undefined ? ["0001_a.sql"] : options.applied;
  const recorded = new Set(applied ?? []);
  const state = { failOn: undefined as string | undefined };
  const query = async (text: string, params: unknown[] = []) => {
    statements.push(text.trim().replace(/\s+/g, " "));
    if (state.failOn && text.includes(state.failOn)) throw new Error("boom");
    if (text.startsWith("SHOW server_version")) return { rows: [{ server_version: options.version ?? "18.6" }] };
    if (text.includes("to_regclass")) return { rows: [{ present: applied !== null }] };
    if (text.startsWith("SELECT filename FROM schema_migrations")) {
      return { rows: [...recorded].map((filename) => ({ filename })) };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) recorded.add(params[0] as string);
    return { rows: [] };
  };
  const client: FakeClient = { query, release: () => undefined };
  const deps: MigrateProdDeps = {
    createPool: (url) => {
      connected.push(url);
      return {
        query,
        connect: async () => client,
        end: async () => {
          ended += 1;
        },
        options: { connectionString: url },
      } as never;
    },
    syntheticDir: dirWith(...(options.synthetic ?? FILES)),
    realDir: dirWith(...(options.real ?? FILES)),
    log: (line) => out.push(line),
    now: () => TODAY,
  };
  return { deps, statements, out, connected, state, ended: () => ended };
}

describe("migrateProd — refusals, before any connection", () => {
  it("requires APP_ENV=production", async () => {
    for (const env of [{}, { APP_ENV: "real" }, { APP_ENV: "development" }, { APP_ENV: "preview" }]) {
      const { deps, connected } = fakeDeps();
      await expect(migrateProd(DIRECT, env, ["--confirm"], deps)).rejects.toThrow(/APP_ENV=production/);
      expect(connected).toEqual([]);
    }
  });

  it("refuses a missing DATABASE_URL and says .env.production.local is yours to create", async () => {
    const { deps, connected } = fakeDeps();
    await expect(migrateProd(undefined, PROD, [], deps)).rejects.toThrow(/DATABASE_URL.*\.env\.production\.local/s);
    expect(connected).toEqual([]);
  });

  it("refuses a pooled host and points at the direct connection string", async () => {
    const { deps, connected } = fakeDeps();
    await expect(migrateProd(POOLED, PROD, ["--confirm"], deps)).rejects.toThrow(/pooler.*direct/s);
    expect(connected).toEqual([]);
  });

  it("refuses a pooler set through ?host= as well", async () => {
    const { deps } = fakeDeps();
    const url = "postgres://u:p@localhost/neondb?host=ep-x-pooler.us-east-1.aws.neon.tech";
    await expect(migrateProd(url, PROD, ["--confirm"], deps)).rejects.toThrow(/pooler/);
  });

  it("rejects any argument other than --confirm", async () => {
    const { deps, connected } = fakeDeps();
    await expect(migrateProd(DIRECT, PROD, ["--yes"], deps)).rejects.toThrow(/--confirm/);
    await expect(migrateProd(DIRECT, PROD, ["--confirm", "reset"], deps)).rejects.toThrow(/--confirm/);
    expect(connected).toEqual([]);
  });

  it("refuses when migrations/synthetic and migrations/real differ", async () => {
    const { deps, connected } = fakeDeps({ real: ["0001_a.sql", "0002_b.sql"] });
    await expect(migrateProd(DIRECT, PROD, ["--confirm"], deps)).rejects.toThrow(/0003_c\.sql/);
    expect(connected).toEqual([]);
  });
});

describe("migrateProd — preview (no --confirm)", () => {
  it("prints the target, server version and pending files, applies nothing, and closes the pool", async () => {
    const { deps, out, statements, ended } = fakeDeps();

    const result = await migrateProd(DIRECT, PROD, [], deps);

    const text = out.join("\n");
    expect(text).toContain("env=production db=ep-cool-a1b2.us-east-1.aws.neon.tech/neondb");
    expect(text).toContain("18.6");
    expect(text).toContain("0002_b.sql");
    expect(text).toContain("0003_c.sql");
    expect(text).not.toContain("0001_a.sql");
    expect(result).toEqual({ pending: ["0002_b.sql", "0003_c.sql"], applied: [], confirmed: false });
    expect(statements.some((s) => /^(CREATE|INSERT|BEGIN|ALTER|DROP)/.test(s))).toBe(false);
    expect(ended()).toBe(1);
  });

  it("reminds you to take a pre-<ticket>-<date> Neon snapshot branch, with today's date", async () => {
    const { deps, out } = fakeDeps();
    await migrateProd(DIRECT, PROD, [], deps);
    const text = out.join("\n");
    expect(text).toMatch(/snapshot/i);
    expect(text).toContain("pre-<ticket>-2026-11-05");
    expect(text).toContain("--confirm");
  });

  it("never prints the password or the user", async () => {
    const { deps, out } = fakeDeps();
    await migrateProd(DIRECT, PROD, [], deps);
    await migrateProd(DIRECT, PROD, ["--confirm"], deps);
    for (const line of out) {
      expect(line).not.toContain("npg_S3cretPw");
      expect(line).not.toContain("neondb_owner");
    }
  });

  it("treats a database with no schema_migrations table as having everything pending", async () => {
    const { deps } = fakeDeps({ applied: null });
    const result = await migrateProd(DIRECT, PROD, [], deps);
    expect(result.pending).toEqual(FILES);
  });

  it("reports nothing pending when everything is applied", async () => {
    const { deps, out } = fakeDeps({ applied: FILES });
    const result = await migrateProd(DIRECT, PROD, [], deps);
    expect(result.pending).toEqual([]);
    expect(out.join("\n")).toMatch(/no pending/i);
  });
});

describe("migrateProd — Postgres version", () => {
  it("warns, without blocking, when the major version is not 18", async () => {
    const { deps, out } = fakeDeps({ version: "17.2" });
    const result = await migrateProd(DIRECT, PROD, ["--confirm"], deps);
    const text = out.join("\n");
    expect(text).toMatch(/WARNING.*17.*18/s);
    expect(text).toMatch(/restore/i);
    expect(result.applied).toEqual(["0002_b.sql", "0003_c.sql"]);
  });

  it("prints no warning on 18", async () => {
    const { deps, out } = fakeDeps({ version: "18.1" });
    await migrateProd(DIRECT, PROD, [], deps);
    expect(out.join("\n")).not.toMatch(/WARNING/);
  });
});

describe("migrateProd — --confirm", () => {
  it("applies only the pending files, in order", async () => {
    const { deps, out, statements, ended } = fakeDeps();

    const result = await migrateProd(DIRECT, PROD, ["--confirm"], deps);

    expect(result).toEqual({ pending: ["0002_b.sql", "0003_c.sql"], applied: ["0002_b.sql", "0003_c.sql"], confirmed: true });
    expect(statements.filter((s) => s.startsWith("INSERT INTO schema_migrations"))).toHaveLength(2);
    expect(out.join("\n")).toMatch(/applied\s+0002_b\.sql/);
    expect(out.join("\n")).toMatch(/skipped\s+0001_a\.sql/);
    expect(ended()).toBe(1);
  });

  it("reads the SQL it runs from migrations/real, not synthetic", async () => {
    const { deps, statements } = fakeDeps();
    writeFileSync(path.join(deps.realDir, "0002_b.sql"), "SELECT 'from-real';\n");
    writeFileSync(path.join(deps.syntheticDir, "0002_b.sql"), "SELECT 'from-synthetic';\n");
    await migrateProd(DIRECT, PROD, ["--confirm"], deps);
    expect(statements).toContain("SELECT 'from-real';");
    expect(statements).not.toContain("SELECT 'from-synthetic';");
  });

  it("closes the pool when a migration fails", async () => {
    const { deps, state, ended } = fakeDeps();
    state.failOn = "-- 0002_b.sql";
    await expect(migrateProd(DIRECT, PROD, ["--confirm"], deps)).rejects.toThrow("boom");
    expect(ended()).toBe(1);
  });
});

describe("migrateProd — no path to a reset", () => {
  /** Every repo source file migrateProd.ts can reach through relative imports. */
  function reachable(entry: string): Map<string, string> {
    const seen = new Map<string, string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      const source = readFileSync(file, "utf8");
      seen.set(file, source);
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.resolve(path.dirname(file), match[1]!.replace(/\.js$/, ".ts"));
        if (existsSync(target)) queue.push(target);
      }
    }
    return seen;
  }

  const files = () => reachable(path.join(import.meta.dirname, "migrateProd.ts"));

  it("imports neither the reset/seed CLIs nor the dump and restore code", () => {
    const names = [...files().keys()].map((file) => path.basename(file));
    expect(names).toContain("migrateProd.ts");
    expect(names).toContain("migrate.ts");
    for (const forbidden of ["dbAdmin.ts", "seed.ts", "restoreToReal.ts", "dbNuke.ts", "backup.ts", "dbBackup.ts"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("contains no reset, drop, truncate or delete anywhere in what it can reach", () => {
    const forbidden =
      /recreateDatabase|resetDatabase|createDatabases|\bDROP\s+(DATABASE|SCHEMA|TABLE)|\bTRUNCATE\b|\bDELETE\s+FROM\b/;
    for (const [file, source] of files()) {
      expect(forbidden.test(source), `${path.basename(file)} reaches a destructive statement`).toBe(false);
    }
  });

  it("issues only SHOW, SELECT and migration statements against the database", async () => {
    const { deps, statements } = fakeDeps();
    await migrateProd(DIRECT, PROD, ["--confirm"], deps);
    const allowed =
      /^(SHOW |SELECT |-- |CREATE TABLE IF NOT EXISTS schema_migrations|BEGIN|COMMIT|INSERT INTO schema_migrations)/;
    for (const statement of statements) expect(statement).toMatch(allowed);
  });
});

describe("migrateProd — the preview target (T-106)", () => {
  it("db:migrate:preview requires APP_ENV=preview, and refuses production and every other value", async () => {
    for (const env of [{}, PROD, { APP_ENV: "real" }, { APP_ENV: "development" }, { APP_ENV: "test" }]) {
      const { deps, connected } = fakeDeps();
      await expect(migrateProd(DIRECT, env, ["--confirm"], deps, "preview")).rejects.toThrow(
        /db:migrate:preview requires APP_ENV=preview/,
      );
      expect(connected).toEqual([]);
    }
  });

  it("db:migrate:prod still refuses APP_ENV=preview", async () => {
    const { deps, connected } = fakeDeps();
    await expect(migrateProd(DIRECT, PREVIEW, ["--confirm"], deps, "production")).rejects.toThrow(
      /db:migrate:prod requires APP_ENV=production/,
    );
    expect(connected).toEqual([]);
  });

  it("names .env.preview.local when DATABASE_URL is missing", async () => {
    const { deps } = fakeDeps();
    await expect(migrateProd(undefined, PREVIEW, [], deps, "preview")).rejects.toThrow(/\.env\.preview\.local/);
  });

  it("refuses a pooled host under preview", async () => {
    const { deps, connected } = fakeDeps();
    await expect(migrateProd(POOLED, PREVIEW, ["--confirm"], deps, "preview")).rejects.toThrow(/pooler.*direct/s);
    expect(connected).toEqual([]);
  });

  it("refuses a parity mismatch under preview", async () => {
    const { deps, connected } = fakeDeps({ real: ["0001_a.sql", "0002_b.sql"] });
    await expect(migrateProd(DIRECT, PREVIEW, ["--confirm"], deps, "preview")).rejects.toThrow(/0003_c\.sql/);
    expect(connected).toEqual([]);
  });

  it("without --confirm prints env=preview and the pending list, applies nothing, and says undo is Reset from parent", async () => {
    const { deps, out, statements } = fakeDeps();
    const result = await migrateProd(DIRECT, PREVIEW, [], deps, "preview");
    const text = out.join("\n");
    expect(text).toContain("env=preview db=ep-cool-a1b2.us-east-1.aws.neon.tech/neondb");
    expect(text).toContain("0002_b.sql");
    expect(text).toMatch(/Reset from parent/);
    expect(text).not.toMatch(/snapshot/i);
    expect(result).toEqual({ pending: ["0002_b.sql", "0003_c.sql"], applied: [], confirmed: false });
    expect(statements.some((s) => /^(CREATE|INSERT|BEGIN|ALTER|DROP)/.test(s))).toBe(false);
  });

  it("with --confirm applies the pending files through runMigrations", async () => {
    const { deps, statements, ended } = fakeDeps();
    const result = await migrateProd(DIRECT, PREVIEW, ["--confirm"], deps, "preview");
    expect(result).toEqual({ pending: ["0002_b.sql", "0003_c.sql"], applied: ["0002_b.sql", "0003_c.sql"], confirmed: true });
    expect(statements.filter((s) => s.startsWith("INSERT INTO schema_migrations"))).toHaveLength(2);
    expect(ended()).toBe(1);
  });

  it("parseTarget accepts only production and preview", () => {
    expect(parseTarget("production")).toBe("production");
    expect(parseTarget("preview")).toBe("preview");
    for (const bad of [undefined, "--confirm", "real", "prod"]) expect(() => parseTarget(bad)).toThrow(/production or preview/);
  });
});

describe("the migration SQL files", () => {
  // A tripwire, not proof: migration SQL is the one thing the command runs
  // that this test cannot reach by following imports.
  it("hold no DROP DATABASE or DROP SCHEMA", () => {
    const root = path.resolve(import.meta.dirname, "../../../migrations");
    for (const set of ["synthetic", "real"]) {
      const dir = path.join(root, set);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
        expect(readFileSync(path.join(dir, file), "utf8"), `${set}/${file}`).not.toMatch(/DROP\s+(DATABASE|SCHEMA)/i);
      }
    }
  });
});
