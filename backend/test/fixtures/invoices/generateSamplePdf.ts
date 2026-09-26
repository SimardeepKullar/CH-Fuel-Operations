import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

/**
 * Regenerates `sample-redacted.pdf`, the committed synthetic stand-in for the
 * emailed BVD invoice. Run with:
 *
 *   npx tsx test/fixtures/invoices/generateSamplePdf.ts
 *
 * It describes the **same invoice** as `sample-redacted.csv` — same cards,
 * transactions and totals — so a test can assert the two parsers agree, and
 * can assert the one real difference between BVD's exports: only the PDF
 * carries tractor/driver on express rows.
 *
 * What matters here is the *extracted text*, not the visual result: cells are
 * laid out by measured width so pdf-parse sees column gaps the way it
 * does on a real invoice. Invented data throughout — never a real invoice
 * (root `.gitignore`).
 */

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "sample-redacted.pdf");

const FUEL_COLUMNS = [
  "Auth Code", "Driver Name", "Unit #", "Date", "Site #", "Site Name",
  "Site City", "Prov/ST", "Prod", "QTY", "Retail", "Billed", "Pre Tax AMT",
  "HST", "GST", "PST", "QST", "Disc Rate", "Disc AMT", "Final AMT", "CUR",
];

const EXPRESS_COLUMNS = [
  "DATE", "EXP. CODE", "AUTH CODE", "TRACTOR", "TRAILER", "DRIVER NAME/ID",
  "CDL", "TRIP #", "AMOUNT CASHED", "FEE", "TOTAL", "CUR", "Payee", "NOTES",
];

const TOTALS_COLUMNS = [
  "PRODUCT", "QTY", "PRE TAX AMT", "HST", "GST", "PST", "QST", "DISC RATE",
  "DISC AMT", "FINAL AMOUNT", "CUR",
];

/** Same figures as sample-redacted.csv. */
const CARDS: Array<{ card: string; rows: string[][] }> = [
  {
    card: "1000001",
    rows: [
      ["B100001-TA", "DRIVER ONE", "101", "2026-01-05 10:00:00", "90001", "SAMPLE #1", "Sampleton", "TX", "TA", "50.00", "5.5000", "5.1234", "256.17", "0.00", "0.00", "0.00", "0.00", "0.3750", "18.83", "256.17", "US"],
      ["B100001-DF", "DRIVER ONE", "101", "2026-01-05 10:00:00", "90001", "SAMPLE #1", "Sampleton", "TX", "DF", "5.00", "4.5000", "4.5000", "22.50", "0.00", "0.00", "0.00", "0.00", "0.0000", "0.00", "22.50", "US"],
    ],
  },
  {
    card: "1000002",
    rows: [
      ["B100002-TA", "DRIVER TWO", "102", "2026-01-06 12:00:00", "90002", "SAMPLE #2", "Sampleton", "TX", "TA", "80.00", "5.6000", "5.2000", "416.00", "0.00", "0.00", "0.00", "0.00", "0.4000", "32.00", "416.00", "US"],
    ],
  },
  {
    card: "1000003",
    rows: [
      ["B100003-S", "DRIVER THREE", "103", "2026-01-07 09:00:00", "90003", "SAMPLE #3", "Sampleton", "TX", "S", "0.00", "0.0000", "0.0000", "15.00", "0.00", "0.00", "0.00", "0.00", "0.0000", "0.00", "15.00", "US"],
    ],
  },
];

/** Tractor and driver exist only on this export. The second row leaves the
 * driver genuinely blank, as real invoices do. */
const EXPRESS_ROWS = [
  ["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "DRIVER ONE", "", "", "50.00", "3", "53.00", "US", "lumper fees", ""],
  ["2026-01-06 09:00:00", "9000002", "E1000002", "102", "", "", "", "", "75.00", "3", "78.00", "US", "lumper", ""],
];

const TOTALS_ROWS = [
  ["TA", "130.00", "672.17", "0.00", "0.00", "0.00", "0.00", "0.39", "50.83", "672.17", "US"],
  ["TF", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "US"],
  ["DF", "5.00", "22.50", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "22.50", "US"],
  ["S", "15.00", "US"],
  ["Manual", "0.00", "US"],
  ["Express", "131.00", "US"],
  ["Grand Total", "135.00", "709.67", "0.00", "0.00", "0.00", "0.00", "0.38", "50.83", "840.67", "US"],
];

const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 24 });
doc.pipe(createWriteStream(OUT));
doc.fontSize(6);

/**
 * Lays cells left to right, advancing by each cell's measured width plus a
 * gap, so no two cells collide and extraction reliably sees a column break
 * between them. A blank cell still consumes its column.
 */
const GAP = 9;
function row(cells: readonly string[], y: number): void {
  let x = 24;
  for (const cell of cells) {
    if (cell !== "") {
      doc.text(cell, x, y, { lineBreak: false });
    }
    x += Math.max(doc.widthOfString(cell), 10) + GAP;
  }
}

let y = 24;
const line = (cells: readonly string[]): void => {
  row(cells, y);
  y += 10;
};

// Header table, then the client/supplier blocks the real invoice prints.
line(["Invoice"]);
line(["Number", "Invoice Date", "Start Date", "End Date", "Due Date"]);
line(["100001", "2026-01-08", "2026-01-05", "2026-01-07", "2026-01-09"]);
y += 6;
line(["Client info"]);
line(["SAMPLE CARRIER INC"]);
line(["Address:1 Sample Way, Sampleville ON"]);
y += 6;

line(["Fuel Card Transactions"]);
for (const { card, rows } of CARDS) {
  line(["Transactions for card", card]);
  line(FUEL_COLUMNS);
  for (const r of rows) line(r);
  line(["SUBTOTAL"]);
}

y += 6;
line(["Express Codes"]);
line(EXPRESS_COLUMNS);
for (const r of EXPRESS_ROWS) line(r);

y += 6;
line(["Grand Totals"]);
line(TOTALS_COLUMNS);
for (const r of TOTALS_ROWS) line(r);

y += 6;
line(["HST# 000000000RT0001"]);

doc.end();
