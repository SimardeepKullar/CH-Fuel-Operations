import type { PriceSheetSummary } from "@ch/core/catalog/priceSheets";
import { listPriceSheets } from "../lib/api";
import { useApiResource } from "./useApiResource";

/** `GET /price-sheets` — the sheet picker (UI contract §3.6), newest first. */
export function usePriceSheets() {
  const { data, loading, error, refetch } = useApiResource(listPriceSheets);
  return { sheets: data ?? ([] as PriceSheetSummary[]), loading, error, refetch };
}
