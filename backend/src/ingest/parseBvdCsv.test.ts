import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BvdCsvFormatError, parseBvdCsv } from "./parseBvdCsv.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/bvd-prices/${name}`, import.meta.url));

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_DIR = new URL("../../../data/bvd-prices/", import.meta.url);
const REAL_AUGUST = new URL("pcn-usd-9206810-981.csv", REAL_DIR);
const REAL_JANUARY_FIRST = new URL("2026-01/pcn-usd-7968664-981.csv", REAL_DIR);
const hasRealData = existsSync(REAL_AUGUST) && existsSync(REAL_JANUARY_FIRST);

describe("parseBvdCsv", () => {
  it("parses the sample sheet with the header's effective date and company id", () => {
    const parsed = parseBvdCsv(fixture("sample.csv"));
    expect(parsed.rows).toHaveLength(12);
    expect(parsed.effectiveDate).toBe("2026-08-22");
    expect(parsed.companyId).toBe("981");
  });

  it("carries every one of the 15 columns through as the raw string", () => {
    const [first] = parseBvdCsv(fixture("sample.csv")).rows;
    expect(first).toMatchObject({
      site: "70001",
      name: "LOVES #211",
      city: "Oklahoma City",
      state: "OK",
      prod: "ULSD",
      cost: "4.0000",
      federalTax: "0.2483",
      stateTax: "0.2000",
      salesTax: "0",
      freight: "0.0400",
      other: "0.02",
      totalCost: "4.508",
      retailPrice: "4.808",
      yourPrice: "4.508",
      savings: "0.300",
    });
  });

  it("excludes the metadata row from the data rows", () => {
    const parsed = parseBvdCsv(fixture("sample.csv"));
    for (const row of parsed.rows) {
      expect(row.site).not.toBe("Company Id: ");
    }
    expect(parsed.rows[0]?.site).toBe("70001");
  });

  it("parses CRLF line endings exactly as LF", () => {
    const lf = fixture("sample.csv").toString("utf8");
    const crlf = lf.replace(/\r?\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(parseBvdCsv(crlf)).toEqual(parseBvdCsv(lf));
  });

  it("tolerates stray header whitespace and blank lines, and never rewrites a dirty city", () => {
    const parsed = parseBvdCsv(fixture("edge-format.csv"));
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows[0]).toMatchObject({
      site: "9101",
      name: "LOVES #900",
      city: "ELOY",
      state: "AZ",
      prod: "ULSD",
    });
    expect(parsed.rows.map((row) => row.city)).toEqual([
      "ELOY",
      "TRUTH OR CONSEQUENCES",
      "Mt Juliet",
      "Mc Calla",
      "Milton",
    ]);
  });

  it("rejects a file whose header shape differs, rather than coercing it", () => {
    expect(() => parseBvdCsv(fixture("edge-bad-header.csv"))).toThrow(BvdCsvFormatError);
  });

  it("rejects the whole file when one data row has the wrong number of columns", () => {
    // Line 4 has 14 columns. It is file-fatal, not a per-row rejection: the good rows around it are not returned.
    expect(() => parseBvdCsv(fixture("edge-short-row.csv"))).toThrow(
      /line 4: expected 15 columns, got 14/,
    );
  });

  it("rejects a metadata row with no effective date, naming the missing field", () => {
    expect(() => parseBvdCsv(fixture("edge-missing-effective-date.csv"))).toThrow(
      /metadata row: "Effective Date" not found/,
    );
  });

  it("rejects an empty file", () => {
    expect(() => parseBvdCsv(Buffer.alloc(0))).toThrow(/file is empty/);
  });
});

describe.skipIf(!hasRealData)("parseBvdCsv — real data/bvd-prices (local files only)", () => {
  it("parses the August sheet to 605 rows with the header's effective date and company id", () => {
    const parsed = parseBvdCsv(readFileSync(REAL_AUGUST));
    expect(parsed.rows).toHaveLength(605);
    expect(parsed.effectiveDate).toBe("2026-08-22");
    expect(parsed.companyId).toBe("981");
    expect(parsed.rows[0]?.site).toBe("1277");
  });

  it("parses a January file to 594 rows", () => {
    const parsed = parseBvdCsv(readFileSync(REAL_JANUARY_FIRST));
    expect(parsed.rows).toHaveLength(594);
    expect(parsed.effectiveDate).toBe("2026-01-01");
  });
});
