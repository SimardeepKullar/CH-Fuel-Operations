"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PageBanner from "../../../components/PageBanner";
import RecentTab from "../../../components/RecentTab";
import SegmentedControl from "../../../components/SegmentedControl";

type PlanFilter = "all" | "draft" | "sent";

/** Plans (v1's Recent tab, re-hosted by T-39). Opening a plan navigates to New Plan with
 * `?planId=`, since the two are separate routes. The banner's switch filters by whether the
 * plan has gone to the driver. */
export default function PlansPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<PlanFilter>("all");

  function openPlan(planId: string) {
    router.push(`/?planId=${planId}`);
  }

  return (
    <>
      <PageBanner
        title="Plans"
        controls={
          <SegmentedControl<PlanFilter>
            ariaLabel="Plan status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "draft", label: "Draft" },
              { value: "sent", label: "Sent" },
            ]}
          />
        }
        readout="Solved plans, newest first — open one to load it into New Plan"
      />
      <RecentTab currentPlanId={null} onOpenPlan={openPlan} filter={filter} />
    </>
  );
}
