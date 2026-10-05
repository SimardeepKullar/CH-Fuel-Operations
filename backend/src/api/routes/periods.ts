import type { Pool } from "pg";
import type { InvoiceCurrency } from "../../db/types.js";
import { datesDiffer } from "./invoices.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface PeriodInvoice {
  id: string;
  invoiceNumber: string;
  currency: InvoiceCurrency;
  printedStart: string;
  printedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  datesDiffer: boolean;
}

export interface PeriodWeek {
  /** `YYYY-MM-DD` — the key every period-scoped route takes as `?week=`. */
  weekEnd: string;
  /** USD first, then CAD; at most one of each. */
  invoices: PeriodInvoice[];
}

interface PeriodRow {
  id: string;
  invoice_number: string;
  currency: InvoiceCurrency;
  week_end: string;
  period_start: string;
  period_end: string;
  actual_start: string | null;
  actual_end: string | null;
}

/**
 * `GET /periods` (D26) — billing weeks, newest first, each with the imported
 * invoices behind it. A quarantined invoice has no rows to serve, so it never
 * offers a week. `datesDiffer` is the amber note: BVD printed one range and the
 * transactions ran another (999217 prints Aug 1 – Sep 9, runs Sep 3 – Sep 10).
 */
export async function handleListPeriods(pool: Pool): Promise<Response> {
  const { rows } = await pool.query<PeriodRow>(
    `SELECT id, invoice_number, currency,
            to_char(billing_week_end, 'YYYY-MM-DD') AS week_end,
            to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end,
            to_char(actual_start, 'YYYY-MM-DD') AS actual_start,
            to_char(actual_end, 'YYYY-MM-DD') AS actual_end
     FROM invoices
     WHERE status = 'imported'
     ORDER BY billing_week_end DESC, currency DESC`,
  );

  const weeks: PeriodWeek[] = [];
  for (const row of rows) {
    let week = weeks[weeks.length - 1];
    if (!week || week.weekEnd !== row.week_end) {
      week = { weekEnd: row.week_end, invoices: [] };
      weeks.push(week);
    }
    week.invoices.push({
      id: row.id,
      invoiceNumber: row.invoice_number,
      currency: row.currency,
      printedStart: row.period_start,
      printedEnd: row.period_end,
      actualStart: row.actual_start,
      actualEnd: row.actual_end,
      datesDiffer: datesDiffer(row),
    });
  }
  return jsonResponse({ weeks });
}
