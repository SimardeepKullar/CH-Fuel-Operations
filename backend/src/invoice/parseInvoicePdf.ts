import { parseInvoiceRecords, type ParsedInvoice } from "./parseInvoiceCsv.js";
import type { InvoiceProductType } from "./productCode.js";

export class InvoicePdfFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicePdfFormatError";
  }
}

/** pdf-parse's own per-page footer, e.g. "-- 1 of 1 --". */
const PAGE_MARKER_PATTERN = /^-- \d+ of \d+ --$/;
/** BVD's own page footer, repeated on every page. */
const PAGE_FOOTER_PATTERN = /^Page \d+ of \d+ Pages$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}:\d{2}$/;
const NUMERIC = /^-?[\d,]+\.?\d*$/;
const FUEL_AUTH = /^[A-Z]\d+-[A-Z]{1,2}$/;
const EXPRESS_AUTH = /^E\d+$/;
/** A CUR cell's shape: `US`, `CN` — or a code the core will quarantine as
 * UNKNOWN_CURRENCY rather than this reader guessing at it (T-61). */
const CURRENCY_CODE = /^[A-Z]{2}$/;

/** The 11 numeric columns closing a fuel line: QTY, Retail, Billed, Pre Tax
 * AMT, HST, GST, PST, QST, Disc Rate, Disc AMT, Final AMT. */
const FUEL_TRAILING_NUMERICS = 11;

function tokenize(line: string): string[] {
  return line.split(/[\t ]+/).filter((t) => t.length > 0);
}

/** The PDF prints money with thousands separators ("48,450.68") where the CSV
 * does not. Stripped here, at the boundary, rather than loosening the shared
 * decimal validator for every caller. */
function stripGrouping(value: string): string {
  return NUMERIC.test(value) ? value.replace(/,/g, "") : value;
}

/**
 * Extracted text puts every cell of a row on one line, separated by tabs
 * where the layout gap was wide enough and plain spaces where it was not —
 * so the delimiter is unreliable but the column *order* is fixed. Rows are
 * therefore read by anchoring on shapes that cannot be confused (a trailing
 * currency code, a fixed count of numerics, a timestamp) and walking inward,
 * which also absorbs the multi-word driver names and city names that make a
 * naive split ambiguous.
 *
 * Site name and city are the one boundary no token shape marks. A US site
 * name carries the store number ("LOVES #368"), so the `#` token ends it. A
 * CA site name has none ("BVD MISSISSAUGA - SHAWSON", then "MISSISSAUGA"),
 * but the layout gap after it is always wide enough to extract as a tab —
 * on all 60 rows of the real CA invoice — so there the raw line's tab ends
 * it instead.
 */
interface FuelLineCells {
  authCode: string;
  driverName: string;
  unit: string;
  occurredAt: string;
  siteRef: string;
  siteName: string;
  city: string;
  state: string;
  prod: string;
  numerics: string[];
  /** The CUR cell as printed; mapped (or rejected) by the shared core. */
  currency: string;
}

/** Splits the site-name-and-city words of a `#`-less site name at the first
 * tab after the site number, in the raw line. Null when there is no tab to
 * split on — the row is then unparseable rather than guessed at. */
function splitAtTab(rawLine: string, siteRef: string, words: readonly string[]): { siteName: string[]; city: string[] } | null {
  const segments = rawLine.split("\t").map((seg) => tokenize(seg));
  // The segment holding the site number, then the site name's words after
  // it; the site number may close one segment or open the next.
  for (let s = 0; s < segments.length; s++) {
    const at = segments[s]!.lastIndexOf(siteRef);
    if (at === -1) continue;
    const rest = segments[s]!.slice(at + 1);
    const nameWords = rest.length > 0 ? rest : (segments[s + 1] ?? []);
    if (nameWords.length === 0 || nameWords.length >= words.length) {
      return null;
    }
    if (!nameWords.every((w, k) => w === words[k])) {
      return null;
    }
    return { siteName: [...nameWords], city: words.slice(nameWords.length) };
  }
  return null;
}

