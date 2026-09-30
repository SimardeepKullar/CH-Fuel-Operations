"use client";

import type { InvoiceListItem } from "@ch/core/api/routes/invoices";
import { formatMoneyUsd } from "../lib/formatMoney";
import Corners from "./Corners";
import EmptyState from "./EmptyState";

interface ImportHistoryProps {
  rows: InvoiceListItem[];
  loading?: boolean;
  onReopenQuarantined: (id: string) => void;
}

const STATUS_LABELS: Record<InvoiceListItem["status"], string> = {
  imported: "Imported",
  quarantined: "Quarantined",
};

/**
 * A8.2's history list (T-42): invoice number, period, total, status,
 * imported-at. Lives on the same `/import` route the sidebar already links
 * to, so a quarantined invoice is reachable from the sidebar with no
 * re-upload — clicking its row reopens `QuarantineScreen` via
 * `GET /invoices/{id}`. An imported row isn't clickable here; there's
 * nothing this screen would reopen for it (Overview/Transactions already
 * cover it).
 */
export default function ImportHistory({ rows, loading = false, onReopenQuarantined }: ImportHistoryProps) {
  return (
    <div className="panel-card blueprint import-history" data-testid="import-history">
      <Corners />
      <div className="panel-card-header">
        <span className="panel-card-title">Import history</span>
      </div>

      {loading ? (
        <EmptyState title="Loading history…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No invoices imported yet" />
      ) : (
        <div className="import-history-table">
          <div className="import-history-row import-history-head">
            <span>Invoice #</span>
            <span>Period</span>
            <span className="num">Total</span>
            <span>Status</span>
            <span>Imported</span>
          </div>
          {rows.map((row) => {
            const reopenable = row.status === "quarantined";
            return (
              <div
                key={row.id}
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
                <span className="mono">{row.invoiceNumber}</span>
                <span>
                  {row.periodStart} – {row.periodEnd}
                </span>
                <span className="num">{formatMoneyUsd(row.grandTotalUsd)}</span>
                <span className={`import-history-status import-history-status-${row.status}`}>
                  {STATUS_LABELS[row.status]}
                </span>
                <span className="muted">{new Date(row.importedAt).toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
