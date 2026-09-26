# Handoff prompt — paste as the first message of a fresh Claude chat

> Copy everything between the rules. Attach `PROJECT-SCOPE.md`, `PROJECT-SCOPE-v2.md`, `TICKETS-v2.md`, `BUILD-PLAN-v2.md`, and (if the work touches UI) the design file — now checked in at `docs/design/CH Fuel App.dc.html` (T-39), so read it from there instead of asking for a fresh attach.

---

You are working on **CH Fuel App**, the single internal web application for CH Logistics (2043733 Ontario Inc., Burlington ON — Canadian carrier running freight into the United States). It is the merge of two previously separate projects:

1. **CH Fuel Planner** — the forward-looking half. A dispatcher enters origin, destination and truck; a DP optimiser picks the cheapest compliant Love's stops from the BVD daily price file; output is a Google Maps link handed to the driver. Repository: **`CH-Fuel-Planner`** (GitHub). Specified in `PROJECT-SCOPE.md` (v1.0), ticketed in `TICKETS.md`, decomposed in `BUILD-PLAN.md`.
2. **Fuel invoice actuals** — the backward-looking half, new. Weekly BVD invoices are imported; every transaction, driver, truck, station and express charge is recorded, reconciled and reported on. Specified in `PROJECT-SCOPE-v2.md`.

The two halves share **one reference layer** — trucks, drivers, fuel cards, Love's stations — which is the entire reason for merging: a plan and an invoice must talk about the same truck and the same site. The payoff screen is **Plan vs Actual**: did the driver fuel where the plan said, and what did the difference cost?

**Where the build actually stands.** Read the ticket index in `TICKETS-v2.md` — it is the only place status is kept, and this paragraph is not re-synced on every merge. As of 2026-09-20 it shows T-01 through T-12 merged (workspace, schema and drift test, seed data, Next.js/TS, auth, price-sheet ingest and backfill, station resolution, the ORS adapter with both call meters, the corridor query, and the optimiser with `dp_v1`/`greedy_v1`), the actuals half through T-37 plus the backfill, T-51 (fixtures) and T-52 (all distances in miles). Not yet built: the validation loop (T-13), detour costing (T-14), plan orchestration and the API (T-15…T-19), the frontend client and map (T-21, T-22), and the v2 screens (T-38…T-47). Station resolution places 604 of 605 stations from the Love's export; #306 is temporarily closed and stays `unresolved`. Do not assume any code exists that a ticket does not list as a dependency — read the repository before writing.

**Document authority, in order.** `migrations/*.sql` over any prose. `PROJECT-SCOPE.md` + `PROJECT-SCOPE-v2.md` are the specification; where v2 contradicts v1, v2 wins and v1 gets edited. `TICKETS-v2.md` is the ticket register; `BUILD-PLAN-v2.md` breaks each ticket into steps that can be implemented and tested one at a time. The design file `CH Fuel App.dc.html` is the visual authority for the shell, Transactions, Plan vs Actual, New Plan and Plans screens — it establishes two conventions that every later screen must reuse (see v2 §A9).

**House rules, carried over from v1 and non-negotiable.**
- One ticket per branch, one ticket per session. CI (`npm run verify`) is the gate.
- Storage is **miles and gallons**; unit conversion happens at the API boundary only. Money is **USD everywhere** — never render a bare dollar sign; the company is Canadian and the distinction matters.
- No strategy or pure function performs I/O — no database, no HTTP, no clock. Retries and orchestration live in services.
- The API returns **numbers, not display strings** (`5.2395`, not `"$5.2395"`), and nullable means nullable — `null` must never be coerced to `0`.
- Nothing is written to the database on a failed reconciliation. Quarantine is a **screen**, not a toast.
- Raw supplier text is never overwritten. Every raw field keeps its `_raw` twin beside the resolved value.
- Numbers format as: gallons 2dp, per-gallon prices **4dp**, money 2dp, right-aligned, tabular figures.

**How to work.** Read the ticket, then the step in the build plan, then the code the step touches. Implement one step; make its tests pass; stop. A step is finished when its assertions pass, not when the code is written. If the spec and the repository disagree, say so and propose the edit rather than silently following either.

Start by telling me which ticket you are picking up and what you found in the repository that the ticket's dependencies do not describe.

---
