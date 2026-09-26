import { DecimalFormatError, toDecimalString } from "./decimal.js";

export class ExpressRowFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressRowFormatError";
  }
}

/**
 * Which of BVD's two exports an Express Codes section came from. They are
 * genuinely different shapes, not two renderings of one shape, so each is
 * described here truthfully rather than one being padded to look like the
 * other:
 *
 * - `pdf` — the emailed invoice, 14 columns, the only export carrying
 *   `TRACTOR`/`TRAILER`/`DRIVER NAME/ID`/`CDL`/`TRIP #`.
 * - `csv` — the portal download, 9 columns. It omits all five of those, so
 *   a CSV import can never attribute an express charge to a truck or a
 *   driver. That is a property of the file, not a resolution failure.
 */
export type ExpressLayout = "pdf" | "csv";

interface ColumnMap {
  occurredAt: number;
  expressCode: number;
  authCodeRef: number;
  unitRaw: number | null;
  trailerRaw: number | null;
  driverNameRaw: number | null;
  cdlRaw: number | null;
  tripNumberRaw: number | null;
  amountUsd: number;
  feeUsd: number;
  totalUsd: number;
  payee: number;
  note: number;
}

const COLUMNS: Record<ExpressLayout, ColumnMap> = {
  pdf: {
    occurredAt: 0, expressCode: 1, authCodeRef: 2,
    unitRaw: 3, trailerRaw: 4, driverNameRaw: 5, cdlRaw: 6, tripNumberRaw: 7,
    amountUsd: 8, feeUsd: 9, totalUsd: 10, payee: 12, note: 13,
  },
  csv: {
    occurredAt: 0, expressCode: 1, authCodeRef: 2,
    unitRaw: null, trailerRaw: null, driverNameRaw: null, cdlRaw: null, tripNumberRaw: null,
    amountUsd: 3, feeUsd: 4, totalUsd: 5, payee: 7, note: 8,
  },
};

/** One row on the invoice's Express Codes section (a lumper fee, a repair, etc). */
export interface ExpressRow {
  lineNumber: number;
  /** ISO-ish timestamp, "2026-09-08T18:48:50". */
  occurredAt: string;
  expressCode: string;
  /** BVD's internal reference for this express authorisation. Measured
   * against a real invoice: these are `E`-prefixed and share no namespace
   * with a fuel stop's `A`-prefixed auth code, so they cannot be joined back
   * to `fuel_stops` to inherit a truck or driver. */
  authCodeRef: string;
  /** Tractor text as entered. Always null from the `csv` layout, which has
   * no such column at all. On a real PDF invoice every express row has carried
   * one so far — a null here from the PDF path would be genuinely blank. */
  unitRaw: string | null;
  trailerRaw: string | null;
  /** Free-text driver name or id. Genuinely blank on some real rows even in
   * the PDF export — a real state, not a defect. */
  driverNameRaw: string | null;
  cdlRaw: string | null;
  tripNumberRaw: string | null;
  amountUsd: string;
  feeUsd: string;
  totalUsd: string;
  payee: string | null;
  note: string | null;
  /** Not present as a distinct column on any BVD export seen so far — always
   * null from this parser. Reserved for a future categorisation step. */
  category: string | null;
}

export interface RawExpressRow {
  record: string[];
  lineNumber: number;
}

const EXPECTED_FEE_USD = "3.00";
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

function normaliseTimestamp(raw: string, lineNumber: number): string {
  const match = TIMESTAMP_PATTERN.exec(raw.trim());
  if (!match) {
    throw new ExpressRowFormatError(
      `line ${lineNumber}: unrecognised timestamp: "${raw}"`,
    );
  }
  return `${match[1]}T${match[2]}`;
}

function blankToNull(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function optionalColumn(record: string[], index: number | null): string | null {
  return index === null ? null : blankToNull(record[index]);
}

function decimalField(raw: string | undefined, lineNumber: number, label: string): string {
  try {
    return toDecimalString(raw ?? "", 2);
  } catch (err) {
    const message = err instanceof DecimalFormatError ? err.message : String(err);
    throw new ExpressRowFormatError(`line ${lineNumber}: ${label}: ${message}`);
  }
}

/**
 * Parses an invoice's Express Codes section from either export's layout
 * (see `ExpressLayout`). Pure — no database, no HTTP, no clock, no I/O.
 *
 * Every row carries a flat $3.00 fee (§A5) — asserted explicitly here, never
 * assumed. A row whose fee differs throws rather than passing through: that
 * means the invoice's own flat-fee invariant has changed, not that this one
 * row is merely malformed.
 */
export function parseExpressRows(
  rows: readonly RawExpressRow[],
  layout: ExpressLayout,
): ExpressRow[] {
  const columns = COLUMNS[layout];

  return rows.map(({ record, lineNumber }) => {
    const occurredAt = normaliseTimestamp(record[columns.occurredAt] ?? "", lineNumber);
    const amountUsd = decimalField(record[columns.amountUsd], lineNumber, "amount");
    const feeUsd = decimalField(record[columns.feeUsd], lineNumber, "fee");
    const totalUsd = decimalField(record[columns.totalUsd], lineNumber, "total");

    if (feeUsd !== EXPECTED_FEE_USD) {
      throw new ExpressRowFormatError(
        `line ${lineNumber}: express fee ${feeUsd} != flat fee ${EXPECTED_FEE_USD}`,
      );
    }

    return {
      lineNumber,
      occurredAt,
      expressCode: (record[columns.expressCode] ?? "").trim(),
      authCodeRef: (record[columns.authCodeRef] ?? "").trim(),
      unitRaw: optionalColumn(record, columns.unitRaw),
      trailerRaw: optionalColumn(record, columns.trailerRaw),
      driverNameRaw: optionalColumn(record, columns.driverNameRaw),
      cdlRaw: optionalColumn(record, columns.cdlRaw),
      tripNumberRaw: optionalColumn(record, columns.tripNumberRaw),
      amountUsd,
      feeUsd,
      totalUsd,
      payee: blankToNull(record[columns.payee]),
      note: blankToNull(record[columns.note]),
      category: null,
    };
  });
}
