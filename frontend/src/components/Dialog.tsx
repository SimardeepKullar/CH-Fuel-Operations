"use client";

import { useEffect, type ReactNode } from "react";

interface DialogProps {
  /** The dialog's accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** The panel's `id`, when something links to it. */
  id?: string;
  /** Test ids for the panel and its backdrop. */
  testId?: string;
  backdropTestId?: string;
}

/**
 * The modal shell the Overview's rates pop-up (T-68) and the Import screen's rate prompt (T-67)
 * share: a backdrop, `role="dialog"`, and Escape or a click on the backdrop to dismiss. The
 * content brings its own heading and buttons.
 */
export default function Dialog({ label, onClose, children, className = "", id, testId, backdropTestId }: DialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ov-modal-backdrop"
      data-testid={backdropTestId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={`ov-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-label={label} id={id} data-testid={testId}>
        {children}
      </section>
    </div>
  );
}
