import { parse } from "csv-parse/sync";
import { normaliseHeaderCell } from "../ingest/parseBvdCsv.js";
import { DecimalFormatError, toDecimalString } from "./decimal.js";
import type { InvoiceProductType } from "./productCode.js";
import type { InvoiceCurrency } from "../db/types.js";
import { currencyFromCode } from "./currency.js";
import {
  parseExpressRows,
  type ExpressLayout,
  type ExpressRow,
  type RawExpressRow,
} from "./parseExpressRows.js";
import { addIsoDays } from "../ingest/gapReport.js";

/** Why a whole invoice was refused, where the reason is a named rule rather
 * than a malformed shape (T-61). */
export type InvoiceFormatErrorCode =
  /** Two currencies among one invoice's rows — rejected, never split (D24). */
  | "MIXED_CURRENCY"
  /** A CAD invoice arrived as the portal CSV, a shape not yet verified
   * against a real CA export (D30). Import the PDF instead. */
  | "CA_CSV_UNVERIFIED";

export class InvoiceFormatError extends Error {
  readonly code: InvoiceFormatErrorCode | null;
  constructor(message: string, code: InvoiceFormatErrorCode | null = null) {
    super(code ? `${code}: ${message}` : message);
    this.name = "InvoiceFormatError";
    this.code = code;
  }
}


/** Invoice-level metadata. The emailed PDF prints all of it in a header
 * table; the portal CSV carries none of it and opens straight into
 * `Fuel Card Transactions`, so on that path it is reconstructed from the
 * filename and the file's own transaction dates (`synthesizeMetaRow`). */
export interface InvoiceHeader {
  invoiceNumber: string;
  /** ISO date, "2026-09-03". */
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  /** From the rows' `CUR`: one currency per invoice (D24). */
  currency: InvoiceCurrency;
  supplierName: string;
  supplierAddress: string;
  billToName: string;
  billToAddress: string;
}

/** One row of the invoice's printed Grand Totals section, trusted as given —
 * this is the reconciliation target (T-28), never recomputed here. */
export interface PrintedProductTotal {
  /** The label as printed: a product code ("TA"), or a section label
   * ("Manual Transactions", "Express Codes"). */
  productCode: string;
  /** In the invoice's unit. Null when the printed row has no quantity
   * figure (e.g. "S", "Express Codes"). */
  qty: string | null;
  /** FINAL AMOUNT, tax included, in the invoice's currency. */
  amount: string;
  /** BVD's own printed "Disc AMT" for this product code — trusted as given,
   * never recomputed from retail/billed (their internal rounding doesn't
   * reproduce from the 4dp prices this schema stores). Null when the printed
   * row has no Disc Amt figure (e.g. "S", which has no per-unit price to
   * discount off of). */
  discount: string | null;
  /** PRE TAX AMT; null on a row printing only a final amount ("S"). */
  preTaxAmount: string | null;
  /** The tax columns as printed — "0.00" on a row that prints none. */
  hst: string;
  gst: string;
  pst: string;
  qst: string;
}

export interface PrintedTotals {
  products: PrintedProductTotal[];
  /** The invoice's own printed "Grand Total" row — the sums BVD printed, not
   * ones this parser computed. Its pre-tax and tax columns cover the priced
   * products only; Scale, Manual and Express print a final amount alone
   * (T-61). */
  grandTotalRow: PrintedProductTotal;
  /** `grandTotalRow.amount`, the figure the invoice is reconciled to. */
  grandTotal: string;
}

export type InvoiceLineRejectionCode =
  | "SCHEMA_ERROR"
  | "NUMERIC_PARSE_ERROR"
  | "UNMAPPED_PRODUCT"
  /** `CUR` is neither `US` nor `CN` (D24) — never defaulted. */
  | "UNKNOWN_CURRENCY";

