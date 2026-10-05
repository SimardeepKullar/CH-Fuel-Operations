"use client";

import { useEffect, useRef, useState } from "react";
import type { InvoiceListItem } from "@ch/core/api/routes/invoices";
import { ApiError } from "../lib/api";
import { formatMoney } from "../lib/formatMoney";
import { SIDE_FLAGS, formatDatesDifferNote } from "../lib/weeks";
import Corners from "./Corners";
import EmptyState from "./EmptyState";

interface ImportHistoryProps {
  rows: InvoiceListItem[];
  loading?: boolean;
  onReopenQuarantined: (id: string) => void;
  /** The invoice a strip chip pointed at (`/import?invoice=`) — highlighted and scrolled to. */
  selectedId?: string | null;
  /** Moves an invoice to another billing week (`PATCH /invoices/{id}`, D26). Rejects with the API's
   * problem on a refusal — a 409 names the invoice already holding the week. */
  onMoveWeek?: (id: string, weekEnd: string) => Promise<void>;
}

const STATUS_LABELS: Record<InvoiceListItem["status"], string> = {
  imported: "Imported",
  quarantined: "Quarantined",
};

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
  selectedId = null,
  onMoveWeek,
}: ImportHistoryProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "center" });
  }, [selectedId, rows]);

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
            const selected = row.id === selectedId;
            const draft = drafts[row.id] ?? row.billingWeekEnd;
            const error = errors[row.id];
            return (
              <div
                key={row.id}
                className={`import-history-entry${selected ? " import-history-entry-selected" : ""}`}
                ref={selected ? selectedRef : undefined}
                aria-current={selected ? "true" : undefined}
              >
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
                  <span className="mono">
                    {SIDE_FLAGS[row.currency]} {row.invoiceNumber}
                  </span>
                  <span>
                    {row.periodStart} – {row.periodEnd}
                  </span>
                  <span className="num">{formatMoney(row.grandTotal, row.currency)}</span>
                  <span className={`import-history-status import-history-status-${row.status}`}>
                    {STATUS_LABELS[row.status]}
                  </span>
                  <span className="muted">{new Date(row.importedAt).toLocaleString()}</span>
                </div>

                {row.status === "imported" && (
                  <div className="import-history-sub">
                    {row.datesDiffer && (
                      <span className="import-history-note" data-testid={`dates-differ-note-${row.id}`}>
                        ⚠ {formatDatesDifferNote({ printedStart: row.periodStart, printedEnd: row.periodEnd, actualStart: row.actualStart, actualEnd: row.actualEnd })}
                      </span>
                    )}
                    <span className="import-history-week">
                      <label>
                        Belongs to week ending{" "}
                        <input
                          type="date"
                          className="input import-history-week-input"
                          value={draft}
                          disabled={!onMoveWeek || movingId === row.id}
                          onChange={(e) => setDrafts((current) => ({ ...current, [row.id]: e.target.value }))}
                        />
                      </label>
                      {onMoveWeek && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          disabled={movingId === row.id || draft === "" || draft === row.billingWeekEnd}
                          onClick={() => move(row)}
                        >
                          Move
                        </button>
                      )}
                    </span>
                    {error && (
                      <span className="import-history-error" role="alert" data-testid={`week-error-${row.id}`}>
                        {error}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
