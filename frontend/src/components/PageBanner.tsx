import type { ReactNode } from "react";

interface PageBannerProps {
  title: string;
  /** Segmented controls and pickers, right after the title. */
  controls?: ReactNode;
  /** The plain-text readout of what the page is showing. */
  readout?: ReactNode;
  /** Right-aligned meta: small muted text, then a link. */
  meta?: ReactNode;
}

/**
 * The blocky page header every screen uses (T-75): a cyan hairline over a white
 * band holding the title, the page's controls, a readout and a right-hand meta
 * line. No page styles its own header.
 */
export default function PageBanner({ title, controls, readout, meta }: PageBannerProps) {
  return (
    <header className="pb" data-testid="page-banner">
      <h1 className="pb-title">{title}</h1>
      {controls !== undefined && controls !== null && <div className="pb-controls">{controls}</div>}
      {readout !== undefined && readout !== null && <span className="pb-readout">{readout}</span>}
      {meta !== undefined && meta !== null && <span className="pb-meta">{meta}</span>}
    </header>
  );
}
