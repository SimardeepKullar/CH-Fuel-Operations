import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import PDFDocument from "pdfkit";

/**
 * Regenerates the committed synthetic stand-ins for the emailed BVD invoice.
 * Run with:
 *
 *   npx tsx test/fixtures/invoices/generateSamplePdf.ts [key]
 *
 * `sample-redacted.pdf` (US) describes the **same invoice** as
 * `sample-redacted.csv` — same cards, transactions and totals — so a test can
 * assert the two parsers agree, and can assert the one real difference
 * between BVD's exports: only the PDF carries tractor/driver on express rows.
 *
 * `sample-ca.pdf` (T-61) is a Canadian invoice written in the CA layout, not
 * a reshaped US fixture: `CN` on every row, litres, CAD per litre at 4dp,
 * 13% HST inside the billed price, site names with no `#`, a printed period
 * that starts weeks before the first transaction, and one transaction after
 * the printed period end. Drawn from the real CA invoice's layout, never its
 * data: names and cards come from T-62's synthetic roster.
 *
 * Both reproduce the real invoice's layout (T-50): each header date with its
 * time on the line below, a multi-line client block, a SUBTOTAL after each
 * stop, the per-card roll-ups (`SUBTOTAL TA`, `Card # TF`, `Fuel Total`,
 * `DF`, `S`, `Sub Total`), a `Page N of N Pages` footer, a card that breaks
 * across a page with its heading and column header repeated, an express
 * SUBTOTAL, and the tax-registration lines and Legend after the totals. Every
 * subtotal, roll-up and total is derived from the printed fuel rows, so a
 * fixture cannot disagree with itself unless a test means it to.
 *
 * The `edge-*.pdf` fixtures each carry one failure mode (see EDGE_CASES).
 *
 * What matters here is the *extracted text*, not the visual result: cells are
 * laid out by measured width so pdf-parse sees column gaps the way it
 * does on a real invoice. Invented data throughout — never a real invoice
 * (root `.gitignore`).
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const FUEL_COLUMNS = [
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

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ["TF", "Trailer"], ["TA", "Tractor"], ["DF", "DEF"], ["S", "Scale"],
  ["C", "Cash"], ["AD", "Additive"], ["O", "Oil"], ["L", "Lubricant"],
];

interface InvoiceHeader { number: string; invoiceDate: string; start: string; end: string; due: string }

interface InvoiceSpec {
  header: InvoiceHeader;
  /** Rows under each card: printed fuel lines with a SUBTOTAL after each stop. */
  cards: Array<{ card: string; rows: string[][]; rollUps: string[][] }>;
  expressRows: string[][];
  /** The express section's own SUBTOTAL: amount, fee, total. */
  expressSubtotal: string[] | null;
  totalsRows: string[][];
  /** The fuel table's printed column header. Only an edge case changes it. */
  fuelColumns: readonly string[];
  /** How cell gaps extract. Absent: one narrow gap everywhere, so pdf-parse
   * sees spaces. Present: the page is drawn under a scaled transform, as
   * BVD's own PDF is — pdf.js then sizes its synthetic space in unscaled
   * units, overshooting the next cell by gap × (1/scale − 1). pdf-parse
   * reads an overshoot above 7 as a tab, so at scale 0.6 a `wideGap` of 18
   * extracts as a tab and a `narrowGap` of 6 as a space. `wideAfter` lists
   * the fuel-row cell indexes followed by a wide gap; Site Name (5) is
   * always one, since a CA site name carries no `#` to anchor on. */
  layout?: { scale: number; narrowGap: number; wideGap: number; wideAfter: readonly number[] };
  /** Fuel rows (by auth code) after which a page ends early. A real invoice
   * breaks wherever a page fills; this places one inside a card on an
   * invoice too short to fill a page. */
  breakAfterAuth?: readonly string[];
}

// ─── Arithmetic: integer units, as BVD prints them ────────────────────────