export interface InvoiceLineRejection {
  lineNumber: number;
  authCode: string | null;
  code: InvoiceLineRejectionCode;
  message: string;
  /** The row's raw Prod value regardless of rejection code, mirroring v1's
   * ValidationRejection.rawProduct — lets a report list unmapped codes
   * without re-parsing the message string. */
  rawProduct: string;
}

/** One product line, straight off the sheet and past validation. Numeric
 * fields are decimal-safe strings (never `number`) at their column's exact
 * precision — 2dp for quantities and money, 4dp for per-unit prices — in the
 * line's own currency and unit, as printed (D25). */
export interface ValidatedInvoiceLine {
  lineNumber: number;
  /** The full auth code as printed, e.g. "A900000001-TA". */
  authCode: string;
  /** The auth code with its trailing "-<PROD>" suffix stripped — what a fuel
   * stop groups on (§A5, groupByAuthCode.ts). */
  baseAuthCode: string;
  cardNumber: string;
  driverNameRaw: string;
  unitRaw: string;
  /** ISO-ish timestamp, "2026-09-09T00:41:38". */
  occurredAt: string;
  siteNumber: string;
  stationNameRaw: string;
  stationCity: string;
  stationState: string;
  rawProductCode: string;
  productType: InvoiceProductType;
  currency: InvoiceCurrency;
  /** Litres on a CAD invoice, gallons on a USD one. */
  qty: string;
  retailPerUnit: string;
  /** Tax-inclusive: QTY × Billed ≈ Final AMT (T-61). */
  billedPerUnit: string;
  preTaxAmount: string;
  hst: string;
  gst: string;
  pst: string;
  qst: string;
  discRate: string;
  discount: string;
  /** Final AMT, tax included. */
  amount: string;
}

export type InvoiceLineResult =
  | { ok: true; line: ValidatedInvoiceLine }
  | { ok: false; rejection: InvoiceLineRejection };

/** The unified shape both the CSV path and the PDF fallback produce (D13) —
 * everything downstream is oblivious to which one produced it. */
export interface ParsedInvoice {
  header: InvoiceHeader;
  printedTotals: PrintedTotals;
  lines: ValidatedInvoiceLine[];
  rejections: InvoiceLineRejection[];
  expressRows: ExpressRow[];
}

const FUEL_HEADER = [
  "AUTH CODE", "DRIVER NAME", "UNIT #", "DATE", "SITE #", "SITE NAME",
  "SITE CITY", "PROV/ST", "PROD", "QTY", "RETAIL", "BILLED", "PRE TAX AMT",
  "HST", "GST", "PST", "QST", "DISC RATE", "DISC AMT", "FINAL AMT", "CUR",
] as const;

/**
 * The emailed PDF's Express Codes header — the only export carrying tractor,
 * trailer, driver, CDL and trip columns. Measured against a real invoice.
 */
const EXPRESS_HEADER_PDF = [
  "DATE", "EXP. CODE", "AUTH CODE", "TRACTOR", "TRAILER", "DRIVER NAME/ID",
  "CDL", "TRIP #", "AMOUNT CASHED", "FEE", "TOTAL", "CUR", "PAYEE", "NOTES",
] as const;

/**
 * The portal CSV's Express Codes header. Genuinely nine columns — it omits
 * tractor/trailer/driver/CDL/trip entirely, so a CSV import cannot attribute
 * an express charge to a truck or driver at all.
 */
const EXPRESS_HEADER_CSV = [
  "DATE", "EXPRESS CODE NUMBER", "AUTH CODES",
  "AMOUNT CASHED", "FEE", "TOTAL", "CUR", "PAYEE", "NOTES",
] as const;

const TOTALS_HEADER = [
  "PRODUCT", "QTY", "PRE TAX AMT", "HST", "GST", "PST", "QST", "DISC RATE",
  "DISC AMT", "FINAL AMOUNT", "CUR",
] as const;

const CARD_MARKER_PATTERN = /^Transactions for card\s*#?\s*(\S*)/i;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

