"use client";

import { createContext, useContext } from "react";
import type { StandingCounts } from "./useStandingCounts";

type StandingCountsValue = Pick<StandingCounts, "receipts" | "flags"> & Partial<Pick<StandingCounts, "refresh">>;

/** The shell's standing Receipts/Flags counts (T-39), shared so a page's banner can show them
 * without a second pair of requests. `refresh` is optional so a test that provides only the counts
 * still type-checks; the Receipt Queue calls it when present (T-43). */
const StandingCountsContext = createContext<StandingCountsValue>({ receipts: null, flags: null });

export const StandingCountsProvider = StandingCountsContext.Provider;

export function useStandingCountsValue(): StandingCountsValue {
  return useContext(StandingCountsContext);
}
