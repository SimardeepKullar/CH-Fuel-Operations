import type { Pool } from "pg";

export interface PriceSheetSummary {
  id: string;
  effectiveOn: string;
  importedAt: string;
  rowCount: number;
  stationCount: number;
}

interface PriceSheetRow {
  id: string;
  effective_on: string;
  imported_at: Date;
  row_count: number | null;
  station_count: string;
}

/**
 * `GET /price-sheets` (UI contract §6.1) — the sheet picker's data source,
 * newest first. `stationCount` is the only one of the four not already on
 * `price_imports`: distinct stations actually priced on that sheet, from
 * `station_prices`. `importedAt` reads `completed_at`, not `received_at` —
 * `ingestFile` never writes the latter, so it is always null in practice.
 * Only `status = 'completed'` imports are offered; the sheet picker has
 * nothing to show for one that never finished.
 */
export async function listPriceSheets(pool: Pool): Promise<PriceSheetSummary[]> {
  const { rows } = await pool.query<PriceSheetRow>(
    `SELECT pi.id,
            to_char(pi.effective_date, 'YYYY-MM-DD') AS effective_on,
            pi.completed_at AS imported_at,
            pi.rows_accepted AS row_count,
            count(DISTINCT sp.station_id) AS station_count
     FROM price_imports pi
     LEFT JOIN station_prices sp ON sp.import_id = pi.id
     WHERE pi.status = 'completed'
     GROUP BY pi.id
     ORDER BY pi.effective_date DESC, pi.completed_at DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    effectiveOn: row.effective_on,
    importedAt: row.imported_at.toISOString(),
    rowCount: row.row_count ?? 0,
    stationCount: Number(row.station_count),
  }));
}
