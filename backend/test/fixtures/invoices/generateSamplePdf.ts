import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import PDFDocument from "pdfkit";

/**
 * Regenerates the committed synthetic stand-ins for the emailed BVD invoice.
 * Run with:
 *
 *   npx tsx test/fixtures/invoices/generateSamplePdf.ts [us|ca]
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
 * What matters here is the *extracted text*, not the visual result: cells are
 * laid out by measured width so pdf-parse sees column gaps the way it
 * does on a real invoice. Invented data throughout — never a real invoice
 * (root `.gitignore`).
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));

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

interface InvoiceSpec {
  header: { number: string; invoiceDate: string; start: string; end: string; due: string; withTimes: boolean };
  cards: Array<{ card: string; rows: string[][]; rollUps: string[][] }>;
  expressRows: string[][];
  totalsRows: string[][];
  /** How cell gaps extract. Absent: one narrow gap everywhere, so pdf-parse
   * sees spaces. Present: the page is drawn under a scaled transform, as
   * BVD's own PDF is — pdf.js then sizes its synthetic space in unscaled
   * units, overshooting the next cell by gap × (1/scale − 1). pdf-parse
   * reads an overshoot above 7 as a tab, so at scale 0.6 a `wideGap` of 18
   * extracts as a tab and a `narrowGap` of 6 as a space. `wideAfter` lists
   * the fuel-row cell indexes followed by a wide gap; Site Name (5) is
   * always one, since a CA site name carries no `#` to anchor on. */
  layout?: { scale: number; narrowGap: number; wideGap: number; wideAfter: readonly number[] };
}

// ─── US: same figures as sample-redacted.csv ──────────────────────────────

const US_INVOICE: InvoiceSpec = {
  header: { number: "100001", invoiceDate: "2026-01-08", start: "2026-01-05", end: "2026-01-07", due: "2026-01-09", withTimes: false },
  cards: [
    {
      card: "1000001",
      rows: [
        ["B100001-TA", "DRIVER ONE", "101", "2026-01-05 10:00:00", "90001", "SAMPLE #1", "Sampleton", "TX", "TA", "50.00", "5.5000", "5.1234", "256.17", "0.00", "0.00", "0.00", "0.00", "0.3766", "18.83", "256.17", "US"],
        ["B100001-DF", "DRIVER ONE", "101", "2026-01-05 10:00:00", "90001", "SAMPLE #1", "Sampleton", "TX", "DF", "5.00", "4.5000", "4.5000", "22.50", "0.00", "0.00", "0.00", "0.00", "0.0000", "0.00", "22.50", "US"],
      ],
      rollUps: [["SUBTOTAL"]],
    },
    {
      card: "1000002",
      rows: [
        ["B100002-TA", "DRIVER TWO", "102", "2026-01-06 12:00:00", "90002", "SAMPLE #2", "Sampleton", "TX", "TA", "80.00", "5.6000", "5.2000", "416.00", "0.00", "0.00", "0.00", "0.00", "0.4000", "32.00", "416.00", "US"],
      ],
      rollUps: [["SUBTOTAL"]],
    },
    {
      card: "1000003",
      rows: [
        ["B100003-S", "DRIVER THREE", "103", "2026-01-07 09:00:00", "90003", "SAMPLE #3", "Sampleton", "TX", "S", "0.00", "0.0000", "0.0000", "15.00", "0.00", "0.00", "0.00", "0.00", "0.0000", "0.00", "15.00", "US"],
      ],
      rollUps: [["SUBTOTAL"]],
    },
  ],
  // Tractor and driver exist only on this export. The second row leaves the
  // driver genuinely blank, as real invoices do.
  expressRows: [
    ["2026-01-05 08:00:00", "9000001", "E1000001", "101", "", "DRIVER ONE", "", "", "50.00", "3", "53.00", "US", "lumper fees", ""],
    ["2026-01-06 09:00:00", "9000002", "E1000002", "102", "", "", "", "", "75.00", "3", "78.00", "US", "lumper", ""],
  ],
  totalsRows: [
    ["TA", "130.00", "672.17", "0.00", "0.00", "0.00", "0.00", "0.39", "50.83", "672.17", "US"],
    ["TF", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "US"],
    ["DF", "5.00", "22.50", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "22.50", "US"],
    ["S", "15.00", "US"],
    ["Manual", "0.00", "US"],
    ["Express", "131.00", "US"],
    // Pre Tax covers TA/TF/DF only; S and Express print a final amount alone.
    ["Grand Total", "135.00", "694.67", "0.00", "0.00", "0.00", "0.00", "0.38", "50.83", "840.67", "US"],
  ],
};

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