function readFuelLine(tokens: readonly string[], rawLine: string): FuelLineCells | null {
  let i = tokens.length - 1;
  const currency = (tokens[i] ?? "").toUpperCase();
  if (!CURRENCY_CODE.test(currency)) {
    return null;
  }
  i--;

  const numerics: string[] = [];
  while (i >= 0 && numerics.length < FUEL_TRAILING_NUMERICS && NUMERIC.test(tokens[i]!)) {
    numerics.unshift(tokens[i]!);
    i--;
  }
  if (numerics.length !== FUEL_TRAILING_NUMERICS) {
    return null;
  }

  const prod = tokens[i--] ?? "";
  const state = tokens[i--] ?? "";
  if (!/^[A-Z]{1,2}$/.test(prod) || !/^[A-Z]{2}$/.test(state)) {
    return null;
  }

  // Everything between the timestamp's site number and the state is site
  // name then city. Locate the timestamp from the left: no driver name,
  // unit or auth code looks like a date.
  const dateIndex = tokens.findIndex((t, k) => k > 0 && DATE.test(t));
  if (dateIndex === -1 || dateIndex + 2 > i) {
    return null;
  }
  const date = tokens[dateIndex]!;
  const time = tokens[dateIndex + 1] ?? "";
  const siteRef = tokens[dateIndex + 2] ?? "";
  if (!TIME.test(time)) {
    return null;
  }
  const middle = tokens.slice(dateIndex + 3, i + 1);

  let siteNameWords: string[];
  let cityWords: string[];
  const hashIndex = middle.findLastIndex((t) => t.includes("#"));
  if (hashIndex !== -1) {
    // US: the site name is the token carrying "#" plus the brand word ahead
    // of it; the city is every word after.
    const start = hashIndex > 0 && !NUMERIC.test(middle[hashIndex - 1]!) ? hashIndex - 1 : hashIndex;
    siteNameWords = middle.slice(start, hashIndex + 1);
    cityWords = middle.slice(hashIndex + 1);
  } else {
    const split = splitAtTab(rawLine, siteRef, middle);
    if (!split) {
      return null;
    }
    siteNameWords = split.siteName;
    cityWords = split.city;
  }
  if (cityWords.length === 0) {
    return null;
  }
  i = dateIndex;

  i--;
  const unit = tokens[i--] ?? "";
  const authCode = tokens[0] ?? "";
  const driverName = tokens.slice(1, i + 1).join(" ");
  if (driverName === "") {
    return null;
  }

  return {
    authCode,
    driverName,
    unit,
    occurredAt: `${date} ${time}`,
    siteRef,
    siteName: siteNameWords.join(" "),
    city: cityWords.join(" "),
    state,
    prod,
    numerics: numerics.map(stripGrouping),
    currency,
  };
}

/**
 * The printed Grand Totals block, normalised to the 11 positional columns the
 * shared core reads. Two shapes occur: a full product row, and a sparse row
 * carrying only a final amount ("S 90.50 US"). Any other shape throws rather
 * than being mapped by guesswork, since every column here is money.
 */
function toTotalsRecord(tokens: readonly string[]): string[] | null {
  let label: string;
  let values: string[];
  if (tokens[0] === "Grand" && tokens[1] === "Total") {
    label = "Grand Total";
    values = tokens.slice(2);
  } else if (tokens[0] === "Manual") {
    label = "Manual Transactions"; // the CSV's wording, which reconcile keys on
    values = tokens.slice(1);
  } else if (tokens[0] === "Express") {
    label = "Express Codes";
    values = tokens.slice(1);
  } else if (PRODUCT_CODE_LABELS.has(tokens[0] ?? "")) {
    label = tokens[0]!;
    values = tokens.slice(1);
  } else {
    return null;
  }

  const last = values[values.length - 1] ?? "";
  const currency = CURRENCY_CODE.test(last) ? last : "";
  const figures = (currency ? values.slice(0, -1) : values).map(stripGrouping);

  // QTY through FINAL AMOUNT — nine figures between the label and CUR.
  if (figures.length === 9) {
    return [label, ...figures, currency];
  }
  if (figures.length === 1) {
    // Final amount only — pad the columns this row does not print, so the
    // amount still lands in the FINAL AMOUNT position the core reads.
    return [label, "", "", "", "", "", "", "", "", figures[0]!, currency];
  }
  throw new InvoicePdfFormatError(
    `totals row "${label}" has ${figures.length} figures, expected 9 or 1`,
  );
}

