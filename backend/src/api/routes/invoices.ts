import type { Pool } from "pg";
import { z } from "zod";
import { isUuid } from "../../actuals/ids.js";
import { fxRateProblem } from "../../actuals/units.js";
import type { InvoiceCurrency } from "../../db/types.js";
import { detectInvoiceFormat } from "../../invoice/detectFormat.js";
import { importInvoice, type ImportInvoiceMeta, type ImportInvoiceResult } from "../../invoice/importInvoice.js";
import { parseInvoicePdf } from "../../invoice/parseInvoicePdf.js";
import { problemResponse } from "../problem.js";
import { isoDateSchema } from "../query.js";

/** `ImportInvoiceResult`'s own `report` type, read structurally off its
 * "imported" variant rather than imported directly from `invoice/report.js`
 * — this module is architecturally barred from importing parser/reconcile
 * internals (`invoices.test.ts`'s own module-import test), and every
 * non-error variant carries the same `report` shape. */
type ImportedReport = Extract<ImportInvoiceResult, { status: "imported" }>["report"];

/** `POST /invoices/import`'s 200 body — `ImportInvoiceResult`'s three
 * non-error variants collapsed to one shape (the route maps `"conflict"` to
 * a 409 problem+json instead, so it never reaches JSON as a body). The
 * frontend's upload client (T-42) is typed against this rather than the
 * broader `ImportInvoiceResult`, which still includes the case that never
 * actually serialises. */
export interface ImportInvoiceResponse {
  status: "imported" | "quarantined" | "duplicate";
  invoiceId: string;
  report: ImportedReport;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function importResultResponse(result: ImportInvoiceResult, url: URL): Response {
  switch (result.status) {
    case "imported":
    case "quarantined":
    case "duplicate":
      return jsonResponse({ status: result.status, invoiceId: result.invoiceId, report: result.report });
    case "conflict":
      // A byte-different file under an already-used invoice number, or a
      // second imported invoice of one currency in an occupied billing week
      // (D26), is a real HTTP error — distinct from the 200-with-
      // status:"quarantined" imbalance case, which is never a 4xx.
      return problemResponse({
        title: "Conflict",
        status: 409,
        detail: `${result.message} (existing invoice id: ${result.existingInvoiceId})`,
        instance: url.pathname,
      });
  }
}

/**
 * `POST /invoices/import` — multipart upload, wrapped straight over T-28's
 * `importInvoice()`. No parsing, no reconciliation, no database access of
 * its own: this function only picks a parser and maps the result to HTTP.
 */
export async function handleImportInvoice(pool: Pool, request: Request, url: URL): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: "expected multipart/form-data",
      instance: url.pathname,
    });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: 'missing "file" field',
      instance: url.pathname,
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const format = detectInvoiceFormat(file.name, buffer);
  if (format === null) {
    return problemResponse({
      title: "Unsupported Media Type",
      status: 415,
      detail: `"${file.name}" is neither a CSV nor a PDF invoice export`,
      instance: url.pathname,
    });
  }

  const meta: ImportInvoiceMeta = { sourceFilename: file.name };
  const result =
    format === "pdf"
      ? await importInvoice(pool, buffer, meta, { parse: parseInvoicePdf })
      : await importInvoice(pool, buffer, meta);

  return importResultResponse(result, url);
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

interface InvoiceListRow {
  id: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  billing_week_end: string;
  actual_start: string | null;
  actual_end: string | null;
  currency: InvoiceCurrency;
  grand_total: string;
  status: "imported" | "quarantined";
  imported_at: Date;
  fx_cad_per_usd: string | null;
  fx_entered_at: Date | null;
}

/** D27 (as amended): the exchange rate a dispatcher entered on a CA invoice —
 * `rate` is CAD per 1 USD; `enteredAt` is when it last changed. Named by what
 * it is, not by a currency suffix: no response key carries `Usd` (T-63). */
export interface InvoiceFx {
  rate: number;
  enteredAt: string;
}

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  /** The range BVD printed. */
  periodStart: string;
  periodEnd: string;
  /** D26: the week this invoice belongs to — `periodEnd` unless moved. */
  billingWeekEnd: string;
  /** First and last transaction date (UTC); `null` for a file with none. */
  actualStart: string | null;
  actualEnd: string | null;
  /** The printed range is not the actual one — an amber note, never a block. */
  datesDiffer: boolean;
  /** The invoice's currency (D24); `grandTotal` is in it. */
  currency: InvoiceCurrency;
  grandTotal: number;
  status: "imported" | "quarantined";
  importedAt: string;
  /** The entered rate; `null` until one is entered ("rate pending") and always on a USD invoice. */
  fx: InvoiceFx | null;
}

