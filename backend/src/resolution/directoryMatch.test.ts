import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchStation, type StationForNameMatch } from "../resolve/resolveStation.js";
import { mapDirectoryRows, parseBvdDirectoryCsv } from "./operatorExport.js";

// T-60: a CA invoice's `Site #` resolves against the directory's `Site #`
// through the same `site_ref` path a US invoice uses. The directory is
// committed (D29), so the station side runs in CI.
const DIRECTORY_CSV = new URL(
  "../../../data/US-CA-GasStations/bvd-travel-centres-2026-10-01.csv",
  import.meta.url,
);

function directoryStations(): StationForNameMatch[] {
  return mapDirectoryRows(parseBvdDirectoryCsv(readFileSync(DIRECTORY_CSV))).stations.map((s) => ({
    id: `ca-${s.siteRef}`,
    nameRaw: s.nameRaw,
    siteRef: s.siteRef,
  }));
}

describe("matchStation against the BVD directory (T-60)", () => {
  it("resolves Comber by its Site #, whatever case the invoice prints the name in", () => {
    expect(matchStation("58156", "BVD COMBER", directoryStations())).toBe("ca-58156");
  });

  it("a Site # the directory does not carry is a miss, not a name guess", () => {
    // BVD names carry no `#`, so the store-number fallback cannot fire.
    expect(matchStation("99999", "BVD COMBER", directoryStations())).toBeNull();
  });
});

// The real CA invoice is gitignored (CLAUDE.md, Testing rules).
const INVOICE_999217 = new URL("../../../data/bvd-invoices/BVD_invoice_999217.pdf", import.meta.url);
const hasRealFixture = existsSync(INVOICE_999217);

describe.skipIf(!hasRealFixture)("invoice 999217's stations (local files only)", () => {
  it("all 9 of its site numbers resolve via site_ref", async () => {
    // parseInvoicePdf reads only US rows until T-61, so the site numbers come
    // straight off the text layer: each fuel line prints `\t<Site #> BVD <name>`.
    const { PDFParse } = await import("pdf-parse");
    const { text } = await new PDFParse({ data: readFileSync(INVOICE_999217) }).getText();
    const siteRefs = [...new Set([...text.matchAll(/\t(\d{5}) BVD /g)].map((m) => m[1]!))];
    expect(siteRefs).toHaveLength(9);

    const stations = directoryStations();
    for (const siteRef of siteRefs) {
      expect(matchStation(siteRef, "", stations)).toBe(`ca-${siteRef}`);
    }
  });
});