/** "1234.5" at `dp` places → an integer count of 10^-dp units. */
function toUnits(value: string, dp: number): number {
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 10 ** dp + Number((frac + "0".repeat(dp)).slice(0, dp));
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

function sumOf(figs: CaLineFigures[]): CaLineFigures {
  return figs.reduce(
    (a, f) => ({ qty: a.qty + f.qty, pre: a.pre + f.pre, hst: a.hst + f.hst, discRateT4: 0, disc: a.disc + f.disc, final: a.final + f.final }),
    { qty: 0, pre: 0, hst: 0, discRateT4: 0, disc: 0, final: 0 },
  );
}

/** Per-code average discount rate, printed at 2dp as the totals block does. */
function avgRate(s: CaLineFigures): string {
  return s.qty === 0 ? "0.00" : (Math.round((s.disc * 100) / s.qty) / 100).toFixed(2);
}

function nineFigureRow(label: string, s: CaLineFigures): string[] {
  return [label, money(s.qty), money(s.pre), money(s.hst), "0.00", "0.00", "0.00", avgRate(s), money(s.disc), money(s.final), "CN"];
}

function buildCaInvoice(): InvoiceSpec {
  const all = caLineFigures();
  const byProd = (p: string) => sumOf(all.filter((x) => x.line.prod === p).map((x) => x.figures));
  const ta = byProd("TA");
  const df = byProd("DF");
  const scale = byProd("S");
  const expressCents = CA_EXPRESS_ROWS.reduce((sum, r) => sum + toUnits(r[10]!, 2), 0);
  // The grand total's QTY, Pre Tax and tax columns cover the priced products
  // only; Scale, Manual and Express print a final amount alone, which the
  // grand Final AMT includes (T-61, measured on 999217).
  const priced = sumOf([ta, df]);
  const grand = { ...priced, final: priced.final + scale.final + expressCents };

  const cards = CA_CARDS.map(({ card, lines }) => {
    const figs = lines.map(caFigures);
    const rows: string[][] = [];
    // One SUBTOTAL per stop (base auth code), as the real layout prints.
    const groups = new Map<string, CaLineFigures[]>();
    lines.forEach((line, i) => {
      const base = line.auth.replace(/-[A-Z]+$/, "");
      const g = groups.get(base) ?? [];
      g.push(figs[i]!);
      groups.set(base, g);
    });
    const rowsByBase = new Map<string, string[][]>();
    lines.forEach((line) => {
      const base = line.auth.replace(/-[A-Z]+$/, "");
      rowsByBase.set(base, [...(rowsByBase.get(base) ?? []), caRow(line)]);
    });
    for (const [base, stopRows] of rowsByBase) {
      rows.push(...stopRows);
      const s = sumOf(groups.get(base)!);
      rows.push(["SUBTOTAL", money(s.qty), money(s.pre), money(s.hst), "0.00", "0.00", "0.00", money(s.disc), money(s.final)]);
    }
    const cardTa = sumOf(figs.filter((_, i) => lines[i]!.prod === "TA"));
    const cardDf = sumOf(figs.filter((_, i) => lines[i]!.prod === "DF"));
    const cardAll = sumOf(figs);
    const rollUps = [
      ["SUBTOTAL", ...nineFigureRow("TA", cardTa)],
      ["Card #", "TF", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "CN"],
      [card, "Fuel Total", money(cardTa.qty), money(cardTa.pre), money(cardTa.hst), "0.00", "0.00", "0.00", "0.00", money(cardTa.disc), money(cardTa.final)],
      nineFigureRow("DF", cardDf),
      ["Sub Total", money(cardAll.pre), money(cardAll.hst), "0.00", "0.00", "0.00", money(cardAll.disc), money(cardAll.final), "CN"],
    ];
    return { card, rows, rollUps };
  });

  return {
    header: { number: "700001", invoiceDate: "2026-09-10", start: "2026-08-01", end: "2026-09-09", due: "2026-09-11", withTimes: true },
    // Driver, Unit #, Date, Site Name, Prov/ST and Prod are followed by a
    // tab on the real CA invoice's rows; City → Prov/ST and the money
    // columns are mixed there, and spaces here.
    layout: { scale: 0.6, narrowGap: 6, wideGap: 18, wideAfter: [1, 2, 3, 5, 7, 8] },
    cards,
    expressRows: CA_EXPRESS_ROWS,
    totalsRows: [
      nineFigureRow("TA", ta),
      ["TF", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "CN"],
      nineFigureRow("DF", df),
      ["S", money(scale.final), "CN"],
      ["Manual", "0.00", "CN"],
      ["Express", money(expressCents), "CN"],
      ["Grand Total", money(grand.qty), money(grand.pre), money(grand.hst), "0.00", "0.00", "0.00", avgRate(grand), money(grand.disc), money(grand.final), "CN"],
    ],
  };
}

export const CA_INVOICE: InvoiceSpec = buildCaInvoice();

// ─── Rendering ────────────────────────────────────────────────────────────

const FUEL_AUTH_SHAPE = /^[A-Z]\d+-[A-Z]{1,2}$/;

/** Fixed, so regenerating a fixture is byte-stable. */
const CREATION_DATE = new Date(Date.UTC(2026, 0, 1));

export function renderInvoicePdf(spec: InvoiceSpec): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 24, info: { CreationDate: CREATION_DATE } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  // Coordinates below are in page points; under a scaled layout every one
  // is divided by the scale, so the page looks the same either way.
  const scale = spec.layout?.scale ?? 1;
  const startPage = (): void => {
    if (scale !== 1) doc.scale(scale);
  };
  startPage();
  doc.fontSize(6 / scale);

  /**
   * Lays cells left to right, advancing by each cell's measured width plus a
   * gap, so no two cells collide and extraction reliably sees a column break
   * between them. A blank cell still consumes its column.
   */
  const GAP = 9;
  const PAGE_BOTTOM = 560;
  let y = 24;
  const line = (cells: readonly string[], wideAfter: readonly number[] = []): void => {
    if (y > PAGE_BOTTOM) {
      doc.addPage();
      startPage();
      y = 24;
    }
    let x = 24;
    cells.forEach((cell, i) => {
      if (cell !== "") {
        doc.text(cell, x / scale, y / scale, { lineBreak: false });
      }
      const gap = !spec.layout ? GAP : wideAfter.includes(i) ? spec.layout.wideGap : spec.layout.narrowGap;
      x += Math.max(doc.widthOfString(cell) * scale, 10) + gap;
    });
    y += 10;
  };

  // Header table, then the client/supplier blocks the real invoice prints.
  const h = spec.header;
  line(["Invoice"]);
  line(["Number", "Invoice Date", "Start Date", "End Date", "Due Date"]);
  line([h.number, h.invoiceDate, h.start, h.end, h.due]);
  if (h.withTimes) {
    // The real header prints each date's time under it.
    line(["", "00:00:00", "00:00:00", "23:59:59", "23:59:59"]);
  }
  y += 6;
  line(["Client info"]);
  line(["SAMPLE CARRIER INC"]);
  line(["Address:1 Sample Way, Sampleville ON"]);
  y += 6;

  line(["Fuel Card Transactions"]);
  for (const { card, rows, rollUps } of spec.cards) {
    line(["Transactions for card", card]);
    line(FUEL_COLUMNS);
    for (const r of rows) line(r, FUEL_AUTH_SHAPE.test(r[0] ?? "") ? spec.layout?.wideAfter : []);
    for (const r of rollUps) line(r);
  }

  if (spec.expressRows.length > 0) {
    y += 6;
    line(["Express Codes"]);
    line(EXPRESS_COLUMNS);
    for (const r of spec.expressRows) line(r);
  }

  y += 6;
  line(["Grand Totals"]);
  line(TOTALS_COLUMNS);
  for (const r of spec.totalsRows) line(r);

  y += 6;
  line(["HST# 000000000RT0001"]);

  doc.end();
  return done;
}

export const FIXTURES = {
  us: { spec: US_INVOICE, file: path.join(DIR, "sample-redacted.pdf") },
  ca: { spec: CA_INVOICE, file: path.join(DIR, "sample-ca.pdf") },
} as const;

async function main(): Promise<void> {
  const which = process.argv[2] as keyof typeof FIXTURES | undefined;
  for (const key of which ? [which] : (Object.keys(FIXTURES) as Array<keyof typeof FIXTURES>)) {
    const { spec, file } = FIXTURES[key];
    writeFileSync(file, await renderInvoicePdf(spec));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
