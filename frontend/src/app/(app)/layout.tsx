"use client";

import type { ReactNode } from "react";
import Sidebar from "../../components/Sidebar";
import TopBar from "../../components/TopBar";
import { useStandingCounts } from "../../hooks/useStandingCounts";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../App.css";

/**
 * T-39: the shell every Phase 9 screen mounts into (D15, A7). Fetches the
 * standing receipt/flag counts once here — not in `Sidebar` or `TopBar`
 * individually — because this layout persists across navigation within
 * `(app)`, so it is one pair of requests per session, not one per route.
 */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  const { receipts, flags } = useStandingCounts();
  const pendingReceipts = receipts ? receipts.total - receipts.done : null;

  return (
    <div className="app-shell">
      <Sidebar pendingReceipts={pendingReceipts} />
      <div className="app-shell-main">
        <TopBar receipts={receipts} flags={flags} />
        <main className="app-shell-content">{children}</main>
      </div>
    </div>
  );
}