/** "1,234.5" at `dp` places → an integer count of 10^-dp units. */
function toUnits(value: string, dp: number): number {
  const [whole, frac = ""] = value.replace(/,/g, "").split(".");
  const sign = whole!.startsWith("-") ? -1 : 1;
  return sign * (Math.abs(Number(whole)) * 10 ** dp + Number((frac + "0".repeat(dp)).slice(0, dp)));
}

/** Integer cents → "1,316.45", grouped as the PDF prints money. */
function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** qty (hundredths) × price (ten-thousandths) → cents, half up. */
function productCents(qtyHundredths: number, priceT4: number): number {
  return Math.floor((qtyHundredths * priceT4 + 5_000) / 10_000);
}

/** A fuel line's money columns, in integer hundredths. */
interface LineFigures { qty: number; pre: number; hst: number; gst: number; pst: number; qst: number; disc: number; final: number }

const ZERO: LineFigures = { qty: 0, pre: 0, hst: 0, gst: 0, pst: 0, qst: 0, disc: 0, final: 0 };

function sumOf(figs: readonly LineFigures[]): LineFigures {
  return figs.reduce(
    (a, f) => ({
      qty: a.qty + f.qty, pre: a.pre + f.pre, hst: a.hst + f.hst, gst: a.gst + f.gst,
      pst: a.pst + f.pst, qst: a.qst + f.qst, disc: a.disc + f.disc, final: a.final + f.final,
    }),
    ZERO,
  );
}

/** A printed fuel row's figures, read back from its cells. */
function rowFigures(r: readonly string[]): LineFigures {
  return {
    qty: toUnits(r[9]!, 2), pre: toUnits(r[12]!, 2), hst: toUnits(r[13]!, 2), gst: toUnits(r[14]!, 2),
    pst: toUnits(r[15]!, 2), qst: toUnits(r[16]!, 2), disc: toUnits(r[18]!, 2), final: toUnits(r[19]!, 2),
  };
}

/** Average discount rate, printed at 2dp as the totals block does. */
function avgRate(s: LineFigures): string {
  return s.qty === 0 ? "0.00" : (Math.round((s.disc * 100) / s.qty) / 100).toFixed(2);
}

/** QTY … FINAL AMOUNT: the nine figures of a product roll-up or totals row. */
function nineFigures(s: LineFigures): string[] {
  return [money(s.qty), money(s.pre), money(s.hst), money(s.gst), money(s.pst), money(s.qst), avgRate(s), money(s.disc), money(s.final)];
}

// ─── Building an invoice from its printed fuel rows ───────────────────────

const FUEL_AUTH_SHAPE = /^[A-Z]\d+-[A-Z]{1,2}$/;

const baseAuth = (auth: string): string => auth.replace(/-[A-Z]+$/, "");

/**
 * Lays out one card as the real invoice does: each stop's lines followed by
 * a SUBTOTAL of QTY, Pre Tax, HST, GST, PST, QST, Disc AMT and Final AMT;
 * then the card's product roll-ups.
 */
function cardBlock(card: string, fuelRows: readonly string[][], cur: string): { card: string; rows: string[][]; rollUps: string[][] } {
  const rows: string[][] = [];
  const stops = new Map<string, string[][]>();
  for (const r of fuelRows) stops.set(baseAuth(r[0]!), [...(stops.get(baseAuth(r[0]!)) ?? []), r]);
  for (const stopRows of stops.values()) {
    rows.push(...stopRows);
    const s = sumOf(stopRows.map(rowFigures));
    rows.push(["SUBTOTAL", money(s.qty), money(s.pre), money(s.hst), money(s.gst), money(s.pst), money(s.qst), money(s.disc), money(s.final)]);
  }
  const byProd = (p: string) => sumOf(fuelRows.filter((r) => r[8] === p).map(rowFigures));
  const ta = byProd("TA");
  const tf = byProd("TF");
  const all = sumOf(fuelRows.map(rowFigures));
  const rollUps = [
    ["SUBTOTAL", "TA", ...nineFigures(ta), cur],
    ["Card #", "TF", ...nineFigures(tf), cur],
    [card, "Fuel Total", ...nineFigures(sumOf([ta, tf]))],
    ["DF", ...nineFigures(byProd("DF")), cur],
  ];
  const scale = byProd("S");
  if (fuelRows.some((r) => r[8] === "S")) {
    rollUps.push(["S", money(scale.final), money(scale.pre), money(scale.final), cur]);
  }
  rollUps.push(["Sub Total", money(all.pre), money(all.hst), money(all.gst), money(all.pst), money(all.qst), money(all.disc), money(all.final), cur]);
  return { card, rows, rollUps };
}

