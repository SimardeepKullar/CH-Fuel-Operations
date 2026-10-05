"use client";

import { usePathname } from "next/navigation";
import InvoicesInView from "./InvoicesInView";
import WeekSelector from "./WeekSelector";

interface ScreenCopy {
  title: string;
  subtitle: string;
}

const SCREEN_COPY: Record<string, ScreenCopy> = {
  "/": {
    title: "Plan · New Plan",
    subtitle: "Cheapest compliant Love’s stops · 350–500 mi legs · starts at 100% fuel",
  },
  "/plans": {
    title: "Plan · Plans",
    subtitle: "Solved plans, newest first — open one to load it into New Plan",
  },
  "/overview": { title: "Actuals · Overview", subtitle: "Governed by the billing week selected above" },
  "/transactions": {
    title: "Actuals · Transactions",
    subtitle: "Every fuel stop in the selected week — one row per auth code",
  },
  "/receipt-queue": { title: "Actuals · Receipt Queue", subtitle: "Governed by the billing week selected above" },
  "/other-charges": { title: "Actuals · Other Charges", subtitle: "Governed by the billing week selected above" },
  "/import": { title: "Actuals · Import", subtitle: "Governed by the billing week selected above" },
  "/drivers": { title: "Analysis · Drivers", subtitle: "Governed by the billing week selected above" },
  "/trucks": { title: "Analysis · Trucks", subtitle: "Governed by the billing week selected above" },
  "/stations": { title: "Analysis · Stations", subtitle: "Governed by the billing week selected above" },
  "/plan-actual": {
    title: "Analysis · Plan vs Actual",
    subtitle: "Recommendation against receipt — live on the current invoice, or backtested over history",
  },
  "/settings": { title: "Settings", subtitle: "Card→truck→driver assignments, aliases and thresholds" },
};

const DEFAULT_COPY: ScreenCopy = { title: "Fuel operations", subtitle: "" };

/** A7: the week selector governs Actuals and Analysis; Plan screens show
 * their own price-sheet date instead (`PlanTab`'s existing sheet bar). */
const PLAN_ROUTES = new Set(["/", "/plans"]);

/**
 * The standing Receipts/Flags chips are scoped to Transactions only for now
 * — Receipt Queue, Other Charges, Overview etc. don't have real content yet
 * (T-42…T-47), so showing a system-wide count next to a stub screen implies
 * a connection to that screen's own data which doesn't exist. Revisit this
 * set as each screen's real content lands.
 */
const STANDING_COUNTS_ROUTES = new Set(["/transactions"]);

interface TopBarProps {
  receipts: { done: number; total: number } | null;
  flags: number | null;
}

export default function TopBar({ receipts, flags }: TopBarProps) {
  const pathname = usePathname();
  const copy = SCREEN_COPY[pathname] ?? DEFAULT_COPY;
  const showWeek = !PLAN_ROUTES.has(pathname);
  const showStandingCounts = STANDING_COUNTS_ROUTES.has(pathname);

  return (
    <>
      <div className="topbar-bar">
        <div className="topbar-titles">
          <span className="topbar-title">{copy.title}</span>
          <span className="topbar-subtitle">{copy.subtitle}</span>
        </div>

        <div className="topbar-right">
          {showWeek && <WeekSelector />}
          {showStandingCounts && (
            <span className="topbar-standing">
              <span className="topbar-standing-label">Receipts</span>
              <span className="topbar-standing-value">{receipts ? `${receipts.done}/${receipts.total}` : "—"}</span>
              <span className="topbar-standing-label topbar-standing-flags-label">Flags</span>
              <span className="topbar-standing-value topbar-standing-flags-value">{flags ?? "—"}</span>
            </span>
          )}
        </div>
      </div>
      {showWeek && <InvoicesInView />}
    </>
  );
}
