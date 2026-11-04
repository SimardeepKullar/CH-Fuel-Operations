import { describe, expect, it } from "vitest";
import path from "node:path";
import { backupDatabase, backupFileName, displayPath, realBackupDeps, resolveBackupsDir, ROOT_DIR, type BackupDeps } from "./backup.js";

const LOCAL = "postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_test";
const NEON_DIRECT = "postgresql://neondb_owner:npg_S3cretPw@ep-cool-a1b2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_POOLED = "postgresql://neondb_owner:npg_S3cretPw@ep-cool-a1b2-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";

const NOW = new Date(Date.UTC(2026, 10, 4, 19, 30, 5, 123));

/** Records SQL, docker calls and writes in order; tables and counts are what the server holds. */
function fakeDeps(options: { serverVersionNum?: number; dumpSize?: number } = {}) {
  const log: string[] = [];
  const dockerCalls: Array<{ args: string[]; env?: Record<string, string> }> = [];
  const written: Record<string, string> = {};
  const deps: BackupDeps = {
    connect: async () => ({
      query: async (text: string) => {
        log.push(text);
        if (text.includes("pg_export_snapshot")) return { rows: [{ snapshot: "00000003-0000001B-1" }] };
        if (text.includes("server_version_num")) return { rows: [{ major: Math.floor((options.serverVersionNum ?? 160004) / 10000) }] };
        if (text.includes("FROM pg_tables")) {
          return { rows: [{ schemaname: "public", tablename: "invoices" }, { schemaname: "public", tablename: "schema_migrations" }] };
        }
        if (text.startsWith('SELECT count(*)::int AS n FROM "public"."invoices"')) return { rows: [{ n: 12 }] };
        if (text.startsWith('SELECT count(*)::int AS n FROM "public"."schema_migrations"')) return { rows: [{ n: 5 }] };
        return { rows: [] };
      },
      end: async () => {
        log.push("end");
      },
    }),
    runDocker: (args, env) => {
      log.push(`docker ${args[0]}${args[0] === "compose" ? ` ${args[1]}` : ""}`);
      dockerCalls.push({ args, env });
    },
    backupsDir: "/repo/backups",
    ensureDir: (dir) => {
      log.push(`mkdir ${dir}`);
    },
    now: () => NOW,
    fileSize: () => options.dumpSize ?? 2048,
    writeFile: (file, contents) => {
      log.push(`write ${file}`);
      written[file] = contents;
    },
  };
  return { deps, log, dockerCalls, written };
}

describe("backupFileName", () => {
  it("is <env>-<database>-<UTC timestamp>.dump, safe on Windows and in sh", () => {
    expect(backupFileName("real", "ch_fuel_real", NOW)).toBe("real-ch_fuel_real-2026-11-04T19-30-05Z.dump");
    expect(backupFileName(undefined, "ch_fuel_dev", NOW)).toBe("unset-ch_fuel_dev-2026-11-04T19-30-05Z.dump");
  });
});

describe("backupDatabase — local (the compose container)", () => {
  it("counts and dumps one exported snapshot, then commits", async () => {
    const { deps, log, dockerCalls } = fakeDeps();

    await backupDatabase(LOCAL, "test", deps);

    expect(log.filter((l) => !l.startsWith("mkdir")).slice(0, 2)).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      "SELECT pg_export_snapshot() AS snapshot",
    ]);
    const firstDocker = log.findIndex((l) => l.startsWith("docker"));
    const lastCount = log.map((l) => l.startsWith("SELECT count(*)")).lastIndexOf(true);
    expect(lastCount).toBeLessThan(firstDocker);
    expect(log.indexOf("COMMIT")).toBeGreaterThan(firstDocker);
    const dump = dockerCalls[0]!.args;
    expect(dump.slice(0, 4)).toEqual(["compose", "exec", "-T", "db"]);
    expect(dump).toContain("--snapshot=00000003-0000001B-1");
    expect(dump).toEqual(expect.arrayContaining(["pg_dump", "-U", "ch_fuel", "-d", "ch_fuel_test", "-Fc"]));
  });

  it("copies the file out with docker compose cp and removes it from the container — never a shell redirect", async () => {
    const { deps, dockerCalls } = fakeDeps();

    const result = await backupDatabase(LOCAL, "test", deps);

    expect(dockerCalls.map((c) => c.args.slice(0, 2).join(" "))).toEqual(["compose exec", "compose cp", "compose exec"]);
    expect(dockerCalls[1]!.args.at(-1)).toBe(result.file);
    expect(dockerCalls[2]!.args).toEqual(expect.arrayContaining(["rm", "-f"]));
    expect(result.file.replace(/\\/g, "/")).toBe("/repo/backups/test-ch_fuel_test-2026-11-04T19-30-05Z.dump");
  });

  it("writes a counts sidecar describing exactly the dumped snapshot", async () => {
    const { deps, written } = fakeDeps();

    const result = await backupDatabase(LOCAL, "test", deps);

    expect(result.countsFile).toBe(`${result.file}.counts.json`);
    expect(JSON.parse(written[result.countsFile]!)).toEqual({
      appEnv: "test",
      host: "localhost:5433",
      database: "ch_fuel_test",
      takenAt: "2026-11-04T19:30:05.123Z",
      tables: { "public.invoices": 12, "public.schema_migrations": 5 },
    });
    expect(result.counts).toEqual({ "public.invoices": 12, "public.schema_migrations": 5 });
  });

  it("fails, writing no sidecar, when the dump comes out empty", async () => {
    const { deps, written } = fakeDeps({ dumpSize: 0 });
    await expect(backupDatabase(LOCAL, "test", deps)).rejects.toThrow(/no file|empty/);
    expect(Object.keys(written)).toEqual([]);
  });
});

