import type { Pool } from "pg";
import { z } from "zod";
import type { InvoiceCurrency } from "../../db/types.js";
import { detectInvoiceFormat } from "../../invoice/detectFormat.js";
import { importInvoice, type ImportInvoiceMeta, type ImportInvoiceResult } from "../../invoice/importInvoice.js";
import { parseInvoicePdf } from "../../invoice/parseInvoicePdf.js";
import { problemResponse } from "../problem.js";

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
      // D12/D-whatever: a byte-different file under an already-used invoice
      // number is the one case that's a real HTTP error — distinct from the
      // 200-with-status:"quarantined" imbalance case, which is never a 4xx.
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
  period_start: Date;
  period_end: Date;
  currency: InvoiceCurrency;
  grand_total: string;
  status: "imported" | "quarantined";
  imported_at: Date;
}

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  /** The invoice's currency (D24); `grandTotalUsd` is in it, whatever its
   * name, until T-63 reshapes the contract. */
  currency: InvoiceCurrency;
  grandTotalUsd: number;
  status: "imported" | "quarantined";
  importedAt: string;
}

export interface InvoiceListResult {
  rows: InvoiceListItem[];
  page: number;
  pageSize: number;
  total: number;
}

function toListItem(row: InvoiceListRow): InvoiceListItem {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    periodStart: row.period_start.toISOString().slice(0, 10),
    periodEnd: row.period_end.toISOString().slice(0, 10),
    currency: row.currency,
    grandTotalUsd: Number(row.grand_total),
    status: row.status,
    importedAt: row.imported_at.toISOString(),
  };
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
    `SELECT id, invoice_number, period_start, period_end, currency, grand_total, status, imported_at
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
    `SELECT id, invoice_number, period_start, period_end, currency, grand_total, status, imported_at
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
