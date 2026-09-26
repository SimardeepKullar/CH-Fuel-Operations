import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBvdCsv } from "../ingest/parseBvdCsv.js";
import { parseStoreName } from "./storeNumber.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/bvd-prices/${name}`, import.meta.url));

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_AUGUST = new URL("../../../data/bvd-prices/pcn-usd-9206810-981.csv", import.meta.url);
const hasRealData = existsSync(REAL_AUGUST);

describe("parseStoreName", () => {
  it('parses "LOVES #368" to brand LOVES, number 368', () => {
    expect(parseStoreName("LOVES #368")).toEqual({
      brand: "LOVES",
      storeNumber: 368,
    });
  });

  it("does not throw on an unrecognised brand, and does not guess a number", () => {
    const result = parseStoreName("PILOT TRAVEL CENTER");
    expect(result.storeNumber).toBeNull();
    expect(result.brand).toBe("PILOT TRAVEL CENTER");
  });
});

describe("parseStoreName against the sample sheet", () => {
  const rows = () => parseBvdCsv(fixture("sample.csv")).rows;

  it("parses every name to a distinct store number in range 22-884", () => {
    const numbers = rows().map((row) => parseStoreName(row.name).storeNumber);

    expect(numbers).toHaveLength(12);
    for (const n of numbers) {
      expect(n).not.toBeNull();
      expect(n).toBeGreaterThanOrEqual(22);
      expect(n).toBeLessThanOrEqual(884);
    }
    expect(new Set(numbers).size).toBe(12);
  });

  it("SITE matches the store number in 0 of 12 cases — the trap this exists to avoid", () => {
    const matches = rows().filter((row) => {
      const { storeNumber } = parseStoreName(row.name);
      return storeNumber !== null && Number(row.site) === storeNumber;
    });

    expect(matches).toHaveLength(0);
  });
});

describe.skipIf(!hasRealData)("parseStoreName against the real August sheet (local files only)", () => {
  const rows = () => parseBvdCsv(readFileSync(REAL_AUGUST)).rows;

  it("parses all 605 real names to a distinct store number in range 22-1055", () => {
    const numbers = rows().map((row) => parseStoreName(row.name).storeNumber);

    expect(numbers).toHaveLength(605);
    for (const n of numbers) {
      expect(n).not.toBeNull();
      expect(n).toBeGreaterThanOrEqual(22);
      expect(n).toBeLessThanOrEqual(1055);
    }
    expect(new Set(numbers).size).toBe(605);
  });

  it("SITE matches the store number in 0 of 605 cases", () => {
    const matches = rows().filter((row) => {
      const { storeNumber } = parseStoreName(row.name);
      return storeNumber !== null && Number(row.site) === storeNumber;
    });

    expect(matches).toHaveLength(0);
  });
});
