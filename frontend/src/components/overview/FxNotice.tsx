import type { FxNoticeView } from "../../lib/overviewView";

/** The amber notice for weeks with no exchange rate. */
export default function FxNotice({ notice, onEnter }: { notice: FxNoticeView; onEnter: () => void }) {
  return (
    <div className="ov-fxnote" data-testid="fx-notice">
      <span className="ov-fxnote-main">{notice.text}</span>
      {notice.missing !== "" && <span className="ov-fxnote-list">{notice.missing}</span>}
      <a
        className="ov-fxnote-link"
        href="#rates"
        onClick={(e) => {
          e.preventDefault();
          onEnter();
        }}
      >
        Enter exchange rates →
      </a>
    </div>
  );
}
