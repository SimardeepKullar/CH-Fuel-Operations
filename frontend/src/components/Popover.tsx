"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

interface PopoverProps {
  /** What the button shows. */
  trigger: ReactNode;
  triggerClassName: string;
  /** Needed when the trigger's own text would not name it (the unit column's `i`). */
  triggerLabel?: string;
  /** Names the panel for a screen reader. */
  panelLabel: string;
  panelClassName: string;
  /** `open` lets the trigger style itself and flip its chevron. */
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}

const GAP_PX = 6;
const EDGE_PX = 8;
const FOCUSABLE = "input, select, button, a[href]";

/**
 * A button and the panel it opens. Escape closes and returns focus to the button;
 * a click outside, or tabbing out, closes it.
 *
 * The panel is `position: fixed` because one of these sits in the transactions
 * table's header, inside the `overflow-x: auto` scroller that would clip anything
 * absolutely positioned. It follows the button when anything scrolls.
 */
export default function Popover({ trigger, triggerClassName, triggerLabel, panelLabel, panelClassName, children, onOpenChange }: PopoverProps) {
  const [open, setOpenState] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const place = useCallback(() => {
    const button = buttonRef.current?.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? 0;
    if (button === undefined) return;
    const rightmost = window.innerWidth - panelWidth - EDGE_PX;
    setPosition({ top: button.bottom + GAP_PX, left: Math.max(EDGE_PX, Math.min(button.left, rightmost)) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place, setOpen]);

  return (
    <span
      ref={rootRef}
      className="popover"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        // A null target is the window losing focus, not the dispatcher tabbing away.
        if (open && e.relatedTarget !== null && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-label={panelLabel} className={`popover-panel ${panelClassName}`} style={position}>
          {children}
        </div>
      )}
    </span>
  );
}
