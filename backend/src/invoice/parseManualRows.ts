import type { InvoiceCurrency } from "../db/types.js";
import { currencyFromCode } from "./currency.js";
import { DecimalFormatError, toCents, toDecimalString } from "./decimal.js";

export class ManualRowFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualRowFormatError";
  }
}

/**
 * One row of an invoice's Manual Transactions section (T-128): an amount BVD
 * entered by hand rather than through a card or an express code. The one
 * seen so far is a credit (real invoice 854048, −11,400.00) that nets an
 * advance out of the grand total. Money is as printed, in the invoice's
 * currency, and may be negative (D25).
 */
export interface ManualRow {
  lineNumber: number;
  /** Naive local timestamp as printed, "YYYY-MM-DDTHH:MM:SS". */
  occurredAt: string;
  amount: string;
  fee: string;
  /** amount + fee, checked exactly. The figure that ties to the printed
   * "Manual" total. */
  total: string;
  currency: InvoiceCurrency;
  /** Verbatim — BVD's own words for what the row is. */
  description: string | null;
}

export interface RawManualRow {
  /** DATE, AMOUNT, FEE, TOTAL AMOUNT, CUR, DESCRIPTION. */
  record: string[];
  lineNumber: number;
}

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

function decimalField(raw: string | undefined, lineNumber: number, label: string): string {
  try {
    return toDecimalString(raw ?? "", 2);
  } catch (err) {
    const message = err instanceof DecimalFormatError ? err.message : String(err);
    throw new ManualRowFormatError(`line ${lineNumber}: ${label}: ${message}`);
  }
}

/**
 * Parses an invoice's Manual Transactions rows. Every row must satisfy
 * amount + fee = total exactly, in cents; a row that does not was misread,
 * and throws. Pure — no database, no HTTP, no clock, no I/O.
 */
export function parseManualRows(rows: readonly RawManualRow[]): ManualRow[] {
  return rows.map(({ record, lineNumber }) => {
    const match = TIMESTAMP_PATTERN.exec((record[0] ?? "").trim());
    if (!match) {
      throw new ManualRowFormatError(`line ${lineNumber}: unrecognised timestamp: "${record[0] ?? ""}"`);
    }
    const amount = decimalField(record[1], lineNumber, "amount");
    const fee = decimalField(record[2], lineNumber, "fee");
    const total = decimalField(record[3], lineNumber, "total");
    const rawCurrency = (record[4] ?? "").trim();
    const currency = currencyFromCode(rawCurrency);
    if (!currency) {
      throw new ManualRowFormatError(`line ${lineNumber}: unknown currency code: "${rawCurrency}"`);
    }
    if (toCents(amount) + toCents(fee) !== toCents(total)) {
      throw new ManualRowFormatError(`line ${lineNumber}: amount ${amount} + fee ${fee} != total ${total}`);
    }
    const description = (record[5] ?? "").trim();
    return {
      lineNumber,
      occurredAt: `${match[1]}T${match[2]}`,
      amount,
      fee,
      total,
      currency,
      description: description === "" ? null : description,
    };
  });
}