/**
 * The whole invoice from its header, its cards' printed fuel rows and its
 * express rows. The grand total's QTY, Pre Tax and tax columns cover the
 * priced products (TA, TF, DF) only; Scale, Manual and Express print a final
 * amount alone, which the grand Final AMT includes (measured on 999217).
 */
function buildInvoice(input: {
  header: InvoiceHeader;
  cur: string;
  cards: ReadonlyArray<{ card: string; rows: readonly string[][] }>;
  expressRows: string[][];
  layout?: InvoiceSpec["layout"];
  breakAfterAuth?: readonly string[];
}): InvoiceSpec {
  const fuelRows = input.cards.flatMap((c) => c.rows);
  const byProd = (p: string) => sumOf(fuelRows.filter((r) => r[8] === p).map(rowFigures));
  const ta = byProd("TA");
  const tf = byProd("TF");
  const df = byProd("DF");
  const scale = byProd("S");
  const expressCents = input.expressRows.reduce((sum, r) => sum + toUnits(r[10]!, 2), 0);
  const priced = sumOf([ta, tf, df]);
  const grand = { ...priced, final: priced.final + scale.final + expressCents };
  const cur = input.cur;
  return {
    header: input.header,
    cards: input.cards.map(({ card, rows }) => cardBlock(card, rows, cur)),
    expressRows: input.expressRows,
    expressSubtotal:
      input.expressRows.length === 0
        ? null
        : [
            "SUBTOTAL",
            money(input.expressRows.reduce((s, r) => s + toUnits(r[8]!, 2), 0)),
            String(input.expressRows.reduce((s, r) => s + Number(r[9]!.replace(/,/g, "")), 0)),
            money(expressCents),
          ],
    totalsRows: [
      ["TA", ...nineFigures(ta), cur],
      ["TF", ...nineFigures(tf), cur],
      ["DF", ...nineFigures(df), cur],
      ["S", money(scale.final), cur],
      ["Manual", "0.00", cur],
      ["Express", money(expressCents), cur],
      ["Grand Total", ...nineFigures(grand), cur],
    ],
    fuelColumns: FUEL_COLUMNS,
    layout: input.layout,
    breakAfterAuth: input.breakAfterAuth,
  };
}

// ─── US: same figures as sample-redacted.csv ──────────────────────────────

const US_ROWS = {
  "1000001": [
    ["B100001-TA", "DRIVER ONE", "101", "2026-01-05 10:00:00", "90001", "SAMPLE #1", "Sampleton", "TX", "TA", "50.00", "5.5000", "5.1234", "256.17", "0.00", "0.00", "0.00", "0.00", "0.3766", "18.83", "256.17", "US"],
    ["B100001-DF", "DRIVER ONE", "101", "2026-01-05 10:00:00", "90001", "SAMPLE #1", "Sampleton", "TX", "DF", "5.00", "4.5000", "4.5000", "22.50", "0.00", "0.00", "0.00", "0.00", "0.0000", "0.00", "22.50", "US"],
  ],
  "1000002": [
    ["B100002-TA", "DRIVER TWO", "102", "2026-01-06 12:00:00", "90002", "SAMPLE #2", "Sampleton", "TX", "TA", "80.00", "5.6000", "5.2000", "416.00", "0.00", "0.00", "0.00", "0.00", "0.4000", "32.00", "416.00", "US"],
  ],
  "1000003": [
    ["B100003-S", "DRIVER THREE", "103", "2026-01-07 09:00:00", "90003", "SAMPLE #3", "Sampleton", "TX", "S", "0.00", "0.0000", "0.0000", "15.00", "0.00", "0.00", "0.00", "0.00", "0.0000", "0.00", "15.00", "US"],
  ],
};

