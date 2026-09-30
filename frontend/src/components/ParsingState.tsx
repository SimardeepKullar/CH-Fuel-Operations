import Corners from "./Corners";

interface ParsingStateProps {
  fileName: string;
  /** `null` until known — a PDF has no cheap client-side page count, so it
   * stays `null` for the whole upload and the bar renders alone. */
  rowCount: number | null;
}

/**
 * A8.2 state 1 (T-42 step 42.1): file name, progress, row count.
 * `POST /invoices/import` parses, reconciles and writes in one call (T-28) —
 * there is no server-side progress channel to report against, so "progress"
 * here is an honest indeterminate bar rather than a fabricated percentage.
 * The row count comes from counting newlines in the CSV's own text while it
 * is read client-side, in parallel with the request already in flight.
 */
export default function ParsingState({ fileName, rowCount }: ParsingStateProps) {
  return (
    <div className="panel-card blueprint import-parsing" data-testid="parsing-state">
      <Corners />
      <div className="import-parsing-file">{fileName}</div>
      <div className="import-parsing-bar">
        <div className="import-parsing-bar-fill" />
      </div>
      <div className="import-parsing-status">{rowCount === null ? "Parsing…" : `Parsing… ${rowCount} rows read`}</div>
    </div>
  );
}