/**
 * Express rows carry five optional text columns (tractor, trailer, driver,
 * CDL, trip) that collapse out of the extracted text when blank, so the same
 * anchor-and-walk approach applies: the money columns and currency code pin
 * the right-hand side, the timestamp and codes pin the left, and whatever
 * text sits between is assigned by position from the left.
 */
/** Payee and notes are free text and can each run to several words
 * ("lumper fees"), so word boundaries cannot separate them — but they are
 * distinct columns, so the layout gap can. Read from the raw line, splitting
 * only on tabs, rather than from the whitespace tokens. */
function readTrailingText(rawLine: string, currency: string): { payee: string; note: string } {
  const separator = new RegExp(`(?:^|[\\t ])${currency}(?=[\\t ]|$)`, "g");
  let lastEnd = -1;
  for (let m = separator.exec(rawLine); m !== null; m = separator.exec(rawLine)) {
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd === -1) {
    return { payee: "", note: "" };
  }
  const parts = rawLine
    .slice(lastEnd)
    .split("\t")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { payee: parts[0] ?? "", note: parts.slice(1).join(" ") };
}

function readExpressLine(tokens: readonly string[], rawLine: string): string[] | null {
  const authIndex = tokens.findIndex((t) => EXPRESS_AUTH.test(t));
  if (authIndex < 1) {
    return null;
  }
  const date = tokens[0] ?? "";
  const time = tokens[1] ?? "";
  if (!DATE.test(date) || !TIME.test(time)) {
    return null;
  }
  const expressCode = tokens[authIndex - 1] ?? "";
  const authCodeRef = tokens[authIndex]!;

  const rest = tokens.slice(authIndex + 1);
  // CUR is the first two-letter code straight after three money cells — a
  // two-letter driver name or note word cannot satisfy both.
  const curIndex = rest.findIndex(
    (t, k) => k >= 3 && CURRENCY_CODE.test(t) && [1, 2, 3].every((back) => NUMERIC.test(rest[k - back]!)),
  );
  if (curIndex === -1) {
    return null;
  }
  const currency = rest[curIndex]!;
  // The three cells before the currency code are amount, fee and total.
  const total = rest[curIndex - 1]!;
  const fee = rest[curIndex - 2]!;
  const amount = rest[curIndex - 3]!;

  // Anything before the money block is the optional tractor/trailer/driver/
  // CDL/trip text. A tractor is a bare number; a driver is not.
  const optional = rest.slice(0, curIndex - 3);
  let tractor = "";
  let driver = "";
  if (optional.length > 0 && NUMERIC.test(optional[0]!)) {
    tractor = optional[0]!;
    driver = optional.slice(1).join(" ");
  } else {
    driver = optional.join(" ");
  }

  const { payee, note } = readTrailingText(rawLine, currency);

  // Canonical 14-column express record (EXPRESS_HEADER_PDF order).
  return [
    `${date} ${time}`, expressCode, authCodeRef,
    tractor, "", driver, "", "",
    stripGrouping(amount), stripGrouping(fee), stripGrouping(total),
    currency, payee, note,
  ];
}

/** Header table: the invoice number followed by four date/time pairs
 * (invoice, period start, period end, due), which extraction splits across
 * their own lines. */
function readHeaderRow(lines: readonly string[]): string[] {
  const headerIndex = lines.findIndex((l) => /^Number\b/.test(l) && /Due Date/.test(l));
  if (headerIndex === -1) {
    throw new InvoicePdfFormatError('could not find the invoice header table ("Number ... Due Date")');
  }

  const tokens: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (/^Client info/i.test(line) || line.startsWith("Fuel Card Transactions")) break;
    tokens.push(...tokenize(line));
  }

  const invoiceNumber = tokens.find((t) => /^\d+$/.test(t) && !DATE.test(t));
  const dates = tokens.filter((t) => DATE.test(t));
  if (!invoiceNumber) {
    throw new InvoicePdfFormatError("no invoice number in the header table");
  }
  if (dates.length < 4) {
    throw new InvoicePdfFormatError(
      `expected 4 dates in the header table (invoice, start, end, due), found ${dates.length}`,
    );
  }

  const [invoiceDate, periodStart, periodEnd, dueDate] = dates;
  return [
    "Invoice Number:", invoiceNumber,
    "Period Start:", periodStart!,
    "Period End:", periodEnd!,
    "Invoice Date:", invoiceDate!,
    "Due Date:", dueDate!,
    "Supplier:", "BVD Petroleum",
    "Supplier Address:", "130 Delta Park Blvd, Brampton, ON L6T 5E7",
    "Bill To:", "2043733 ONTARIO INC.",
    "Bill To Address:", "5 MATAGAMI STREET, BRAMPTON, ON, Canada, L6Y 0M9",
  ];
}