export interface InvoiceListResult {
  rows: InvoiceListItem[];
  page: number;
  pageSize: number;
  total: number;
}

/** The columns `InvoiceListRow` reads. Dates are formatted in SQL so none of
 * them passes through a JS `Date` (and a time zone). */
const INVOICE_COLUMNS = `id, invoice_number,
       to_char(period_start, 'YYYY-MM-DD') AS period_start,
       to_char(period_end, 'YYYY-MM-DD') AS period_end,
       to_char(billing_week_end, 'YYYY-MM-DD') AS billing_week_end,
       to_char(actual_start, 'YYYY-MM-DD') AS actual_start,
       to_char(actual_end, 'YYYY-MM-DD') AS actual_end,
       currency, grand_total, status, imported_at, fx_cad_per_usd, fx_entered_at`;

/** `datesDiffer`: printed != actual. An invoice with no transactions has no
 * actual range to differ from. */
export function datesDiffer(row: {
  period_start: string;
  period_end: string;
  actual_start: string | null;
  actual_end: string | null;
}): boolean {
  return (
    row.actual_start !== null &&
    row.actual_end !== null &&
    (row.period_start !== row.actual_start || row.period_end !== row.actual_end)
  );
}

function toListItem(row: InvoiceListRow): InvoiceListItem {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    billingWeekEnd: row.billing_week_end,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    datesDiffer: datesDiffer(row),
    currency: row.currency,
    grandTotal: Number(row.grand_total),
    status: row.status,
    importedAt: row.imported_at.toISOString(),
    fx: toInvoiceFx(row),
  };
}

export function toInvoiceFx(row: { fx_cad_per_usd: string | null; fx_entered_at: Date | null }): InvoiceFx | null {
  return row.fx_cad_per_usd === null || row.fx_entered_at === null
    ? null
    : { rate: Number(row.fx_cad_per_usd), enteredAt: row.fx_entered_at.toISOString() };
}

/** `GET /invoices` — A8.2's history list: newest-first, paginated. Every
 * field maps straight onto an `invoices` column; no join. */
export async function handleListInvoices(pool: Pool, url: URL): Promise<Response> {
  const parsed = listQuerySchema.safeParse({
    page: url.searchParams.get("page") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: parsed.error.message,
      instance: url.pathname,
    });
  }
  const { page, pageSize } = parsed.data;

  const { rows } = await pool.query<InvoiceListRow>(
    `SELECT ${INVOICE_COLUMNS}
     FROM invoices
     ORDER BY imported_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, (page - 1) * pageSize],
  );
  const { rows: countRows } = await pool.query<{ count: string }>("SELECT count(*) FROM invoices");
  const total = Number(countRows[0]?.count ?? "0");

  return jsonResponse({ rows: rows.map(toListItem), page, pageSize, total });
}

interface InvoiceRejectionRow {
  line_number: number;
  auth_code: string | null;
  code: string;
  message: string;
}

export interface InvoiceRejectionItem {
  lineNumber: number;
  authCode: string | null;
  code: string;
  message: string;
}

/** `GET /invoices/{id}`'s body — an `InvoiceListItem` plus the rejections
 * that quarantined it (empty for an `"imported"` invoice). Exported so T-42's
 * "reopen a quarantined row from history" flow can type its fetch without
 * re-declaring this shape client-side. */
export interface InvoiceDetail extends InvoiceListItem {
  rejections: InvoiceRejectionItem[];
}

/**
 * `GET /invoices/{id}` — reopens a history entry without re-uploading the
 * file (Step 34.2). `importInvoice()` never persists the full in-memory
 * `ImportReport`, so a quarantined invoice's reconciliation result is
 * rebuilt from `invoice_rejections`, the one table T-28 writes for exactly
 * this reason. `stationMisses`/`truckAssignmentMisses`/`expressBlankUnits`
 * are diagnostic-only and were never written anywhere, so an older
 * quarantined invoice has no way to surface them here — only `rejections`.
 */
export async function handleGetInvoice(pool: Pool, id: string, url: URL): Promise<Response> {
  const { rows } = await pool.query<InvoiceListRow>(
    `SELECT ${INVOICE_COLUMNS}
     FROM invoices
     WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return problemResponse({
      title: "Not Found",
      status: 404,
      detail: `No invoice with id ${id}`,
      instance: url.pathname,
    });
  }

  let rejections: InvoiceRejectionRow[] = [];
  if (row.status === "quarantined") {
    const result = await pool.query<InvoiceRejectionRow>(
      `SELECT line_number, auth_code, code, message
       FROM invoice_rejections
       WHERE invoice_id = $1
       ORDER BY line_number`,
      [id],
    );
    rejections = result.rows;
  }

  return jsonResponse({
    ...toListItem(row),
    rejections: rejections.map((r) => ({
      lineNumber: r.line_number,
      authCode: r.auth_code,
      code: r.code,
      message: r.message,
    })),
  });
}