// Unit-tested only, not yet run against a real Neon server.
describe("backupDatabase — remote (unit-tested only, not yet run against a real Neon server)", () => {
  it("runs pg_dump from a container matching the server's major version, into a bind-mounted backups/", async () => {
    const { deps, dockerCalls } = fakeDeps({ serverVersionNum: 170002 });

    await backupDatabase(NEON_DIRECT, "production", deps);

    expect(dockerCalls).toHaveLength(1);
    const { args } = dockerCalls[0]!;
    expect(args.slice(0, 2)).toEqual(["run", "--rm"]);
    expect(args).toContain("postgres:17");
    expect(args).toContain("/repo/backups:/backups");
    expect(args.at(-1)).toContain("--snapshot=00000003-0000001B-1");
  });

  it("never puts the password, or the URL, in an argument — the URL goes in by environment variable name", async () => {
    const { deps, dockerCalls } = fakeDeps({ serverVersionNum: 160004 });

    await backupDatabase(NEON_DIRECT, "production", deps);

    const { args, env } = dockerCalls[0]!;
    for (const arg of args) {
      expect(arg).not.toContain("npg_S3cretPw");
      expect(arg).not.toContain("neondb_owner");
    }
    expect(args).toEqual(expect.arrayContaining(["-e", "DUMP_URL"]));
    expect(env).toEqual({ DUMP_URL: NEON_DIRECT });
  });

  it("refuses a pooler host before connecting — PgBouncer cannot hold an exported snapshot", async () => {
    const { deps, log, dockerCalls } = fakeDeps();
    await expect(backupDatabase(NEON_POOLED, "production", deps)).rejects.toThrow(/pooler.*direct/);
    expect(log).toEqual([]);
    expect(dockerCalls).toEqual([]);
  });

  it("refuses a pooler set through ?host= as well", async () => {
    const { deps } = fakeDeps();
    const url = `postgres://u:p@localhost/ch_fuel_dev?host=ep-x-pooler.us-east-1.aws.neon.tech`;
    await expect(backupDatabase(url, "production", deps)).rejects.toThrow(/pooler/);
  });
});

describe("resolveBackupsDir (BACKUP_DIR)", () => {
  const root = path.resolve("/repo");

  it("defaults to backups/ under the repo root when BACKUP_DIR is unset or blank", () => {
    expect(resolveBackupsDir({}, root)).toBe(path.join(root, "backups"));
    expect(resolveBackupsDir({ BACKUP_DIR: "" }, root)).toBe(path.join(root, "backups"));
    expect(resolveBackupsDir({ BACKUP_DIR: "   " }, root)).toBe(path.join(root, "backups"));
  });

  it("uses an absolute BACKUP_DIR as given", () => {
    const outside = path.resolve("/elsewhere/ch-dumps");
    expect(resolveBackupsDir({ BACKUP_DIR: outside }, root)).toBe(outside);
  });

  it("resolves a relative BACKUP_DIR against the repo root, not the working directory", () => {
    expect(resolveBackupsDir({ BACKUP_DIR: "../dumps" }, root)).toBe(path.resolve(root, "../dumps"));
  });
});

describe("realBackupDeps.backupsDir", () => {
  it("is read from BACKUP_DIR when used, so the T-98 env files have been loaded by then", () => {
    const before = process.env.BACKUP_DIR;
    try {
      delete process.env.BACKUP_DIR;
      expect(realBackupDeps.backupsDir).toBe(path.join(ROOT_DIR, "backups"));
      process.env.BACKUP_DIR = path.resolve("/elsewhere/ch-dumps");
      expect(realBackupDeps.backupsDir).toBe(path.resolve("/elsewhere/ch-dumps"));
    } finally {
      if (before === undefined) delete process.env.BACKUP_DIR;
      else process.env.BACKUP_DIR = before;
    }
  });
});

describe("backupDatabase — BACKUP_DIR", () => {
  it("dumps into the configured directory, creating it first, and bind-mounts it for a remote dump", async () => {
    const local = fakeDeps();
    local.deps.backupsDir = "/outside/dumps";
    const result = await backupDatabase(LOCAL, "test", local.deps);
    expect(result.file.replaceAll(path.sep, "/")).toBe("/outside/dumps/test-ch_fuel_test-2026-11-04T19-30-05Z.dump");
    const mkdir = local.log.indexOf("mkdir /outside/dumps");
    expect(mkdir).toBeGreaterThanOrEqual(0);
    expect(mkdir).toBeLessThan(local.log.findIndex((l) => l.startsWith("docker")));

    const remote = fakeDeps({ serverVersionNum: 160004 });
    remote.deps.backupsDir = "/outside/dumps";
    await backupDatabase(NEON_DIRECT, "production", remote.deps);
    expect(remote.dockerCalls[0]!.args).toContain("/outside/dumps:/backups");
  });
});

describe("displayPath", () => {
  it("shows a path inside the repo relative to it, and one outside it in full", () => {
    expect(displayPath(path.join(ROOT_DIR, "backups", "a.dump"))).toBe(path.join("backups", "a.dump"));
    const outside = path.resolve(ROOT_DIR, "..", "..", "elsewhere", "a.dump");
    expect(displayPath(outside)).toBe(outside);
  });
});
