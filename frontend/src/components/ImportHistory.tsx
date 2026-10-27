"use client";

import { useState } from "react";
import type { InvoiceListItem } from "@ch/core/api/routes/invoices";
import { ApiError } from "../lib/api";
import { formatMoneyGrouped } from "../lib/formatMoney";
import { formatDatesDifferNote, formatImportedAt } from "../lib/weeks";
import EmptyState from "./EmptyState";
import { CodeBadge } from "./SubStrip";

interface ImportHistoryProps {
  rows: InvoiceListItem[];
  loading?: boolean;
  onReopenQuarantined: (id: string) => void;
  /** Moves an invoice to another billing week (`PATCH /invoices/{id}`, D26). Rejects with the API's
   * problem on a refusal — a 409 names the invoice already holding the week. */
  onMoveWeek?: (id: string, weekEnd: string) => Promise<void>;
}

const STATUS_LABELS: Record<InvoiceListItem["status"], string> = {
  imported: "Imported",
  quarantined: "Quarantined",
};

/** Every whitespace-separated term must appear in the row's invoice number, either date range,
 * country, status, or total — so "999217 aug" or "ca quarantined" narrow, never widen. */
function matchesQuery(row: InvoiceListItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    row.invoiceNumber,
    row.periodStart,
    row.periodEnd,
    row.billingWeekEnd,
    row.currency === "CAD" ? "ca canada cad" : "us usa usd",
    row.status,
    formatMoneyGrouped(row.grandTotal, row.currency),
    row.grandTotal.toFixed(2),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.title;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * A8.2's history list (T-42): invoice number, period, total, status,
 * imported-at. Lives on the same `/import` route the sidebar already links
 * to, so a quarantined invoice is reachable from the sidebar with no
 * re-upload — clicking its row reopens `QuarantineScreen` via
 * `GET /invoices/{id}`. An imported row isn't clickable here; there's
 * nothing this screen would reopen for it (Overview/Transactions already
 * cover it).
 *
 * T-64: an imported row also says which billing week it belongs to, carries
 * the amber note when BVD's printed range is not the range the transactions
 * ran ("Printed Aug 1 – Sep 9; transactions Sep 3 – Sep 10" — a note, never a
 * block), and a "Belongs to week ending" control for moving it to another week.
 */
export default function ImportHistory({
  rows,
  loading = false,
  onReopenQuarantined,
  onMoveWeek,
}: ImportHistoryProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const visible = rows.filter((row) => matchesQuery(row, query));

  const move = (row: InvoiceListItem) => {
    const target = drafts[row.id];
    if (!onMoveWeek || !target) return;
    setMovingId(row.id);
    setErrors((current) => {
      const { [row.id]: _cleared, ...rest } = current;
      return rest;
    });
    onMoveWeek(row.id, target)
      .then(() =>
        setDrafts((current) => {
          const { [row.id]: _moved, ...rest } = current;
          return rest;
        }),
      )
      .catch((err: unknown) => setErrors((current) => ({ ...current, [row.id]: messageOf(err) })))
      .finally(() => setMovingId(null));
  };

  return (
    <div className="panel-card import-panel import-history" data-testid="import-history">
      <div className="import-panel-head import-history-head-bar">
        <div>
          <h2 className="import-panel-title">Import history</h2>
          <p className="import-panel-sub">Move an invoice if it landed in the wrong billing week</p>
        </div>
        <input
          type="search"
          className="input import-history-search"
          placeholder="Search invoice #, date, US/CA, status…"
          aria-label="Search import history"
          data-testid="history-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <EmptyState title="Loading history…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No invoices imported yet" />
      ) : visible.length === 0 ? (
        <EmptyState title="No invoice matches" detail={`Nothing in the import history matches "${query.trim()}".`} />
      ) : (
        <div className="import-history-table">
          <div className="import-history-row import-history-head">
            <span>Invoice #</span>
            <span>Period</span>
            <span className="num">Total</span>
            <span>Status</span>
            <span>Imported</span>
            <span>Belongs to week ending</span>
          </div>
          {visible.map((row) => {
            const reopenable = row.status === "quarantined";
            const imported = row.status === "imported";
            const draft = drafts[row.id] ?? row.billingWeekEnd;
            const error = errors[row.id];
            return (
              <div key={row.id} className="import-history-entry">
                <div
                  className={`import-history-row${reopenable ? " import-history-row-clickable" : ""}`}
                  data-testid={`import-history-row-${row.id}`}
                  role={reopenable ? "button" : undefined}
                  tabIndex={reopenable ? 0 : undefined}
                  onClick={reopenable ? () => onReopenQuarantined(row.id) : undefined}
                  onKeyDown={
                    reopenable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") onReopenQuarantined(row.id);
                        }
                      : undefined
                  }
                >
                  <span className="import-history-invoice">
                    <CodeBadge code={row.currency === "CAD" ? "CA" : "US"} small />
                    <span className="mono">{row.invoiceNumber}</span>
                  </span>
                  <span className="import-history-period">
                    <strong>
                      {row.periodStart} – {row.periodEnd}
                    </strong>
                    {imported && row.datesDiffer && (
                      <span className="import-history-note" data-testid={`dates-differ-note-${row.id}`}>
                        ⚠ {formatDatesDifferNote({ printedStart: row.periodStart, printedEnd: row.periodEnd, actualStart: row.actualStart, actualEnd: row.actualEnd })}
                      </span>
                    )}
                  </span>
                  <span className="num import-history-total">{formatMoneyGrouped(row.grandTotal, row.currency)}</span>
                  <span className={`import-history-status import-history-status-${row.status}`}>
                    {STATUS_LABELS[row.status]}
                  </span>
                  <span className="muted">{formatImportedAt(row.importedAt)}</span>
                  <span className="import-history-week">
                    {imported && (
                      <>
                        <input
                          type="date"
                          aria-label="Belongs to week ending"
                          className="input import-history-week-input"
                          value={draft}
                          disabled={!onMoveWeek || movingId === row.id}
                          onChange={(e) => setDrafts((current) => ({ ...current, [row.id]: e.target.value }))}
                        />
                        {onMoveWeek && (
                          <button
                            type="button"
                            className="import-history-move"
                            disabled={movingId === row.id || draft === "" || draft === row.billingWeekEnd}
                            onClick={() => move(row)}
                          >
                            Move
                          </button>
                        )}
                        {error && (
                          <span className="import-history-error" role="alert" data-testid={`week-error-${row.id}`}>
                            {error}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
