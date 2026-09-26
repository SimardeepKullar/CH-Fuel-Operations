export type InvoiceFormat = "csv" | "pdf";

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * Which of BVD's two exports this file is.
 *
 * Magic bytes decide first, because an upload's name can lie about its
 * contents; the extension is a fallback for a PDF whose bytes did not survive
 * intact. Anything else is neither format, and callers reject it rather than
 * guessing — a mis-detected file would be parsed against the wrong column
 * layout entirely.
 *
 * Pure — no I/O of its own; the caller has already read the bytes.
 */
export function detectInvoiceFormat(filename: string, buffer: Buffer): InvoiceFormat | null {
  if (buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return "pdf";
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    return "csv";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  return null;
}
