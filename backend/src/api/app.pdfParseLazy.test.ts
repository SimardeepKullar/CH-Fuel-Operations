import { describe, expect, it, vi } from "vitest";

// pdfjs-dist (via pdf-parse) throws at module-init when bundled into the
// Next.js API route. Loading it only when a PDF is actually parsed keeps
// every other route alive even if the bundler config regresses.
const loads = vi.hoisted(() => ({ count: 0 }));
vi.mock("pdf-parse", () => {
  loads.count++;
  return { PDFParse: class {} };
});

describe("pdf-parse is loaded lazily", () => {
  it("importing the API app does not load pdf-parse", async () => {
    await import("./app.js");
    expect(loads.count).toBe(0);
  });
});
