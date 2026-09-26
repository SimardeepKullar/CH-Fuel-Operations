"use client";

import { useRouter } from "next/navigation";
import RecentTab from "../../../components/RecentTab";

/** Plans (v1's Recent tab, re-hosted by T-39 — behaviour unchanged). Opening
 * a plan navigates to New Plan with `?planId=`, since the two are now
 * separate routes rather than tab state on one page. */
export default function PlansPage() {
  const router = useRouter();

  function openPlan(planId: string) {
    router.push(`/?planId=${planId}`);
  }

  return <RecentTab currentPlanId={null} onOpenPlan={openPlan} />;
}
