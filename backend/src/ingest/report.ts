import type { ValidationRejection } from "./validate.js";

/**
 * §11.1 step 7: rows read/accepted/rejected with reasons, new stations,
 * unmapped product codes, stations that vanished from this sheet.
 */
export interface IngestReport {
  sourceFilename: string;
  companyId: string;
  effectiveDate: string;
  fileSha256: string;
  /** True when this call found an existing completed import by hash and
   * wrote nothing — the report describes that prior import, unchanged. */
  deduped: boolean;
  rowsRead: number;
  rowsAccepted: number;
  rowsRejected: number;
  rejections: ValidationRejection[];
  newStations: string[];
  unmappedProducts: string[];
  vanishedStations: string[];
}

export interface BuildReportInput {
  sourceFilename: string;
  companyId: string;
  effectiveDate: string;
  fileSha256: string;
  deduped: boolean;
  rowsRead: number;
  rejections: ValidationRejection[];
  newStations: string[];
  vanishedStations: string[];
}

/**
 * Pure: assembles the report from data the caller (`ingestFile`) already
 * gathered. No database, no HTTP, no clock — just shaping and counting.
 */
export function buildReport(input: BuildReportInput): IngestReport {
  const rowsRejected = input.rejections.length;
  const rowsAccepted = input.rowsRead - rowsRejected;

  const unmappedProducts = [
    ...new Set(
      input.rejections
        .filter((r) => r.code === "UNMAPPED_PRODUCT")
        .map((r) => r.rawProduct),
    ),
  ];

  return {
    sourceFilename: input.sourceFilename,
    companyId: input.companyId,
    effectiveDate: input.effectiveDate,
    fileSha256: input.fileSha256,
    deduped: input.deduped,
    rowsRead: input.rowsRead,
    rowsAccepted,
    rowsRejected,
    rejections: input.rejections,
    newStations: input.newStations,
    unmappedProducts,
    vanishedStations: input.vanishedStations,
  };
}
