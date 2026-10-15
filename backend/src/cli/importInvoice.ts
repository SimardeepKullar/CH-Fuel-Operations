import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { detectInvoiceFormat } from "../invoice/detectFormat.js";
import { importInvoice } from "../invoice/importInvoice.js";
import { parseInvoicePdf } from "../invoice/parseInvoicePdf.js";
import type { ImportReport } from "../invoice/report.js";
import { getPool } from "../db/pool.js";

function printReport(report: ImportReport): void {
  console.log(`invoice:             ${report.invoiceNumber}`);
  console.log(`grand total:         ${report.grandTotal} ${report.currency}`);
  console.log(`balanced:            ${report.reconcile.balanced}`);
  console.log(`parser rejections:   ${report.parserRejectionCount}`);

  if (report.unknownCardNumbers.length > 0) {
    console.log(`unknown cards:       ${report.unknownCardNumbers.join(", ")}`);
  }
  if (report.unknownTruckUnits.length > 0) {
    console.log(`unknown truck units: ${report.unknownTruckUnits.join(", ")}`);
  }
  if (report.stationMisses.length > 0) {
    console.log(`unresolved stations: ${report.stationMisses.join(", ")}`);
  }
  if (report.truckAssignmentMisses.length > 0) {
    console.log(`no truck assignment: ${report.truckAssignmentMisses.join(", ")}`);
  }
  if (report.expressBlankUnits.length > 0) {
    console.log(`blank express units: ${report.expressBlankUnits.join(", ")}`);
  }
}

const USAGE = "usage: import-invoice <file> [--fx-rate <CAD per 1 USD>]";

/** `<file> [--fx-rate 1.3712]` (also `--fx-rate=1.3712`), or the usage error to print. */
export function parseImportInvoiceArgs(argv: string[]): { filePath: string; fxCadPerUsd?: number } | { error: string } {
  let filePath: string | undefined;
  let fxRaw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--fx-rate") {
      fxRaw = argv[++i];
      if (fxRaw === undefined) return { error: `--fx-rate needs a value
${USAGE}` };
    } else if (arg.startsWith("--fx-rate=")) {
      fxRaw = arg.slice("--fx-rate=".length);
    } else if (arg.startsWith("--") || filePath !== undefined) {
      return { error: `unexpected argument "${arg}"
${USAGE}` };
    } else {
      filePath = arg;
    }
  }
  if (filePath === undefined) return { error: USAGE };
  if (fxRaw === undefined) return { filePath };
  // A plain decimal only: Number("") is 0 and Number("0x1") is 1.
  if (!/^\d+(\.\d+)?$/.test(fxRaw)) {
    return { error: `--fx-rate "${fxRaw}" is not a number (CAD per 1 USD, e.g. 1.3712)` };
  }
  return { filePath, fxCadPerUsd: Number(fxRaw) };
}

/**
 * argv and stdout, nothing else — same split as `cli/ingest.ts`. Every
 * decision (parse, group, reconcile, resolve, promote-or-quarantine, run
 * anomalies) lives in `importInvoice()` (T-28/T-29/T-30); this only reads
 * the file, picks the parser for its format, calls it once, and prints the
 * report.
 *
 * Both of BVD's exports are accepted. Prefer the emailed PDF: it prints the
 * invoice's own header dates and is the only one carrying tractor and driver
 * on express rows.
 */
export async function runImportInvoiceCli(argv: string[], pool: Pool): Promise<number> {
  const args = parseImportInvoiceArgs(argv);
  if ("error" in args) {
    console.error(args.error);
    return 1;
  }
  const { filePath, fxCadPerUsd } = args;

  try {
    const buffer = readFileSync(filePath);
    const sourceFilename = path.basename(filePath);
    const format = detectInvoiceFormat(sourceFilename, buffer);
    if (format === null) {
      console.error(`${sourceFilename}: neither a CSV nor a PDF invoice export`);
      return 1;
    }

    const result = await importInvoice(pool, buffer, { sourceFilename }, {
      ...(format === "pdf" ? { parse: parseInvoicePdf } : {}),
      ...(fxCadPerUsd !== undefined ? { fxCadPerUsd } : {}),
    });

    switch (result.status) {
      case "imported":
        printReport(result.report);
        if (fxCadPerUsd !== undefined) {
          console.log(`exchange rate:       ${fxCadPerUsd} CAD per USD`);
        }
        return 0;
      case "duplicate":
        console.log(`already imported — invoice ${result.report.invoiceNumber} unchanged`);
        if (fxCadPerUsd !== undefined) {
          console.log("exchange rate not applied — correct it on the Overview (PATCH /invoices/{id})");
        }
        printReport(result.report);
        return 0;
      case "quarantined":
        console.error(`quarantined — invoice ${result.report.invoiceNumber}`);
        for (const rejection of result.report.rejections) {
          console.error(`  ${rejection.code}: ${rejection.message}`);
        }
        return 1;
      case "conflict":
        console.error(result.message);
        return 1;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const pool = getPool();
  runImportInvoiceCli(process.argv.slice(2), pool)
    .then(async (exitCode) => {
      process.exitCode = exitCode;
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      await pool.end();
    });
}
