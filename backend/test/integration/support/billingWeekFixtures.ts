import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { importInvoice, type ImportInvoiceResult } from "../../../src/invoice/importInvoice.js";
import { parseInvoicePdf } from "../../../src/invoice/parseInvoicePdf.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/invoices");

/** The week the real pair (999210 US, 999217 CA) share, and the synthetic
 * CA fixture prints as its period end. */
export const WEEK_END = "2026-09-09";

/** A committed CSV fixture with its transaction dates rewritten, composed in
 * the test — never committed re-dated (backfillInvoices.test.ts does the same).
 * `dates` maps each date the fixture contains to the one it should carry. The
 * CSV's header period is derived from its own transaction dates, so re-dating
 * them re-dates the invoice. */
export function redatedCsv(fixture: string, dates: Record<string, string>): Buffer {
  let text = readFileSync(path.join(fixturesDir, fixture), "utf8");
  for (const [from, to] of Object.entries(dates)) {
    text = text.replaceAll(from, to);
  }
  return Buffer.from(text, "utf8");
}

/** sample-redacted.csv (US, Jan 5 – 7) moved to Sep 7 – 9: period end 2026-09-09. */
export const usInWeek = (): Buffer =>
  redatedCsv("sample-redacted.csv", {
    "2026-01-05": "2026-09-07",
    "2026-01-06": "2026-09-08",
    "2026-01-07": "2026-09-09",
  });

/** sample-redacted-2.csv (US, one stop Jan 19) moved onto Sep 9 — a *different*
 * US invoice for the same week as `usInWeek()`. A CSV's period is derived from
 * its transaction dates, so the one stop's date is the week end. */
export const secondUsInWeek = (): Buffer =>
  redatedCsv("sample-redacted-2.csv", { "2026-01-19": WEEK_END });

/** sample-redacted-imbalanced.csv moved into the same week as `usInWeek()`. */
export const imbalancedUsInWeek = (): Buffer =>
  redatedCsv("sample-redacted-imbalanced.csv", {
    "2026-01-05": "2026-09-07",
    "2026-01-06": "2026-09-08",
    "2026-01-07": "2026-09-09",
  });

export const caPdf = (): Buffer => readFileSync(path.join(fixturesDir, "sample-ca.pdf"));

/** The synthetic cards/units the sample-redacted CSVs name. The CA PDF's come
 * from T-62's synthetic roster, already migrated. */
export async function seedUsFixtureRoster(pool: Pool): Promise<void> {
  await pool.query(
    "INSERT INTO fuel_cards (card_number) VALUES ('1000001'), ('1000002'), ('1000003') ON CONFLICT DO NOTHING",
  );
  await pool.query("INSERT INTO trucks (unit_number) VALUES ('101'), ('102'), ('103') ON CONFLICT DO NOTHING");
}

export const importUs = (pool: Pool, csv: Buffer, filename: string): Promise<ImportInvoiceResult> =>
  importInvoice(pool, csv, { sourceFilename: filename });

export const importCa = (pool: Pool): Promise<ImportInvoiceResult> =>
  importInvoice(pool, caPdf(), { sourceFilename: "sample-ca.pdf" }, { parse: parseInvoicePdf });
