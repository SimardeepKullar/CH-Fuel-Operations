import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CA_INVOICE, FIXTURES, caLineFigures, renderInvoicePdf } from "./generateSamplePdf.js";

/** "1,234.56" → 123456 hundredths; "2.4990" at dp 4 → 24990. Integer only. */
function units(value: string, dp: number): number {
  const [whole, frac = ""] = value.replace(/,/g, "").split(".");
  return Number(whole) * 10 ** dp + Number((frac + "0".repeat(dp)).slice(0, dp));
}

/**
 * |qty × price − printed| within the rounding bound of a 2dp quantity and a
 * 4dp price (T-61): ½¢ + 0.005 × price + 0.00005 × qty. qtyH × priceT4 is
 * in micro-units (10^-6), where that bound is 5,000 + ½ × priceT4 + ½ × qtyH
 * — compared doubled, so it stays integer.
 */
function withinBound(qtyH: number, priceT4: number, printedCents: number): boolean {
  const deviation = Math.abs(qtyH * priceT4 - printedCents * 10_000);
  return 2 * deviation <= 10_000 + priceT4 + qtyH;
}

const caRows = CA_INVOICE.cards.flatMap((c) => c.rows.filter((r) => /^A\d+-[A-Z]+$/.test(r[0]!)));
const totalsRow = (label: string) => CA_INVOICE.totalsRows.find((r) => r[0] === label)!;

describe("sample-ca.pdf's own figures (T-61 step 61.2)", () => {
  it("prints CN on every fuel line, totals row and express row", () => {
    expect(caRows.length).toBeGreaterThan(0);
    expect(caRows.every((r) => r.at(-1) === "CN")).toBe(true);
    expect(CA_INVOICE.totalsRows.every((r) => r.at(-1) === "CN")).toBe(true);
    expect(CA_INVOICE.expressRows.every((r) => r[11] === "CN")).toBe(true);
  });

  it("satisfies Pre Tax + HST + GST + PST + QST = Final and Retail − Billed = Disc Rate exactly on every line", () => {
    for (const r of caRows) {
      const [qty, retail, billed, pre, hst, gst, pst, qst, discRate, , final] = r.slice(9, 20);
      void qty;
      expect(units(pre!, 2) + units(hst!, 2) + units(gst!, 2) + units(pst!, 2) + units(qst!, 2)).toBe(units(final!, 2));
      expect(units(retail!, 4) - units(billed!, 4)).toBe(units(discRate!, 4));
    }
  });

  it("charges 13% HST and no GST, PST or QST", () => {
    for (const { figures } of caLineFigures()) {
      expect(figures.pre + figures.hst).toBe(figures.final);
      // pre = round(final / 1.13): |pre × 113 − final × 100| ≤ 56.5
      expect(Math.abs(figures.pre * 113 - figures.final * 100) * 2).toBeLessThanOrEqual(113);
    }
    expect(caRows.every((r) => r[14] === "0.00" && r[15] === "0.00" && r[16] === "0.00")).toBe(true);
  });

  it("keeps QTY × Billed and QTY × Disc Rate within the rounding bound, and is off the exact product on at least one line", () => {
    let offExact = 0;
    for (const r of caRows) {
      const qtyH = units(r[9]!, 2);
      if (qtyH === 0) continue; // Scale: a flat fee, no per-unit price
      const billed = units(r[11]!, 4);
      const final = units(r[19]!, 2);
      expect(withinBound(qtyH, billed, final)).toBe(true);
      expect(withinBound(qtyH, units(r[17]!, 4), units(r[18]!, 2))).toBe(true);
      if (Math.floor((qtyH * billed + 5_000) / 10_000) !== final) offExact++;
    }
    expect(offExact).toBeGreaterThanOrEqual(1);
  });

  it("reconciles its printed totals: per product, and a grand total whose tax columns cover TA/TF/DF only", () => {
    const sum = (prod: string, col: number) =>
      caRows.filter((r) => r[8] === prod).reduce((s, r) => s + units(r[col]!, 2), 0);
    for (const prod of ["TA", "DF"]) {
      const row = totalsRow(prod);
      expect(units(row[1]!, 2)).toBe(sum(prod, 9)); // QTY
      expect(units(row[2]!, 2)).toBe(sum(prod, 12)); // Pre Tax
      expect(units(row[3]!, 2)).toBe(sum(prod, 13)); // HST
      expect(units(row[8]!, 2)).toBe(sum(prod, 18)); // Disc AMT
      expect(units(row[9]!, 2)).toBe(sum(prod, 19)); // Final
      expect(units(row[2]!, 2) + units(row[3]!, 2)).toBe(units(row[9]!, 2));
    }
    const grand = totalsRow("Grand Total");
    const ta = totalsRow("TA");
    const df = totalsRow("DF");
    expect(units(grand[2]!, 2)).toBe(units(ta[2]!, 2) + units(df[2]!, 2));
    expect(units(grand[3]!, 2)).toBe(units(ta[3]!, 2) + units(df[3]!, 2));
    expect(units(totalsRow("S")[1]!, 2)).toBe(sum("S", 19));
    const express = CA_INVOICE.expressRows.reduce((s, r) => s + units(r[10]!, 2), 0);
    expect(units(totalsRow("Express")[1]!, 2)).toBe(express);
    expect(units(grand[9]!, 2)).toBe(
      units(ta[9]!, 2) + units(df[9]!, 2) + units(totalsRow("S")[1]!, 2) + units(totalsRow("Manual")[1]!, 2) + express,
    );
    // The scale's tax sits in Final AMT but not in the grand total's tax column.
    expect(units(grand[2]!, 2) + units(grand[3]!, 2)).not.toBe(units(grand[9]!, 2) - express);
  });

  it("carries every case T-61 needs", () => {
    const byProd = (p: string) => caRows.filter((r) => r[8] === p);
    // A TA+DF pair on one base auth code.
    const bases = caRows.map((r) => r[0]!.replace(/-[A-Z]+$/, ""));
    const pairBase = bases.find((b) => caRows.some((r) => r[0] === `${b}-TA`) && caRows.some((r) => r[0] === `${b}-DF`));
    expect(pairBase).toBeDefined();
    // Scale: QTY 0, 23.01 + 2.99 = 26.00.
    expect(byProd("S").map((r) => [r[9], r[12], r[13], r[19]])).toEqual([["0.00", "23.01", "2.99", "26.00"]]);
    // DEF at 0.01 L.
    expect(byProd("DF").some((r) => r[9] === "0.01")).toBe(true);
    // Diesel under one US gallon (3.785411784 L).
    expect(byProd("TA").some((r) => units(r[9]!, 2) > 0 && units(r[9]!, 2) < 379)).toBe(true);
    // One transaction after the printed period end; the printed start weeks
    // before the first transaction.
    const times = caRows.map((r) => r[3]!).sort();
    expect(times.at(-1)! > `${CA_INVOICE.header.end} 23:59:59`).toBe(true);
    expect(CA_INVOICE.header.start).toBe("2026-08-01");
    expect(times[0]!.slice(0, 10) > "2026-08-31").toBe(true);
    // Cards only from T-62's synthetic 90000xx set.
    expect(CA_INVOICE.cards.every((c) => /^90000\d\d$/.test(c.card))).toBe(true);
  });

  it.each(["ca", "us"] as const)("regenerates byte-for-byte identical to the committed %s fixture", async (key) => {
    const committed = readFileSync(FIXTURES[key].file);
    const regenerated = await renderInvoicePdf(FIXTURES[key].spec);
    expect(regenerated.equals(committed)).toBe(true);
  });
});