function findLabelledValue(metaFields: string[], label: string): string {
  const labelNormalised = label.trim().toUpperCase();
  for (let i = 0; i < metaFields.length; i++) {
    const field = metaFields[i]?.trim().toUpperCase().replace(/:\s*$/, "");
    if (field === labelNormalised) {
      const value = metaFields[i + 1]?.trim();
      if (value) {
        return value;
      }
      throw new InvoiceFormatError(`metadata row: "${label}" has no value`);
    }
  }
  throw new InvoiceFormatError(`metadata row: "${label}" not found`);
}

function assertIsoDate(value: string, label: string): string {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new InvoiceFormatError(`${label}: not an ISO date: "${value}"`);
  }
  return value;
}

function parseHeader(metaRow: string[]): Omit<InvoiceHeader, "currency"> {
  return {
    invoiceNumber: findLabelledValue(metaRow, "Invoice Number"),
    periodStart: assertIsoDate(findLabelledValue(metaRow, "Period Start"), "Period Start"),
    periodEnd: assertIsoDate(findLabelledValue(metaRow, "Period End"), "Period End"),
    invoiceDate: assertIsoDate(findLabelledValue(metaRow, "Invoice Date"), "Invoice Date"),
    dueDate: assertIsoDate(findLabelledValue(metaRow, "Due Date"), "Due Date"),
    supplierName: findLabelledValue(metaRow, "Supplier"),
    supplierAddress: findLabelledValue(metaRow, "Supplier Address"),
    billToName: findLabelledValue(metaRow, "Bill To"),
    billToAddress: findLabelledValue(metaRow, "Bill To Address"),
  };
}

function matchesHeader(record: string[], expected: readonly string[]): boolean {
  const normalised = record.map((cell) => normaliseHeaderCell(cell ?? ""));
  if (normalised.length < expected.length) {
    return false;
  }
  return expected.every((col, i) => normalised[i] === col);
}

function normaliseTimestamp(raw: string): string {
  const match = TIMESTAMP_PATTERN.exec(raw.trim());
  if (!match) {
    throw new InvoiceFormatError(`unrecognised timestamp: "${raw}"`);
  }
  return `${match[1]}T${match[2]}`;
}

/**
 * Validates one fuel-card product line: auth code well-formed, PROD mapped
 * in `productCodes` (v1 §11.1's tripwire, reused — an unmapped code fails
 * the row, never default-maps), and every numeric field decimal-safe at its
 * column's precision. Returns a typed rejection rather than throwing — a row
 * is accepted or rejected, never guessed at.
 */
