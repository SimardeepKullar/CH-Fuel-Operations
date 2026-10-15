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

/** T-66 step 66.1 — the rate a dispatcher enters, stored on the CA invoice. */
describe.skipIf(!hasDatabase)("exchange rate on the CA invoice (integration, T-66)", () => {
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

  describe("PATCH /invoices/{id} { fxCadPerUsd }", () => {
    it("stores the rate with when it was entered, and returns it as fx", async () => {
      await importCa(pool);
      const caId = await idOf("700001");
      expect(await stored(caId)).toMatchObject({ fx_cad_per_usd: null, fx_entered_at: null });

      const response = await patch(app, caId, { fxCadPerUsd: 1.3712 });
      expect(response.status).toBe(200);
      const body = (await response.json()) as InvoiceListItem;
      const row = await stored(caId);
      expect(row.fx_cad_per_usd).toBe("1.371200");
      expect(row.fx_entered_at).toBeInstanceOf(Date);
      expect(body.fx).toEqual({ rate: 1.3712, enteredAt: row.fx_entered_at!.toISOString() });
      expect(body.billingWeekEnd).toBe(WEEK_END);
    });

    it("a second value corrects it and moves fx_entered_at; the same value again leaves the time alone", async () => {
      await importCa(pool);
      const caId = await idOf("700001");
      await patch(app, caId, { fxCadPerUsd: 1.3712 });
      const first = await stored(caId);

      await patch(app, caId, { fxCadPerUsd: 1.3712 });
      expect((await stored(caId)).fx_entered_at).toEqual(first.fx_entered_at);

      await patch(app, caId, { fxCadPerUsd: 1.38 });
      const corrected = await stored(caId);
      expect(corrected.fx_cad_per_usd).toBe("1.380000");
      expect(corrected.fx_entered_at!.getTime()).toBeGreaterThan(first.fx_entered_at!.getTime());
    });

    it("null clears the rate and its timestamp — back to pending", async () => {
      await importCa(pool);
      const caId = await idOf("700001");
      await patch(app, caId, { fxCadPerUsd: 1.3712 });

      const response = await patch(app, caId, { fxCadPerUsd: null });
      expect(response.status).toBe(200);
      expect(((await response.json()) as InvoiceListItem).fx).toBeNull();
      expect(await stored(caId)).toMatchObject({ fx_cad_per_usd: null, fx_entered_at: null });
    });

    it("is a 400 on a USD invoice, with nothing changed", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      const usId = await idOf("100001");

      const response = await patch(app, usId, { fxCadPerUsd: 1.3712 });
      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
      expect(((await response.json()) as { detail: string }).detail).toContain("USD invoice");
      expect(await stored(usId)).toMatchObject({ fx_cad_per_usd: null, fx_entered_at: null });
      // Clearing is no different: a USD invoice has no rate to touch.
      expect((await patch(app, usId, { fxCadPerUsd: null })).status).toBe(400);
    });

    it("is a 400 for 0, -1, 0.4, 3.1, a string, or more than six places — with nothing changed", async () => {
      await importCa(pool);
      const caId = await idOf("700001");
      await patch(app, caId, { fxCadPerUsd: 1.3712 });
      const before = await stored(caId);

      for (const fxCadPerUsd of [0, -1, 0.4, 3.1, "1.3712", true, 1.3712345]) {
        const response = await patch(app, caId, { fxCadPerUsd });
        expect(response.status, JSON.stringify(fxCadPerUsd)).toBe(400);
        expect(((await response.json()) as { detail: string }).detail.length).toBeGreaterThan(0);
      }
      expect(await stored(caId)).toEqual(before);
    });

    it("beside billingWeekEnd, applies both", async () => {
      await importCa(pool);
      const caId = await idOf("700001");

      const response = await patch(app, caId, { billingWeekEnd: "2026-09-16", fxCadPerUsd: 1.3712 });
      expect(response.status).toBe(200);
      expect(await stored(caId)).toMatchObject({ billing_week_end: "2026-09-16", fx_cad_per_usd: "1.371200" });
    });

    it("beside billingWeekEnd, applies neither when either is refused", async () => {
      await importCa(pool);
      const caId = await idOf("700001");
      // Another CA invoice holding 2026-09-16, so the move is a 409.
      await pool.query(
        `INSERT INTO invoices (invoice_number, period_start, period_end, billing_week_end, invoice_date, due_date,
                               currency, qty_unit, grand_total, status, file_sha256)
         VALUES ('CA-HOLDER', '2026-09-10', '2026-09-16', '2026-09-16', '2026-09-17', '2026-09-18',
                 'CAD', 'L', 0, 'imported', repeat('a', 64))`,
      );
      const before = await stored(caId);

      const conflict = await patch(app, caId, { billingWeekEnd: "2026-09-16", fxCadPerUsd: 1.3712 });
      expect(conflict.status).toBe(409);
      expect(await stored(caId)).toEqual(before);

      const badRate = await patch(app, caId, { billingWeekEnd: "2026-09-23", fxCadPerUsd: 3.1 });
      expect(badRate.status).toBe(400);
      expect(await stored(caId)).toEqual(before);

      const badWeek = await patch(app, caId, { billingWeekEnd: "2026-9-23", fxCadPerUsd: 1.3712 });
      expect(badWeek.status).toBe(400);
      expect(await stored(caId)).toEqual(before);
    });

    it("leaves the rate alone when only the week moves", async () => {
      await importCa(pool);
      const caId = await idOf("700001");
      await patch(app, caId, { fxCadPerUsd: 1.3712 });
      const before = await stored(caId);

      expect((await patch(app, caId, { billingWeekEnd: "2026-09-16" })).status).toBe(200);
      expect(await stored(caId)).toMatchObject({
        billing_week_end: "2026-09-16",
        fx_cad_per_usd: "1.371200",
        fx_entered_at: before.fx_entered_at,
      });
    });

    it("GET /invoices, GET /invoices/{id} and GET /periods carry fx — null on USD and until entered", async () => {
      await importUs(pool, usInWeek(), "invoice_100001.csv");
      await importCa(pool);
      const caId = await idOf("700001");

      const weekFx = async () =>
        ((await (await get(app, "/periods")).json()) as { weeks: PeriodWeek[] }).weeks[0]!.invoices.map((i) => [i.currency, i.fx]);
      expect(await weekFx()).toEqual([
        ["USD", null],
        ["CAD", null],
      ]);

      await patch(app, caId, { fxCadPerUsd: 1.3712 });
      const enteredAt = (await stored(caId)).fx_entered_at!.toISOString();
      const fx = { rate: 1.3712, enteredAt };

      expect(await weekFx()).toEqual([
        ["USD", null],
        ["CAD", fx],
      ]);
      const list = (await (await get(app, "/invoices")).json()) as { rows: InvoiceListItem[] };
      expect(Object.fromEntries(list.rows.map((r) => [r.currency, r.fx]))).toEqual({ USD: null, CAD: fx });
      expect(((await (await get(app, `/invoices/${caId}`)).json()) as InvoiceListItem).fx).toEqual(fx);
    });
  });

  describe("at import", () => {
    it("importInvoice stores a rate given for a CA invoice", async () => {
      const result = await importInvoice(pool, caPdf(), { sourceFilename: "sample-ca.pdf" }, { parse: parseInvoicePdf, fxCadPerUsd: 1.3712 });
      expect(result.status).toBe("imported");
      const row = await stored(await idOf("700001"));
      expect(row.fx_cad_per_usd).toBe("1.371200");
      expect(row.fx_entered_at).toBeInstanceOf(Date);
    });

    it("importInvoice refuses a rate on a USD invoice, or outside the band, before any row is written", async () => {
      await expect(importInvoice(pool, usInWeek(), { sourceFilename: "invoice_100001.csv" }, { fxCadPerUsd: 1.3712 })).rejects.toThrow(
        /USD invoice.*nothing was imported/,
      );
      await expect(
        importInvoice(pool, caPdf(), { sourceFilename: "sample-ca.pdf" }, { parse: parseInvoicePdf, fxCadPerUsd: 13.712 }),
      ).rejects.toThrow(/between 0.5 and 3.0/);
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

      it("sets the rate on a CA file", async () => {
        expect(await runImportInvoiceCli([written("sample-ca.pdf", caPdf()), "--fx-rate", "1.3712"], pool)).toBe(0);
        expect((await stored(await idOf("700001"))).fx_cad_per_usd).toBe("1.371200");
        expect(printed(logSpy)).toContain("1.3712 CAD per USD");
      });

      it("fails on a USD file before any row is written", async () => {
        expect(await runImportInvoiceCli([written("invoice_100001.csv", usInWeek()), "--fx-rate", "1.3712"], pool)).toBe(1);
        expect(printed(errorSpy)).toContain("USD invoice");
        expect((await pool.query<{ n: string }>("SELECT count(*) AS n FROM invoices")).rows[0]!.n).toBe("0");
      });

      it("refuses a non-numeric rate without reading the file", async () => {
        expect(await runImportInvoiceCli([path.join(tempDir, "missing.pdf"), "--fx-rate", "abc"], pool)).toBe(1);
        expect(printed(errorSpy)).toContain("not a number");
      });

      it("leaves an already-imported invoice's rate alone on a duplicate, and says how to correct it", async () => {
        const file = written("sample-ca.pdf", caPdf());
        expect(await runImportInvoiceCli([file, "--fx-rate", "1.3712"], pool)).toBe(0);
        expect(await runImportInvoiceCli([file, "--fx-rate", "1.40"], pool)).toBe(0);
        expect((await stored(await idOf("700001"))).fx_cad_per_usd).toBe("1.371200");
        expect(printed(logSpy)).toContain("exchange rate not applied");
      });
    });
  });
});
