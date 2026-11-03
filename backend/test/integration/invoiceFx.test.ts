import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App } from "../../src/api/app.js";
import type { InvoiceListItem } from "../../src/api/routes/invoices.js";
import type { PeriodWeek } from "../../src/api/routes/periods.js";
import { runImportInvoiceCli } from "../../src/cli/importInvoice.js";
import { importInvoice } from "../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../src/invoice/parseInvoicePdf.js";
import { scopedSchema, teardown } from "./support/actualsFixtures.js";
import { WEEK_END, caPdf, importCa, importUs, seedUsFixtureRoster, usInWeek } from "./support/billingWeekFixtures.js";

const hasDatabase = Boolean(process.env.DATABASE_URL);

const get = (app: App, p: string) => app.handle(new Request(`http://localhost/api/v1${p}`));
const patch = (app: App, id: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost/api/v1/invoices/${id}`, {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

interface FxRow {
  fx_cad_per_usd: string | null;
  fx_entered_at: Date | null;
  billing_week_end: string;
}

/** T-66 step 66.1, moved by T-68 — the rate a dispatcher enters, stored on the US invoice. */
describe.skipIf(!hasDatabase)("exchange rate on the US invoice (integration, T-66, T-68)", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;
  let app: App;

  beforeEach(async () => {
    ({ adminPool, scopedPool: pool, schema } = await scopedSchema("test_invoice_fx"));
    await seedUsFixtureRoster(pool);
    app = createApp({ pool, authRequired: false });
  });

  afterEach(async () => {
    await teardown(adminPool, pool, schema);
  });

  const idOf = async (invoiceNumber: string): Promise<string> =>
    (await pool.query<{ id: string }>("SELECT id FROM invoices WHERE invoice_number = $1", [invoiceNumber])).rows[0]!.id;

  const stored = async (id: string): Promise<FxRow> =>
    (
      await pool.query<FxRow>(
        "SELECT fx_cad_per_usd, fx_entered_at, to_char(billing_week_end, 'YYYY-MM-DD') AS billing_week_end FROM invoices WHERE id = $1",
        [id],
      )
    ).rows[0]!;

  describe("POST /invoices/import carries the invoice's rate (T-67)", () => {
    const upload = (buffer: Buffer, filename: string) => {
      const formData = new FormData();
      formData.append("file", new Blob([buffer]), filename);
      return app.handle(new Request("http://localhost/api/v1/invoices/import", { method: "POST", body: formData }));
    };

    it("a fresh US import has fx: null, with the invoice id and currency to PATCH against", async () => {
      const body = (await (await upload(usInWeek(), "invoice_100001.csv")).json()) as {
        status: string;
        invoiceId: string;
        fx: unknown;
        report: { currency: string };
      };
      expect(body.status).toBe("imported");
      expect(body.invoiceId).toBe(await idOf("100001"));
      expect(body.report.currency).toBe("USD");
      expect(body.fx).toBeNull();
    });

    it("an invoice that already has a rate comes back with it and when it was entered", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      await patch(app, usId, { fxCadPerUsd: 1.3712 });
      const row = await stored(usId);
      const body = (await (await upload(usInWeek(), "invoice_100001.csv")).json()) as { status: string; fx: unknown };
      expect(body.status).toBe("duplicate");
      expect(body.fx).toEqual({ rate: 1.3712, enteredAt: row.fx_entered_at!.toISOString() });
    });

    it("a CA import has fx: null", async () => {
      const response = await upload(caPdf(), "sample-ca.pdf");
      const body = (await response.json()) as { status: string; fx: unknown; report: { currency: string } };
      expect(body.report.currency).toBe("CAD");
      expect(body.fx).toBeNull();
    });
  });

  describe("PATCH /invoices/{id} { fxCadPerUsd }", () => {
    it("stores the rate with when it was entered, and returns it as fx", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      expect(await stored(usId)).toMatchObject({ fx_cad_per_usd: null, fx_entered_at: null });

      const response = await patch(app, usId, { fxCadPerUsd: 1.3712 });
      expect(response.status).toBe(200);
      const body = (await response.json()) as InvoiceListItem;
      const row = await stored(usId);
      expect(row.fx_cad_per_usd).toBe("1.371200");
      expect(row.fx_entered_at).toBeInstanceOf(Date);
      expect(body.fx).toEqual({ rate: 1.3712, enteredAt: row.fx_entered_at!.toISOString() });
      expect(body.billingWeekEnd).toBe(WEEK_END);
    });

    it("a second value corrects it and moves fx_entered_at; the same value again leaves the time alone", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      await patch(app, usId, { fxCadPerUsd: 1.3712 });
      const first = await stored(usId);

      await patch(app, usId, { fxCadPerUsd: 1.3712 });
      expect((await stored(usId)).fx_entered_at).toEqual(first.fx_entered_at);

      await patch(app, usId, { fxCadPerUsd: 1.38 });
      const corrected = await stored(usId);
      expect(corrected.fx_cad_per_usd).toBe("1.380000");
      expect(corrected.fx_entered_at!.getTime()).toBeGreaterThan(first.fx_entered_at!.getTime());
    });

    it("null clears the rate and its timestamp — back to pending", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      await patch(app, usId, { fxCadPerUsd: 1.3712 });

      const response = await patch(app, usId, { fxCadPerUsd: null });
      expect(response.status).toBe(200);
      expect(((await response.json()) as InvoiceListItem).fx).toBeNull();
      expect(await stored(usId)).toMatchObject({ fx_cad_per_usd: null, fx_entered_at: null });
    });

    it("is a 400 on a CAD invoice, with nothing changed", async () => {
      await importCa(pool);
      const caId = await idOf("700001");

      const response = await patch(app, caId, { fxCadPerUsd: 1.3712 });
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(((await response.json()) as { detail: string }).detail).toContain("CAD invoice");
      expect(await stored(caId)).toMatchObject({ fx_cad_per_usd: null, fx_entered_at: null });
      // Clearing is no different: a CAD invoice has no rate to touch.
      expect((await patch(app, caId, { fxCadPerUsd: null })).status).toBe(400);
    });

    it("the migration's CHECK refuses a rate on a CAD invoice and accepts one on a USD invoice", async () => {
      await importCa(pool);
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      await expect(pool.query("UPDATE invoices SET fx_cad_per_usd = 1.3712, fx_entered_at = now() WHERE currency = 'CAD'")).rejects.toThrow(/check/i);
      await pool.query("UPDATE invoices SET fx_cad_per_usd = 1.3712, fx_entered_at = now() WHERE currency = 'USD'");
    });

    it("is a 400 for 0, -1, 0.4, 3.1, a string, or more than six places — with nothing changed", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      await patch(app, usId, { fxCadPerUsd: 1.3712 });
      const before = await stored(usId);

      for (const fxCadPerUsd of [0, -1, 0.4, 3.1, "1.3712", true, 1.3712345]) {
        const response = await patch(app, usId, { fxCadPerUsd });
        expect(response.status, JSON.stringify(fxCadPerUsd)).toBe(400);
        expect(((await response.json()) as { detail: string }).detail.length).toBeGreaterThan(0);
      }
      expect(await stored(usId)).toEqual(before);
    });

    it("beside billingWeekEnd, applies both", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");

      const response = await patch(app, usId, { billingWeekEnd: "2026-09-16", fxCadPerUsd: 1.3712 });
      expect(response.status).toBe(200);
      expect(await stored(usId)).toMatchObject({ billing_week_end: "2026-09-16", fx_cad_per_usd: "1.371200" });
    });

    it("beside billingWeekEnd, applies neither when either is refused", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      // Another US invoice holding 2026-09-16, so the move is a 409.
      await pool.query(
        `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date,
                               currency, qty_unit, grand_total, status, file_sha256)
         VALUES ('CA-HOLDER', '2026-09-10', '2026-09-16', '2026-09-16', '2026-09-17', '2026-09-18',
                 'USD', 'gal', 0, 'imported', repeat('a', 64))`,
      );
      const before = await stored(usId);

      const conflict = await patch(app, usId, { billingWeekEnd: "2026-09-16", fxCadPerUsd: 1.3712 });
      expect(conflict.status).toBe(409);
      expect(await stored(usId)).toEqual(before);

      const badRate = await patch(app, usId, { billingWeekEnd: "2026-09-23", fxCadPerUsd: 3.1 });
      expect(badRate.status).toBe(400);
      expect(await stored(usId)).toEqual(before);

      const badWeek = await patch(app, usId, { billingWeekEnd: "2026-9-23", fxCadPerUsd: 1.3712 });
      expect(badWeek.status).toBe(400);
      expect(await stored(usId)).toEqual(before);
    });

    it("leaves the rate alone when only the week moves", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");
      await patch(app, usId, { fxCadPerUsd: 1.3712 });
      const before = await stored(usId);

      expect((await patch(app, usId, { billingWeekEnd: "2026-09-16" })).status).toBe(200);
      expect(await stored(usId)).toMatchObject({
        billing_week_end: "2026-09-16",
        fx_cad_per_usd: "1.371200",
        fx_entered_at: before.fx_entered_at,
      });
    });

    it("GET /invoices, GET /invoices/{id} and GET /periods carry fx — null on CAD and until entered", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      await importCa(pool);
      const usId = await idOf("100001");

      const weekFx = async () =>
        ((await (await get(app, "/periods")).json()) as { weeks: PeriodWeek[] }).weeks[0]!.invoices.map((i) => [i.currency, i.fx]);
      expect(await weekFx()).toEqual([
        ["USD", null],
        ["CAD", null],
      ]);

      await patch(app, usId, { fxCadPerUsd: 1.3712 });
      const enteredAt = (await stored(usId)).fx_entered_at!.toISOString();
      const fx = { rate: 1.3712, enteredAt };

      expect(await weekFx()).toEqual([
        ["USD", fx],
        ["CAD", null],
      ]);
      const list = (await (await get(app, "/invoices")).json()) as { rows: InvoiceListItem[] };
      expect(Object.fromEntries(list.rows.map((r) => [r.currency, r.fx]))).toEqual({ USD: fx, CAD: null });
      expect(((await (await get(app, `/invoices/${usId}`)).json()) as InvoiceListItem).fx).toEqual(fx);
    });
  });

  describe("at import", () => {
    it("importInvoice stores a rate given for a US invoice", async () => {
      const result = await importInvoice(pool, usInWeek(), { sourceFilename: "invoice_100001.csv" }, { fxCadPerUsd: 1.3712 });
      expect(result.status).toBe("imported");
      const row = await stored(await idOf("100001"));
      expect(row.fx_cad_per_usd).toBe("1.371200");
      expect(row.fx_entered_at).toBeInstanceOf(Date);
    });

    it("importInvoice refuses a rate on a CAD invoice, or outside the band, before any row is written", async () => {
      await expect(
        importInvoice(pool, caPdf(), { sourceFilename: "sample-ca.pdf" }, { parse: parseInvoicePdf, fxCadPerUsd: 1.3712 }),
      ).rejects.toThrow(/CAD invoice.*nothing was imported/);
      await expect(importInvoice(pool, usInWeek(), { sourceFilename: "invoice_100001.csv" }, { fxCadPerUsd: 13.712 })).rejects.toThrow(
        /between 0.5 and 3.0/,
      );
      for (const table of ["invoices", "fuel_stops", "invoice_totals", "invoice_rejections", "express_charges", "anomalies"]) {
        expect((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n, table).toBe("0");
      }
    });

    describe("npm run import-invoice -- <file> --fx-rate", () => {
      let tempDir: string;
      let logSpy: ReturnType<typeof vi.spyOn>;
      let errorSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        tempDir = mkdtempSync(path.join(os.tmpdir(), "ch-import-fx-"));
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      });

      afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
      });

      const written = (name: string, bytes: Buffer): string => {
        const file = path.join(tempDir, name);
        writeFileSync(file, bytes);
        return file;
      };
      const printed = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((call) => String(call[0])).join("\n");

      it("sets the rate on a US file", async () => {
        expect(await runImportInvoiceCli([written("invoice_100001.csv", usInWeek()), "--fx-rate", "1.3712"], pool)).toBe(0);
        expect((await stored(await idOf("100001"))).fx_cad_per_usd).toBe("1.371200");
        expect(printed(logSpy)).toContain("1.3712 CAD per USD");
      });

      it("fails on a CA file before any row is written", async () => {
        expect(await runImportInvoiceCli([written("sample-ca.pdf", caPdf()), "--fx-rate", "1.3712"], pool)).toBe(1);
        expect(printed(errorSpy)).toContain("CAD invoice");
        expect((await pool.query<{ n: string }>("SELECT count(*) AS n FROM invoices")).rows[0]!.n).toBe("0");
      });

      it("refuses a non-numeric rate without reading the file", async () => {
        expect(await runImportInvoiceCli([path.join(tempDir, "missing.pdf"), "--fx-rate", "abc"], pool)).toBe(1);
        expect(printed(errorSpy)).toContain("not a number");
      });

      it("leaves an already-imported invoice's rate alone on a duplicate, and says how to correct it", async () => {
        const file = written("invoice_100001.csv", usInWeek());
        expect(await runImportInvoiceCli([file, "--fx-rate", "1.3712"], pool)).toBe(0);
        expect(await runImportInvoiceCli([file, "--fx-rate", "1.40"], pool)).toBe(0);
        expect((await stored(await idOf("100001"))).fx_cad_per_usd).toBe("1.371200");
        expect(printed(logSpy)).toContain("exchange rate not applied");
      });
    });
  });
});