export function validateProductLine(
  record: string[],
  lineNumber: number,
  cardNumber: string,
  productCodes: ReadonlyMap<string, InvoiceProductType>,
): InvoiceLineResult {
  const authCode = (record[0] ?? "").trim();
  const rawProductCode = (record[8] ?? "").trim().toUpperCase();
  const dashIndex = authCode.lastIndexOf("-");

  if (dashIndex <= 0) {
    return {
      ok: false,
      rejection: {
        lineNumber,
        authCode: authCode || null,
        code: "SCHEMA_ERROR",
        message: `malformed auth code: "${authCode}"`,
        rawProduct: rawProductCode,
      },
    };
  }

  if (!productCodes.has(rawProductCode)) {
    return {
      ok: false,
      rejection: {
        lineNumber,
        authCode,
        code: "UNMAPPED_PRODUCT",
        message: `unmapped product code: "${rawProductCode}"`,
        rawProduct: rawProductCode,
      },
    };
  }

  let occurredAt: string;
  try {
    occurredAt = normaliseTimestamp(record[3] ?? "");
  } catch {
    return {
      ok: false,
      rejection: {
        lineNumber,
        authCode,
        code: "SCHEMA_ERROR",
        message: `unrecognised timestamp: "${record[3] ?? ""}"`,
        rawProduct: rawProductCode,
      },
    };
  }

  const rawCurrency = (record[20] ?? "").trim();
  const currency = currencyFromCode(rawCurrency);
  if (!currency) {
    return {
      ok: false,
      rejection: {
        lineNumber,
        authCode,
        code: "UNKNOWN_CURRENCY",
        message: `unknown currency code: "${rawCurrency}"`,
        rawProduct: rawProductCode,
      },
    };
  }

  let numerics: Pick<
    ValidatedInvoiceLine,
    "qty" | "retailPerUnit" | "billedPerUnit" | "preTaxAmount" | "hst" | "gst" | "pst" | "qst" | "discRate" | "discount" | "amount"
  >;
  try {
    numerics = {
      qty: toDecimalString(record[9] ?? "", 2),
      retailPerUnit: toDecimalString(record[10] ?? "", 4),
      billedPerUnit: toDecimalString(record[11] ?? "", 4),
      preTaxAmount: toDecimalString(record[12] ?? "", 2),
      hst: toDecimalString(record[13] ?? "", 2),
      gst: toDecimalString(record[14] ?? "", 2),
      pst: toDecimalString(record[15] ?? "", 2),
      qst: toDecimalString(record[16] ?? "", 2),
      discRate: toDecimalString(record[17] ?? "", 4),
      discount: toDecimalString(record[18] ?? "", 2),
      amount: toDecimalString(record[19] ?? "", 2),
    };
  } catch (err) {
    const message = err instanceof DecimalFormatError ? err.message : String(err);
    return {
      ok: false,
      rejection: { lineNumber, authCode, code: "NUMERIC_PARSE_ERROR", message, rawProduct: rawProductCode },
    };
  }

  return {
    ok: true,
    line: {
      lineNumber,
      authCode,
      baseAuthCode: authCode.slice(0, dashIndex),
      cardNumber,
      driverNameRaw: (record[1] ?? "").trim(),
      unitRaw: (record[2] ?? "").trim(),
      occurredAt,
      siteNumber: (record[4] ?? "").trim(),
      stationNameRaw: (record[5] ?? "").trim(),
      stationCity: (record[6] ?? "").trim(),
      stationState: (record[7] ?? "").trim(),
      rawProductCode,
      productType: productCodes.get(rawProductCode)!,
      currency,
      ...numerics,
    },
  };
}

function buildPrintedTotals(
  rows: string[][],
  lineNumbers: number[],
): { printedTotals: PrintedTotals; currencies: InvoiceCurrency[] } {
  const products: PrintedProductTotal[] = [];
  let grandTotalRow: PrintedProductTotal | null = null;
  const currencies: InvoiceCurrency[] = [];

  rows.forEach((record, idx) => {
    const lineNumber = lineNumbers[idx]!;
    const label = (record[0] ?? "").trim();
    const cell = (i: number) => (record[i] ?? "").trim();
    const finalAmountRaw = cell(9);

    if (finalAmountRaw === "") {
      throw new InvoiceFormatError(`line ${lineNumber}: totals row "${label}" has no final amount`);
    }
    if (cell(10) !== "") {
      const currency = currencyFromCode(cell(10));
      if (!currency) {
        throw new InvoiceFormatError(`line ${lineNumber}: totals row "${label}": unknown currency code "${cell(10)}"`);
      }
      currencies.push(currency);
    }

    const optional = (i: number) => (cell(i) === "" ? null : toDecimalString(cell(i), 2));
    let row: PrintedProductTotal;
    try {
      row = {
        productCode: label,
        qty: optional(1),
        amount: toDecimalString(finalAmountRaw, 2),
        discount: optional(8),
        preTaxAmount: optional(2),
        hst: optional(3) ?? "0.00",
        gst: optional(4) ?? "0.00",
        pst: optional(5) ?? "0.00",
        qst: optional(6) ?? "0.00",
      };
    } catch (err) {
      const message = err instanceof DecimalFormatError ? err.message : String(err);
      throw new InvoiceFormatError(`line ${lineNumber}: totals row "${label}": ${message}`);
    }

    if (label === "Grand Total") {
      grandTotalRow = row;
      return;
    }
    products.push(row);
  });

  if (grandTotalRow === null) {
    throw new InvoiceFormatError('missing "Grand Total" row in the Grand Totals section');
  }
  const grand: PrintedProductTotal = grandTotalRow;

  return { printedTotals: { products, grandTotalRow: grand, grandTotal: grand.amount }, currencies };
}

