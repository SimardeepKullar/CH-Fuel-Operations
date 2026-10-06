import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface TransactionFiltersState {
  q: string;
  driverId: string;
  truckId: string;
  cardId: string;
  state: string;
  product: string;
  receiptStatus: string;
  anomalyOnly: boolean;
}

const EMPTY: TransactionFiltersState = {
  q: "",
  driverId: "",
  truckId: "",
  cardId: "",
  state: "",
  product: "",
  receiptStatus: "",
  anomalyOnly: false,
};

const FILTER_KEYS = Object.keys(EMPTY) as (keyof TransactionFiltersState)[];

export interface UseTransactionFiltersResult {
  filters: TransactionFiltersState;
  setFilter: (key: keyof TransactionFiltersState, value: string | boolean) => void;
  clearFilters: () => void;
}

/**
 * A8.3's filters, round-tripped through the URL's query string (T-40 DoD:
 * "every filter round-trips ... so a filtered view is linkable"). `week`
 * is deliberately not one of these keys — that's the shell's week context's own
 * param (A7), read/written independently; both hooks preserve whatever
 * params the other owns by reading `searchParams` fresh on every write.
 */
export function useTransactionFilters(): UseTransactionFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<TransactionFiltersState>(
    () => ({
      q: searchParams.get("q") ?? "",
      driverId: searchParams.get("driverId") ?? "",
      truckId: searchParams.get("truckId") ?? "",
      cardId: searchParams.get("cardId") ?? "",
      state: searchParams.get("state") ?? "",
      product: searchParams.get("product") ?? "",
      receiptStatus: searchParams.get("receiptStatus") ?? "",
      anomalyOnly: searchParams.get("anomalyOnly") === "true",
    }),
    [searchParams],
  );

  const setFilter = useCallback(
    (key: keyof TransactionFiltersState, value: string | boolean) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === "" || value === false) {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
      router.replace(`${pathname}?${next.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_KEYS) next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }, [router, pathname, searchParams]);

  return { filters, setFilter, clearFilters };
}
