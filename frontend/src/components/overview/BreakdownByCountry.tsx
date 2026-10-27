"use client";

import { useState, type ReactNode } from "react";
import Corners from "../Corners";

/** The US and Canada cards under one collapsible header. Kept mounted when folded so each card's units toggle survives. */
export default function BreakdownByCountry({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="ov-card ov-drivers ov-breakdown blueprint" aria-label="Breakdown by country" data-testid="country-breakdown">
      <Corners />
      <button type="button" className="ov-drivers-head" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="breakdown-toggle">
        <svg className="ov-drivers-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="1" y="2" width="8" height="16" fill="#16205c" />
          <rect x="11" y="2" width="8" height="16" fill="#00a6e2" />
        </svg>
        <span className="ov-drivers-titles">
          <h2 className="ov-section-title">Breakdown by country</h2>
          <span className="ov-region-sub">US in USD and gallons · Canada in CAD and litres</span>
        </span>
        <span className="ov-hide">{open ? "Hide ▴" : "Show ▾"}</span>
      </button>
      <div className="ov-drivers-body ov-breakdown-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