const FUEL_HEADER_RECORD = [
  "Auth Code", "Driver Name", "Unit #", "Date", "Site #", "Site Name",
  "Site City", "Prov/ST", "Prod", "QTY", "Retail", "Billed", "Pre Tax AMT",
  "HST", "GST", "PST", "QST", "Disc Rate", "Disc AMT", "Final AMT", "CUR",
];

const EXPRESS_HEADER_RECORD = [
  "DATE", "EXP. CODE", "AUTH CODE", "TRACTOR", "TRAILER", "DRIVER NAME/ID",
  "CDL", "TRIP #", "AMOUNT CASHED", "FEE", "TOTAL", "CUR", "PAYEE", "NOTES",
];

const TOTALS_HEADER_RECORD = [
  "PRODUCT", "QTY", "PRE TAX AMT", "HST", "GST", "PST", "QST", "DISC RATE",
  "DISC AMT", "FINAL AMOUNT", "CUR",
];

const PRODUCT_CODE_LABELS = new Set(["TA", "TF", "DF", "S", "C", "AD", "O", "L"]);

/**
 * Each table's column header as the PDF prints it. Rows are read by position,
 * so a reordered or renamed column would shift values silently into the
 * wrong field; the printed header is checked instead (T-50). The express
 * header prints "Payee" in mixed case.
 */
interface TableHeader {
  table: "fuel" | "express" | "totals";
  words: readonly string[];
}

const PRINTED_HEADERS: readonly TableHeader[] = [
  { table: "fuel", words: FUEL_HEADER_RECORD.join(" ").split(" ") },
  { table: "express", words: EXPRESS_HEADER_RECORD.map((c) => (c === "PAYEE" ? "Payee" : c)).join(" ").split(" ") },
  { table: "totals", words: TOTALS_HEADER_RECORD.join(" ").split(" ") },
];

/** Around a page break pdf.js can extract the fuel header and the next card
 * heading as one line (seen on 999217); the heading is printed again on its
 * own line, which is the one read. */
const MERGED_CARD_HEADING = /^Transactions for card \S+$/;

/**
 * Whether `tokens` is a printed column header. A line opening with a
 * header's first two words is one, and must then be that header exactly —
 * anything else throws rather than being skipped as a roll-up.
 */
function isColumnHeader(tokens: readonly string[], header: TableHeader): boolean {
  const { words } = header;
  if (tokens[0] !== words[0] || tokens[1] !== words[1]) {
    return false;
  }
  const printed = tokens.slice(0, words.length).join(" ");
  const tail = tokens.slice(words.length).join(" ");
  if (printed !== words.join(" ") || (tail !== "" && !(header.table === "fuel" && MERGED_CARD_HEADING.test(tail)))) {
    throw new InvoicePdfFormatError(
      `the ${header.table} table's column header changed: expected "${words.join(" ")}", found "${tokens.join(" ")}"`,
    );
  }
  return true;
}

function headerFor(table: TableHeader["table"]): TableHeader {
  return PRINTED_HEADERS.find((h) => h.table === table)!;
}

