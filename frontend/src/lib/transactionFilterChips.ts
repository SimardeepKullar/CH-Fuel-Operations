/**
 * What the Transactions filter bar says about the filters in force (T-87): the
 * Flags button's value and one removable chip per active filter. Pure — the
 * components lay these out and the URL stays the only state.
 */
import { flagLabel } from "../components/AnomalyFlag";
import type { FilterOption } from "../hooks/useTransactionFilterOptions";
import type { TransactionFiltersState } from "../hooks/useTransactionFilters";
import { PRODUCT_OPTIONS, RECEIPT_STATUS_OPTIONS } from "./transactionFilterConstants";

/** The filter keys a chip or the Flags menu writes, all at once. */
export type ChipPatch = Partial<Pick<TransactionFiltersState, "q" | "driverId" | "truckId" | "cardId" | "state" | "product" | "receiptStatus" | "flags" | "anomalyOnly">>;

export interface FilterChip {
  key: string;
  label: string;
  value: string;
  /** The × button's accessible name. */
  removeLabel: string;
  clear: ChipPatch;
}

interface ChipOptions {
  drivers: FilterOption[];
  trucks: FilterOption[];
  cards: FilterOption[];
  states: FilterOption[];
}

export function optionLabel(options: FilterOption[], value: string): string | null {
  return options.find((o) => o.value === value)?.label ?? null;
}

/** `All`, `Any flag`, the one rule picked, or `2 flags`. */
export function flagsValueLabel(filters: Pick<TransactionFiltersState, "flags" | "anomalyOnly">): string {
  const rules = filters.flags === "" ? [] : filters.flags.split(",");
  if (rules.length === 1) return flagLabel(rules[0]!);
  if (rules.length > 1) return `${rules.length} flags`;
  return filters.anomalyOnly ? "Any flag" : "All";
}

/** One chip per active filter, and one per flag, in the bar's order. A value whose
 * option has not loaded (a driver off the list) still gets a chip, so it can be removed. */
export function activeFilterChips(filters: TransactionFiltersState, options: ChipOptions): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (key: keyof ChipPatch, label: string, value: string, clear: ChipPatch) =>
    chips.push({ key, label, value, removeLabel: `Remove ${label.toLowerCase()} filter`, clear });

  if (filters.q !== "") add("q", "Search", filters.q, { q: "" });
  if (filters.driverId !== "") add("driverId", "Driver", optionLabel(options.drivers, filters.driverId) ?? "Selected", { driverId: "" });
  if (filters.truckId !== "") add("truckId", "Truck", optionLabel(options.trucks, filters.truckId) ?? "Selected", { truckId: "" });
  if (filters.product !== "") add("product", "Product", optionLabel(PRODUCT_OPTIONS, filters.product) ?? filters.product, { product: "" });
  if (filters.receiptStatus !== "") add("receiptStatus", "Receipt", optionLabel(RECEIPT_STATUS_OPTIONS, filters.receiptStatus) ?? filters.receiptStatus, { receiptStatus: "" });
  if (filters.anomalyOnly) add("anomalyOnly", "Flags", "Any flag", { anomalyOnly: false });

  const rules = filters.flags === "" ? [] : filters.flags.split(",");
  for (const rule of rules) {
    chips.push({
      key: `flag:${rule}`,
      label: "Flags",
      value: flagLabel(rule),
      removeLabel: `Remove ${flagLabel(rule)} flag filter`,
      clear: { flags: rules.filter((r) => r !== rule).join(",") },
    });
  }

  if (filters.cardId !== "") add("cardId", "Card", optionLabel(options.cards, filters.cardId) ?? filters.cardId, { cardId: "" });
  if (filters.state !== "") add("state", "State", optionLabel(options.states, filters.state) ?? filters.state, { state: "" });
  return chips;
}
