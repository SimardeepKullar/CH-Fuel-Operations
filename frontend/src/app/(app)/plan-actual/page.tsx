"use client";

import { useMemo } from "react";
import { useWeek } from "../../../hooks/useWeek";
import { useOverviewScope } from "../../../hooks/useOverviewScope";
import { actualRange, formatDay } from "../../../lib/weeks";
import { weekEndsInScope } from "../../../lib/overviewScope";
import { rangeLabel, scopeReadout } from "../../../lib/overviewView";
import PageBanner from "../../../components/PageBanner";
import ScopeControl from "../../../components/ScopeControl";
import ScreenStub from "../../../components/ScreenStub";

/** Plan vs Actual (T-46, not built): the banner and its scope control are in place so the
 * screen reads like the Overview once its content lands. */
export default function PlanActualPage() {
  const { weeks } = useWeek();
  const ascending = useMemo(() => [...weeks].reverse(), [weeks]);
  const scopeWeeks = useMemo(
    () =>
      ascending.map((w) => {
        const ranges = w.invoices.map(actualRange);
        const start = ranges.map((r) => r.start).sort()[0] ?? w.weekEnd;
        const end = ranges.map((r) => r.end).sort().at(-1) ?? w.weekEnd;
        return { weekEnd: w.weekEnd, label: rangeLabel(start, end), start, end };
      }),
    [ascending],
  );
  const { scope, setScope } = useOverviewScope(scopeWeeks.map((w) => w.weekEnd));
  const covered = new Set(weekEndsInScope(scope, scopeWeeks.map((w) => w.weekEnd)));
  const inScope = scopeWeeks.filter((w) => covered.has(w.weekEnd));
  const readout =
    inScope.length === 0
      ? undefined
      : scopeReadout(scope, inScope.length, inScope.length === 1 ? inScope[0]!.label : `${formatDay(inScope[0]!.start)} – ${formatDay(inScope.at(-1)!.end)}`);

  return (
    <>
      <PageBanner title="Plan vs Actual" controls={<ScopeControl scope={scope} weeks={scopeWeeks} onChange={setScope} />} readout={readout} />
      <ScreenStub title="Plan vs Actual" ticket="T-46" />
    </>
  );
}