/**
 * The invoice's one currency, from every `CUR` it printed (D24): accepted
 * lines, express rows and totals rows. Lines rejected for an unknown code
 * are already quarantined and do not vote. Two known currencies reject the
 * invoice whole — never split.
 */
function invoiceCurrency(printed: readonly InvoiceCurrency[]): InvoiceCurrency {
  const currencies = new Set(printed);
  if (currencies.size > 1) {
    throw new InvoiceFormatError(
      `rows print more than one currency (${[...currencies].sort().join(", ")}); an invoice is single-currency`,
      "MIXED_CURRENCY",
    );
  }
  const [only] = currencies;
  if (!only) {
    throw new InvoiceFormatError("no row prints a recognised currency code (US or CN)");
  }
  return only;
}

/**
 * Parses already-split CSV records into a full invoice: header, printed
 * totals, product lines (accepted and rejected), and express rows. Pure — no
 * database, no HTTP, no clock, no I/O.
 *
 * This is the shared core between both of BVD's exports (D13):
 * `parseInvoicePdf` reconstructs the same record shape from PDF text and
 * calls this function too, which is what guarantees identical output.
 *
 * Rejects (throws) on a header, section-header, or totals shape that does
 * not match — it never coerces a differently-shaped invoice into this one.
 */
export function parseInvoiceRecords(
  records: string[][],
  productCodes: ReadonlyMap<string, InvoiceProductType>,
): ParsedInvoice {
  const metaRow = records[0];
  if (!metaRow) {
    throw new InvoiceFormatError("file is empty");
  }
  const headerFields = parseHeader(metaRow);

  // Explicit "awaiting header" states, so a header-shape mismatch is caught
  // exactly where a header is expected and throws (rejected, not coerced) —
  // rather than falling through to per-row data parsing, which would only
  // ever produce a per-row rejection for what is actually a structural
  // problem with the whole section.
  type Mode =
    | "before"
    | "fuel-awaiting-header"
    | "fuel-data"
    | "express-awaiting-header"
    | "express-data"
    | "totals-awaiting-header"
    | "totals-data";
  let mode: Mode = "before";
  let currentCard = "";
  // Set when the express header is matched; the two exports carry genuinely
  // different column sets, so the layout decides how rows are read.
  let expressLayout: ExpressLayout = "csv";

  const lines: ValidatedInvoiceLine[] = [];
  const rejections: InvoiceLineRejection[] = [];
  const rawExpressRows: RawExpressRow[] = [];
  const totalsRows: string[][] = [];
  const totalsLineNumbers: number[] = [];

  for (let i = 1; i < records.length; i++) {
    const record = records[i] ?? [];
    const lineNumber = i + 1;
    const first = (record[0] ?? "").trim();

    if (mode === "before") {
      if (first !== "Fuel Card Transactions") {
        throw new InvoiceFormatError(
          `line ${lineNumber}: expected "Fuel Card Transactions", got: ${JSON.stringify(record)}`,
        );
      }
      mode = "fuel-awaiting-header"; // next non-marker row must be the card marker, then the header
      continue;
    }

    // A new card section can start from either awaiting-header or fuel-data.
    // The two exports word this differently — the CSV writes
    // "Transactions for Card # 9000005", the PDF "Transactions for card"
    // with the number in its own cell — so both are accepted here.
    if ((mode === "fuel-awaiting-header" || mode === "fuel-data") && CARD_MARKER_PATTERN.test(first)) {
      const inline = CARD_MARKER_PATTERN.exec(first)?.[1]?.trim();
      const cardNumber = inline || (record[1] ?? "").trim();
      if (!cardNumber) {
        throw new InvoiceFormatError(`line ${lineNumber}: malformed card section marker: "${first}"`);
      }
      currentCard = cardNumber;
      mode = "fuel-awaiting-header";
      continue;
    }
    if (mode === "fuel-data" && first === "Express Codes") {
      mode = "express-awaiting-header";
      continue;
    }
    // An invoice with zero express charges for the whole file omits the
    // Express Codes section entirely (marker and all) and goes straight
    // from the last card's fuel data into Grand Totals — measured against
    // 11 of 20 real September invoices (T-48). Checked before the generic
    // fuel-data row handling below, which would otherwise misparse this
    // marker as a malformed product line; the Grand Totals section still
    // prints its own "Express Codes" total row (amount 0), which is why
    // this transition matters — without it, fuel-data mode is still active
    // when that row is reached and its matching text is misread as the
    // section marker instead.
    if (mode === "fuel-data" && first === "Grand Totals") {
      mode = "totals-awaiting-header";
      continue;
    }
    if (mode === "express-data" && first === "Grand Totals") {
      mode = "totals-awaiting-header";
      continue;
    }

    if (mode === "fuel-awaiting-header") {
      if (!matchesHeader(record, FUEL_HEADER)) {
        throw new InvoiceFormatError(
          `line ${lineNumber}: unexpected fuel section header shape: ${JSON.stringify(record)}`,
        );
      }
      mode = "fuel-data";
      continue;
    }
    if (mode === "fuel-data") {
      if (first === "") {
        continue; // Transaction/Card Subtotal, Fuel Totals, Sub Total rows
      }
      const result = validateProductLine(record, lineNumber, currentCard, productCodes);
      if (result.ok) {
        lines.push(result.line);
      } else {
        rejections.push(result.rejection);
      }
      continue;
    }

    if (mode === "express-awaiting-header") {
      if (matchesHeader(record, EXPRESS_HEADER_PDF)) {
        expressLayout = "pdf";
      } else if (matchesHeader(record, EXPRESS_HEADER_CSV)) {
        expressLayout = "csv";
      } else {
        throw new InvoiceFormatError(
          `line ${lineNumber}: unexpected express section header shape: ${JSON.stringify(record)}`,
        );
      }
      mode = "express-data";
      continue;
    }
    if (mode === "express-data") {
      rawExpressRows.push({ record, lineNumber });
      continue;
    }

    if (mode === "totals-awaiting-header") {
      if (!matchesHeader(record, TOTALS_HEADER)) {
        throw new InvoiceFormatError(
          `line ${lineNumber}: unexpected totals section header shape: ${JSON.stringify(record)}`,
        );
      }
      mode = "totals-data";
      continue;
    }
    if (mode === "totals-data") {
      totalsRows.push(record);
      totalsLineNumbers.push(lineNumber);
      continue;
    }

    throw new InvoiceFormatError(`line ${lineNumber}: unexpected content: ${JSON.stringify(record)}`);
  }

  const expressRows = parseExpressRows(rawExpressRows, expressLayout);
  const { printedTotals, currencies } = buildPrintedTotals(totalsRows, totalsLineNumbers);
  const currency = invoiceCurrency([
    ...lines.map((l) => l.currency),
    ...expressRows.map((r) => r.currency),
    ...currencies,
  ]);
  const header: InvoiceHeader = { ...headerFields, currency };

  return { header, printedTotals, lines, rejections, expressRows };
}

