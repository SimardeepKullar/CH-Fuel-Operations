import { describe, expect, it } from "vitest";
import { buildReport } from "./report.js";
import type { ValidationRejection } from "./validate.js";

function rejection(overrides: Partial<ValidationRejection> = {}): ValidationRejection {
  return {
    lineNumber: 5,
    siteRef: "1234",
    code: "UNMAPPED_PRODUCT",
    message: "unmapped PROD code",
    rawProduct: "DYED",
    ...overrides,
  };
}

describe("buildReport", () => {
  it("counts accepted as rows read minus rejections", () => {
    const report = buildReport({
      sourceFilename: "pcn-usd-9206810-981.csv",
      companyId: "981",
      effectiveDate: "2026-08-22",
      fileSha256: "abc123",
      deduped: false,
      rowsRead: 605,
      rejections: [rejection()],
      newStations: [],
      vanishedStations: [],
    });

    expect(report.rowsRead).toBe(605);
    expect(report.rowsRejected).toBe(1);
    expect(report.rowsAccepted).toBe(604);
  });

  it("lists distinct unmapped product codes from rejections", () => {
    const report = buildReport({
      sourceFilename: "f.csv",
      companyId: "981",
      effectiveDate: "2026-08-22",
      fileSha256: "abc123",
      deduped: false,
      rowsRead: 3,
      rejections: [
        rejection({ rawProduct: "DYED" }),
        rejection({ rawProduct: "DYED" }),
        rejection({ rawProduct: "REGULAR", code: "UNMAPPED_PRODUCT" }),
      ],
      newStations: [],
      vanishedStations: [],
    });

    expect(report.unmappedProducts.sort()).toEqual(["DYED", "REGULAR"]);
  });

  it("does not treat other rejection codes as unmapped products", () => {
    const report = buildReport({
      sourceFilename: "f.csv",
      companyId: "981",
      effectiveDate: "2026-08-22",
      fileSha256: "abc123",
      deduped: false,
      rowsRead: 1,
      rejections: [
        rejection({ code: "INVALID_STATE", rawProduct: "ULSD" }),
      ],
      newStations: [],
      vanishedStations: [],
    });

    expect(report.unmappedProducts).toEqual([]);
  });

  it("passes new and vanished stations through unchanged", () => {
    const report = buildReport({
      sourceFilename: "f.csv",
      companyId: "981",
      effectiveDate: "2026-08-22",
      fileSha256: "abc123",
      deduped: false,
      rowsRead: 0,
      rejections: [],
      newStations: ["9999"],
      vanishedStations: ["1111"],
    });

    expect(report.newStations).toEqual(["9999"]);
    expect(report.vanishedStations).toEqual(["1111"]);
  });

  it("marks a deduped import without altering the counts it carries", () => {
    const report = buildReport({
      sourceFilename: "f.csv",
      companyId: "981",
      effectiveDate: "2026-08-22",
      fileSha256: "abc123",
      deduped: true,
      rowsRead: 605,
      rejections: [],
      newStations: [],
      vanishedStations: [],
    });

    expect(report.deduped).toBe(true);
    expect(report.rowsAccepted).toBe(605);
  });
});
