"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { TrendGrain } from "../lib/overviewAggregate";

/** The URL key for the trend cards' Week / Month choice (T-89). Not a scope key, so a scope change keeps it. */
export const TREND_PARAM = "trend";

/** Anything but `month` is Week, the default. */
export function parseTrendGrain(params: { get(name: string): string | null }): TrendGrain {
  return params.get(TREND_PARAM) === "month" ? "month" : "week";
}

/** The trend cards' grain, kept in the URL so a reload and a link carry it. Week is the default and leaves the URL clean. */
export function useTrendGrain(): { grain: TrendGrain; setGrain: (grain: TrendGrain) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const grain = parseTrendGrain(searchParams);

  const setGrain = useCallback(
    (next: TrendGrain) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "month") params.set(TREND_PARAM, "month");
      else params.delete(TREND_PARAM);
      const query = params.toString();
      router.replace(query === "" ? pathname : `${pathname}?${query}`);
    },
    [router, pathname, searchParams],
  );

  return { grain, setGrain };
}
