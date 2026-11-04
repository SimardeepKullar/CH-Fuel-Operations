import { describe, expect, it } from "vitest";
import {
  CREATE_TEMPLATE,
  createDatabases,
  maintenanceUrl,
  migrationsDirFor,
  resetDatabase,
  withDatabase,
  type AdminDeps,
} from "./dbAdmin.js";
import { nukeDecision, NUKE_FLAG } from "./dbNuke.js";

const LOCAL = "postgres://ch_fuel:ch_fuel@localhost:5433";

/** Records every statement and step in order; `existing` is what pg_database holds. */
function fakeDeps(existing: string[], options: { dumpFails?: boolean } = {}) {
  const log: string[] = [];
  const deps: AdminDeps = {
    connectMaintenance: async (url) => {
      log.push(`connect ${new URL(url).pathname}`);
      return {
        query: async (text: string, params: unknown[] = []) => {
          log.push(params.length ? `${text} [${params.join(",")}]` : text);
          if (text.startsWith("SELECT 1 FROM pg_database")) {
            return { rows: existing.includes(String(params[0])) ? [{ "?column?": 1 }] : [] };
          }
          return { rows: [] };
        },
        end: async () => {
          log.push("end");
        },
      };
    },
    migrate: async (url, dir) => {
      log.push(`migrate ${new URL(url).pathname} ${dir}`);
    },
    dump: async (database) => {
      log.push(`dump ${database}`);
      if (options.dumpFails) throw new Error("pg_dump exited 1");
      return `backups/${database}-x.dump`;
    },
  };
  return { deps, log };
}

describe("withDatabase / maintenanceUrl", () => {
  it("swaps only the database, keeping credentials, host and query", () => {
    expect(withDatabase(`${LOCAL}/ch_fuel_dev?sslmode=disable`, "ch_fuel_real")).toBe(
      `${LOCAL}/ch_fuel_real?sslmode=disable`,
    );
    expect(maintenanceUrl(`${LOCAL}/ch_fuel_dev`)).toBe(`${LOCAL}/postgres`);
  });
});

describe("migrationsDirFor", () => {
  it("uses migrations/real only under APP_ENV=real", () => {
    expect(migrationsDirFor("real")).toMatch(/migrations[\\/]real$/);
    expect(migrationsDirFor("development")).toMatch(/migrations[\\/]synthetic$/);
    expect(migrationsDirFor("test")).toMatch(/migrations[\\/]synthetic$/);
    expect(migrationsDirFor(undefined)).toMatch(/migrations[\\/]synthetic$/);
  });
});

describe("createDatabases", () => {
  it("creates the three missing databases from template1, never template_postgis", async () => {
    // template_postgis already has PostGIS installed, so a pg_restore of a
    // dump (which carries its own CREATE EXTENSION) would fail with
    // "extension already exists". The migrations create the extensions.
    expect(CREATE_TEMPLATE).toBe("template1");
    const { deps, log } = fakeDeps([]);

    const result = await createDatabases(`${LOCAL}/ch_fuel_dev`, {}, deps);

    expect(result).toEqual([
      { database: "ch_fuel_dev", created: true },
      { database: "ch_fuel_test", created: true },
      { database: "ch_fuel_real", created: true },
    ]);
    const creates = log.filter((line) => line.startsWith("CREATE DATABASE"));
    expect(creates).toEqual([
      'CREATE DATABASE "ch_fuel_dev" TEMPLATE template1',
      'CREATE DATABASE "ch_fuel_test" TEMPLATE template1',
      'CREATE DATABASE "ch_fuel_real" TEMPLATE template1',
    ]);
    expect(log.join("\n")).not.toMatch(/template_postgis/);
    expect(log[0]).toBe("connect /postgres");
    expect(log.at(-1)).toBe("end");
  });

  it("skips databases that exist and never drops, migrates or touches ch_fuel_planner", async () => {
    const { deps, log } = fakeDeps(["ch_fuel_planner", "ch_fuel_dev", "ch_fuel_real"]);

    const result = await createDatabases(`${LOCAL}/ch_fuel_dev`, {}, deps);

    expect(result.filter((r) => r.created).map((r) => r.database)).toEqual(["ch_fuel_test"]);
    const joined = log.join("\n");
    expect(joined).not.toMatch(/DROP/);
    expect(joined).not.toMatch(/migrate|dump/);
    expect(joined).not.toMatch(/ch_fuel_planner/);
  });

  it("refuses a non-local server before connecting", async () => {
    const { deps, log } = fakeDeps([]);
    await expect(createDatabases("postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb", {}, deps)).rejects.toThrow(
      /refusing/,
    );
    expect(log).toEqual([]);
  });

  it("refuses under APP_ENV=production before connecting", async () => {
    const { deps, log } = fakeDeps([]);
    await expect(createDatabases(`${LOCAL}/ch_fuel_dev`, { APP_ENV: "production" }, deps)).rejects.toThrow(/APP_ENV/);
    expect(log).toEqual([]);
  });
});