/** This system bills one supplier to one customer (CLAUDE.md), and the CSV
 * export names neither. Taken from the emailed PDF's own header blocks. */
const SUPPLIER_NAME = "BVD Petroleum";
const SUPPLIER_ADDRESS = "130 Delta Park Blvd, Brampton, ON L6T 5E7";
const BILL_TO_NAME = "2043733 ONTARIO INC.";
const BILL_TO_ADDRESS = "5 MATAGAMI STREET, BRAMPTON, ON, Canada, L6Y 0M9";

const DATE_TOKEN_PATTERN = /^(\d{4}-\d{2}-\d{2})/;

/**
 * The invoice number appears nowhere inside the CSV export — not in a header
 * block, not on a data row — so the filename it arrived under is the only
 * source. BVD names them `invoice_999210.csv`; a bare `999210.csv` works too.
 */
function invoiceNumberFromFilename(sourceFilename: string): string {
  const base = sourceFilename
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/^invoice[_-]?/i, "");
  if (!/^\d+$/.test(base)) {
    throw new InvoiceFormatError(
      `cannot determine an invoice number from filename "${sourceFilename}"`,
    );
  }
  return base;
}

/** Earliest and latest transaction date anywhere in the file. Scans every
 * cell rather than a fixed column so it works before the section layout has
 * been established. */
