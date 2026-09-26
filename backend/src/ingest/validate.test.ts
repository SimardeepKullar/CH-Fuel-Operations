import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBvdCsv, type RawBvdRow } from "./parseBvdCsv.js";
import { validateRow } from "./validate.js";
import type { ProductType } from "../db/types.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../../test/fixtures/bvd-prices/${name}`, import.meta.url));

// The real price sheets are gitignored — see the root .gitignore. Tests that
// assert their exact figures skip when they are absent, as CI's checkout is.
const REAL_AUGUST = new URL("../../../data/bvd-prices/pcn-usd-9206810-981.csv", import.meta.url);
const hasRealData = existsSync(REAL_AUGUST);

const BVD_PRODUCT_CODES = new Map<string, ProductType>([
  ["ULSD", "highway_diesel"],
]);

function baseRow(overrides: Partial<RawBvdRow> = {}): RawBvdRow {
  return {
    lineNumber: 3,
    site: "1277",
    name: "LOVES #368",
    city: "Clanton",
    state: "AL",
    prod: "ULSD",
    cost: "4.5215",
    federalTax: "0.2483",
    stateTax: "0.3175",
    salesTax: "0",
    freight: "0.1187",
    other: "0.02",
    totalCost: "5.226",
    retailPrice: "5.689",
    yourPrice: "5.226",
    savings: "0.463",
    ...overrides,
  };
}

describe("validateRow", () => {
  it("rejects an unmapped PROD rather than mapping it to diesel", () => {
    const result = validateRow(baseRow({ prod: "DYED" }), BVD_PRODUCT_CODES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("UNMAPPED_PRODUCT");
      expect(result.rejection.lineNumber).toBe(3);
      expect(result.rejection.siteRef).toBe("1277");
    }
  });

  it("rejects an invalid USPS state code", () => {
    const result = validateRow(baseRow({ state: "XX" }), BVD_PRODUCT_CODES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("INVALID_STATE");
      expect(result.rejection.siteRef).toBe("1277");
    }
  });

  it("rejects a non-numeric COST with a parse code", () => {
    const result = validateRow(baseRow({ cost: "not-a-number" }), BVD_PRODUCT_CODES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.code).toBe("NUMERIC_PARSE_ERROR");
    }
  });

  it("carries line number and site ref on every rejection", () => {
    const result = validateRow(
      baseRow({ lineNumber: 42, site: "9999", prod: "DYED" }),
      BVD_PRODUCT_CODES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.lineNumber).toBe(42);
      expect(result.rejection.siteRef).toBe("9999");
    }
  });
});

describe("validateRow against the sample sheet", () => {
  const rows = () => parseBvdCsv(fixture("sample.csv")).rows;

  it("accepts every row, including the 3 capped at retail (savings = 0)", () => {
    let accepted = 0;
    let cappedAtRetail = 0;
    for (const row of rows()) {
      const result = validateRow(row, BVD_PRODUCT_CODES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        accepted++;
        if (Number(result.row.savings) === 0) {
          cappedAtRetail++;
        }
      }
    }
    expect(accepted).toBe(12);
    expect(cappedAtRetail).toBe(3);
  });

  it("holds the YOUR PRICE = min(...) invariant on every row with zero error", () => {
    const violations = rows().filter((row) => {
      const result = validateRow(row, BVD_PRODUCT_CODES);
      return !result.ok && result.rejection.code === "PRICE_INVARIANT_VIOLATION";
    });
    expect(violations).toHaveLength(0);
  });
});

describe("validateRow against edge-rejections.csv", () => {
  const results = () =>
    parseBvdCsv(fixture("edge-rejections.csv")).rows.map((row) =>
      validateRow(row, BVD_PRODUCT_CODES),
    );

  it("accepts the three good rows and nothing else", () => {
    const accepted = results().flatMap((r) => (r.ok ? [r.row.siteRef] : []));
    expect(accepted).toEqual(["8101", "8103", "8108"]);
  });

  it("rejects each bad row with its own code, line number and site ref", () => {
    const rejections = results().flatMap((r) =>
      r.ok ? [] : [[r.rejection.lineNumber, r.rejection.siteRef, r.rejection.code]],
    );
    expect(rejections).toEqual([
      [4, "8102", "UNMAPPED_PRODUCT"],
      [6, "8104", "INVALID_STATE"],
      [7, "8105", "NUMERIC_PARSE_ERROR"],
      [8, "8106", "PRICE_INVARIANT_VIOLATION"],
      [9, "8107", "SCHEMA_ERROR"],
    ]);
  });
});

describe.skipIf(!hasRealData)("validateRow against the real August sheet (local files only)", () => {
  const rows = () => parseBvdCsv(readFileSync(REAL_AUGUST)).rows;

  it("accepts all 605 August rows, including the 30 capped at retail (savings = 0)", () => {
    let accepted = 0;
    let cappedAtRetail = 0;
    for (const row of rows()) {
      const result = validateRow(row, BVD_PRODUCT_CODES);
      expect(result.ok).toBe(true);
      if (result.ok) {
        accepted++;
        if (Number(result.row.savings) === 0) {
          cappedAtRetail++;
        }
      }
    }
    expect(accepted).toBe(605);
    expect(cappedAtRetail).toBe(30);
  });

  it("holds the YOUR PRICE = min(...) invariant on 605/605 with zero error", () => {
    const violations = rows().filter((row) => {
      const result = validateRow(row, BVD_PRODUCT_CODES);
      return !result.ok && result.rejection.code === "PRICE_INVARIANT_VIOLATION";
    });
    expect(violations).toHaveLength(0);
  });
});
