import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [path] : [];
  });
}

// A bare `occurred_at::date` takes its day in the Postgres session's
// TimeZone, so it agrees with the rest of the schema's UTC-anchored days
// only while the server happens to run in UTC (T-81). Every timestamptz
// `_at` column is cast through `(… AT TIME ZONE 'UTC')::date` instead.
const BARE_CAST = /\b\w+_at::date\b/g;

describe("timestamptz day casts (T-81)", () => {
  it("never casts an `_at` column to a date without AT TIME ZONE 'UTC'", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .flatMap((line, i) =>
          [...line.matchAll(BARE_CAST)].map((m) => `${relative(SRC, file)}:${i + 1} ${m[0]}`),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("recognises the shape it guards against", () => {
    expect("AND fs.occurred_at::date BETWEEN $1::date".match(BARE_CAST)).toEqual(["occurred_at::date"]);
    expect("(fs.occurred_at AT TIME ZONE 'UTC')::date".match(BARE_CAST)).toBeNull();
  });
});
