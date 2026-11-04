import { describe, expect, it } from "vitest";
import { compareCounts, restoreToReal, type RestoreDeps } from "./restoreToReal.js";

const REAL = "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_real";
const FILE = "backups/test-ch_fuel_test-2026-11-04T19-30-05Z.dump";
const SIDECAR = { "public.invoices": 12, "public.schema_migrations": 5 };

function fakeDeps(
  options: {
    header?: string | null;
    listFails?: boolean;
    realExists?: boolean;
    backupFails?: boolean;
    sidecar?: Record<string, number> | null;
    restored?: Record<string, number>;
    pending?: string[];
  } = {},
) {
  const log: string[] = [];
  const deps: RestoreDeps = {
    readHeader: () => (options.header === undefined ? "PGDMP" : options.header),
    readSidecar: () => (options.sidecar === undefined ? SIDECAR : options.sidecar),
    copyIn: (file) => {
      log.push(`copyIn ${file}`);
      return "/tmp/restore.dump";
    },
    listArchive: () => {
      log.push("list");
      if (options.listFails) throw new Error("pg_restore: error: input file does not appear to be a valid archive");
    },
    removeFromContainer: () => {
      log.push("rm");
    },
    connectMaintenance: async () => ({
      query: async (text: string, params: unknown[] = []) => {
        log.push(params.length ? `${text} [${params.join(",")}]` : text);
        if (text.startsWith("SELECT 1 FROM pg_database")) return { rows: options.realExists === false ? [] : [{}] };
        return { rows: [] };
      },
      end: async () => {
        log.push("end");
      },
    }),
    backup: async () => {
      log.push("backup ch_fuel_real");
      if (options.backupFails) throw new Error("pg_dump exited 1");
      return "backups/real-ch_fuel_real-rollback.dump";
    },
    restore: (containerPath, database) => {
      log.push(`restore ${containerPath} -> ${database}`);
    },
    countRestored: async () => {
      log.push("count");
      return options.restored ?? SIDECAR;
    },
    pendingMigrations: async () => options.pending ?? [],
  };
  return { deps, log };
}

describe("restoreToReal — refuses before touching anything", () => {
  it.each([
    ["APP_ENV=production", REAL, { APP_ENV: "production" }, /refusing/],
    ["a Neon URL", "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb", {}, /refusing/],
    ["ch_fuel_dev", "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_dev", {}, /only ch_fuel_real/],
  ])("%s", async (_label, url, env, error) => {
    const { deps, log } = fakeDeps();
    await expect(restoreToReal(FILE, url, env, deps)).rejects.toThrow(error);
    expect(log).toEqual([]);
  });

  it("a missing file", async () => {
    const { deps, log } = fakeDeps({ header: null });
    await expect(restoreToReal(FILE, REAL, {}, deps)).rejects.toThrow(/not found/);
    expect(log).toEqual([]);
  });

  it("a file without the PGDMP custom-format header", async () => {
    const { deps, log } = fakeDeps({ header: "-- Po" });
    await expect(restoreToReal(FILE, REAL, {}, deps)).rejects.toThrow(/PGDMP/);
    expect(log).toEqual([]);
  });

  it("an archive pg_restore cannot read — before any dump, drop or create", async () => {
    const { deps, log } = fakeDeps({ listFails: true });
    await expect(restoreToReal(FILE, REAL, {}, deps)).rejects.toThrow(/valid archive/);
    expect(log).toEqual([`copyIn ${FILE}`, "list", "rm"]);
  });

  it("aborts, dropping nothing, when the automatic dump of ch_fuel_real fails", async () => {
    const { deps, log } = fakeDeps({ backupFails: true });
    await expect(restoreToReal(FILE, REAL, {}, deps)).rejects.toThrow(/pg_dump/);
    expect(log.join("\n")).not.toMatch(/DROP|CREATE DATABASE|restore /);
    expect(log.at(-1)).toBe("rm");
  });
});

describe("restoreToReal — the replacement", () => {
  it("checks the archive, dumps the current ch_fuel_real, drops, recreates from template1, restores, counts", async () => {
    const { deps, log } = fakeDeps();

    const result = await restoreToReal(FILE, REAL, { APP_ENV: "real" }, deps);

    expect(log).toEqual([
      `copyIn ${FILE}`,
      "list",
      "SELECT 1 FROM pg_database WHERE datname = $1 [ch_fuel_real]",
      "backup ch_fuel_real",
      'DROP DATABASE IF EXISTS "ch_fuel_real" WITH (FORCE)',
      'CREATE DATABASE "ch_fuel_real" TEMPLATE template1',
      "end",
      "restore /tmp/restore.dump -> ch_fuel_real",
      "count",
      "rm",
    ]);
    expect(result).toMatchObject({ rollback: "backups/real-ch_fuel_real-rollback.dump", verified: true, mismatches: [] });
  });

  it("skips the automatic dump when ch_fuel_real does not exist", async () => {
    const { deps, log } = fakeDeps({ realExists: false });
    const result = await restoreToReal(FILE, REAL, {}, deps);
    expect(log).not.toContain("backup ch_fuel_real");
    expect(result.rollback).toBeUndefined();
  });

  it("fails, naming each table and the rollback dump, when restored counts differ from the sidecar", async () => {
    const { deps } = fakeDeps({ restored: { "public.invoices": 11, "public.schema_migrations": 5 } });
    await expect(restoreToReal(FILE, REAL, {}, deps)).rejects.toThrow(
      /public\.invoices: expected 12, restored 11.*real-ch_fuel_real-rollback\.dump/s,
    );
  });

  it("with no sidecar, reports the counts as unverified rather than failing", async () => {
    const { deps } = fakeDeps({ sidecar: null, restored: { "public.invoices": 7 } });
    const result = await restoreToReal(FILE, REAL, {}, deps);
    expect(result).toMatchObject({ verified: false, counts: { "public.invoices": 7 } });
  });

  it("lists migrations still pending against migrations/real, without applying them", async () => {
    const { deps, log } = fakeDeps({ pending: ["0006_new.sql"] });
    const result = await restoreToReal(FILE, REAL, {}, deps);
    expect(result.pendingMigrations).toEqual(["0006_new.sql"]);
    expect(log.join("\n")).not.toMatch(/migrate/);
  });
});

describe("compareCounts", () => {
  it("reports differing, missing and unexpected tables", () => {
    expect(compareCounts({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4 })).toEqual([
      "b: expected 2, restored 5",
      "c: expected 3, restored (missing)",
      "d: expected (none), restored 4",
    ]);
    expect(compareCounts({ a: 1 }, { a: 1 })).toEqual([]);
  });
});
