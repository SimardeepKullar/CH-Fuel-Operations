"use client";

import { usePathname } from "next/navigation";
import InvoicesInView from "./InvoicesInView";
import PageBanner from "./PageBanner";
import WeekSelector from "./WeekSelector";

/** The banner title per route. */
const SCREEN_TITLES: Record<string, string> = {
  "/": "New Plan",
  "/plans": "Plans",
  "/overview": "Overview",
  "/transactions": "Transactions",
  "/receipt-queue": "Receipt Queue",
  "/other-charges": "Other Charges",
  "/import": "Import",
  "/drivers": "Drivers",
  "/trucks": "Trucks",
  "/stations": "Stations",
  "/plan-actual": "Plan vs Actual",
  "/settings": "Settings",
};

/**
 * Screens that render their own `PageBanner` — they have controls of their own
 * (a scope, a Draft/Sent switch, counts) — so the shell draws no header over them.
 */
export const OWN_BANNER = new Set(["/", "/plans", "/overview", "/transactions", "/import", "/plan-actual", "/receipt-queue"]);

/** Screens governed by the shell's single billing-week selector. The Receipt Queue is not one: it is a standing worklist across every week (D17). */
const WEEK_ROUTES = new Set(["/other-charges", "/drivers", "/trucks", "/stations"]);

/**
 * The default page header (T-75): a `PageBanner` for every screen that does not draw its
 * own. Screens still behind "later" carry the billing-week selector and the "Invoices in
 * view" strip, as before; Settings has neither.
 */
export default function TopBar() {
  const pathname = usePathname();
  if (OWN_BANNER.has(pathname)) return null;
  const showWeek = WEEK_ROUTES.has(pathname);

  return (
    <>
      <PageBanner title={SCREEN_TITLES[pathname] ?? "Fuel operations"} controls={showWeek ? <WeekSelector /> : undefined} />
      {showWeek && <InvoicesInView />}
    </>
  );
}
