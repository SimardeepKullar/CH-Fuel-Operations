"use client";

import { useState } from "react";
import { usePublishViewSide, useWeek } from "./useWeek";
import { effectiveSide, type CurrencySide } from "../lib/weeks";

/**
 * The US | CA switch's state (T-64, D28), for any screen that mounts the
 * switch — Transactions now, Drivers/Trucks/Stations/Other Charges later.
 *
 * Local state, deliberately: it starts at US on every mount, so it is never
 * remembered across visits (including after a CA one) and nothing is written
 * to the URL or storage. The side is also published to the shell, which is
 * what the "Invoices in view" strip highlights — one value drives both the
 * request and the strip, so they cannot disagree.
 *
 * `side` is the one to read: the requested side, unless the selected week has
 * no invoice on it and has one on the other (a CA-only week reads CA rather
 * than showing an empty US page behind a disabled switch).
 */
export function useCurrencySide(): { side: CurrencySide; setSide: (side: CurrencySide) => void } {
  const { weekEntry } = useWeek();
  const [requested, setRequested] = useState<CurrencySide>("USD");
  const side = effectiveSide(weekEntry, requested);
  usePublishViewSide(side);
  return { side, setSide: setRequested };
}
