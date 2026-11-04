import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertMigrationParity, checkMigrationParity } from "./migrationParity.js";

const made: string[] = [];
function dirWith(...files: string[]): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "parity-"));
  made.push(dir);
  for (const file of files) writeFileSync(path.join(dir, file), "SELECT 1;\n");
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("checkMigrationParity", () => {
  it("is ok when both directories hold the same .sql filenames", () => {
    const a = dirWith("0001_a.sql", "0002_b.sql");
    const b = dirWith("0002_b.sql", "0001_a.sql");
    expect(checkMigrationParity(a, b)).toEqual({ ok: true, missingInReal: [], missingInSynthetic: [] });
  });

  it("names a file present in only one directory, on the side that lacks it", () => {
    const synthetic = dirWith("0001_a.sql", "0002_b.sql");
    const real = dirWith("0001_a.sql", "0003_c.sql");
    expect(checkMigrationParity(synthetic, real)).toEqual({
      ok: false,
      missingInReal: ["0002_b.sql"],
      missingInSynthetic: ["0003_c.sql"],
    });
  });

  it("ignores files that are not .sql", () => {
    const a = dirWith("0001_a.sql", "README.md");
    const b = dirWith("0001_a.sql");
    expect(checkMigrationParity(a, b).ok).toBe(true);
  });

  it("assertMigrationParity throws a message naming each side's missing files", () => {
    const synthetic = dirWith("0001_a.sql");
    const real = dirWith("0001_a.sql", "0002_b.sql");
    expect(() => assertMigrationParity(synthetic, real)).toThrow(/0002_b\.sql.*migrations\/synthetic/s);
  });

  it("assertMigrationParity does not throw when the sets match", () => {
    expect(() => assertMigrationParity(dirWith("0001_a.sql"), dirWith("0001_a.sql"))).not.toThrow();
  });
});

// migrations/real is gitignored, so only the dev machine can compare the two
// real directories; CI runs the synthetic cases above.
const repoMigrations = path.resolve(import.meta.dirname, "../../../migrations");
const hasReal = existsSync(path.join(repoMigrations, "real"));

describe("the repository's migration sets", () => {
  it.skipIf(!hasReal)("migrations/synthetic and migrations/real have identical filenames", () => {
    expect(checkMigrationParity(path.join(repoMigrations, "synthetic"), path.join(repoMigrations, "real"))).toEqual({
      ok: true,
      missingInReal: [],
      missingInSynthetic: [],
    });
  });
});
