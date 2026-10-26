"use client";

import { createContext, useContext } from "react";
import type { StandingCounts } from "./useStandingCounts";

/** The shell's standing Receipts/Flags counts (T-39), shared so a page's banner can show them
 * without a second pair of requests. */
const StandingCountsContext = createContext<Pick<StandingCounts, "receipts" | "flags">>({ receipts: null, flags: null });

export const StandingCountsProvider = StandingCountsContext.Provider;

export function useStandingCountsValue(): Pick<StandingCounts, "receipts" | "flags"> {
  return useContext(StandingCountsContext);
}