/**
 * Parses the emailed BVD invoice PDF — the **fuller** of BVD's two exports.
 * It is the only one carrying the invoice's own header table (number, period,
 * invoice and due dates) and the only one carrying tractor, trailer, driver,
 * CDL and trip columns on express rows; the portal CSV
 * (`parseInvoiceCsv`) has none of that.
 *
 * The PDF draws its tables with fills rather than ruled lines, so pdf-parse's
 * table extraction finds nothing and the text layer is what gets read. See
 * `readFuelLine` for why rows are parsed by anchoring on shape.
 *
 * Reconstructs the same record shape the CSV path produces and hands off to
 * the shared core (`parseInvoiceRecords`), which is what guarantees the two
 * parsers return identical types (parseInvoicePdf.test.ts asserts it).
 */
export async function parseInvoicePdf(
  input: Buffer,
  productCodes: ReadonlyMap<string, InvoiceProductType>,
): Promise<ParsedInvoice> {
  // Imported here, not at module scope: pdfjs-dist's init code throws when
  // bundled into the Next API route, and every other route imports this file.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: input });
  let text: string;
  try {
    const result = await parser.getText();
    text = result.text;
  } finally {
    await parser.destroy();
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !PAGE_MARKER_PATTERN.test(line) &&
        !PAGE_FOOTER_PATTERN.test(line),
    );

  const records: string[][] = [readHeaderRow(lines)];

  const fuelStart = lines.findIndex((l) => l === "Fuel Card Transactions");
  if (fuelStart === -1) {
    throw new InvoicePdfFormatError('could not find "Fuel Card Transactions" in the extracted text');
  }
  records.push(["Fuel Card Transactions"]);

  let section: "fuel" | "express" | "totals" = "fuel";
  let seenCard = false;
  /** Whether the current table's column header has been read and checked
   * since its heading. Extraction order around a page break is not the
   * printed order, so the header is not required on the very next line —
   * only before the table's first row. */
  let headerChecked = false;
  const requireHeader = (): void => {
    if (!headerChecked) {
      throw new InvoicePdfFormatError(`a ${section} row came before the ${section} table's column header`);
    }
  };

  for (const line of lines.slice(fuelStart + 1)) {
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;

    if (line === "Express Codes") {
      records.push(["Express Codes"], EXPRESS_HEADER_RECORD);
      section = "express";
      headerChecked = false;
      continue;
    }
    if (line === "Grand Totals") {
      records.push(["Grand Totals"], TOTALS_HEADER_RECORD);
      section = "totals";
      headerChecked = false;
      continue;
    }
    if (isColumnHeader(tokens, headerFor(section))) {
      headerChecked = true;
      continue;
    }
    // The tax registration lines and the product-code Legend follow the
    // totals block. The Legend's rows ("TF Trailer") look like totals rows,
    // so stop before reaching them rather than filtering them out later.
    if (/^Legend$/i.test(line) || /^HST#/i.test(line)) {
      break;
    }

    if (section === "fuel") {
      if (/^Transactions for card/i.test(line)) {
        const cardNumber = tokens[tokens.length - 1] ?? "";
        records.push(["Transactions for card", cardNumber]);
        if (!seenCard) {
          seenCard = true;
        }
        records.push(FUEL_HEADER_RECORD);
        headerChecked = false;
        continue;
      }
      if (!FUEL_AUTH.test(tokens[0] ?? "")) {
        continue; // SUBTOTAL / Card # / Fuel Total / Sub Total roll-ups
      }
      requireHeader();
      const cells = readFuelLine(tokens, line);
      if (!cells) {
        throw new InvoicePdfFormatError(`unparseable fuel line: ${JSON.stringify(line)}`);
      }
      records.push([
        cells.authCode, cells.driverName, cells.unit, cells.occurredAt,
        cells.siteRef, cells.siteName, cells.city, cells.state, cells.prod,
        ...cells.numerics, cells.currency,
      ]);
      continue;
    }

    if (section === "express") {
      if (!DATE.test(tokens[0] ?? "")) {
        continue; // SUBTOTAL
      }
      requireHeader();
      const record = readExpressLine(tokens, line);
      if (!record) {
        throw new InvoicePdfFormatError(`unparseable express line: ${JSON.stringify(line)}`);
      }
      records.push(record);
      continue;
    }

    const totalsRecord = toTotalsRecord(tokens);
    if (totalsRecord) {
      requireHeader();
      records.push(totalsRecord);
    }
  }

  return parseInvoiceRecords(records, productCodes);
}
