import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { handleImportInvoice } from "./invoices.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(path.join(dirname, "invoices.ts"), "utf8");

/** A pool that fails the test the moment anything on it is called — the 415
 * path (and any other pre-database rejection) must never touch the database. */
const untouchedPool = new Proxy(
  {},
  {
    get(): never {
      throw new Error("route touched the database before it should have");
    },
  },
) as Pool;

describe("invoices route module", () => {
  it("imports no parser internals — only importInvoice.js and parseInvoicePdf.js from invoice/", () => {
    const specifiers = [...routeSource.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    const invoiceModuleImports = specifiers.filter((s) => s.includes("/invoice/"));

    // The route dispatches CSV-vs-PDF and maps HTTP — it never implements
    // parsing or reconciliation itself, so those modules must stay untouched.
    for (const forbidden of [
      "parseInvoiceCsv.js",
      "reconcile.js",
      "groupByAuthCode.js",
      "parseExpressRows.js",
      "productCode.js",
      "report.js",
      "decimal.js",
    ]) {
      expect(invoiceModuleImports.some((s) => s.endsWith(forbidden))).toBe(false);
    }

    expect(invoiceModuleImports.some((s) => s.endsWith("importInvoice.js"))).toBe(true);
    expect(invoiceModuleImports.some((s) => s.endsWith("parseInvoicePdf.js"))).toBe(true);
  });
});

describe("handleImportInvoice", () => {
  it("415s a file that is neither CSV nor PDF, without touching the database", async () => {
    const formData = new FormData();
    formData.append("file", new Blob([Buffer.from("not an invoice")]), "notes.txt");
    const request = new Request("http://localhost/api/v1/invoices/import", {
      method: "POST",
      body: formData,
    });

    const response = await handleImportInvoice(untouchedPool, request, new URL(request.url));

    expect(response.status).toBe(415);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("400s a request with no \"file\" field", async () => {
    const formData = new FormData();
    const request = new Request("http://localhost/api/v1/invoices/import", {
      method: "POST",
      body: formData,
    });

    const response = await handleImportInvoice(untouchedPool, request, new URL(request.url));

    expect(response.status).toBe(400);
  });
});