const patchInvoiceSchema = z
  .object({
    billingWeekEnd: isoDateSchema.optional(),
    // Validated below with its own reasons; `null` clears the rate.
    fxCadPerUsd: z.unknown().optional(),
  })
  .strict()
  .refine((body) => body.billingWeekEnd !== undefined || "fxCadPerUsd" in body, {
    message: "expected billingWeekEnd, fxCadPerUsd, or both",
  });

/**
 * `PATCH /invoices/{id}` `{ billingWeekEnd?, fxCadPerUsd? }`.
 *
 * `billingWeekEnd` (D26) moves an invoice to another billing week: the Import
 * screen's override for a week BVD's printed period end gets wrong. The printed
 * and actual ranges are untouched. Moving onto a week another *imported*
 * invoice of the same currency already holds is a 409, not a silent merge (the
 * unique index decides, so two concurrent moves cannot both win).
 *
 * `fxCadPerUsd` (D27, T-66) enters or corrects a CA invoice's exchange rate —
 * CAD per 1 USD — or clears it with `null`, back to "rate pending".
 * `fx_entered_at` moves only when the rate actually changes. A USD invoice has
 * no rate (400), and a value outside 0.5–3.0 is a typo (400).
 *
 * Both fields go in one UPDATE, so a request carrying both applies both or
 * neither.
 */
export async function handlePatchInvoice(pool: Pool, id: string, request: Request, url: URL): Promise<Response> {
  if (!isUuid(id)) {
    return problemResponse({ title: "Not Found", status: 404, detail: `No invoice with id ${id}`, instance: url.pathname });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemResponse({ title: "Bad Request", status: 400, detail: "expected a JSON body", instance: url.pathname });
  }
  const parsed = patchInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return problemResponse({ title: "Bad Request", status: 400, detail: parsed.error.message, instance: url.pathname });
  }
  const billingWeekEnd = parsed.data.billingWeekEnd ?? null;
  const setsFx = "fxCadPerUsd" in parsed.data;
  const fx = parsed.data.fxCadPerUsd ?? null;
  if (setsFx && fx !== null) {
    const problem = fxRateProblem(fx);
    if (problem !== null) {
      return problemResponse({ title: "Bad Request", status: 400, detail: problem, instance: url.pathname });
    }
  }

  const { rows: found } = await pool.query<{ currency: InvoiceCurrency }>("SELECT currency FROM invoices WHERE id = $1", [id]);
  const invoice = found[0];
  if (!invoice) {
    return problemResponse({ title: "Not Found", status: 404, detail: `No invoice with id ${id}`, instance: url.pathname });
  }
  if (setsFx && invoice.currency !== "CAD") {
    return problemResponse({
      title: "Bad Request",
      status: 400,
      detail: "a USD invoice has no exchange rate — the rate is entered on the CA invoice",
      instance: url.pathname,
    });
  }

  try {
    await pool.query(
      `UPDATE invoices
       SET billing_week_end = COALESCE($2::date, billing_week_end),
           fx_entered_at = CASE
             WHEN NOT $3::boolean THEN fx_entered_at
             WHEN $4::numeric(10,6) IS NULL THEN NULL
             WHEN fx_cad_per_usd IS DISTINCT FROM $4::numeric(10,6) THEN now()
             ELSE fx_entered_at
           END,
           fx_cad_per_usd = CASE WHEN $3::boolean THEN $4::numeric(10,6) ELSE fx_cad_per_usd END
       WHERE id = $1`,
      [id, billingWeekEnd, setsFx, fx],
    );
  } catch (err) {
    if ((err as { code?: string }).code !== "23505") {
      throw err;
    }
    const { rows } = await pool.query<{ id: string; invoice_number: string }>(
      `SELECT h.id, h.invoice_number
       FROM invoices i
       JOIN invoices h ON h.billing_week_end = $2::date AND h.currency = i.currency AND h.status = 'imported'
       WHERE i.id = $1`,
      [id, billingWeekEnd],
    );
    const holder = rows[0];
    return problemResponse({
      title: "Conflict",
      status: 409,
      detail: holder
        ? `invoice ${holder.invoice_number} already holds that billing week for this currency (existing invoice id: ${holder.id})`
        : "another invoice already holds that billing week for this currency",
      instance: url.pathname,
    });
  }
  const { rows } = await pool.query<InvoiceListRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1`, [id]);
  return jsonResponse(toListItem(rows[0]!));
}
