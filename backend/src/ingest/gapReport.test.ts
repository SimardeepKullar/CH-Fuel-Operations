import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findGaps, isoDateRange } from "./gapReport.js";
import { parseBvdCsv } from "./parseBvdCsv.js";

const sample = () =>
  readFileSync(new URL("../../test/fixtures/bvd-prices/sample.csv", import.meta.url), "utf8");

/** The sample sheet, re-dated — the same bytes as any other day's sheet but for the header. */
const withEffectiveDate = (csv: string, date: string) =>
  csv.replace(/("Effective Date: ",)\d{4}-\d{2}-\d{2}/, `$1${date}`);

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_JANUARY_DIR = new URL("../../../data/bvd-prices/2026-01/", import.meta.url);
const hasRealData = existsSync(REAL_JANUARY_DIR);

function effectiveDatesIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".csv"))
    .map((name) => parseBvdCsv(readFileSync(path.join(dir, name))).effectiveDate);
}

describe("findGaps", () => {
  it("reports no gaps for a contiguous range", () => {
    const present = isoDateRange("2026-02-01", "2026-02-10");
    expect(findGaps(present, { start: "2026-02-01", end: "2026-02-10" })).toEqual([]);
  });

  it("reports two separated gaps", () => {
    const present = isoDateRange("2026-03-01", "2026-03-10").filter(
      (date) => date !== "2026-03-03" && date !== "2026-03-07",
    );
    expect(findGaps(present, { start: "2026-03-01", end: "2026-03-10" })).toEqual([
      "2026-03-03",
      "2026-03-07",
    ]);
  });

  it("reports the one missing day in a directory of dated sheets, duplicates included", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ch-gap-report-"));
    for (const date of ["2026-01-01", "2026-01-02", "2026-01-04"]) {
      writeFileSync(path.join(dir, `${date}.csv`), withEffectiveDate(sample(), date));
    }
    // A browser-style " (1)" copy of a day must neither hide nor invent a gap.
    writeFileSync(path.join(dir, "2026-01-02 (1).csv"), withEffectiveDate(sample(), "2026-01-02"));

    const gaps = findGaps(effectiveDatesIn(dir), { start: "2026-01-01", end: "2026-01-04" });

    expect(gaps).toEqual(["2026-01-03"]);
  });

  it.skipIf(!hasRealData)("reports exactly 2026-01-11 as the gap in the real January corpus", () => {
    const gaps = findGaps(effectiveDatesIn(fileURLToPath(REAL_JANUARY_DIR)), {
      start: "2026-01-01",
      end: "2026-01-31",
    });

    expect(gaps).toEqual(["2026-01-11"]);
  });
});

describe("isoDateRange", () => {
  it("includes both endpoints", () => {
    expect(isoDateRange("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("returns a single date when start equals end", () => {
    expect(isoDateRange("2026-01-11", "2026-01-11")).toEqual(["2026-01-11"]);
  });
});
