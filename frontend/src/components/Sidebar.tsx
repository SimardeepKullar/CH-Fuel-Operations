"use client";

import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

interface NavItem {
  label: string;
  href: string;
  /** Only Receipt Queue carries one (A7); others simply omit `badge`. */
  badge?: boolean;
  /** True once a Phase 9 ticket has built real content for this route —
   * false renders the design's "later" tag and the route still exists
   * (`ScreenStub`), it just isn't finished yet. */
  built: boolean;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

/**
 * A7's sidebar IA, matching `CH Fuel App.dc.html`'s `NAV` data exactly —
 * including Settings living as the last item of the Analysis group rather
 * than a visually separate fourth block; the design renders every group
 * identically, so that's what "plus Settings" actually looks like once
 * built. Plan and Plans are the only routes with real content today (T-21…
 * T-23, ported by T-39); every other destination exists as a route so later
 * tickets can fill it in without moving anything (A18 Q4: a plain array a
 * caller can extend with a fourth group needs no layout change).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Plan",
    items: [
      { label: "New Plan", href: "/", built: true },
      { label: "Plans", href: "/plans", built: true },
    ],
  },
  {
    group: "Actuals",
    items: [
      { label: "Overview", href: "/overview", built: false },
      { label: "Transactions", href: "/transactions", built: false },
      { label: "Receipt Queue", href: "/receipt-queue", built: false, badge: true },
      { label: "Other Charges", href: "/other-charges", built: false },
      { label: "Import", href: "/import", built: false },
    ],
  },
  {
    group: "Analysis",
    items: [
      { label: "Drivers", href: "/drivers", built: false },
      { label: "Trucks", href: "/trucks", built: false },
      { label: "Stations", href: "/stations", built: false },
      { label: "Plan vs Actual", href: "/plan-actual", built: false },
      { label: "Settings", href: "/settings", built: false },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarProps {
  /** `null` while loading or unknown — renders no badge rather than "0". */
  pendingReceipts: number | null;
  groups?: NavGroup[];
}

export default function Sidebar({ pendingReceipts, groups = NAV_GROUPS }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const displayName = session?.user?.name ?? "…";
  const role = session?.user?.role ?? "";

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="sidebar-brand">
        <img className="sidebar-logo" src="/ch-logo-white.png" alt="CH Logistics" />
        <div className="sidebar-eyebrow">Fuel operations</div>
      </div>

      <div className="sidebar-scroll">
        {groups.map((g) => (
          <div className="sidebar-group" key={g.group}>
            <div className="sidebar-group-label">{g.group}</div>
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              const badgeVal = item.badge ? pendingReceipts : null;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`sidebar-item${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(item.href);
                  }}
                >
                  <span className="sidebar-item-label">{item.label}</span>
                  {badgeVal !== null && badgeVal > 0 && <span className="sidebar-item-badge">{badgeVal}</span>}
                  {!item.built && <span className="sidebar-item-soon">later</span>}
                </a>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-user">
          <span className="sidebar-user-name">{displayName}</span>
          <span className="sidebar-user-role">{role}</span>
        </span>
        <button className="sidebar-signout" onClick={() => signOut({ callbackUrl: "/" })}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