describe("resetDatabase", () => {
  it("drops, recreates from template1, then migrates synthetic — for ch_fuel_dev, with no dump", async () => {
    const { deps, log } = fakeDeps(["ch_fuel_dev"]);

    await resetDatabase("ch_fuel_dev", `${LOCAL}/ch_fuel_dev`, { APP_ENV: "development" }, deps);

    expect(log).toEqual([
      "connect /postgres",
      'DROP DATABASE IF EXISTS "ch_fuel_dev" WITH (FORCE)',
      'CREATE DATABASE "ch_fuel_dev" TEMPLATE template1',
      "end",
      `migrate /ch_fuel_dev ${migrationsDirFor("development")}`,
    ]);
  });

  it("dumps ch_fuel_real to backups/ before anything is dropped, and migrates migrations/real", async () => {
    const { deps, log } = fakeDeps(["ch_fuel_real"]);

    await resetDatabase("ch_fuel_real", `${LOCAL}/ch_fuel_real`, { APP_ENV: "real" }, deps);

    expect(log.indexOf("dump ch_fuel_real")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("dump ch_fuel_real")).toBeLessThan(log.findIndex((l) => l.startsWith("DROP")));
    expect(log.at(-1)).toBe(`migrate /ch_fuel_real ${migrationsDirFor("real")}`);
  });

  it("aborts a ch_fuel_real reset, dropping nothing, when the dump fails", async () => {
    const { deps, log } = fakeDeps(["ch_fuel_real"], { dumpFails: true });

    await expect(resetDatabase("ch_fuel_real", `${LOCAL}/ch_fuel_real`, { APP_ENV: "real" }, deps)).rejects.toThrow(
      /pg_dump/,
    );
    expect(log.join("\n")).not.toMatch(/DROP|CREATE DATABASE|migrate/);
  });

  it("skips the dump when ch_fuel_real does not exist yet — there is nothing to lose", async () => {
    const { deps, log } = fakeDeps([]);

    await resetDatabase("ch_fuel_real", `${LOCAL}/ch_fuel_real`, { APP_ENV: "real" }, deps);

    expect(log).not.toContain("dump ch_fuel_real");
    expect(log).toContain('CREATE DATABASE "ch_fuel_real" TEMPLATE template1');
  });

  it("refuses a name that does not match DATABASE_URL", async () => {
    const { deps, log } = fakeDeps(["ch_fuel_dev"]);
    await expect(resetDatabase("ch_fuel_real", `${LOCAL}/ch_fuel_dev`, {}, deps)).rejects.toThrow(/does not match/);
    expect(log).toEqual([]);
  });

  it.each([
    ["ch_fuel_planner", `${LOCAL}/ch_fuel_planner`, {}],
    ["neondb", "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb", {}],
    ["ch_fuel_dev", `${LOCAL}/ch_fuel_dev`, { APP_ENV: "production" }],
    ["ch_fuel_dev", `${LOCAL}/ch_fuel_dev`, { APP_ENV: "preview" }],
  ])("refuses %s (%s) before connecting or dumping", async (name, url, env) => {
    const { deps, log } = fakeDeps([name]);
    await expect(resetDatabase(name, url, env, deps)).rejects.toThrow(/refusing/);
    expect(log).toEqual([]);
  });
});

describe("db:nuke", () => {
  it("refuses without the explicit flag", () => {
    expect(nukeDecision([])).toBe("refuse");
    expect(nukeDecision(["--yes"])).toBe("refuse");
    expect(nukeDecision(["--force"])).toBe("refuse");
  });

  it("runs only with the explicit flag", () => {
    expect(NUKE_FLAG).toBe("--yes-delete-every-local-database");
    expect(nukeDecision([NUKE_FLAG])).toBe("run");
  });
});
