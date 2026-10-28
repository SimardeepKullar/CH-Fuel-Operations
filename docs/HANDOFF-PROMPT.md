# Handoff prompt — paste as the first message of a fresh Claude chat

> Copy everything between the rules. Attach `PROJECT-SCOPE.md`, `PROJECT-SCOPE-v2.md`, the ticket's GitHub issue (`gh issue view <n>`), and (if the work touches UI) the design file — now checked in at `docs/design/CH Fuel App.dc.html` (T-39), so read it from there instead of asking for a fresh attach.

---

You are working on **CH Fuel App**, the single internal web application for CH Logistics (2043733 Ontario Inc., Burlington ON — Canadian carrier running freight into the United States). It is the merge of two previously separate projects:

1. **CH Fuel Planner** — the forward-looking half. A dispatcher enters origin, destination and truck; a DP optimiser picks the cheapest compliant Love's stops from the BVD daily price file; output is a Google Maps link handed to the driver. Repository: **`CH-Fuel-Planner`** (GitHub). Specified in `PROJECT-SCOPE.md` (v1.0); ticketed as GitHub issues.
2. **Fuel invoice actuals** — the backward-looking half, new. Weekly BVD invoices are imported; every transaction, driver, truck, station and express charge is recorded, reconciled and reported on. Specified in `PROJECT-SCOPE-v2.md`.

The two halves share **one reference layer** — trucks, drivers, fuel cards, Love's stations — which is the entire reason for merging: a plan and an invoice must talk about the same truck and the same site. The payoff screen is **Plan vs Actual**: did the driver fuel where the plan said, and what did the difference cost?

**Where the build actually stands.** Read the ticket issues and the "CH Fuel Planner" project board on GitHub — they are the only place status is kept, and this paragraph is not re-synced on every merge. As of 2026-09-20 it shows T-01 through T-12 merged (workspace, schema and drift test, seed data, Next.js/TS, auth, price-sheet ingest and backfill, station resolution, the ORS adapter with both call meters, the corridor query, and the optimiser with `dp_v1`/`greedy_v1`), the actuals half through T-37 plus the backfill, T-51 (fixtures) and T-52 (all distances in miles). Not yet built: the validation loop (T-13), detour costing (T-14), plan orchestration and the API (T-15…T-19), the frontend client and map (T-21, T-22), and the v2 screens (T-38…T-47). Station resolution places 604 of 605 stations from the Love's export; #306 is temporarily closed and stays `unresolved`. Do not assume any code exists that a ticket does not list as a dependency — read the repository before writing.

**Document authority, in order.** `migrations/*.sql` over any prose. `PROJECT-SCOPE.md` + `PROJECT-SCOPE-v2.md` are the specification; where v2 contradicts v1, v2 wins and v1 gets edited. Each ticket is a GitHub issue titled `T-NN · <title>`: its **Ticket** section holds the goal, files, dependencies and definition of done, and its **Build plan** section breaks it into steps that can be implemented and tested one at a time. The design file `CH Fuel App.dc.html` is the visual authority for the shell, Transactions, Plan vs Actual, New Plan and Plans screens — it establishes two conventions that every later screen must reuse (see v2 §A9).

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

## Kickoff prompt — one ticket, one fresh session

Copy, replace `T-NN`, `<n>` (the issue number), `<title>` and `<slug>`, and paste as the first message of a fresh session. One ticket per session, one branch per ticket (D9).

```
Ticket T-NN · <title> — issue #<n>

Read, in order:
  CLAUDE.md                    — workflow, commands, the rules that are easy to get wrong
  gh issue view <n>            — goal, files, dependencies, definition of done, build steps
  the scope sections T-NN cites

Confirm every dependency the issue names is merged to main; if one is not, stop and tell me.
Then read the code the first step touches before writing anything.

Branch: ticket/T-NN-<slug>; move the card to In progress.
Work one step at a time: implement, run its tests, commit, report what the tests said, stop.
Gate: npm run verify must be green before the PR. The PR body says "Closes #<n>".
If the spec and the repository disagree, say so and propose the edit.
Do not silently narrow the scope; if something is wrong or impossible, stop and say so.
```

**Why one step at a time.** A ticket's steps are decomposed so each can be reviewed before the next builds on it. Running a whole ticket unattended puts the review where unwinding a wrong decision is most expensive — usually the schema or the optimiser, the two places this project can go quietly wrong.