const US_HEADER: InvoiceHeader = { number: "100001", invoiceDate: "2026-01-08", start: "2026-01-05", end: "2026-01-07", due: "2026-01-09" };

const US_INVOICE: InvoiceSpec = buildInvoice({
  header: US_HEADER,
  cur: "US",
  cards: Object.entries(US_ROWS).map(([card, rows]) => ({ card, rows })),
  // Tractor and driver exist only on this export. The second row leaves the
  // driver genuinely blank, as real invoices do.
  expressRows: [
    ["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "DRIVER ONE", "", "", "50.00", "3", "53.00", "US", "lumper fees", ""],
    ["2026-01-06 09:00:00", "9000002", "E1000002", "102", "", "", "", "", "75.00", "3", "78.00", "US", "lumper", ""],
  ],
  // Card 1000002's stop subtotal lands on page 2, under a repeated heading.
  breakAfterAuth: ["B100002-TA"],
});

// ─── CA: derived in integer arithmetic, as BVD prints it ──────────────────

/** Ontario HST, inside the billed price: Final AMT = Pre Tax AMT + HST. */
const HST_PERCENT = 13;

/** One CA product line before its money columns are derived. `qty` is
 * litres at 2dp, prices CAD per litre at 4dp. `finalAdjustCents` /
 * `discAdjustCents` reproduce BVD printing QTY × Billed from an unrounded
 * quantity — a cent or two off the printed product, always within the
 * rounding bound reconciliation allows (T-61). A Scale line instead carries
 * a flat `flatFinalCents` and prints QTY 0. */
interface CaLineInput {
  auth: string;
  driver: string;
  unit: string;
  at: string;
  site: string;
  siteName: string;
  city: string;
  prod: "TA" | "DF" | "S";
  qty: string;
  retail: string;
  billed: string;
  finalAdjustCents?: number;
  discAdjustCents?: number;
  flatFinalCents?: number;
}

interface CaLineFigures {
  qty: number; pre: number; hst: number; discRateT4: number; disc: number; final: number;
}

function caFigures(line: CaLineInput): CaLineFigures {
  const qty = toUnits(line.qty, 2);
  const billed = toUnits(line.billed, 4);
  const discRateT4 = toUnits(line.retail, 4) - billed;
  const final = line.flatFinalCents ?? productCents(qty, billed) + (line.finalAdjustCents ?? 0);
  const pre = Math.floor((final * 100 * 2 + (100 + HST_PERCENT)) / (2 * (100 + HST_PERCENT)));
  const disc = productCents(qty, discRateT4) + (line.discAdjustCents ?? 0);
  return { qty, pre, hst: final - pre, discRateT4, disc, final };
}

function caRow(line: CaLineInput): string[] {
  const f = caFigures(line);
  return [
    line.auth, line.driver, line.unit, line.at, line.site, line.siteName, line.city, "ON", line.prod,
    money(f.qty), line.retail, line.billed, money(f.pre), money(f.hst), "0.00", "0.00", "0.00",
    (f.discRateT4 / 10_000).toFixed(4), money(f.disc), money(f.final), "CN",
  ];
}

/**
 * Nine stops on eight synthetic cards: the five T-62 drivers left unassigned
 * (9000030, -32, -33, -42, -47), two assigned ones, and an existing US
 * driver (9000005) entering 074 — a unit not assigned to that driver.
 */
export const CA_CARDS: Array<{ card: string; lines: CaLineInput[] }> = [
  {
    card: "9000028",
    lines: [
      { auth: "A700000101-TA", driver: "MILES HARTE", unit: "038", at: "2026-09-03 10:10:17", site: "58803", siteName: "BVD MISSISSAUGA - SHAWSON", city: "MISSISSAUGA", prod: "TA", qty: "300.00", retail: "2.4990", billed: "2.2427", finalAdjustCents: -1 },
    ],
  },
  {
    card: "9000030",
    lines: [
      // A TA+DF pair sharing one base auth code — one fuel stop.
      { auth: "A700000102-TA", driver: "COLE WINTER", unit: "067", at: "2026-09-04 08:02:11", site: "58156", siteName: "BVD COMBER", city: "Comber", prod: "TA", qty: "250.40", retail: "2.4990", billed: "2.2223" },
      { auth: "A700000102-DF", driver: "COLE WINTER", unit: "067", at: "2026-09-04 08:02:11", site: "58156", siteName: "BVD COMBER", city: "Comber", prod: "DF", qty: "20.00", retail: "1.5392", billed: "1.5392" },
    ],
  },
  {
    card: "9000032",
    lines: [
      // Scale: QTY 0, a flat 23.01 + 2.99 HST = 26.00.
      { auth: "A700000103-S", driver: "REMY", unit: "062", at: "2026-09-04 13:08:45", site: "58037", siteName: "BVD CORNWALL", city: "Cornwall", prod: "S", qty: "0.00", retail: "0.0000", billed: "0.0000", flatFinalCents: 2600 },
    ],
  },
  {
    card: "9000033",
    lines: [
      // Diesel under one gallon: 3.00 L = 0.79 gal (sub-gallon rule, D25).
      { auth: "A700000104-TA", driver: "ELLIOT", unit: "1002", at: "2026-09-05 06:41:52", site: "58073", siteName: "BVD NIAGARA", city: "Niagara on the Lake", prod: "TA", qty: "3.00", retail: "2.4990", billed: "2.1721" },
    ],
  },
  {
    card: "9000005",
    lines: [
      { auth: "A700000105-TA", driver: "JORDAN", unit: "074", at: "2026-09-06 12:00:03", site: "58057", siteName: "BVD SARNIA", city: "Sarnia", prod: "TA", qty: "602.00", retail: "2.4990", billed: "2.1868", discAdjustCents: 1 },
    ],
  },
  {
    card: "9000044",
    lines: [
      // DEF at 0.01 L, as BVD prints it: 0.01 × 1.5390 rounds to 0.02, the
      // invoice says 0.01 — the quantity behind it is under a hundredth.
      // Exempt from the sub-gallon rule however small (T-40F).
      { auth: "A700000106-DF", driver: "KAI", unit: "034", at: "2026-09-08 19:09:08", site: "58156", siteName: "BVD COMBER", city: "Comber", prod: "DF", qty: "0.01", retail: "1.5390", billed: "1.5390", finalAdjustCents: -1 },
    ],
  },
  {
    card: "9000042",
    lines: [
      { auth: "A700000107-TA", driver: "ROWAN", unit: "031", at: "2026-09-09 14:29:21", site: "58062", siteName: "BVD MISSISSAUGA", city: "Mississauga", prod: "TA", qty: "160.25", retail: "2.4990", billed: "2.1721" },
    ],
  },
  {
    card: "9000047",
    lines: [
      // After the printed period end (2026-09-09 23:59:59): it still imports.
      { auth: "A700000108-TA", driver: "LENNOX", unit: "031", at: "2026-09-10 00:45:19", site: "58782", siteName: "BVD LONDON", city: "LONDON", prod: "TA", qty: "390.00", retail: "2.4990", billed: "2.1524" },
    ],
  },
];

/** Tractor and driver as the PDF prints them; CUR is CN like every row. */
export const CA_EXPRESS_ROWS: string[][] = [
  ["2026-09-07 09:15:00", "7000001", "E7000001", "1010", "", "PAXTON", "", "", "40.00", "3", "43.00", "CN", "lumper fees", ""],
];

export function caLineFigures(): Array<{ card: string; line: CaLineInput; figures: CaLineFigures }> {
  return CA_CARDS.flatMap(({ card, lines }) => lines.map((line) => ({ card, line, figures: caFigures(line) })));
}

export const CA_INVOICE: InvoiceSpec = buildInvoice({
  header: { number: "700001", invoiceDate: "2026-09-10", start: "2026-08-01", end: "2026-09-09", due: "2026-09-11" },
  cur: "CN",
  cards: CA_CARDS.map(({ card, lines }) => ({ card, rows: lines.map(caRow) })),
  expressRows: CA_EXPRESS_ROWS,
  // Driver, Unit #, Date, Site Name, Prov/ST and Prod are followed by a
  // tab on the real CA invoice's rows; City → Prov/ST and the money
  // columns are mixed there, and spaces here.
  layout: { scale: 0.6, narrowGap: 6, wideGap: 18, wideAfter: [1, 2, 3, 5, 7, 8] },
  // Card 9000030's DEF line and the stop's subtotal land on page 2.
  breakAfterAuth: ["A700000102-TA"],
});

// ─── Edge cases: one failure mode each ────────────────────────────────────

/** A US fuel row from its varying cells; the rest are the sample's. */
function usRow(auth: string, driver: string, unit: string, at: string, store: string, prod: string, qty: string, retail: string, billed: string): string[] {
  const qtyH = toUnits(qty, 2);
  const billedT4 = toUnits(billed, 4);
  const rateT4 = toUnits(retail, 4) - billedT4;
  const final = productCents(qtyH, billedT4);
  return [
    auth, driver, unit, at, `9${store.padStart(4, "0")}`, `SAMPLE #${store}`, "Sampleton", "TX", prod,
    money(qtyH), retail, billed, money(final), "0.00", "0.00", "0.00", "0.00",
    (rateT4 / 10_000).toFixed(4), money(productCents(qtyH, rateT4)), money(final), "US",
  ];
}

/** Twenty-four stops on one card — more than a page holds, so the card
 * breaks across pages wherever the page fills — driven under one-, two- and
 * three-word names, as the real invoice's drivers are. */
function longCardRows(): string[][] {
  const drivers = ["REMY", "DRIVER TWO", "ANA DE SOUSA"];
  return Array.from({ length: 24 }, (_, i) => {
    // Eight a day across the printed period, 2026-01-05 to -07.
    const day = String(5 + Math.floor(i / 8)).padStart(2, "0");
    const hour = String(6 + (i % 8) * 2).padStart(2, "0");
    return usRow(`B2000${String(i + 10).padStart(2, "0")}-TA`, drivers[i % 3]!, "101", `2026-01-${day} ${hour}:00:00`, String(1 + (i % 5)), "TA", `${60 + i}.00`, "5.5000", "5.1234");
  });
}

const EDGE_HEADER: InvoiceHeader = { ...US_HEADER, number: "100002" };

const EDGE_EXPRESS: string[][] = [
  ["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "DRIVER ONE", "", "", "50.00", "3", "53.00", "US", "lumper fees", ""],
];

function edge(cards: ReadonlyArray<{ card: string; rows: readonly string[][] }>, expressRows: string[][] = EDGE_EXPRESS): InvoiceSpec {
  return buildInvoice({ header: EDGE_HEADER, cur: "US", cards, expressRows });
}

export const EDGE_CASES = {
  /** The grand total is a dollar more than its rows: parses, does not reconcile. */
  "edge-totals-mismatch": (() => {
    const spec = edge(Object.entries(US_ROWS).map(([card, rows]) => ({ card, rows })));
    const grand = spec.totalsRows.find((r) => r[0] === "Grand Total")!;
    grand[9] = money(toUnits(grand[9]!, 2) + 100);
    return spec;
  })(),
  /** The fuel table's Retail and Billed headings swapped: the reader must
   * refuse it (InvoicePdfFormatError) rather than read prices by position. */
  "edge-changed-header": {
    ...edge(Object.entries(US_ROWS).map(([card, rows]) => ({ card, rows }))),
    fuelColumns: FUEL_COLUMNS.map((c) => (c === "Retail" ? "Billed" : c === "Billed" ? "Retail" : c)),
  },
  /** One card whose rows run across a page break, under 1-, 2- and 3-word names. */
  "edge-page-break": edge([{ card: "1000001", rows: longCardRows() }]),
  /** Express rows with a blank driver, a blank tractor, both blank, and a
   * whole-dollar amount printed without cents, as real rows are. */
  "edge-express-blanks": edge(
    [{ card: "1000001", rows: US_ROWS["1000001"] }],
    [
      ["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "", "", "", "50", "3", "53", "US", "lumper", ""],
      ["2026-01-05 09:00:00", "9000002", "E1000002", "", "", "PAT LEE", "", "", "75.00", "3", "78.00", "US", "lumper fees", ""],
      ["2026-01-06 10:00:00", "9000003", "E1000003", "", "", "", "", "", "20.00", "3", "23.00", "US", "tolls", ""],
    ],
  ),
  /** Figures past a thousand, grouped with commas wherever the PDF prints
   * money: lines, subtotals, roll-ups, totals and an express amount. */
  "edge-thousands": edge(
    [{
      card: "1000001",
      rows: [
        usRow("B300001-TA", "DRIVER ONE", "101", "2026-01-05 10:00:00", "1", "TA", "250.00", "5.5000", "5.1234"),
        usRow("B300002-TA", "DRIVER ONE", "101", "2026-01-06 10:00:00", "2", "TA", "210.50", "5.6000", "5.2000"),
      ],
    }],
    [["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "DRIVER ONE", "", "", "1,200.00", "3", "1,203.00", "US", "repairs", ""]],
  ),
  /** One fuel line under a product code no mapping knows: quarantined as
   * UNMAPPED_PRODUCT, never default-mapped. */
  "edge-unmapped-product": edge([{
    card: "1000001",
    rows: [
      ...US_ROWS["1000001"],
      usRow("B400001-ZZ", "DRIVER ONE", "101", "2026-01-06 10:00:00", "1", "ZZ", "4.00", "9.0000", "9.0000"),
    ],
  }]),
} satisfies Record<string, InvoiceSpec>;

// ─── Rendering ────────────────────────────────────────────────────────────

/** Fixed, so regenerating a fixture is byte-stable. */
const CREATION_DATE = new Date(Date.UTC(2026, 0, 1));

/** One printed line: its cells, and how far below the previous line it sits. */
interface Entry { cells: readonly string[]; wideAfter?: readonly number[]; gapBefore?: number; card?: string; breakAfter?: boolean }

/** Everything the invoice prints, in order, before it is cut into pages. */
function entriesOf(spec: InvoiceSpec): Entry[] {
  const out: Entry[] = [];
  const add = (cells: readonly string[], extra: Omit<Entry, "cells"> = {}) => out.push({ cells, ...extra });

  // Header table: the number beside the invoice date, then every date with
  // its time on the line below, as the real header extracts.
  const h = spec.header;
  add(["Invoice"]);
  add(["Number", "Invoice Date", "Start Date", "End Date", "Due Date"]);
  add([h.number, h.invoiceDate]);
  add(["00:00:00"]);
  for (const [date, time] of [[h.start, "00:00:00"], [h.end, "23:59:59"], [h.due, "23:59:59"]] as const) {
    add([date]);
    add([time]);
  }

  add(["Client info"], { gapBefore: 6 });
  add(["SAMPLE CARRIER INC."]);
  add(["Address:1 SAMPLE WAY, SAMPLEVILLE,"]);
  add(["ON, Canada, A1A 1A1"]);
  add(["Phone: (555) 555-0100"]);
  add(["Remit:", "100 Sample Park Blvd"]);
  add(["Sampleton, ON"]);
  add(["A1A 1A1"]);

  add(["Fuel Card Transactions"], { gapBefore: 6 });
  for (const { card, rows, rollUps } of spec.cards) {
    add(["Transactions for card", card]);
    add(spec.fuelColumns);
    for (const r of rows) {
      const isFuel = FUEL_AUTH_SHAPE.test(r[0] ?? "");
      add(r, {
        card,
        wideAfter: isFuel ? spec.layout?.wideAfter : [],
        breakAfter: isFuel && (spec.breakAfterAuth ?? []).includes(r[0]!),
      });
    }
    for (const r of rollUps) add(r, { card });
  }

  if (spec.expressRows.length > 0) {
    add(["Express Codes"], { gapBefore: 6 });
    add(EXPRESS_COLUMNS);
    for (const r of spec.expressRows) add(r);
    if (spec.expressSubtotal) add(spec.expressSubtotal);
  }

  add(["Grand Totals"], { gapBefore: 6 });
  add(TOTALS_COLUMNS);
  for (const r of spec.totalsRows) add(r);

  add(["HST# 000000000RT0001"], { gapBefore: 6 });
  add(["QST# 0000000000TQ0001"]);
  add(["Legend"], { gapBefore: 6 });
  add(["Code", "Product Name"]);
  for (const [code, name] of LEGEND) add([code, name]);
  return out;
}

const TOP = 24;
const LINE = 10;
/** The last line's top on a page; the footer sits below it. */
const PAGE_BOTTOM = 560;
const FOOTER_Y = 576;

/**
 * Cuts the entries into pages. A page ends when the next line would pass
 * PAGE_BOTTOM, or after a `breakAfter` row. A card's rows that continue onto
 * a new page are preceded there by the card heading and the fuel column
 * header again, as the real invoice repeats them.
 */
function paginate(spec: InvoiceSpec, entries: readonly Entry[]): Entry[][] {
  const pages: Entry[][] = [];
  let page: Entry[] = [];
  /** The top of the last line placed on `page` — the renderer's own rule. */
  let y = 0;
  const place = (entry: Entry): void => {
    y = page.length === 0 ? TOP : y + (entry.gapBefore ?? 0) + LINE;
    page.push(entry);
  };
  const breakPage = (continuingCard: string | undefined): void => {
    pages.push(page);
    page = [];
    if (continuingCard !== undefined) {
      place({ cells: ["Transactions for card", continuingCard] });
      place({ cells: spec.fuelColumns });
    }
  };
  entries.forEach((entry, i) => {
    if (page.length > 0 && y + (entry.gapBefore ?? 0) + LINE > PAGE_BOTTOM) breakPage(entry.card);
    place(entry);
    const next = entries[i + 1];
    if (entry.breakAfter && next) breakPage(next.card === entry.card ? entry.card : undefined);
  });
  pages.push(page);
  return pages;
}

export function renderInvoicePdf(spec: InvoiceSpec): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 24, info: { CreationDate: CREATION_DATE }, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  // Coordinates below are in page points; under a scaled layout every one
  // is divided by the scale, so the page looks the same either way.
  const scale = spec.layout?.scale ?? 1;

  /**
   * Lays cells left to right, advancing by each cell's measured width plus a
   * gap, so no two cells collide and extraction reliably sees a column break
   * between them. A blank cell still consumes its column.
   */
  const GAP = 9;
  const line = (cells: readonly string[], y: number, wideAfter: readonly number[] = []): void => {
    let x = 24;
    cells.forEach((cell, i) => {
      if (cell !== "") {
        doc.text(cell, x / scale, y / scale, { lineBreak: false });
      }
      const gap = !spec.layout ? GAP : wideAfter.includes(i) ? spec.layout.wideGap : spec.layout.narrowGap;
      x += Math.max(doc.widthOfString(cell) * scale, 10) + gap;
    });
  };

  const pages = paginate(spec, entriesOf(spec));
  pages.forEach((entries, p) => {
    doc.addPage();
    if (scale !== 1) doc.scale(scale);
    doc.fontSize(6 / scale);
    let y = TOP;
    entries.forEach((entry, i) => {
      if (i > 0) y += (entry.gapBefore ?? 0) + LINE;
      line(entry.cells, y, entry.wideAfter);
    });
    line([`Page ${p + 1} of ${pages.length} Pages`], FOOTER_Y);
  });

  doc.end();
  return done;
}

export const FIXTURES: Record<string, { spec: InvoiceSpec; file: string }> = {
  us: { spec: US_INVOICE, file: path.join(DIR, "sample-redacted.pdf") },
  ca: { spec: CA_INVOICE, file: path.join(DIR, "sample-ca.pdf") },
  ...Object.fromEntries(
    Object.entries(EDGE_CASES).map(([name, spec]) => [name, { spec, file: path.join(DIR, `${name}.pdf`) }]),
  ),
};

async function main(): Promise<void> {
  const which = process.argv[2];
  for (const key of which ? [which] : Object.keys(FIXTURES)) {
    const { spec, file } = FIXTURES[key]!;
    writeFileSync(file, await renderInvoicePdf(spec));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
