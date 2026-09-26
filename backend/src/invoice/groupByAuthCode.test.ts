import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FuelStopGroupingError, groupByAuthCode } from "./groupByAuthCode.js";
import { parseInvoiceCsv } from "./parseInvoiceCsv.js";
import { DEFAULT_INVOICE_PRODUCT_CODES } from "./productCode.js";
import type { ValidatedInvoiceLine } from "./parseInvoiceCsv.js";

// Synthetic, invented data — committed, runs on a fresh clone and in CI.
const REDACTED_PATH = fileURLToPath(
  new URL("../../test/fixtures/invoices/sample-redacted.csv", import.meta.url),
);
function redactedLines(): ValidatedInvoiceLine[] {
  return parseInvoiceCsv(readFileSync(REDACTED_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_100001.csv").lines;
}

// A real invoice, if the operator has dropped one in locally
// (data/bvd-invoices/, gitignored).
const REAL_PATH = fileURLToPath(
  new URL("../../../data/bvd-invoices/invoice_999210.csv", import.meta.url),
);
const hasRealFixture = existsSync(REAL_PATH);
function realLines(): ValidatedInvoiceLine[] {
  return parseInvoiceCsv(readFileSync(REAL_PATH), DEFAULT_INVOICE_PRODUCT_CODES, "invoice_999210.csv").lines;
}

function line(overrides: Partial<ValidatedInvoiceLine>): ValidatedInvoiceLine {
  return {
    lineNumber: 1,
    authCode: "A1-TA",
    baseAuthCode: "A1",
    cardNumber: "1000001",
    driverNameRaw: "DRIVER",
    unitRaw: "101",
    occurredAt: "2026-01-05T10:00:00",
    siteNumber: "90001",
    stationNameRaw: "SAMPLE #1",
    stationCity: "SAMPLETON",
    stationState: "TX",
    rawProductCode: "TA",
    productType: "highway_diesel",
    gallons: "100.00",
    retailUsdPerGal: "5.9990",
    billedUsdPerGal: "5.5000",
    amountUsd: "550.00",
    ...overrides,
  };
}

describe("groupByAuthCode — structural (synthetic fixture)", () => {
  it("groups B100001's TA and DF lines and no others, totalling all line amounts", () => {
    const groups = groupByAuthCode(redactedLines());
    const stop = groups.find((g) => g.baseAuthCode === "B100001")!;
    expect(stop.lines).toHaveLength(2);
    expect(stop.lines.map((l) => l.rawProductCode).sort()).toEqual(["DF", "TA"]);
    expect(stop.totalUsd).toBe("278.67");
  });

  it("produces one group per base auth code", () => {
    const groups = groupByAuthCode(redactedLines());
    expect(groups).toHaveLength(3);
  });

  it("totals a single-line stop as its one line", () => {
    const groups = groupByAuthCode(redactedLines());
    const single = groups.find((g) => g.baseAuthCode === "B100002")!;
    expect(single.lines).toHaveLength(1);
    expect(single.totalUsd).toBe(single.lines[0]!.amountUsd);
  });

  it("gives a scale-only stop zero gallons and a non-zero total", () => {
    const groups = groupByAuthCode(redactedLines());
    const scaleOnly = groups.find((g) => g.baseAuthCode === "B100003")!;
    expect(scaleOnly.lines.every((l) => l.rawProductCode === "S")).toBe(true);
    expect(scaleOnly.totalGallons).toBe("0.00");
    expect(Number(scaleOnly.totalUsd)).toBeGreaterThan(0);
  });

  it("rejects a group whose lines disagree on card or station", () => {
    const lines = [
      line({ authCode: "A1-TA", baseAuthCode: "A1", cardNumber: "1000001" }),
      line({ authCode: "A1-DF", baseAuthCode: "A1", cardNumber: "1000002", rawProductCode: "DF", productType: "def" }),
    ];
    expect(() => groupByAuthCode(lines)).toThrow(FuelStopGroupingError);
  });
});

describe.skipIf(!hasRealFixture)("groupByAuthCode — real invoice 999210 (local fixture only)", () => {
  it("groups A252014353's TA and DF lines and no others, totalling exactly $255.13", () => {
    const groups = groupByAuthCode(realLines());
    const stop = groups.find((g) => g.baseAuthCode === "A252014353")!;
    expect(stop.lines).toHaveLength(2);
    expect(stop.lines.map((l) => l.rawProductCode).sort()).toEqual(["DF", "TA"]);
    expect(stop.totalUsd).toBe("255.13");
  });

  it("produces ~60 stops (66) from the full line set", () => {
    const groups = groupByAuthCode(realLines());
    expect(groups).toHaveLength(66);
  });
});
