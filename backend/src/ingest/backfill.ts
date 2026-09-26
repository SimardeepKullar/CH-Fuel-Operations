import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { ingestFile } from "./ingestFile.js";
import type { IngestReport } from "./report.js";

export interface BackfillFile {
  filename: string;
  path: string;
}

export interface BackfillFileResult {
  filename: string;
  status: "completed" | "deduped" | "failed";
  report?: IngestReport;
  error?: string;
}

export interface BackfillResult {
  batchId: string;
  fileCount: number;
  files: BackfillFileResult[];
}

export interface BackfillMeta {
  supplier?: string;
  label?: string;
}

/**
 * Runs a batch of already-resolved files through `ingestFile`, one at a
 * time, recording a per-file result instead of letting one bad sheet throw
 * out of the whole run. Because `valid_on` is a single date per file rather
 * than a range, files can arrive in any order — the unique constraint only
 * fires on a genuine duplicate, so the resulting database state does not
 * depend on processing order.
 */
export async function backfillFiles(
  pool: Pool,
  files: readonly BackfillFile[],
  meta: BackfillMeta = {},
): Promise<BackfillResult> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO import_batches (label, file_count) VALUES ($1, $2) RETURNING id`,
    [meta.label ?? null, files.length],
  );
  const batchId = rows[0]?.id;
  if (!batchId) {
    throw new Error("import_batches insert returned no id");
  }

  const results: BackfillFileResult[] = [];
  for (const file of files) {
    try {
      const buffer = readFileSync(file.path);
      const report = await ingestFile(pool, buffer, {
        sourceFilename: file.filename,
        supplier: meta.supplier,
        batchId,
      });
      results.push({
        filename: file.filename,
        status: report.deduped ? "deduped" : "completed",
        report,
      });
    } catch (err) {
      results.push({
        filename: file.filename,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await pool.query(`UPDATE import_batches SET completed_at = now() WHERE id = $1`, [batchId]);

  return { batchId, fileCount: files.length, files: results };
}

/**
 * Walks a directory of BVD sheets and runs them through `backfillFiles`.
 * Filenames are sorted before processing purely for reproducible CLI
 * output — correctness does not depend on the order (see `backfillFiles`).
 */
export async function backfillDirectory(
  pool: Pool,
  dirPath: string,
  meta: BackfillMeta = {},
): Promise<BackfillResult> {
  const filenames = readdirSync(dirPath)
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort();
  const files = filenames.map((filename) => ({
    filename,
    path: path.join(dirPath, filename),
  }));

  return backfillFiles(pool, files, {
    ...meta,
    label: meta.label ?? path.basename(dirPath),
  });
}
