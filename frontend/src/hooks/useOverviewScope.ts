"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseScope, writeScope, type Scope } from "../lib/overviewScope";

/**
 * The time scope, kept in the URL (T-71) so a link, a reload and the back button
 * all carry it. `weekEnds` is every billing week end, ascending. Choosing a scope
 * replaces the URL's scope keys and leaves any other key alone.
 */
export function useOverviewScope(weekEnds: readonly string[]): { scope: Scope; setScope: (scope: Scope) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = weekEnds.join(",");

  const scope = useMemo(() => parseScope(searchParams, key === "" ? [] : key.split(",")), [searchParams, key]);

  const setScope = useCallback(
    (next: Scope) => {
      const params = new URLSearchParams(searchParams.toString());
      writeScope(params, next);
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return { scope, setScope };
}