function scanPeriod(records: readonly string[][]): { start: string; end: string } {
  let start: string | null = null;
  let end: string | null = null;
  for (const record of records) {
    for (const cell of record) {
      const match = DATE_TOKEN_PATTERN.exec((cell ?? "").trim());
      if (!match) continue;
      const date = match[1]!;
      if (start === null || date < start) start = date;
      if (end === null || date > end) end = date;
    }
  }
  if (start === null || end === null) {
    throw new InvoiceFormatError("no transaction dates found to derive the invoice period");
  }
  return { start, end };
}

/**
 * Rebuilds the header block the CSV export does not carry, in the labelled
 * shape `parseHeader` reads. Every value is derived from the file itself or
 * its name — nothing here is invented:
 *
 * - invoice number: the filename (see `invoiceNumberFromFilename`)
 * - period: the earliest and latest transaction timestamps in the file
 * - invoice/due date: period end +1 and +2 days. Confirmed against the same
 *   invoice's PDF, which prints these dates explicitly (999210: period ends
 *   09-09, invoice date 09-10, due 09-11).
 *
 * The emailed PDF states all of these outright, which is why it is the fuller
 * source and this reconstruction is only needed on the CSV path.
 */
function synthesizeMetaRow(sourceFilename: string, records: readonly string[][]): string[] {
  const { start, end } = scanPeriod(records);
  return [
    "Invoice Number:", invoiceNumberFromFilename(sourceFilename),
    "Period Start:", start,
    "Period End:", end,
    "Invoice Date:", addIsoDays(end, 1),
    "Due Date:", addIsoDays(end, 2),
    "Supplier:", SUPPLIER_NAME,
    "Supplier Address:", SUPPLIER_ADDRESS,
    "Bill To:", BILL_TO_NAME,
    "Bill To Address:", BILL_TO_ADDRESS,
  ];
}

/**
 * Parses a BVD invoice CSV export — the portal download. It opens straight
 * into `Fuel Card Transactions` with no header block of any kind, so the
 * invoice metadata is reconstructed here (`synthesizeMetaRow`) before the
 * shared core runs.
 *
 * This export is a **subset** of the emailed PDF (`parseInvoicePdf`): it
 * carries no invoice metadata and no tractor/trailer/driver/CDL/trip columns
 * on express rows. Prefer the PDF when both are available.
 */
export function parseInvoiceCsv(
  input: Buffer | string,
  productCodes: ReadonlyMap<string, InvoiceProductType>,
  sourceFilename: string,
): ParsedInvoice {
  const records: string[][] = parse(input, {
    relax_column_count: true,
    skip_empty_lines: true,
  });
  const metaRow = synthesizeMetaRow(sourceFilename, records);
  const parsed = parseInvoiceRecords([metaRow, ...records], productCodes);
  if (parsed.header.currency !== "USD") {
    throw new InvoiceFormatError(
      "a CAD invoice imports from the emailed PDF only, until a real CA portal CSV has been seen",
      "CA_CSV_UNVERIFIED",
    );
  }
  return parsed;
}
