import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { parseBvdCsv } from "./parseBvdCsv.js";
import { validateRow, type ValidatedRow, type ValidationRejection } from "./validate.js";
import { buildReport, type IngestReport } from "./report.js";
import type { ProductType } from "../db/types.js";
import { normalizeCity } from "../resolution/cityNormalize.js";

const DEFAULT_SUPPLIER = "BVD";

export interface IngestFileMeta {
  sourceFilename: string;
  supplier?: string;
  batchId?: string | null;
}

interface ExistingImportRow {
  report: IngestReport;
}

async function findCompletedImport(
  pool: Pool,
  fileSha256: string,
): Promise<IngestReport | null> {
  const { rows } = await pool.query<ExistingImportRow>(
    `SELECT report FROM price_imports WHERE file_sha256 = $1 AND status = 'completed'`,
    [fileSha256],
  );
  const existing = rows[0];
  return existing ? existing.report : null;
}

async function loadProductCodes(
  pool: Pool,
  supplier: string,
): Promise<Map<string, ProductType>> {
  const { rows } = await pool.query<{ raw_code: string; product_type: ProductType }>(
    "SELECT raw_code, product_type FROM product_codes WHERE supplier = $1",
    [supplier],
  );
  return new Map(rows.map((row) => [row.raw_code, row.product_type]));
}

async function loadKnownSiteRefs(pool: Pool, supplier: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ site_ref: string }>(
    "SELECT site_ref FROM stations WHERE supplier = $1",
    [supplier],
  );
  return new Set(rows.map((row) => row.site_ref));
}

async function upsertStation(
  client: PoolClient,
  supplier: string,
  row: ValidatedRow,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO stations (supplier, site_ref, name_raw, city_raw, city_normalized, state_usps, country)
     VALUES ($1, $2, $3, $4, $5, $6, 'US')
     ON CONFLICT (supplier, site_ref) DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [supplier, row.siteRef, row.nameRaw, row.cityRaw, normalizeCity(row.cityRaw), row.stateUsps],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(`station upsert for site_ref ${row.siteRef} returned no id`);
  }
  return id;
}

async function insertStationPrice(
  client: PoolClient,
  stationId: string,
  importId: string,
  row: ValidatedRow,
  validOn: string,
): Promise<void> {
  await client.query(
    `INSERT INTO station_prices
       (station_id, import_id, raw_product, product_type,
        cost, federal_tax, state_tax, sales_tax, freight, other,
        total_cost, retail_price, your_price, savings, valid_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (station_id, raw_product, valid_on) DO NOTHING`,
    [
      stationId,
      importId,
      row.rawProduct,
      row.productType,
      row.cost,
      row.federalTax,
      row.stateTax,
      row.salesTax,
      row.freight,
      row.other,
      row.totalCost,
      row.retailPrice,
      row.yourPrice,
      row.savings,
      validOn,
    ],
  );
}

async function insertRejection(
  client: PoolClient,
  importId: string,
  rejection: ValidationRejection,
): Promise<void> {
  await client.query(
    `INSERT INTO import_rejections (import_id, line_number, site_ref, code, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [importId, rejection.lineNumber, rejection.siteRef, rejection.code, rejection.message],
  );
}

/**
 * §11.1's seven steps as one function: hash → dedupe → stage → validate →
 * promote only accepted rows → upsert stations → insert prices → report.
 *
 * Does no HTTP, reads no process.argv, and prints nothing — the CLI in
 * cli/ingest.ts is the only caller in v1, and the only one that touches
 * stdout. That split is what makes the deferred upload route and Gmail
 * poller wrappers rather than rewrites (§11.1, §11.2, §20).
 */
export async function ingestFile(
  pool: Pool,
  buffer: Buffer,
  meta: IngestFileMeta,
): Promise<IngestReport> {
  const supplier = meta.supplier ?? DEFAULT_SUPPLIER;
  const fileSha256 = createHash("sha256").update(buffer).digest("hex");

  const existingReport = await findCompletedImport(pool, fileSha256);
  if (existingReport) {
    return { ...existingReport, deduped: true };
  }

  const parsed = parseBvdCsv(buffer);
  const productCodes = await loadProductCodes(pool, supplier);
  const knownSiteRefsBefore = await loadKnownSiteRefs(pool, supplier);

  const accepted: ValidatedRow[] = [];
  const rejections: ValidationRejection[] = [];
  const siteRefsInFile = new Set<string>();

  for (const row of parsed.rows) {
    siteRefsInFile.add(row.site.trim());
    const result = validateRow(row, productCodes);
    if (result.ok) {
      accepted.push(result.row);
    } else {
      rejections.push(result.rejection);
    }
  }

  const newStations = [
    ...new Set(accepted.map((row) => row.siteRef)),
  ].filter((siteRef) => !knownSiteRefsBefore.has(siteRef));
  const vanishedStations = [...knownSiteRefsBefore].filter(
    (siteRef) => !siteRefsInFile.has(siteRef),
  );

  const report = buildReport({
    sourceFilename: meta.sourceFilename,
    companyId: parsed.companyId,
    effectiveDate: parsed.effectiveDate,
    fileSha256,
    deduped: false,
    rowsRead: parsed.rows.length,
    rejections,
    newStations,
    vanishedStations,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: importRows } = await client.query<{ id: string }>(
      `INSERT INTO price_imports
         (batch_id, supplier, company_id, country, source_filename, file_sha256,
          effective_date, status, rows_read, rows_accepted, rows_rejected, report,
          completed_at)
       VALUES ($1, $2, $3, 'US', $4, $5, $6, 'completed', $7, $8, $9, $10, now())
       RETURNING id`,
      [
        meta.batchId ?? null,
        supplier,
        parsed.companyId,
        meta.sourceFilename,
        fileSha256,
        parsed.effectiveDate,
        report.rowsRead,
        report.rowsAccepted,
        report.rowsRejected,
        JSON.stringify(report),
      ],
    );
    const importId = importRows[0]?.id;
    if (!importId) {
      throw new Error("price_imports insert returned no id");
    }

    for (const row of accepted) {
      const stationId = await upsertStation(client, supplier, row);
      await insertStationPrice(client, stationId, importId, row, parsed.effectiveDate);
    }

    for (const rejection of rejections) {
      await insertRejection(client, importId, rejection);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return report;
}
