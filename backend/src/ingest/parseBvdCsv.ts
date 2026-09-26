import { parse } from "csv-parse/sync";

/**
 * The 15-column BVD header, in order, after normalisation (trim, uppercase,
 * collapse internal whitespace). All 31 January files and the August sheet
 * share this exact shape, so the gate can be strict (§4.1 / BUILD-PLAN 6.1).
 */
const EXPECTED_HEADER = [
  "SITE",
  "NAME",
  "CITY",
  "STATE",
  "PROD",
  "COST",
  "FEDERAL TAX",
  "STATE TAX",
  "SALES TAX",
  "FREIGHT",
  "OTHER",
  "TOTAL COST",
  "RETAIL PRICE",
  "YOUR PRICE",
  "SAVINGS",
] as const;

export class BvdCsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BvdCsvFormatError";
  }
}

/** One data row, straight off the sheet — every field still a raw string. */
export interface RawBvdRow {
  /** 1-based line number in the source file, for rejection reporting. */
  lineNumber: number;
  site: string;
  name: string;
  city: string;
  state: string;
  prod: string;
  cost: string;
  federalTax: string;
  stateTax: string;
  salesTax: string;
  freight: string;
  other: string;
  totalCost: string;
  retailPrice: string;
  yourPrice: string;
  savings: string;
}

export interface ParsedBvdFile {
  companyId: string;
  /** ISO date (yyyy-mm-dd), trusted directly from the header — no +1 offset. */
  effectiveDate: string;
  rows: RawBvdRow[];
}

export function normaliseHeaderCell(cell: string): string {
  return cell.trim().toUpperCase().replace(/\s+/g, " ");
}

function findLabelledValue(metaFields: string[], label: string): string {
  const labelNormalised = label.trim().toUpperCase();
  for (let i = 0; i < metaFields.length; i++) {
    const field = metaFields[i]?.trim().toUpperCase().replace(/:\s*$/, "");
    if (field === labelNormalised) {
      const value = metaFields[i + 1]?.trim();
      if (value) {
        return value;
      }
      throw new BvdCsvFormatError(`metadata row: "${label}" has no value`);
    }
  }
  throw new BvdCsvFormatError(`metadata row: "${label}" not found`);
}

/**
 * Parses BVD's daily price sheet: line 1 is metadata (company id, effective
 * date), line 2 is the header, and the rest are data rows. Trusts the
 * header's effective date exactly as written — the file arrives on day N
 * stating day N+1, and the header is already correct (§4.1).
 *
 * Rejects (throws) on a header shape that does not match. It does not
 * coerce a differently-shaped sheet into the expected one.
 */
export function parseBvdCsv(input: Buffer | string): ParsedBvdFile {
  const records: string[][] = parse(input, {
    relax_column_count: true,
    skip_empty_lines: true,
  });

  const metaRow = records[0];
  if (!metaRow) {
    throw new BvdCsvFormatError("file is empty");
  }
  const companyId = findLabelledValue(metaRow, "Company Id");
  const effectiveDate = findLabelledValue(metaRow, "Effective Date");

  const headerRow = records[1];
  if (!headerRow) {
    throw new BvdCsvFormatError("missing header row");
  }
  const normalisedHeader = headerRow.map(normaliseHeaderCell);
  if (
    normalisedHeader.length !== EXPECTED_HEADER.length ||
    !EXPECTED_HEADER.every((col, i) => normalisedHeader[i] === col)
  ) {
    throw new BvdCsvFormatError(
      `unexpected header shape: got [${normalisedHeader.join(", ")}]`,
    );
  }

  const rows: RawBvdRow[] = [];
  for (let i = 2; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length === 0) {
      continue;
    }
    if (record.length !== EXPECTED_HEADER.length) {
      throw new BvdCsvFormatError(
        `line ${i + 1}: expected ${EXPECTED_HEADER.length} columns, got ${record.length}`,
      );
    }
    rows.push({
      lineNumber: i + 1,
      site: record[0] ?? "",
      name: record[1] ?? "",
      city: record[2] ?? "",
      state: record[3] ?? "",
      prod: record[4] ?? "",
      cost: record[5] ?? "",
      federalTax: record[6] ?? "",
      stateTax: record[7] ?? "",
      salesTax: record[8] ?? "",
      freight: record[9] ?? "",
      other: record[10] ?? "",
      totalCost: record[11] ?? "",
      retailPrice: record[12] ?? "",
      yourPrice: record[13] ?? "",
      savings: record[14] ?? "",
    });
  }

  return { companyId, effectiveDate, rows };
}
