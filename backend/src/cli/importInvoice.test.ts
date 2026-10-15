import { describe, expect, it } from "vitest";
import { parseImportInvoiceArgs } from "./importInvoice.js";

describe("parseImportInvoiceArgs (T-66)", () => {
  it("takes a file alone, or with --fx-rate in either spelling", () => {
    expect(parseImportInvoiceArgs(["a.pdf"])).toEqual({ filePath: "a.pdf" });
    expect(parseImportInvoiceArgs(["a.pdf", "--fx-rate", "1.3712"])).toEqual({ filePath: "a.pdf", fxCadPerUsd: 1.3712 });
    expect(parseImportInvoiceArgs(["--fx-rate=1.3712", "a.pdf"])).toEqual({ filePath: "a.pdf", fxCadPerUsd: 1.3712 });
  });

  it("refuses a missing file, a missing or non-numeric rate, and anything else", () => {
    for (const argv of [[], ["--fx-rate", "1.3"], ["a.pdf", "--fx-rate"], ["a.pdf", "--fx-rate", "abc"], ["a.pdf", "--fx-rate", ""], ["a.pdf", "--fx-rate", "0x1"], ["a.pdf", "b.pdf"], ["a.pdf", "--rate", "1.3"]]) {
      expect(parseImportInvoiceArgs(argv), JSON.stringify(argv)).toHaveProperty("error");
    }
  });
});
