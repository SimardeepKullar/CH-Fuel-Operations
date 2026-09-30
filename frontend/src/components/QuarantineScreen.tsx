"use client";

import Corners from "./Corners";

export interface QuarantineRejection {
  lineNumber: number;
  authCode: string | null;
  code: string;
  message: string;
}

interface QuarantineScreenProps {
  invoiceNumber: string;
  rejections: QuarantineRejection[];
  /** Omitted for a screen reached straight off an upload, where there's
   * nowhere else on this page to go back to. */
  onDismiss?: () => void;
}

const CODE_LABELS: Record<string, string> = {
  AMOUNT_IMBALANCE: "Amount imbalance",
  GALLONS_IMBALANCE: "Gallons imbalance",
  GRAND_TOTAL_IMBALANCE: "Grand total imbalance",
  UNKNOWN_CARD: "Unknown card",
  UNKNOWN_TRUCK_UNIT: "Unknown truck unit",
  SCHEMA_ERROR: "Schema error",
  NUMERIC_PARSE_ERROR: "Numeric parse error",
  UNMAPPED_PRODUCT: "Unmapped product code",
};

function codeLabel(code: string): string {
  return CODE_LABELS[code] ?? code;
}

/**
 * A8.2 state 3 (T-42 step 42.2): reconciliation failed. A full screen, not a
 * toast — the failing code(s), expected vs parsed (already carried in each
 * rejection's own `message`, the same shape stored in `invoice_rejections`
 * and returned by `GET /invoices/{id}`, T-28/T-34), and the offending rows.
 *
 * The "nothing was written" statement is unconditionally true here: an
 * invoice with any rejection at all never gets fuel_stops/express_charges
 * rows (importInvoice.ts's own invariant) — true whether this screen renders
 * straight off an upload or is reopened later from history.
 */
export default function QuarantineScreen({ invoiceNumber, rejections, onDismiss }: QuarantineScreenProps) {
  return (
    <div className="import-quarantine" data-testid="quarantine-screen">
      <Corners />
      <div className="import-quarantine-title">Quarantined — invoice {invoiceNumber}</div>
      <p className="import-quarantine-statement" data-testid="quarantine-nothing-written">
        Nothing was written. No fuel stops, express charges or totals exist for this invoice — fix the file, or
        report the issue to BVD, then re-upload.
      </p>

      <div className="import-quarantine-table">
        <div className="import-quarantine-row import-quarantine-head">
          <span>Code</span>
          <span>Row</span>
          <span>Auth code</span>
          <span>Expected vs. parsed</span>
        </div>
        {rejections.map((r, i) => (
          <div className="import-quarantine-row" key={`${r.code}-${r.lineNumber}-${i}`}>
            <span className="import-quarantine-code">{codeLabel(r.code)}</span>
            <span className="num mono">{r.lineNumber || "—"}</span>
            <span className="mono">{r.authCode ?? "—"}</span>
            <span className="import-quarantine-detail">{r.message}</span>
          </div>
        ))}
      </div>

      {onDismiss && (
        <button className="btn btn-ghost" onClick={onDismiss} data-testid="quarantine-back">
          Back to history
        </button>
      )}
    </div>
  );
}
