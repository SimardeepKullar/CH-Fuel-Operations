"use client";

import type { ImportReport } from "@ch/core/invoice/report";
import { formatGallons2dp, formatMoneyUsd } from "../lib/formatMoney";
import Corners from "./Corners";

interface ReconciliationPreviewProps {
  report: ImportReport;
  onConfirm: () => void;
}

/**
 * A8.2 state 2 — "reconciliation passed" (T-42 step 42.1): the balance
 * check shown explicitly, per product code exactly as BVD printed it,
 * summing to the invoice's own printed grand total (`report.grandTotalUsd`,
 * trusted as given — never recomputed here, the same rule CLAUDE.md states
 * for `YOUR PRICE`). Always-zero rows (e.g. a fleet that never uses `TF`)
 * are left out of the list — they still make up part of the printed total,
 * they just have nothing to show.
 *
 * `POST /invoices/import` is one-shot (T-28): by the time this screen can
 * render, the write has already happened. "Confirm" therefore acknowledges
 * and moves on rather than firing a second write — stated on screen so it
 * doesn't read as a lie.
 */
export default function ReconciliationPreview({ report, onConfirm }: ReconciliationPreviewProps) {
  const rows = report.productTotals.filter((p) => Number(p.amountUsd) !== 0);

  return (
    <div className="panel-card blueprint import-preview" data-testid="reconciliation-preview">
      <Corners />
      <div className="panel-card-header">
        <span className="panel-card-title">Reconciliation passed</span>
        <span className="panel-card-sub">invoice {report.invoiceNumber}</span>
      </div>

      <div className="import-balance-table">
        <div className="import-balance-row import-balance-head">
          <span>Product code</span>
          <span className="num">Gallons</span>
          <span className="num">Amount</span>
        </div>
        {rows.map((p) => (
          <div className="import-balance-row" key={p.productCode}>
            <span className="mono">{p.productCode}</span>
            <span className="num muted">{p.gallons === null ? "—" : formatGallons2dp(Number(p.gallons))}</span>
            <span className="num">{formatMoneyUsd(Number(p.amountUsd))}</span>
          </div>
        ))}
        <div className="import-balance-row import-balance-total" data-testid="import-balance-total">
          <span>Grand total</span>
          <span />
          <span className="num">{formatMoneyUsd(Number(report.grandTotalUsd))}</span>
        </div>
      </div>

      <p className="import-preview-note">
        This invoice has already been written to the database — Confirm just closes this screen and adds it to
        the history below.
      </p>
      <button className="btn btn-primary" onClick={onConfirm} data-testid="confirm-button">
        Confirm
      </button>
    </div>
  );
}
