"use client";

import { useRouter } from "next/navigation";
import Corners from "./Corners";

interface ScreenStubProps {
  title: string;
  /** e.g. "T-40" — which ticket builds this screen's real content. */
  ticket: string;
}

/**
 * T-39 routes every A7 destination so the sidebar's nav is complete and
 * linkable from day one; most of those routes have no real content until
 * their own Phase 9 ticket lands (T-40…T-47). This is that placeholder —
 * matching the design file's own `isStub` fallback — rather than a 404 or a
 * blank page for a destination that legitimately exists yet.
 */
export default function ScreenStub({ title, ticket }: ScreenStubProps) {
  const router = useRouter();
  return (
    <div className="screen-stub">
      <div className="panel-card blueprint screen-stub-card">
        <Corners />
        <div className="screen-stub-title">{title}</div>
        <p className="screen-stub-body">
          Not built yet — see <strong>{ticket}</strong> in <code>docs/TICKETS-v2.md</code>.
        </p>
        <button className="btn btn-primary blueprint" onClick={() => router.push("/")}>
          <Corners />
          Back to New Plan
        </button>
      </div>
    </div>
  );
}
