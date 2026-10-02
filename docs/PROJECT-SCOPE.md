# Truck Route + Cheapest Fuel Stop Planner — Project Scope

**Organisation:** 2043733 ONTARIO INC., DBA CH LOGISTICS
**Document version:** 1.0 — 4 September 2026
**Supersedes:** `PROJECT-SCOPE.md` v3.4 (the copy in `~/Downloads`, now archived)

---

## How to read this document

This is a rewrite from scratch, using v3.4 as the source material. It exists because v3.4 described a finished v1 — nine shipped milestones, 54 passing tests, a deployed frontend — and none of that code is in this repository. Reading it as a status report was misleading.

This document separates three things that v3.4 ran together:

| Marker | Meaning |
|---|---|
| **Verified** | Measured against the files in `data/` on 4 September 2026. Reproducible. |
| **Decided** | A choice made with a stated reason. Change it deliberately, not by drift. |
| **Open** | Not yet decided. Listed in §21. Needs an answer before the affected step is built. |


---

## Table of contents

1. [What the app does](#1-what-the-app-does)
2. [Where the project actually stands](#2-where-the-project-actually-stands)
3. [Scope boundaries](#3-scope-boundaries)
4. [The data](#4-the-data)
5. [The fuel model](#5-the-fuel-model)
6. [Decisions locked in](#6-decisions-locked-in)
7. [Tech stack](#7-tech-stack)
8. [Routing provider](#8-routing-provider)
9. [Map rendering](#9-map-rendering)
10. [Deployment and infrastructure](#10-deployment-and-infrastructure)
11. [Data pipeline](#11-data-pipeline)
12. [Database schema](#12-database-schema)
13. [Service boundaries](#13-service-boundaries)
14. [API design](#14-api-design)
15. [The stop-selection algorithm](#15-the-stop-selection-algorithm)
16. [Truck profiles](#16-truck-profiles)
17. [Data retention and licensing](#17-data-retention-and-licensing)
18. [Known risks and gaps](#18-known-risks-and-gaps)
19. [Build order](#19-build-order)
20. [Future phases](#20-future-phases)
21. [Open questions](#21-open-questions)
22. [Rejected approaches](#22-rejected-approaches)
23. [Sources](#23-sources)

---

## 1. What the app does

A dispatcher enters a load — origin, destination, and which truck is running it. The app returns:

1. A **baseline truck-legal route** from A to B.
2. The **cheapest diesel stations** along or near that route, from the BVD price sheet for the specific effective day.
3. An **optimised route** inserting selected stations as mandatory stops, respecting the 500-mile operational cap as a hard constraint while minimising total fuel cost. (v1 fixes that cap and the 300-mile floor as flat distances; deriving them from tank size, MPG and a reserve buffer is a later change — §5.6.)
4. **Map data** for both routes plus station markers.
5. A **summary table** of stops with gallons, price, cost, and cumulative distance and duration.
6. A **shareable Google Maps link** the dispatcher sends to the driver.

### The process being replaced

The dispatcher has the load's origin and destination, puts both into Google Maps, and sends the driver a link. The BVD CSV sits alongside as a rough guide to where fuel is cheap. Drivers fill up largely where they feel like it and follow the guide loosely. There is no range checking, no cost optimisation, and no record of what was chosen or what it cost.

### Who uses it

One dispatcher, planning loads ahead of time. Drivers receive a Google Maps link but do not log in.

### The operating pattern

Trucks leave a yard in Canada and are **required to fill up at a station immediately before the US border**. The Canadian leg is negligible — the station sits beside the crossing. **Every US trip therefore begins at 100% fuel from a US origin point.** This is always the case, so it is the modelled default rather than an assumption to guard against.

### Why it is worth building

Verified from the 2026-08-22 sheet: the spread between the cheapest and dearest station is **$2.184/gal**, and within a single state it reaches **63¢/gal** (Colorado). A 60¢ spread on a 90-gallon fill is **~$54 per stop**. At two or three stops per trip, run daily, the optimisation pays for itself many times over.

---

## 2. Where the project actually stands

Verified by inspection of the repository on 4 September 2026. **This section is a frozen baseline snapshot, not a live status tracker** — for current build state, see `TICKETS-v2.md`'s ticket index, the single source of truth for what's merged.

### What exists

| Path | What it is | State |
|---|---|---|
| `migrations/0001_init.sql` | 79 lines. `stations`, `price_imports`, `station_prices`, `routes`, `trucks` | **Does not run** — syntax error, see §12.1 |
| `docker-compose.yml` | `postgis/postgis:16-3.4` on port 5433, migrations mounted as init scripts | Works |
| `frontend/` | Vite + React 19. `App.jsx` with Plan / Recent / Dev tabs, ~400 lines total | **Static mock** — reads `src/data/trips.js`, no API, no map |
| `data/bvd-prices/pcn-usd-9206810-981.csv` | The 2026-08-22 sheet, 605 rows | Present |
| `data/bvd-prices/2026-01/` | 31 files covering 30 days of January 2026 | Present |
| `data/US-CA-GasStations/LovesSearchResults.xlsx` | Love's operator export, 732 stores with coordinates | Present |
| `package.json` | Workspace root, `db:*` scripts, frontend workspace | Works |

### What does not exist

No `src/`. No backend of any kind. No ingest, no routing adapter, no corridor que ry, no optimiser, no API, no tests, no auth, no map. `package.json` declares no dependencies beyond React and Vite.

**The project is at step 1 of §19, partially done.** The schema is drafted but does not apply cleanly; the frontend mock is a useful UI reference but is not wired to anything.

### The frontend mock is worth keeping

`frontend/src/data/trips.js` is hardcoded sample data shaped roughly like a plan. Treat it as a **design artefact, not a stub to fill in** — it records what the dispatcher expects to see, which is real input to §14's payload design. Expect to rewrite the components once the API exists.

---

## 3. Scope boundaries

### In scope for v1

- Single origin → single destination (A→B), US only
- Origin assumed at 100% fuel (adjustable)
- Three truck profiles (Volvo-based)
- One supplier (BVD), one product (ULSD)
- CLI ingest — single file and bulk backfill, no upload UI (§11.2)
- Single user with login
- Cost minimisation under the 500-mile operational cap
- Styled, interactive map with both routes and hoverable station pins
- Google Maps link output for drivers

### Out of scope for v1, designed for

| Feature | What makes it additive later |
|---|---|
| Multi-stop deliveries (A→B→C) | `plan_stops.seq` and `stop_type` shaped for it |
| Round trips (A→B→A) | Needs joint cross-leg optimisation |
| Canada lanes | A second BVD CSV exists in the same format; see §20 |
| User-defined truck profiles | An INSERT, not a migration |
| Automated Gmail ingest | `price_imports` is the seam |
| Dispatcher-facing CSV upload | The ingest is a library function with entry points bolted on; the HTTP route is a thin wrapper (§11.2) |
| Additional fuel suppliers | `supplier` columns throughout |
| Receipt vs. plan backtesting | Driver invoices first, OCR second |
| Metrics dashboards | Depends on accumulated history |
| Price forecasting | Depends on the historical backfill |
| Hours-of-service integration | `stop_type` enum reserves space |

### Not being built

- Turn-by-turn navigation
- Multi-vehicle fleet optimisation
- Load/dispatch management — this is not a TMS
- IFTA tax modelling (§4.7 records what is retained in case this changes)

---

## 4. The data

**Every figure here was re-measured on 4 September 2026** against `data/bvd-prices/`, using a throwaway pandas script. All of v3.4's claims held exactly. The findings in §4.3 are new — v3.4 never analysed the January corpus.

### 4.1 The file

`pcn-usd-9206810-981.csv`, arriving daily by Gmail from BVD.

**Line 1 is metadata, not a header:**

```
"Company Id: ",981," ","Company Name: ","2043733 ONTARIO INC."," ",DBA,"CH LOGISTIX"," ","Effective Date: ",2026-08-22
```

Parse it for `company_id` and `effective_date`, then skip it. The DBA reads `CH LOGISTIX` with an X because that is the name on file with the fuel supplier; the org's own spelling is CH LOGISTICS. Do not "correct" it on the way in — it is what the supplier sends, and the ingest's job is to record what arrived.

**Line 2 is the header**, 15 columns:

`SITE, NAME, CITY, STATE, PROD, COST, FEDERAL TAX, STATE TAX, SALES TAX, FREIGHT, OTHER, TOTAL COST, RETAIL PRICE, YOUR PRICE, SAVINGS`

**605 data rows, zero nulls** in the August file.

**Effective date semantics.** The file arrives on day *N* and its header states day *N+1*. The August file arrived 21 Aug with a header of 2026-08-22. **Trust the header field directly; no +1 offset logic in code.** The pattern holds on weekends.

### 4.2 Verified facts — the August sheet

Every claim tested against all 605 rows.

| Finding | Detail |
|---|---|
| **`SITE` is unique** | 605 distinct values in 605 rows. Valid natural key. |
| **`SITE` ≠ Love's store number** | Matches in **0 of 605**. `SITE` is BVD's internal ID; the store number is in `NAME` (`LOVES #368`), range 22–1055, all 605 distinct. |
| **One product** | `PROD = ULSD` in every row. |
| **One brand** | 605/605 Love's. |
| **Columns sum exactly** | `COST + FEDERAL + STATE + SALES + FREIGHT + OTHER = TOTAL COST`, max diff 0.0005. |
| **`YOUR PRICE = min(TOTAL COST, RETAIL PRICE)`** | **605/605, zero error.** |
| **`SAVINGS = max(0, RETAIL − TOTAL COST)`** | **605/605, zero error.** |
| **30 rows capped at retail** | Contract cost exceeds street price → you pay street, zero savings. CA, FL, GA, ID, IL, MT, NV, SC, WA. |
| **`FEDERAL TAX` constant** | 0.2483 in every row. |
| **`STATE TAX` constant within state** | Zero states have more than one value. A lookup, not a per-station fact. |
| **`SALES TAX` mostly zero** | Nonzero in 65 rows: IL (37), CA (16), WA (7), NY (5). |

**The optimiser reads `YOUR PRICE` directly and never recomputes it.** The `min()` cap is a BVD business rule that only they can apply.

### 4.3 Verified facts — the January corpus (new in v1.0)

31 files in `data/bvd-prices/2026-01/`. These change three things, and give the ingest two real test cases before a line of it is written.

| Finding | Detail | Consequence |
|---|---|---|
| **Format is stable** | All 31 files share one identical header shape | The validation gate can be strict rather than forgiving |
| **594 rows each, not 605** | Every January file has 594 stations; August has 605 | The station network grows. Ingest must handle stations appearing. |
| **January ⊂ August** | 0 January sites absent from August; 11 August sites absent from January | Growth, not churn. Nothing was dropped in 8 months. |
| **Site set is stable within the month** | All 31 files carry the identical 594-site set | Day to day the network does not move. |
| **2026-01-11 is missing** | Dates run 01-01 to 01-31, 30 distinct, one gap | **Gap detection is not hypothetical.** It fires on the first real backfill. |
| **2026-01-26 arrives twice** | `pcn-usd-8097639-981.csv` and `… (1).csv` are **byte-identical** (same SHA-256) | **The `file_sha256` idempotency guard has a real test case on day one.** |
| **Prices move daily** | Per-station price range across January: median **$0.408**, p90 **$0.567**, max **$0.682** | Confirms "always re-plan" (§11.6). Yesterday's answer carries ~41¢/gal of error. |
| **The cheapest station changes** | Only **4 distinct stations** were network-cheapest across the 30 days | Concentrated, but not fixed. Nothing to hardcode. |

The last two together are the quantitative case for the whole project: a 41¢ median daily swing per station means a plan computed against stale prices is materially wrong, and there is no shortcut that avoids re-running the optimisation.

### 4.4 Geographic coverage

**42 states.** Absent: `AK, DE, HI, MA, ME, NH, RI, VT`.

**Densest:** TX (84), IL (37), OK (37), OH (29), MO (25), FL (23), IN (23), MS (21).

**Thin — range-gap risk:** CT (1), NJ (1), WV (1), MD (2), SD (3), ID (4), MN (4), MT (4).

With a 500-mile hard cap between fills, lanes through the Northeast or the northern Mountain states can genuinely fail. **The infeasible response must be actionable, not a bare error** — see §14.

### 4.5 City/state ambiguity — small

593 distinct `(city, state)` pairs across 605 rows. **Only 9 pairs hold more than one station**, covering 21 rows — **3.5%**:

Jacksonville FL (3), Amarillo TX (3), Oklahoma City OK (3), Prescott AR (2), Fort Pierce FL (2), Albuquerque NM (2), Houston TX (2), Lufkin TX (2), Van TX (2).

The Love's store number in `NAME` disambiguates all of them. This matters only for the gazetteer fallback (§11.4 step 3); tier 1 resolves by store number and never consults the city.

### 4.6 City string hygiene

- **25 ALL-CAPS** rows (`ELOY`, `BRIGHTON`, `TRINIDAD`, `LAUREL`, …) — normalise case.
- **5 abbreviated prefixes:** `Mc Calla`, `Mt Juliet`, `Mt Vernon`, `N Little Rock`, `St Augustine` — expand before gazetteer matching.

Store both: `city_raw` as received, `city_normalized` for matching. Never overwrite what the supplier sent.

### 4.7 Price distribution and basis

| Metric | `YOUR PRICE` ($/gal) |
|---|---|
| Min | 4.865 |
| p25 | 5.079 |
| Median | 5.193 |
| p75 | 5.377 |
| Max | 7.049 |
| **Spread** | **$2.184** |

**Discount vs street:** mean 44.6¢/gal, median 49.5¢/gal, max $1.108/gal, zero in 30 rows.

**Decided: use `YOUR PRICE` (the `pump` basis). IFTA modelling is out of scope.**

Recorded because it was analysed and may matter later: ranking stations by pump price versus tax-stripped cost gives a Spearman correlation of ~0.52, with only 7 of the 50 cheapest stations shared between the two bases. Illinois is the clearest divergence — cheap on a tax-stripped basis, above median at the pump.

The `price_ifta_net` generated column stays in the schema. It costs nothing, needs no code, and makes switching basis later a parameter change rather than a migration.

---

## 5. The fuel model

This section governs the algorithm.

**Decided for v1: the leg window is a pair of flat distances — a 500-mile cap and a 300-mile floor — and nothing else.** Where the truck may stop is a function of miles travelled since the last fill, not of how much fuel is physically left in the tank. Tank capacity and MPG are still in the model, but they do one job in v1: converting miles into gallons and gallons into dollars. They do not decide where a leg may end.

This is deliberate, not an approximation waiting to be fixed. The 500-mile cap is operational policy and binds long before physical range does (§5.1), so a range-derived cap would compute a larger number that the policy immediately overrides. Fixing the window also keeps the two numbers legible to a dispatcher — "never more than 500, never less than 300" is a rule a person can check by eye against the summary table.

**Later, the window can be derived from the truck instead** — usable range from tank, MPG and a reserve buffer, rather than a constant. §5.6 sets out what that change touches. It changes *how `max_leg_miles` and `min_leg_miles` get their values*, not the algorithm that consumes them, which is why it is safe to defer: every parameter it needs is already a column on the truck profile (§5.5, §12).

### 5.1 The operational cap

**The truck must never travel more than 500 miles between fuel purchases.** This is operational policy, not a tank limit — it binds well before physical range does. A 150-gallon tank at 6.5 mpg is 975 miles nominal; every profile in §16 comfortably exceeds 500. **The optimiser therefore never checks physical range against the cap in v1**, because on every profile in the fleet that check could not fail.

**There is also a hard 300-mile minimum between fuel purchases.** Stopping sooner is not wanted — a stop has fixed overhead and a near-full tank has nowhere to put the fuel. Like the cap, this is a flat distance in v1 and not a fraction of the tank.

**The minimum does not apply to the final leg.** You do not buy fuel at the destination, so the last fill only needs to be within 500 miles of arrival; there is no floor on how close it can be. This is a frequent source of off-by-one bugs — it has a dedicated test in §15.6.

**Automatic relaxation on infeasibility.** A hard floor can declare a trip impossible that the truck could physically make: if no station sits in the 300–500 mile window from origin, the plan fails even though the truck could comfortably reach mile 600. The planner therefore runs two passes:

1. Solve with `min_leg_miles = 300`.
2. If infeasible, re-solve with `min_leg_miles = 0` and attach a `MIN_LEG_RELAXED` disclaimer naming which legs fall short.

A plan with a 280-mile leg and a clear warning is more useful to a dispatcher than a dead end.

### 5.2 What prevents excessive stopping

The 300-mile floor is the primary control — it structurally rules out clusters of short hops. A secondary per-stop cost shapes the choice between otherwise-valid alternatives:

```
stop_penalty = fixed_stop_minutes × (driver_cost_per_hour / 60)
             + detour_distance_miles × cost_per_mile
             + detour_duration_hours × driver_cost_per_hour
```

With `driver_cost_per_hour = 0` this reduces to pure fuel-cost minimisation, which is the v1 default and is safe because the floor does the structural work. Raising the driver rate later makes the optimiser prefer fewer stops and shorter detours. Revisit once real plans are being compared against real outcomes — not before, because until then there is nothing to tune against.

### 5.3 Starting and ending conditions

- **Start:** 100% fuel. `startFuelGallons` is an API parameter defaulting to tank capacity.
- **Origin counts as a fill.** The first stop must therefore be within 500 miles of the origin.
- **Arrival:** by default the destination must be within 500 miles of the last fill (`requireArrivalWithinMaxLeg = true`, configurable). Minimum arrival fuel defaults to the reserve level.

### 5.4 Why carrying fuel forward matters

Because the minimum leg can be relaxed and the cap forces stops regardless of need, surplus fuel has value. If a cheap station sits at mile 100 and an expensive one at mile 550, the optimiser can fill at 100, stop at 550 as the cap requires, and buy little or nothing there.

**This is why the algorithm needs a fuel-level dimension** and cannot be a plain shortest path over stop positions. It is the single most important structural fact about §15.

### 5.5 Parameters

Each parameter is marked with what it actually drives, because the split is what §5.6 later changes: the **window** parameters decide where a leg may end, the **fuel** parameters decide only how many gallons and dollars a stop involves.

| Parameter | Default | Lives in | Drives |
|---|---|---|---|
| `max_leg_miles` | 500 | truck profile | Window — hard cap, set directly |
| `min_leg_miles` | 300 | truck profile; auto-relaxed to 0 on infeasibility | Window — hard floor, set directly |
| `tank_gallons` | per profile | truck profile | Fuel — how much can be carried forward (§5.4) |
| `avg_mpg` | per profile | truck profile | Fuel — miles → gallons → dollars |
| `reserve_fraction` | 0.15 | truck profile | Fuel — minimum arrival level |
| `fixed_stop_minutes` | 20 | truck profile, overridable per plan | Penalty (§5.2) |
| `driver_cost_per_hour` | 0 | per plan | Penalty (§5.2) |
| `cost_per_mile` | 0 | truck profile, overridable per plan | Penalty (§5.2) |
| `startFuelGallons` | tank capacity | per plan | Fuel — DP start state |
| `maxStops` | null | per plan | Window — optional stop-count ceiling |

`tank_gallons`, `avg_mpg` and `reserve_fraction` appear in the Fuel rows only. That is the whole content of the v1 decision: **no window value is computed from a fuel value.**

### 5.6 Later: deriving the window from the truck

Not built in v1. Recorded here so the eventual change is a substitution rather than a redesign.

Today `max_leg_miles` and `min_leg_miles` are constants on the truck profile. The alternative is to compute them per plan from what the truck can physically do:

```
usable_gallons = tank_gallons × (1 − reserve_fraction)
physical_range = usable_gallons × avg_mpg
max_leg_miles  = min(policy_cap_miles, physical_range × (1 − mpg_error_buffer))
min_leg_miles  = a headroom rule — the distance below which a fill is not worth
                 stopping for, given tank_gallons and expected arrival level
```

**What would change:** one function producing the two window values, called once at plan setup. The truck profile gains `policy_cap_miles` and `mpg_error_buffer`.

**Explicitly: `truck_profiles.max_leg_miles` and `min_leg_miles` (§12) get superseded, not reused.** They stop being the stored answer and are replaced on that table by `policy_cap_miles` and `mpg_error_buffer` — the two inputs the formula above actually needs. Nothing on `truck_profiles` still holds a flat mileage number once this lands; a profile might keep the pair only as an optional manual override for a dispatcher who wants to force a lower cap, and that is a UX decision, not a structural requirement.

**`plans.max_leg_miles` and `min_leg_miles` (§12) do not move.** They were never the input — they are the record of what value the DP actually ran with for that specific plan, the same role `min_leg_relaxed` plays beside them (§12.2). Whether that number came from a flat profile default (v1) or the formula above (v2), the DP still consumes one concrete number per leg and the plan still has to say what it was, so this pair is permanent regardless of which side of this change is live.

**What would not change:** the DP in §15, the relaxation pass in §5.1, the stop penalty in §5.2, and the API contract in §14 — `maxLegMiles` and `minLegMiles` are already per-plan request fields with profile defaults, so a derived default arrives through the same channel a caller override does. §16's profiles already carry every column the formula reads.

**What has to be settled first**, and cannot be settled from here:

- **The real fleet MPG (§21 Q4).** A range-derived cap is only as trustworthy as the MPG behind it. Deriving a 900-mile cap from a wrong 7.5 mpg is worse than a flat 500 that is wrong for nobody.
- **Whether the policy cap survives (§21 Q9).** If 500 miles is a driver-hours and stop-cadence rule rather than a range proxy, the `min()` returns 500 on every profile and the derivation buys nothing.
- **The MPG error buffer.** §18 risk 5 puts MPG error at ±10%. Whatever buffer replaces today's implicit margin has to cover it.

The honest summary: this change matters for a truck whose physical range falls *below* the policy cap — a smaller tank, a heavier load, a worse duty cycle. No profile in §16 is close. Build it when such a truck exists, or when receipt data (§20 Phase 3) makes MPG trustworthy enough to compute a range from.

---

## 6. Decisions locked in

| # | Decision | Rationale |
|---|---|---|
| 1 | A→B, US only, for v1 | Multi-stop and Canada are additive |
| 2 | Start at 100% fuel | Mandatory pre-border fill; always the case |
| 3 | 500-mile hard cap between fills | Operational policy; binds before tank capacity |
| 4 | Hard 300-mile minimum leg, auto-relaxed on infeasibility | Avoids pointless short hops without creating dead ends |
| 4a | **Flat-distance leg window in v1** — no window value derived from tank size, MPG or reserve | The policy cap binds on every profile in §16, so a derived cap would be overridden anyway. The range-derived version is specified but deferred (§5.6) |
| 5 | Exact DP over `(station, fuel level)` | Small problem; optimal beats heuristic (§22.3) |
| 6 | Optimiser is a swappable strategy | Explicit modularity requirement |
| 7 | `YOUR PRICE` as the price basis | IFTA out of scope; `price_ifta_net` retained |
| 8 | Trust the CSV header's effective date | Confirmed against real files |
| 9 | Single user with login | Auth.js, one seeded account |
| 10 | **TypeScript for everything that runs in production** | §7.1 |
| 11 | Vercel + Neon Postgres/PostGIS | §10 |
| 12 | OpenRouteService for v1, HERE deferred behind an interface | §8.2 |
| 13 | MapLibre GL JS for rendering | Full styling control, free |
| 14 | Google Maps link as driver output | Matches the existing workflow |
| 15 | **CLI-only ingest in v1** — no upload UI, no `/imports` endpoints | The ingest is entry-point agnostic; the upload route and the Gmail poller are both later callers of the same function (§11.2) |
| 16 | Store miles + gallons; convert at the API boundary | `?units=metric` toggle |
| 17 | Permanent station coords from operator export, OSM and Census only | Provider geocoding has a 30-day cap (§17) |
| 18 | Structured logging on every provider call | Keyed by request hash |
| 19 | No job queue in v1 | Computation fits inside function limits |

---

## 7. Tech stack

**Node 22 + TypeScript + Next.js route handlers + Drizzle or Kysely + Postgres/PostGIS + Zod.**

| Concern | Pick |
|---|---|
| HTTP | Next.js route handlers |
| ORM / query builder | Drizzle or Kysely (Prisma needs raw SQL for PostGIS anyway) — **Open, §21 Q1** |
| Validation | Zod |
| CSV | `csv-parse` or `papaparse` |
| XLSX (one-time, operator export) | `xlsx` or a Python script — see §7.1 |
| Auth | Auth.js |
| Logging | `pino` |
| Map | MapLibre GL JS |
| Tests | `vitest` |

**Why TypeScript.** The geospatial work happens in Postgres (`ST_LineLocatePoint`, `ST_DWithin`), not in application code. The optimiser is a few hundred lines of array manipulation. CSV parsing is trivial at 605 rows. And shared types with the React frontend give compile-time guarantees across the boundary in one repository.

### 7.1 The Python question — decided

Python was considered for the ingest pipeline. **Decision: TypeScript for the ingest, Python permitted for one-time analysis.** The rule:

> **Anything that runs in production, repeatedly, goes in TypeScript. One-time analysis whose deliverable is rows in a table, not code, may be written in whatever is fastest.**

**Why the ingest is TypeScript, specifically:**

1. **It is not a data-processing problem.** 605 rows per file; the full ten-year backfill is roughly 2.2M rows of flat CSV with zero nulls and 15 columns. Nothing pandas offers beats `csv-parse` and a loop at that size.
2. **The ingest has to run inside the deployed Node runtime, even though v1 only calls it from a CLI.** §11.2's HTTP upload route and §20's Gmail poller are both deferred, not cancelled, and both call the ingest in-process from Vercel. A Python ingest means that path either shells out to a subprocess from a Next route handler, or becomes a second deployed service with its own connection pool and env vars. Two runtimes, no benefit — and a rewrite the day the upload route lands.
   *(This argument was stronger when v1 shipped the HTTP endpoint. It is now a bet on Phase 2 rather than a same-release constraint — but point 3 below holds regardless of entry point, and CLI-only makes a Python ingest more tempting, not less. Naming that is the point of writing it down.)*
3. **The validation rules are shared with the API.** §11.1 step 4 validates the same shapes the API later reads back. One Zod schema means the rule exists once; two languages means maintaining it twice, by hand, with silent drift.
4. **Deployment is Vercel + Neon.** There is nowhere for a Python worker to live under the current plan.

**Where Python is the better tool, and is allowed:**

- **§11.4 station resolution.** Clustering OSM fuel features, matching store numbers, parsing the Census Gazetteer. Exploratory geospatial work with a lot of look-adjust-look; geopandas and shapely genuinely beat TypeScript on iteration speed. Its output is coordinates in the `stations` table, and nothing in the app imports it.
- **Data analysis.** §4's verification was done in pandas, which is the right call and took minutes.
- **Phase 3 backtesting and Phase 4 forecasting** (§20), for the same reason.

**What is not allowed:** writing the ingest in Python because v1 is "just a CLI." It is the same ingest the upload route and the Gmail poller will call, and two implementations of it is two chances to disagree about what a valid row is — the `file_sha256` idempotency in §11.2 only protects you if every path produces identical results.

Any Python that is written lives in `scripts/` with a `requirements.txt`, is run by hand, and is never imported by application code.

---

## 8. Routing provider

### 8.1 Options considered

| # | Option | Truck routing | Free tier | Verdict |
|---|---|---|---|---|
| 1 | **HERE Routing v8** | Native, commercially maintained | ~5k routing + 2.5k matrix/mo | **Deferred, not rejected** — best US truck data. Card required. |
| 2 | Google Routes + Large Vehicle Routing | Native (GA 17 Aug 2026) | Up to 10k/SKU/mo | Strong; very new. Second adapter if needed. |
| 3 | **OpenRouteService** | `driving-hgv`, OSM-derived | 2k directions + 500 matrix **per day**, no card | **Chosen for v1** — see §8.2 |
| 4 | GraphHopper Directions API | Truck profiles | Unverified | No advantage here. |
| 5 | Self-hosted GraphHopper | Yes | Free | Needs a persistent ~12–15 GB box. Not v1. |
| — | Mapbox | None | — | Ruled out. |

**Ruled out as oversized:** HERE Tour Planning, Waypoints Sequence, Route Optimization. Those solve multi-vehicle fleet assignment. This project needs `route` and `matrix`.

### 8.2 Why v1 ships on ORS, not HERE

HERE remains the better truck-data product. It is deferred because **v1 cannot cash in that advantage.**

**Quota is not the reason.** It is not the deciding factor, but ORS's free tier is no longer the more generous by an order of magnitude: measured, it is 200 directions and 50 matrix calls a day (§8.3), not the 2,000 the documentation quotes. At §8.3's 4–6 directions and matrix calls per plan, HERE's ~5,000/month allows roughly 830–1,250 plans a month, and ORS's binding matrix limit allows 25 plans a day, about 750 a month. Both cover the target of about 25 plans a day, but ORS's matrix does so exactly, with no headroom (§8.3's call table), where HERE has some.

**The reason is that v1's truck-legality gap is downstream, not upstream.** HERE's advantage is coverage of low bridges and weight limits in its road data. But §9.4 sends the driver a **Google Maps car route**: correct stops, unchecked roads. So in v1 the routing provider's truck data determines:

- distance and duration estimates → gallons → dollars ✅
- which stations fall inside the corridor ✅
- **not** the roads the driver actually drives ❌

Paying for better upstream truck data while the downstream link is a car route closes the gap at one end of the pipeline only.

**What deferring buys.** No card, no account, and — because ODbL carries no storage cap — the 30-day retention job is **dropped from v1 entirely** (§17), taking the expiry trigger and the `geometryExpired` response field with it. That is real engineering work avoided, and it comes back only with HERE.

**The named trigger for revisiting.** Adopt HERE when either becomes true:

1. The app ships **truck-legal turn-by-turn to drivers** rather than a Google link. At that point the routing data becomes safety-critical and HERE's maturity is worth paying for.
2. A coverage probe against known low-clearance and weight-restricted locations shows ORS missing restrictions at a material rate.

**This is deliberately cheap to reverse.** The provider interface (§8.4) exists for exactly this: adopting HERE is one new adapter file plus one case in a factory, with no caller changed. Nothing downstream — corridor query, optimiser, validation loop, API — knows which provider produced a route.

### 8.3 Cost and the budget guard

One plan ≈ 2–4 route calls (a baseline, plus one via route and up to three if the validation loop iterates — T-13), 2 matrix calls (two N × N — T-14) and up to 2 geocoding calls for typed addresses (T-15). **Expected spend: $0.**

The real risk is a retry loop, not ordinary use. **Build the budget guard in v1** — a persisted counter that throws once an endpoint's daily ceiling is hit. Not a log line; an error that stops the call.

**What a day has to hold.** The target is about 25 plans a day, and the guard must not add a limit tighter than the provider's own:

| Endpoint | Per plan | At 25 plans/day | ORS daily limit |
|---|---|---|---|
| directions | 2–4 | 50–100 | 200 |
| matrix | 2 | **50** | **50** |
| geocoding | ≤ 2 | ≤ 50 | 100 |

Matrix is the binding limit: 25 plans a day is exactly ORS's daily matrix quota, so there is no headroom there to spend on a margin.

#### There are two meters, and they measure different things

| | Ours — `provider_usage` | Theirs — `provider_quota` |
|---|---|---|
| What | A daily **call** ceiling | The provider's own **rate** limit |
| Scope | One counter per endpoint, never pooled | A separate pool per endpoint |
| Who enforces it | We do — the guard throws on call N+1 | They do; we only observe it |
| Where it comes from | Counted as calls are reserved, in one atomic statement | The `x-ratelimit-remaining` response header |
| Period | UTC day — `provider_usage.period` is that date | **Not stated by the provider** |

**Do not conflate them.** Ours resets at UTC midnight; theirs is a rolling window from the moment of each call. Just after midnight our matrix counter reads zero while ORS still counts the previous evening's calls, so the endpoint pool the next plan needs can be three calls from empty while ours says it is untouched. A single "calls remaining" figure would hide whichever is about to bite. Show both, separately.

**The provider does not say what window its rate limit covers, so neither should we.** `x-ratelimit-limit` is a bare number. Store the number and the moment it was observed; label no period. `observed_at` is what makes a reading interpretable at all.

**Measured, 2026-09-14 (T-10 step 5).** Live calls against the free tier's `x-ratelimit-limit` header confirm v3.4's figures exactly: **200/day for directions, 50/day for matrix, 100/day for geocoding** — not the 2,000/day and 500/day the documentation quotes. The documented quota is not the operative one; `backend/src/routing/budgetCeilings.ts`'s `DEFAULT_BUDGET_CEILINGS` sets the budget guard's per-endpoint ceilings from this measurement (200 directions, 50 matrix, 100 geocoding), not from the docs. `x-ratelimit-reset` moved with each request (a rolling window from the moment of the call, not a fixed UTC clock boundary) — one more reason §8.3's rule stands: store the number and when it was observed, and state no period. **Measured again, 2026-09-21 (T-14 step 14.3):** a matrix request ORS *refused* (400, error 6004) still decremented `x-ratelimit-remaining`, so a refused call costs a call — the guard already counts a reserved call that then fails. The per-request matrix limit is 3,500 routes; see §15.4.1.

**Decided, 2026-09-21 (T-54): the guard counts the provider's daily figures per endpoint per UTC day.** T-10 first applied these daily figures as *monthly* ceilings pooled across endpoints, so a matrix call was refused once the month's total calls reached 50 — about 8–12 plans a month against a target of about 25 a day, and 30 times tighter than the provider. Now:
- **A ceiling per endpoint, counted per UTC day.** A retry loop that burns one endpoint's day stops there and leaves the others working. A `provider_usage` row is `(provider, UTC day, endpoint)`.
- **The defaults are the measured limits, with no margin.** ORS's window is rolling, not a UTC day, so the guard approximates the provider's limit either way; a 429 from ORS is already a typed `RoutingProviderError`.
- **Overridable by environment** — `ORS_DAILY_LIMIT_DIRECTIONS`, `ORS_DAILY_LIMIT_MATRIX`, `ORS_DAILY_LIMIT_GEOCODING` — so a paid tier or a raised limit needs no code change. Unset means the default; anything but a whole number fails at startup; `0` blocks every call. The geocoding ceiling is read by T-15's adapter; until then nothing calls that endpoint.
- **The reservation is one atomic statement**, so two concurrent plans cannot both take the last slot.
- **A refusal says which endpoint, which day, the ceiling and the next UTC midnight**, when the counter resets.
- **No monthly spend ceiling is built.** On a $0 tier there is no spend to protect. It returns, pooled and per calendar month, when a paid provider is adopted — the way §17 keeps route expiry.

**Drift between the two meters is a finding, not noise.** If their remaining count falls faster than our permitted calls, something is calling the provider outside the guard — and our own budget is an undercount. Drift is a *rate*, not a level: one reading says nothing, so keep the two most recent observations and compare (their fall) − (our permitted calls), floored at zero. Both counters can legitimately go backwards — theirs at a window reset, ours at UTC midnight — and neither case is drift, so each starts a fresh baseline. The two windows differ (theirs rolls from each call, ours resets at a fixed clock time), so a reading straddling midnight can look like a reset on one side only; that is a fresh baseline too, not drift.

### 8.4 Provider interface

```typescript
interface RoutingProvider {
  readonly name: 'ors' | 'here' | 'google' | 'graphhopper';

  route(req: {
    origin: LatLng;
    destination: LatLng;
    via?: LatLng[];
    truckSpec: TruckSpec;
    departAt?: Date;
  }): Promise<{
    polyline: string;
    distanceMiles: number;          // the adapter converts a provider's native unit once, on the way in
    durationSeconds: number;
    legs: Array<{ distanceMiles: number; durationSeconds: number }>;
    providerRaw: unknown;          // raw stays raw: a provider's own units, untouched
  }>;

  matrix(req: {
    origins: LatLng[];
    destinations: LatLng[];
    truckSpec: TruckSpec;
  }): Promise<{ distanceMiles: Array<Array<number | null>>; durationSeconds: number[][] }>; // null = unreachable pair, never 0
}
```

**`legs` is mandatory.** The validation loop in §15.5 needs per-leg distances from the final waypointed route, and a provider adapter that cannot supply them is unusable regardless of its other qualities.

`ROUTING_PROVIDER` env var selects the adapter. v1 runs ORS in development and production alike.

---

## 9. Map rendering

### 9.1 Requirement

Custom-styled base map; station pins with custom icons; both routes overlaid in different colours and styles; hover tooltips showing price, distance from route, cumulative distance, and gallons.

### 9.2 Choice: MapLibre GL JS

Free, open source, vector-based. Styling is a JSON stylesheet you fully control. Handles custom markers, multiple line layers with independent paint properties, and popup/hover interactions natively.

**The renderer is independent of the routing provider.** Routes are computed by the routing adapter and drawn by MapLibre. These are unrelated choices — which is why changing provider does not touch the map at all.

### 9.3 Base tiles and layers

**OpenFreeMap** — free, keyless, no account, OSM-derived. Alternatives if it proves unreliable: MapTiler (free tier, key required), Protomaps (self-hosted), HERE Vector Tiles (key required). Swapping is a style-URL change.

| Layer | Content | Styling |
|---|---|---|
| `route-baseline` | Original A→B polyline | Muted, dashed |
| `route-optimized` | Waypointed polyline | Prominent, solid |
| `stations-selected` | Chosen fuel stops | Numbered pins, hover popup |
| `stations-candidate` | Corridor stations not selected | Small dots, toggleable |
| `endpoints` | Origin and destination | Distinct icons |

A station resolved only to city accuracy also draws an **uncertainty circle** of radius `uncertaintyMiles`, so the dispatcher can see that a pin is a town rather than a forecourt. The API returns everything these layers need in one payload (§14).

### 9.4 Google Maps link output

The dispatcher's deliverable to the driver:

```
https://www.google.com/maps/dir/?api=1
  &origin=<lat,lng>
  &destination=<lat,lng>
  &waypoints=<lat,lng>|<lat,lng>
  &travelmode=driving
```

Supports up to 9 intermediate waypoints; 1–4 fuel stops fits comfortably.

⚠️ **Caveat that must be surfaced in the UI:** this gives the driver a *car* route. The stop locations are correct, but the roads between them are not checked for truck restrictions. No worse than the current process, but it is a real gap between what the app computes and what the driver follows. Ship it with a disclaimer, in the payload rather than the frontend, so the frontend cannot omit it.

---

## 10. Deployment and infrastructure

| Component | Choice | Notes |
|---|---|---|
| App hosting | **Vercel** | Hobby is personal/non-commercial only; Pro is $20/mo for business use |
| Database | **Neon** (Postgres + PostGIS) | Free tier viable; branching useful for a fluid schema |
| Auth | **Auth.js**, one seeded account | Do not build auth |
| Cron (later) | Vercel Cron | A daily Gmail poll fits comfortably |
| Queue | **None in v1** | Add `pg-boss` on the same Postgres if ever needed |
| Domain | `*.vercel.app` for now | Migrate to the existing domain later |

**Why Vercel:** the frontend is React and the backend is TypeScript. Next.js route handlers put the shared `PlanResponse` type in one repository with one deploy — a daily benefit for a solo developer.

**Cost reality:** ORS's free tier covers this many times over and needs no card. Neon's free tier covers this. The only unavoidable cost is Vercel Pro at $20/month if this counts as business rather than personal use.

**Function limits are not a constraint.** With Fluid Compute, Hobby gets 300s and Pro up to 800s. Plan computation is 3–10s of mostly I/O wait, which Active CPU billing does not charge for.

**Alternatives if Vercel is rejected:** Railway (strongest — app, PostGIS, and a persistent worker in one project), Fly.io, Render, or a VPS with Docker Compose. Only relevant if a routing engine is ever self-hosted.

**Local development:** Docker Compose with `postgis/postgis` (already working, port 5433), Next dev server, an ORS API key. No cloud dependency.

---

## 11. Data pipeline

### 11.1 Ingest — one file

1. **Parse the metadata row** for `company_id` and `effective_date`; skip it.
2. **Hash the file** (SHA-256). An existing completed import with that hash → return it unchanged. Retries become free. *(§4.3 supplies a real duplicate to test this with.)*
3. **Normalise headers** — trim, uppercase, collapse whitespace.
4. **Stage → validate → promote.** Validate that columns are present, numerics parse, all `PROD` values are mapped, states are valid USPS codes, and `YOUR PRICE = min(TOTAL COST, RETAIL PRICE)`. Promote only on a clean pass.
5. **Upsert stations** on `(supplier, site_ref)`; update `last_seen_at`.
6. **Insert one `station_prices` row per station per day**, keyed on `valid_on`. Nothing is closed out and nothing is mutated — a day's prices are written once and never touched again.
7. **Report:** rows read / accepted / rejected with reasons, new stations, unmapped product codes, stations that vanished from this sheet.

At 605 rows this runs in seconds. Synchronous is fine.

**The ingest is a function, not an endpoint.** `ingestFile(buffer, meta)` takes bytes and returns a report; it does no HTTP, reads no `process.argv`, and prints nothing. v1 gives it exactly one caller — the CLI in §11.2. The upload route (§14) and the Gmail poller (§20) are later callers of the same function, which is the only reason deferring them costs nothing.

**Rejected rows are quarantined with a reason code, never dropped and never default-mapped.** An unmapped `PROD` value fails the row rather than guessing at it — that guard is the entire reason the product-code table exists (§22.4).

### 11.2 Bulk import and historical backfill

Roughly **ten years** of daily CSVs exist in Gmail, all in the same format. **Start with January 2026** — already on disk, 31 files — and extend once the pipeline is proven.

**One file = one day of validity.** Because a sheet arrives every day including weekends, each file's prices are valid for exactly the single day its header names. Set `valid_on = effective_date` rather than modelling "valid until superseded" as a range. This makes ingest **order-independent** — files can be uploaded in any sequence, and the `UNIQUE (station_id, raw_product, valid_on)` constraint is the only thing that can fire, and only on a genuine duplicate. Gaps stay visible rather than being papered over by a stale price carried forward.

**v1 ships two CLI entry points and no HTTP upload.** Both wrap the same single-file ingest (§11.1):

| Path | Command | Use |
|---|---|---|
| CLI single file | `npm run ingest -- ./data/bvd-prices/pcn-usd-9206810-981.csv` | The daily sheet |
| CLI backfill | `npm run backfill -- ./data/bvd-prices/2026-01/` | Ten-year replays; no timeout pressure |

Both are idempotent via `file_sha256`, so re-running is free and partial failures can simply be re-run. Both write an `import_batches` row with per-file status, so a single malformed sheet does not sink the run, and print the §11.1 report to stdout.

**Deferred: `POST /api/v1/imports/batch` and the upload UI.** A dispatcher dragging a folder into a browser is the eventual shape, and the schema already supports it — `import_batches`, `import_rejections` and the per-file status columns are built in v1 by the CLI, not added later for the endpoint. What is deferred is a route handler, a multipart parser, a progress UI and a Vercel function-timeout problem that a `.zip` of 3,650 files would create. None of that is needed to get ten years of prices into the database.

**Why this is the right call while v1 is being tested rather than run.** The operator and the user are the same person. A CLI is not a downgrade from an upload button for that person — it is faster to use, scriptable, and it makes the January backfill a single command instead of a browser tab that must stay open. The upload UI exists to serve someone who does not have a terminal. Until that someone exists, building it is work with no reader.

**What the deferral does not cost.** `priceAsOf` is unaffected: it reads `effective_date` from the sheet header (§4.1) and the CLI writes it exactly as any other entry point would. §18 risk 4 requires it in every response regardless of how the sheet arrived. Nothing about staleness handling changes with the entry point — only who is positioned to fix it.

**The condition for revisiting.** *The day a second person uses the planner.* At that point the ingest becomes someone else's dependency, and "ask the developer to run a command" stops being a workflow. Two things follow, in this order:

1. **The Gmail poller (§20 Phase 2) is the real answer**, not the upload UI. It removes the daily action entirely rather than moving it into a browser, and it is the smaller build — a Vercel Cron, a Gmail fetch, and a call to the same `ingestFile`.
2. **The upload route is then the exception handler** — corrected re-sends, one-off gap fills, a day the poller missed. That is a genuinely smaller feature than the drag-a-folder backfill tool it would have been in v1, because the backfill is already done by then.

**Detecting gaps:** after a backfill, report any date in the range with no `price_imports` row. **January 2026 is missing 2026-01-11** (§4.3), so this reports a real gap on the first run — which is the correct behaviour, not a bug to suppress. A missing day means either an email was deleted or BVD skipped a send.

**This unlocks backtesting and forecasting far earlier than accumulating history from scratch.** Do it early. Do not delete the emails.

### 11.3 Handling a new brand

Today every station is a Love's. If a future sheet includes another brand, the pipeline must degrade gracefully rather than break:

1. Brand extraction from `NAME` is generic — strip the trailing `#nnnn`.
2. An unrecognised brand does **not** fail the import. The station is created with `resolution = 'unresolved'`.
3. It appears in the import report under `new_brands` and `unresolved_stations`.
4. It is **excluded from planning** until resolved.
5. Resolution options, in order: OSM brand match if the chain is tagged; Census gazetteer centroid as a `city`-tier fallback; manual coordinate entry.

The station is never silently planned against with a bad coordinate.

### 11.4 Station resolution — a one-time script

**Step 1 — The operator's own export. Verified 4 September 2026.**

`data/US-CA-GasStations/LovesSearchResults.xlsx` holds **732 stores** with coordinates. Joining on store number — the number parsed out of `NAME`, never `SITE` — against the 605 BVD stations gives:

| Measure | Result |
|---|---|
| Matched | **604 of 605** |
| Unmatched | **1** — store **#306** (Dandridge, TN), which is temporarily closed, so Love's omits it from the export |
| State agreement on matches | **604 of 604** — an independent check that passed completely |
| `StoreType` of matched stores | **`Travel Stop`, all 604** |
| `DEFLanes` / `ParkingSpaces` populated | **604 of 604**, no nulls |
| Coordinate sanity | lat 25.95–48.57, lng −123.37 to −72.26 — inside CONUS |

Practical notes for whoever writes this: the file's real header is on **row 3** (`header=2`), rows 1–2 are Love's branding and a price disclaimer, and the last row is a footer to drop. Useful columns beyond coordinates: `StoreType`, `ParkingSpaces`, `DEFLanes`, `Address`, `Zip`, `HighwayOrExit`.

**That all 604 matched stores are `Travel Stop` settles §11.5's truck-accessibility question from the operator directly**, rather than by inference from OSM tagging. It also means the accessibility disclaimer can be softened — see §11.5.

**Step 2 — OpenStreetMap**, for whatever step 1 misses and as a cross-check. A single Overpass query filtered to the brand returns the whole chain in one request. Do **not** batch-query Overpass per station; that is what its rate limits exist to prevent.

Match on brand plus store number, which in practice comes from the `website` URL (`loves.com/locations/432`) far more often than from `ref`. Harvest `hgv`, `fuel:diesel`, `fuel:HGV_diesel`, `maxheight`, `capacity:hgv`.

> ⚠️ **Unverified, carried from v3.4:** OSM holds 489 distinct Love's sites against BVD's 605; one site is often several fuel features (`Love's (Trucks)`, `Love's (Cars)`) so clustering at ~400 m is required first; only 129 stations match by store number. **OSM alone is not sufficient** — which step 1's 604/605 makes moot for v1. Re-measure only if a second supplier arrives.

**Step 3 — Census Gazetteer centroids.** Places plus county subdivisions. Uncertainty radius `r = sqrt(ALAND_SQMI / π)`, in miles from the source data and **stored as miles** in `uncertainty_miles` — storage is miles everywhere. The eligibility rule below is `u < 5 miles` (Decided 2026-09-20; it was 8 km, ≈ 4.971 mi, until the rule was restated in the storage unit so a metric figure cannot be mixed in). > ⚠️ **Unverified, carried from v3.4:** it reported that this tier would place 595 of 605 stations by `(state, name_normalized)`. It is a name-match count, not a count of stations passing the 8 km rule; no code or test here reproduces it, and it does not matter for v1, since step 1 places 604 of 605. Re-measure only if a second supplier arrives.

This is the fallback for a brand that publishes nothing.

Loaded by `scripts/load_gazetteer.py` (T-03) from the Census Bureau's national Gazetteer files, restricted to the 50 states plus DC (§4.4 — this app is US-only). Where a Place and a County Subdivision would claim the same `(state, name_normalized)` key, the Place wins.

**Step 4 — Manual review** of the remainder. Given step 1, that is **one station** (#306), which is **temporarily closed** (decision, 2026-09-20): Love's omits it from the export because it has no coordinates to publish. It stays `unresolved`, so the corridor query never plans against it (T-11) — the right outcome for a closed store. If it reopens and reaches the export, re-running `scripts/resolve_from_operator.py` places it. The manual-entry subcommand still exists for a future case; its coordinates must come from an approved source (OSM has a node for #306, used by the tests), and a coordinate copied from a provider's map is still provider data (§17).

| Tier | Source | `resolution` | Eligible as a stop? |
|---|---|---|---|
| 1 | Operator export | `exact`, u = 0 | Yes |
| 2 | OSM match | `exact`, u ≈ 0 | Yes |
| 3 | Census centroid | `city` | Only if u < 5 miles and the leg has ≥ 2u slack |
| — | nothing | `unresolved` | **No** |

**Licensing:** see §17.1. The operator's export, OSM (ODbL, attribution required) and the Census Gazetteer (US public domain) all permit permanent storage. Provider geocoders do not.

### 11.5 Truck accessibility

The BVD sheet carries no diesel-lane, parking, or clearance data. But §11.4 step 1 does, for 604 of 605 stations.

- **v1:** stations matched to the operator export carry `truck_accessible = 'operator_verified'`, justified by `StoreType = 'Travel Stop'` plus a non-null `DEFLanes` count. The single unmatched station carries `'unverified'`.
- The plan still carries a `disclaimers` array, and an `ACCESSIBILITY_UNVERIFIED` disclaimer is emitted **only when a plan actually contains an unverified stop** — not unconditionally. A disclaimer that always fires is one nobody reads.
- **v1.5:** cross-check against OSM tags where available. Absence in OSM is not evidence of absence.

This is a change from v3.4, which had every stop `'unverified'` with a blanket disclaimer. The operator export makes that unnecessarily pessimistic.

### 11.6 Saved locations

Deliveries repeat, so origin and destination addresses recur. Cache resolved coordinates in a `saved_locations` table keyed on normalised address, with a **30-day expiry** — these come from a provider geocoder and are subject to §17's cap.

**But always re-plan.** §4.3 measured a median **41¢/gal** daily swing per station; yesterday's cheapest route for the same lane is not today's. Only the geocoding is cached, never the plan.

---

## 12. Database schema

**`migrations/*.sql` is authoritative.** This section is the target design. §12.1 lists every place the current migration diverges from it, and what to do about each. It covers only the v1 (fuel-planner) tables below — v2 adds an additive actuals schema (`drivers`, `trucks`, `fuel_cards`, invoices, reconciliation) on top of these via `migrations/0003_actuals.sql`/`0004_actuals_seed.sql`; see `PROJECT-SCOPE-v2.md` §A11 for that target design.

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Reference ───────────────────────────────────────────────────────────

CREATE TABLE place_centroids (
  state_usps       char(2) NOT NULL,
  name_normalized  text    NOT NULL,
  name_raw         text    NOT NULL,
  geoid            text,
  geom             geography(Point,4326) NOT NULL,
  land_area_sqmi   numeric(10,4),
  uncertainty_miles numeric(8,3) NOT NULL,
  source           text NOT NULL,
  PRIMARY KEY (state_usps, name_normalized)
);

CREATE TABLE product_codes (
  supplier      text NOT NULL,
  raw_code      text NOT NULL,
  product_type  text NOT NULL
    CHECK (product_type IN ('highway_diesel','off_road_diesel','gasoline','def','other')),
  mapped_by     text NOT NULL,
  mapped_at     timestamptz NOT NULL DEFAULT now(),
  notes         text,
  PRIMARY KEY (supplier, raw_code)
);
-- Seed: ('BVD','ULSD','highway_diesel','seed',now(),'Confirmed from 2026-08-22 sheet')

-- ─── Users and locations ─────────────────────────────────────────────────

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text UNIQUE NOT NULL,
  role       text NOT NULL DEFAULT 'dispatcher'
               CHECK (role IN ('dispatcher','driver','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label          text,
  address_raw    text NOT NULL,
  address_norm   text NOT NULL UNIQUE,
  matched_label  text,                     -- the geocoder's own formatted match (T-15); distinct from `label`, a dispatcher-set favourite name never written by the resolver
  geom           geography(Point,4326) NOT NULL,
  geocode_source text NOT NULL,
  geocoded_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,     -- provider geocodes: 30-day cap
  use_count      integer NOT NULL DEFAULT 0
);

-- ─── Truck profiles ──────────────────────────────────────────────────────

CREATE TABLE truck_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL,
  display_name         text NOT NULL,
  truck_number         integer UNIQUE,          -- fleet unit number, if assigned. This is a v1 profile/template field (D6) — distinct
                                                 -- from v2's `trucks.unit_number` (text, D18), which identifies a real fleet unit for
                                                 -- actuals matching. The two are different concepts, not competing designs.
  owner_user_id        uuid REFERENCES users(id),
  is_system            boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,

  -- fuel model (§5)
  tank_gallons         numeric(6,1) NOT NULL CHECK (tank_gallons > 0),
  avg_mpg              numeric(4,2) NOT NULL CHECK (avg_mpg > 0),
  reserve_fraction     numeric(4,3) NOT NULL DEFAULT 0.150
                         CHECK (reserve_fraction >= 0 AND reserve_fraction < 0.5),
  max_leg_miles        numeric(6,1) NOT NULL DEFAULT 500,
  min_leg_miles        numeric(6,1) NOT NULL DEFAULT 300,
  max_gallons_per_fill numeric(6,1),

  -- physical spec → routing provider
  gross_weight_kg      integer,
  height_cm            integer,
  width_cm             integer,
  length_cm            integer,
  axle_count           smallint,
  trailer_count        smallint,
  hazmat_class         text,

  -- cost model
  cost_per_mile_usd    numeric(6,3) NOT NULL DEFAULT 0.000,
  fixed_stop_minutes   integer      NOT NULL DEFAULT 20,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CHECK (min_leg_miles <= max_leg_miles)
);

CREATE UNIQUE INDEX truck_profiles_owner_slug ON truck_profiles
  (COALESCE(owner_user_id,'00000000-0000-0000-0000-000000000000'::uuid), slug);

-- ─── Stations ────────────────────────────────────────────────────────────

CREATE TABLE stations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier            text NOT NULL,
  site_ref            text NOT NULL,        -- BVD's SITE
  name_raw            text NOT NULL,        -- "LOVES #368"
  brand_normalized    text,                 -- "LOVES"
  store_number        integer,              -- 368 — the operator/OSM join key
  city_raw            text NOT NULL,
  city_normalized     text NOT NULL,
  state_usps          char(2) NOT NULL,
  country             char(2) NOT NULL DEFAULT 'US',

  geom                geography(Point,4326),
  resolution          text NOT NULL DEFAULT 'unresolved'
                        CHECK (resolution IN ('exact','city','unresolved')),
  uncertainty_miles   numeric(8,3),
  resolution_source   text,
  resolved_at         timestamptz,

  truck_accessible    text NOT NULL DEFAULT 'unverified'
                        CHECK (truck_accessible IN ('operator_verified','osm_verified',
                                                    'unverified','excluded')),
  osm_id              text,
  osm_tags            jsonb,
  operator_attrs      jsonb,                -- StoreType, ParkingSpaces, DEFLanes.
                                            -- NEVER prices — see §17.1.
  max_gallons_per_txn numeric(6,1),

  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (supplier, site_ref)
);

CREATE INDEX stations_geom_gix   ON stations USING GIST (geom);
CREATE INDEX stations_resolution ON stations (resolution) WHERE resolution <> 'unresolved';
CREATE INDEX stations_store_num  ON stations (brand_normalized, store_number);

CREATE TABLE station_geocode_candidates (
  id            bigserial PRIMARY KEY,
  station_id    uuid NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  rank          smallint NOT NULL,
  geom          geography(Point,4326) NOT NULL,
  source        text NOT NULL,
  score         numeric(5,4),
  uncertainty_miles numeric(8,3),
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── Imports and prices ──────────────────────────────────────────────────

CREATE TABLE import_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label        text,
  file_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE price_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        uuid REFERENCES import_batches(id),
  supplier        text NOT NULL,
  company_id      text,
  country         char(2) NOT NULL DEFAULT 'US',
  source_filename text NOT NULL,
  file_sha256     char(64) NOT NULL UNIQUE,   -- the idempotency key
  effective_date  date NOT NULL,              -- from the header. NOT unique — see §12.1
  received_at     timestamptz,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','parsing','validating','completed','failed')),
  rows_read       integer,
  rows_accepted   integer,
  rows_rejected   integer,
  report          jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX price_imports_effective ON price_imports (supplier, effective_date);

CREATE TABLE import_rejections (
  id          bigserial PRIMARY KEY,
  import_id   uuid NOT NULL REFERENCES price_imports(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  site_ref    text,
  code        text NOT NULL,
  message     text NOT NULL
);

CREATE TABLE station_prices (
  id             bigserial PRIMARY KEY,
  station_id     uuid   NOT NULL REFERENCES stations(id),
  import_id      uuid   NOT NULL REFERENCES price_imports(id) ON DELETE CASCADE,
  raw_product    text   NOT NULL,
  product_type   text   NOT NULL,   -- denormalised at import; see §15.4

  cost           numeric(8,4),
  federal_tax    numeric(8,4),
  state_tax      numeric(8,4),
  sales_tax      numeric(8,4),
  freight        numeric(8,4),
  other          numeric(8,4),
  total_cost     numeric(8,4),
  retail_price   numeric(8,4),
  your_price     numeric(8,4),   -- = min(total_cost, retail_price); READ, never compute
  savings        numeric(8,4),

  price_pump     numeric(8,4) GENERATED ALWAYS AS (your_price) STORED,
  price_ifta_net numeric(8,4) GENERATED ALWAYS AS
                   (COALESCE(cost,0) + COALESCE(freight,0)
                    + COALESCE(other,0) + COALESCE(federal_tax,0)) STORED,

  valid_on       date NOT NULL,   -- exactly one day. Not a range.

  UNIQUE (station_id, raw_product, valid_on)
);

CREATE INDEX station_prices_lookup ON station_prices (valid_on, product_type, station_id);

-- ─── Routes and plans ────────────────────────────────────────────────────

-- ORS geometry is ODbL and carries no storage cap, so v1 keeps it indefinitely
-- and there is no expiry column or trigger. Geometry stays nullable: adopting a
-- contractually capped provider (HERE, Google) reintroduces expiry, and the
-- retention job then needs somewhere to null it to. See §17.
CREATE TABLE routes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL,
  request_hash     char(64) NOT NULL,
  origin_geom      geography(Point,4326) NOT NULL,
  destination_geom geography(Point,4326) NOT NULL,
  truck_profile_id uuid NOT NULL REFERENCES truck_profiles(id),
  via_hash         char(64),
  line             geography(LineString,4326),   -- NULLABLE: see §17
  polyline         text,                         -- NULLABLE: see §17
  legs             jsonb,                        -- NULLABLE: see §17
  distance_miles   numeric(9,3) NOT NULL,        -- scalar: permanent
  duration_s       integer NOT NULL,             -- scalar: permanent
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, request_hash)
);

CREATE INDEX routes_line_gix ON routes USING GIST (line);

CREATE TABLE plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by           uuid REFERENCES users(id),
  base_route_id        uuid NOT NULL REFERENCES routes(id),
  optimized_route_id   uuid REFERENCES routes(id),
  truck_profile_id     uuid NOT NULL REFERENCES truck_profiles(id),

  optimizer_strategy   text NOT NULL DEFAULT 'dp_v1',
  price_basis          text NOT NULL DEFAULT 'pump'
                         CHECK (price_basis IN ('pump','ifta_net','total_cost')),
  start_fuel_gallons   numeric(6,1) NOT NULL,
  min_arrival_gallons  numeric(6,1) NOT NULL,
  max_leg_miles        numeric(6,1) NOT NULL,
  min_leg_miles        numeric(6,1) NOT NULL,
  min_leg_relaxed      boolean      NOT NULL DEFAULT false,   -- §5.1 two-pass fallback
  max_detour_miles     numeric(5,1) NOT NULL,
  driver_cost_per_hour numeric(7,2) NOT NULL DEFAULT 0,
  fixed_stop_minutes   integer      NOT NULL DEFAULT 20,
  max_stops            smallint,

  status               text NOT NULL
                         CHECK (status IN ('completed','infeasible')),
  infeasible_reason    text,

  total_fuel_cost_usd  numeric(10,2),
  total_gallons        numeric(8,2),
  total_distance_miles numeric(9,3),
  total_duration_s     integer,
  baseline_cost_usd    numeric(10,2),
  price_as_of          date,
  google_maps_url      text,
  disclaimers          jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  dispatched_at        timestamptz   -- set when a human actually sends this plan to a driver; NULL = computed only
);

CREATE TABLE plan_stops (
  id                   bigserial PRIMARY KEY,
  plan_id              uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  seq                  smallint NOT NULL,
  stop_type            text NOT NULL DEFAULT 'fuel'
                         CHECK (stop_type IN ('fuel','rest','delivery')),
  station_id           uuid   REFERENCES stations(id),
  station_price_id     bigint REFERENCES station_prices(id),

  offset_along_route_miles numeric(9,3) NOT NULL,
  leg_distance_miles   numeric(9,3) NOT NULL,    -- from the previous fill
  detour_distance_miles numeric(7,3) NOT NULL DEFAULT 0,
  detour_duration_s    integer      NOT NULL DEFAULT 0,

  arrival_gallons      numeric(6,2) NOT NULL,
  purchase_gallons     numeric(6,2) NOT NULL,
  departure_gallons    numeric(6,2) NOT NULL,
  unit_price_usd       numeric(8,4) NOT NULL,    -- literal, not a join. See §17.
  stop_cost_usd        numeric(9,2) NOT NULL,

  cum_distance_miles   numeric(9,3) NOT NULL,
  cum_duration_s       integer      NOT NULL,

  UNIQUE (plan_id, seq)
);

-- ─── Provider metering (§8.3) ────────────────────────────────────────────

CREATE TABLE provider_usage (        -- ours: a daily call ceiling per endpoint; period = UTC day
  provider   text NOT NULL,
  period     date NOT NULL,
  endpoint   text NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, period, endpoint)
);

CREATE TABLE provider_quota (        -- theirs: an observed rate limit, no stated window
  provider     text NOT NULL,
  endpoint     text NOT NULL,
  limit_value  integer,
  remaining    integer,
  observed_at  timestamptz NOT NULL,
  prev_remaining integer,
  prev_observed_at timestamptz,
  PRIMARY KEY (provider, endpoint)
);
```

### 12.1 Where the current migration diverges — must fix

`migrations/0001_init.sql` was written before this design settled. Every item below is a real difference, ordered by severity.

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | **Syntax error** — trailing comma after `max_leg_miles … DEFAULT 500,` before the closing `);` in `trucks` | **The migration does not run at all.** Docker Compose's init step fails silently on an already-initialised volume. | Delete the comma. Then `npm run db:reset` to re-run against a clean volume. |
| 2 | `price_imports.effective_date` is **`UNIQUE`** | Blocks a corrected re-send for the same day, and blocks a second supplier's sheet for that day. The SHA-256 already provides idempotency; this constraint adds nothing and forbids something legitimate. | Drop `UNIQUE`; keep a plain index. |
| 3 | No `plans` or `plan_stops` | The business record does not exist. Everything in §17's retention model depends on these. | Add. |
| 4 | No `users`, `saved_locations`, `product_codes`, `place_centroids`, `import_batches`, `import_rejections`, `provider_usage`, `provider_quota` | Auth, geocode caching, the unmapped-product tripwire, the gazetteer fallback, batch reporting and the budget guard all have nowhere to live. | Add as needed per build step, not all at once. |
| 5 | `trucks` lacks `min_leg_miles`, `cost_per_mile_usd`, `fixed_stop_minutes` | §5.5's parameters have no home; the 300-mile floor would become a hardcoded constant. | Add. Rename the table `truck_profiles`. |
| 6 | `trucks.reserve_fraction` defaults to **0.100**, spec says **0.150** | A 5-point difference in the safety margin that absorbs MPG error. | Decide (§21 Q2), then align both. |
| 7 | `stations.site_ref` is `UNIQUE` alone, not `(supplier, site_ref)` | Fine for one supplier; breaks the moment a second one shares a site ID. | Change to a composite unique with a `supplier` column. |
| 8 | `stations` has no `resolution`, `uncertainty_miles`, `truck_accessible`, `operator_attrs` | §11.4's tier model and §11.5's accessibility cannot be recorded. | Add. |
| 9 | `station_prices.effective_on` vs spec's `valid_on`; no generated price columns; unique is `(station_id, product_type, effective_on)` not `(station_id, raw_product, valid_on)` | Naming drift, plus keying on the mapped type rather than the raw code loses the ability to carry two raw codes that map to one type. | Rename and re-key. |
| 10 | `routes.line` and `polyline` are `NOT NULL`; no `provider` | Geometry cannot be nulled, so adopting a capped provider later would need a schema change rather than a job. | Make geometry nullable, add `provider`. No expiry column or trigger in v1 — see §17. |
| 11 | All keys are `bigserial`, spec uses `uuid` | Cosmetic, but mixed styles are worse than either. | Pick one (§21 Q3). |

**Recommended approach:** rather than a chain of `ALTER TABLE` migrations against a schema that has never successfully applied and holds no data, **rewrite `0001_init.sql`.** There is nothing to preserve. Once real data is loaded, switch to additive migrations permanently.

### 12.2 Schema notes

- **`station_prices` is keyed on a plain `valid_on` date, not a `tstzrange`.** A sheet arrives every day, so validity is always exactly one day. A date column with a unique constraint expresses the same guarantee more simply, keeps bulk backfill order-independent, and leaves a skipped day visible as a gap rather than papering over it with a stale price carried forward. §4.3's missing 2026-01-11 is exactly the case this preserves.
- `truck_profiles` needs no migration for user-defined profiles — `owner_user_id` plus the partial unique index handles it.
- `plans.optimizer_strategy` records which algorithm produced a plan, so results stay interpretable across upgrades.
- `plans.min_leg_relaxed` records that §5.1's fallback fired, so a plan with a short leg is always distinguishable from one that met the floor.
- **`plans.corridor_miles` and `plans.max_detour_miles` are the two parameters T-16 split apart** (§14, §15.1): the screening radius the corridor query ran with is always recorded (`NOT NULL`), while the post-routing cap is nullable — `NULL` means the plan was computed with no cap, not a cap of `0`.
- **`plans.status` has only two values: `completed` and `infeasible`.** `pending`/`computing`/`failed` were dropped. They belong to an async job model — submit, then poll a status while a worker churns — and v1 explicitly has none of that: §6 decision 19 rules out a job queue, and §10 measures plan computation at 3–10s of mostly I/O wait, comfortably inside one synchronous request. A `plans` row is written once, at the end of `POST /plans`, already carrying its final outcome — there is no in-between state for the database to hold, and a status column that implies one invites a client to poll for a transition that will never happen. `failed` goes for the same reason from the other direction: a technical failure (provider timeout, budget guard, an unhandled exception) is not a business outcome worth a permanent row — it returns an RFC 9457 error response (§14) and nothing is persisted. Only `infeasible` is a persisted non-success, because it is the DP's actual answer — "no valid plan exists under these constraints" — not a crash.
- **`plans.dispatched_at` is deliberately separate from `status`.** `status = 'completed'` means the optimiser finished and produced stops — it says nothing about whether anyone acted on the result. A dispatcher exploring three truck profiles for the same lane produces three completed plans and dispatches one. `dispatched_at` (nullable, unset by default) is that human signal: null means "computed only," a timestamp means "this is the plan that was actually sent to a driver." Nothing sets it automatically in v1 — no endpoint marks it yet — so it carries no weight until a caller writes to it, but the column exists now so the distinction is not lost in the interim. Its first real use is §20 Phase 3: backtesting should reconcile driver receipts against dispatched plans, not against every exploratory computation a dispatcher discarded.
- **Keep a schema-drift test.** Mirror the migrations in the query builder's schema definition and compare that mirror against `information_schema` on every test run. Code and database then cannot drift from each other. Neither checks *this document* — when they disagree with §12, the migration wins and §12 gets edited.

---

## 13. Service boundaries

```
Entry points
  ├─ API Layer (Next.js route handlers) ─ validation, auth, serialisation,
  │                                        unit conversion. No business logic.
  └─ CLI (npm run ingest | backfill) ──── argv, stdout report. No business logic.

Services — framework-free, callable from either entry point
  ├── Ingest Service ......... parse, validate, promote   ← CLI only in v1 (§11.2)
  ├── Resolution Service ..... operator export → OSM → gazetteer → manual queue
  ├── Catalog Service ........ profiles, stations, price history, saved locations
  └── Planning Service ....... orchestration
          ├── Routing Adapter (ORS in v1 | HERE | Google) + budget guard
          └── Optimizer Strategy  ← PURE, no I/O
```

**The CLI is a second entry point, not a second implementation.** It does argument parsing and report printing and nothing else — the same rule the API layer follows. This is what makes §11.2's deferred upload route a wrapper rather than a rewrite, and it is the constraint §7.1 leans on when it rules out a Python ingest.

**Auth sits in front of the API, not inside it.** Keep `src/api/` framework-free so the whole API can mount in a single Next route file and be exercised by tests without a server. A thin proxy layer refuses anonymous requests: 307 to `/signin` for a page, 401 `application/problem+json` for an API path — because a redirect answers `fetch` with a 200 carrying a sign-in page, which is a confusing failure. Nothing is exempt, including `GET /health`.

The API is **told** whether it is protected rather than asserting it: `createApp({ authRequired: true })` from the mount. A local `npm run serve` has no session check and binds to `127.0.0.1`.

### 13.1 The optimiser as a swappable strategy

Modularity was an explicit requirement. The optimiser is a **pure function behind a registry**, so a more complex algorithm can be dropped in without touching orchestration, persistence, or the API.

```typescript
// Miles and gallons throughout: a strategy never sees a metre. Nothing upstream of it does
// either: the routing adapter and the corridor query convert at their own edges (§8.4, §15.4),
// and planning/optimizerInput.ts (toOptimizerLane) is a plain mapping.
export interface OptimizerCandidate {
  id: string;
  positionMiles: number;           // along the route from the origin
  unitPriceUsd: number;            // 4dp, never rounded inside a strategy
  detourMiles: number;             // 0 for a station on the route
  detourHours: number;
}

export interface OptimizerInput {
  totalDistanceMiles: number;
  candidates: readonly OptimizerCandidate[];  // a strategy sorts; order is not trusted
  fuel: {
    tankGallons: number;
    avgMpg: number;
    reserveFraction: number;
    maxLegMiles: number;
    minLegMiles: number;
    startGallons: number;
    minArrivalGallons: number;
    requireArrivalWithinMaxLeg: boolean;
  };
  cost: {
    costPerMile: number;
    driverCostPerHour: number;
    fixedStopMinutes: number;
  };
  maxStops: number | null;         // null = no cap; 0 = no stops. Required, so null is never dropped.
}

export type OptimizerResult =
  | { kind: 'plan'; stops: PlannedStop[]; startGallons: number; finalLegMiles: number;
      destinationArrivalGallons: number; totalGallons: number;
      totalFuelCostUsd: number; totalCostUsd: number }   // totalCostUsd = fuel + stop penalties
  | { kind: 'infeasible'; code: InfeasibleCode; detail: /* typed per code */ object };

// InfeasibleCode = 'LEG_GAP' | 'MAX_STOPS_EXCEEDED' | 'FUEL_INFEASIBLE'. LEG_GAP is decided from
// the leg bounds alone, before fuel or stop count is blamed. Fuel figures on a plan are in
// 2-gallon buckets, rounded down on arrival (§15.3): a conservative bookkeeping the planning
// service re-derives from the routed legs (§15.5).

export interface OptimizerStrategy {
  readonly id: string;                 // persisted to plans.optimizer_strategy
  readonly description: string;
  solve(input: OptimizerInput): OptimizerResult;
}

export const OPTIMIZERS = {
  dp_v1:     dynamicProgrammingOptimizer,   // default — exact
  greedy_v1: greedyOptimizer,               // reference baseline
} as const satisfies Record<string, OptimizerStrategy>;
```

**Rules that keep this modular:**

- **No I/O in a strategy.** No database, no HTTP, no clock. Every strategy is testable in-process against fixtures.
- Strategies are interchangeable on identical input. Running two and diffing is a supported workflow.
- `plans.optimizer_strategy` records which one ran, so historical plans stay interpretable after an upgrade.
- Adding a strategy is a new file plus a registry entry. Nothing else changes.

This is the highest-leverage structural decision in the backend. Every interesting bug will live inside a strategy, and you want a hundred table-driven cases running in milliseconds without a container.

---

## 14. API design

Versioned under `/api/v1`. Errors follow RFC 9457. All responses accept `?units=imperial|metric`, default imperial.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/truck-profiles` | List profiles |
| `POST` | `/plans` | Create a plan |
| `GET` | `/plans/{id}` | Fetch a plan — map + table + link in one payload |
| `GET` | `/plans` | Recent plans |
| `GET` | `/price-sheets` | Import identity for the UI — `effectiveOn`, `importedAt`, `stationCount` |
| `GET` | `/stations` | Station layer (`?bbox=`, `?resolution=`) |
| `GET` | `/stations/{id}/prices` | Price history |
| `GET` | `/health` | DB, provider reachability, both call meters, latest sheet date |

**No `/imports` routes in v1.** Ingest is CLI-only (§11.2); the endpoints below are specified so the deferral is a gap rather than an unknown, and are built when the upload UI is:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/imports` | Upload a BVD CSV |
| `POST` | `/imports/batch` | Bulk upload — zip or multi-file |
| `GET` | `/imports/batch/{id}` | Per-file status for a batch |
| `GET` | `/imports/{id}` | Status + validation report |
| `GET` | `/imports/{id}/rejections` | Rejected rows with reasons |

The tables they read from (`import_batches`, `price_imports`, `import_rejections`) are populated by the CLI from step 2, so these are read-model endpoints over data that already exists — not a feature waiting on a schema change.

### `POST /plans`

**Synchronous.** The request computes the plan in-process and the response carries the finished result directly — the same `completed`/`infeasible` body `GET /plans/{id}` returns, not a job reference to poll. This follows from §6 decision 19 (no job queue) and §10's measured 3–10s solve time, and it is why `plans.status` has no in-progress states (§12.2). `GET /plans/{id}` exists to re-fetch a plan later — a shared link, browsing history — not to poll one still computing.

```jsonc
{
  "origin":      { "address": "1200 W 35th St, Chicago, IL 60609" },
  "destination": { "address": "4200 S Lamar Blvd, Dallas, TX 75215" },
  "truckProfileId": "…",

  "startFuelGallons":   null,     // default = tank capacity (100%)
  "minArrivalGallons":  null,     // default = reserve level
  "maxLegMiles":        500,      // default from profile
  "minLegMiles":        300,      // default from profile; auto-relaxed if infeasible
  "corridorMiles":      25,       // screening radius; default when omitted — see §15.1
  "maxDetourMiles":     5,        // post-routing cap on one station's actual detour
  "maxStops":           null,
  "priceBasis":         "pump",
  "driverCostPerHour":  0,
  "fixedStopMinutes":   20,
  "optimizerStrategy":  "dp_v1",  // optional override
  "departAt":           null
}
```

Both endpoints accept `{ "address": "…" }` or `{ "lat": …, "lng": … }`.

**Two detour parameters, not one (T-16, 22 September 2026).** An earlier draft of
this document had a single `maxDetourMiles` doing two jobs — deciding what a
corridor candidate was at all, and capping what the optimiser could route a
truck to. Those are different questions at different stages of the pipeline,
so they are now two fields:

- `corridorMiles` — a straight-line **screening** radius, inflated per-station
  by that station's own uncertainty (§17.1's tiered resolution), deciding
  what is considered a corridor candidate at all. Defaults to a fixed
  screening radius when omitted; there is no truck-profile column for it,
  since it is a search parameter, not a fact about the truck.
- `maxDetourMiles` — a **post-routing** cap on one station's actual,
  measured round-trip drive off the route. Nullable; `null` means no cap,
  distinct from `0`, which keeps only stations effectively on the route.

A station can be inside the corridor and still be rejected by the detour
cap — the two never substitute for each other.

### `GET /plans/{id}` — completed

```jsonc
{
  "planId": "…",
  "status": "completed",
  "units": "imperial",
  "priceAsOf": "2026-08-22",
  "optimizerStrategy": "dp_v1",

  "truckProfile": {
    "slug": "volvo-vnl-860",
    "displayName": "Volvo VNL 860 — dual tank, long haul",
    "maxLegMiles": 500
  },

  "baseline": {
    "polyline": "BG0xy…",
    "distanceMiles": 967.4,
    "durationSeconds": 53280,
    "estimatedFuelCostUsd": 863.20,
    "bounds": { "north": 0, "south": 0, "east": 0, "west": 0 }
  },

  "optimized": {
    "polyline": "BG3ab…",
    "distanceMiles": 981.2,
    "durationSeconds": 55020,
    "totalFuelCostUsd": 792.14,
    "totalGallons": 163.5,
    "savingsVsBaselineUsd": 71.06,
    "addedDistanceMiles": 13.8,
    "addedDurationSeconds": 1740,
    "bounds": { }
  },

  "stops": [
    {
      "seq": 1,
      "stopType": "fuel",
      "station": {
        "id": "…",
        "name": "LOVES #412",
        "storeNumber": 412,
        "city": "Effingham",
        "state": "IL",
        "location": { "lat": 39.1123, "lng": -88.5434 },
        "resolution": "exact",
        "uncertaintyMiles": 0,
        "truckAccessible": "operator_verified"
      },
      "legDistanceMiles": 214.3,
      "detourMiles": 0.4,
      "detourSeconds": 90,
      "unitPriceUsd": 5.193,
      "arrivalGallons": 64.2,
      "purchaseGallons": 85.8,
      "departureGallons": 150.0,
      "stopCostUsd": 445.56,
      "cumulativeDistanceMiles": 214.7,
      "cumulativeDurationSeconds": 12180,
      "arrivalFuelPercent": 42.8
    }
  ],

  "candidateStations": [ /* corridor stations not selected — the map's dot layer */ ],

  "googleMapsUrl": "https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=…",

  "disclaimers": [
    { "code": "GOOGLE_LINK_NOT_TRUCK_LEGAL",
      "message": "The Google Maps link routes between the correct stops but does not check truck restrictions." },
    { "code": "PRICE_STALENESS",
      "message": "Prices reflect the BVD sheet effective 2026-08-22." }
  ],

  "attribution": {
    "routing": "© openrouteservice.org (HeiGIT)",
    "placeData": "© OpenStreetMap contributors (ODbL)"
  }
}
```

**`stops[]` serves the map markers and the table.** One array, no drift between the two views.

**Two disclaimers are conditional, two are not.** `GOOGLE_LINK_NOT_TRUCK_LEGAL` and `PRICE_STALENESS` always fire, as the sample above shows. `ACCESSIBILITY_UNVERIFIED` fires only when a stop is not operator-verified (§11.5). `MIN_LEG_RELAXED` fires only when §5.1's second pass ran, and names the short legs.

### `GET /plans/{id}` — infeasible

```jsonc
{
  "planId": "…",
  "status": "infeasible",
  "reason": {
    "code": "LEG_GAP",
    "message": "No BVD station between mile 412 and mile 1,088; the 500-mile cap cannot be met.",
    "gapStartMile": 412,
    "gapEndMile": 1088,
    "gapMiles": 676,
    "maxLegMiles": 500,
    "suggestions": [
      { "action": "increaseDetour",      "maxDetourMiles": 25 },
      { "action": "increaseMaxLeg",      "maxLegMiles": 700 },
      { "action": "allowOffNetworkStop", "note": "Requires a non-BVD fuel stop" }
    ]
  },
  "candidateStations": [ /* still returned, so the dispatcher can decide manually */ ]
}
```

Given §4.4's thin coverage in CT/NJ/WV/MD/SD/ID/MN/MT, this **will** fire on real lanes. Returning candidates alongside the failure lets the dispatcher fall back to judgement rather than hitting a dead end. An infeasible plan is a legitimate answer, not an error — it is persisted with `status = 'infeasible'`, not discarded.

### Geometry expiry — not in v1

Route geometry does not expire under ORS, so **no `geometryExpired` field is returned in v1** and a plan of any age renders its map. Adopting a contractually capped provider reintroduces both the expiry and the field, whose behaviour is specified in §17: the table still renders, the map does not, and nothing is recomputed to display one.

---

## 15. The stop-selection algorithm

### 15.1 Formulation

Minimise total cost subject to:

- Distance between consecutive fuel purchases ≤ `max_leg_miles` (500) — **hard**
- Distance between consecutive purchases ≥ `min_leg_miles` (300) — **hard**, but see §5.1's relaxation pass
- The minimum does **not** apply to the final leg (last fill → destination)
- Tank level never below `reserve_fraction × tank_gallons` — **hard**
- Tank level never above `tank_gallons` — **hard**
- Arrival fuel ≥ `min_arrival_gallons` — **hard**
- Origin counts as a fill (truck starts at 100%)
- Destination within `max_leg_miles` of the last fill, if `requireArrivalWithinMaxLeg`
- A candidate's straight-line offset from the route ≤ `corridor_miles` +
  its own `uncertainty_miles` — **screening**, decides candidacy, not cost
  (T-16, §14)
- A chosen stop's measured, routed detour ≤ `max_detour_miles`, when not
  `null` — **post-routing**, applied after a candidate has already survived
  screening (T-16, §14)

Objective:

```
total = Σ (purchase_gallons_i × price_i)
      + Σ (detour_miles_i × cost_per_mile)
      + Σ (detour_hours_i × driver_cost_per_hour)
      + Σ (fixed_stop_minutes / 60 × driver_cost_per_hour)   for each stop where purchase > 0
```

### 15.2 Why an exact DP, not a greedy

Lin, Gertsch & Russell (2007) prove the greedy refuelling policy optimal for the fixed-route problem, but the proof assumes free pass-by and no per-stop cost. Detours and the stop penalty violate both.

More decisively: with a 500-mile cap, any realistic route has **1–4 stops** and **tens of corridor candidates**. An exact DP runs in single-digit milliseconds. There is no reason to accept a heuristic here. The greedy is retained as `greedy_v1` purely as a comparison baseline — running both and diffing is how you find out whether a future strategy is actually better.

### 15.3 The DP

**State:** `cost[i][f]` = minimum cost to arrive at candidate *i* holding *f* gallons (before purchasing), where *f* is a bucket index.

**Buckets:** 2-gallon granularity. A 150-gallon tank → 75 buckets, finer than the ±10% real-world MPG error. **Round conservatively — down on arrival fuel** — so discretisation never manufactures range that does not exist.

**Two-phase relaxation per station**, which is what keeps it cheap:

*Phase A — purchase (in place).* **A visited station buys at least one bucket.** (An earlier draft let Phase A leave the level unchanged; but then a stop that buys nothing still resets the leg counter, and a truck could cover 800 miles on "stops" that never fuel it — breaking §5.1's cap on distance between *purchases*. A stop the plan does not need is simply not made; "buy little" at a forced stop means one bucket.) At station *i*, scan buckets upward. Buying moves you from bucket *f* to *f+1* at a cost of `bucketGallons × price_i`. One linear pass gives the optimal cost of reaching every departure level. The fixed stop penalty is charged once, on the first gallon bought.

```
for f from 0 to B-1:
    if depart[i][f] + bucketGallons * price_i < depart[i][f+1]:
        depart[i][f+1] = depart[i][f] + bucketGallons * price_i
```

*Phase B — drive.* For each departure bucket at *i* and each candidate *j* with `min_leg_miles ≤ s_j − s_i ≤ max_leg_miles`, compute burn and relax `cost[j][f']`. The lower bound is the only change the hard floor introduces — and the transition into the virtual destination node ignores it.

**Complexity:** O(n·B) for Phase A across all stations, O(n²·B) for Phase B. At n = 80, B = 75 that is roughly 480,000 relaxations — milliseconds.

**Origin** is a virtual node at mile 0, fuel = tank capacity, price = ∞ (no purchase possible).
**Destination** is a virtual node at mile D; a transition into it is valid only if the leg is within `max_leg_miles` and arrival fuel ≥ `min_arrival_gallons`.

**`maxStops`** adds a third state dimension `(i, f, stops_used)`, multiplying the state space by `maxStops` — still trivial. Implement only when needed.

**Reconstruct** by storing the predecessor `(station, bucket, purchase)` at each relaxation.

**Two-pass driver.** The strategy is invoked once with `min_leg_miles = 300`. If it returns infeasible, the planner re-invokes with `min_leg_miles = 0` and records `MIN_LEG_RELAXED`, listing which legs fall below the floor. **The strategy itself stays pure** — the retry lives in the Planning Service, not inside `solve()`.

**Feasibility structure worth knowing.** The window in which each stop can land narrows as route length approaches an awkward multiple of the leg bounds. A 967-mile route admits either one stop confined to miles 467–500 (a 33-mile window) or two stops with far more freedom. The DP evaluates every stop count automatically and picks the cheapest feasible shape, so this needs no special handling — but it explains why some routes surface `LEG_GAP` while a slightly longer one plans fine.

### 15.4 Corridor query and detours

```sql
WITH route AS (SELECT line, distance_miles FROM routes WHERE id = $1),
corridor AS (
  SELECT s.id, s.name_raw, s.store_number, s.city_raw, s.state_usps,
         s.resolution, COALESCE(s.uncertainty_miles,0) AS uncertainty_miles,
         s.truck_accessible, s.geom,
         ST_LineLocatePoint(r.line::geometry, s.geom::geometry) AS frac,
         ST_Distance(s.geom, r.line) / 1609.344 AS perp_offset_miles,   -- geography metres -> miles
         r.distance_miles
  FROM stations s CROSS JOIN route r
  WHERE s.resolution <> 'unresolved'
    AND s.truck_accessible <> 'excluded'
    AND ST_DWithin(s.geom, r.line, $2::float8 * 1609.344)   -- radius in miles; scale the parameter, never the column
)
SELECT c.*,
       ST_Y(c.geom::geometry) AS lat,
       ST_X(c.geom::geometry) AS lng,
       c.frac * c.distance_miles AS offset_along_route_miles,
       sp.id AS price_id,
       CASE $3
         WHEN 'pump'       THEN sp.price_pump
         WHEN 'ifta_net'   THEN sp.price_ifta_net
         WHEN 'total_cost' THEN sp.total_cost
       END AS unit_price
FROM corridor c
LEFT JOIN LATERAL (
  SELECT sp.* FROM station_prices sp
  WHERE sp.station_id = c.id
    AND sp.product_type = 'highway_diesel'
    AND sp.valid_on = $4
  ORDER BY sp.id
  LIMIT 1
) sp ON true
ORDER BY offset_along_route_miles, c.id;
```

**Units.** Storage is miles and PostGIS geography is metres, so this statement is one of the three conversion edges (CLAUDE.md): the radius *parameter* is multiplied by 1609.344 and the returned perpendicular distance divided by it. The parameter is scaled, never `s.geom`, so `ST_DWithin` can still use `stations_geom_gix`. The offset along the route needs no conversion — `frac * distance_miles` is already miles.

The lateral's `ORDER BY` is there because `UNIQUE (station_id, raw_product, valid_on)` permits two raw products mapping to `highway_diesel` on one day, and an unordered `LIMIT 1` would pick between them arbitrarily. `truck_accessible <> 'excluded'` keeps a station marked unusable for trucks out of the candidate set; `unresolved` and `excluded` stations appear in **neither** `candidates` nor `exclusions` — `exclusions` names only stations that are plannable but unpriced, with a reason (`no_price_on_date`, or `price_basis_null` when the row exists but lacks the chosen `priceBasis` column, e.g. `total_cost`).

`$4` is an explicit date rather than an implied "current" flag. Prices are stored one row per station per day, so "today's price" is a date the caller chooses. It is recorded on the plan as `price_as_of`, which is what makes a plan reproducible after the fact.

**Three requirements that are easy to get wrong.** All three come from v3.4's milestone 5; the reasoning is sound and is restated here as a specification, not as a report of work done.

**a) No `product_codes` join in the hot path.** `station_prices.product_type` is denormalised onto the row at import time and indexed as `(valid_on, product_type, station_id)`. §11.1's hard rule keeps an unmapped code out of the table entirely, so joining to re-derive the type is redundant work on every corridor query.

**b) `LEFT JOIN LATERAL` for the price, not an inner join.** An inner join makes a station with no price on `valid_on` vanish — indistinguishable from one that was never near the route. Those stations must be **counted and named** in the result's `exclusions`, because "no price that day" and "not on this route" are different facts and only one of them is a data problem.

**c) Top-K must be stratified by position, not sorted by price.** Prices cluster regionally (§4.4: TX has 84 stations, CT has 1). The 40 cheapest on a Texas-to-Illinois run can all sit at one end, leaving a 500-mile stretch with no candidate. The optimiser then reports a range gap across ground that had usable stations on it, and the output looks like a legitimate infeasibility. **Cut the route into 50-mile buckets and draw round-robin, cheapest first within each bucket. Coverage first, price within it.** Two corollaries, both implemented in `stratifiedTopK.ts`: a round that K cannot finish goes to the buckets whose next candidate is cheapest, not the earliest; and when more than K buckets are occupied (a lane past 2,000 miles) K widens to the bucket count, because holding K would drop whole buckets and re-open the gap.

#### 15.4.1 The detour model

**"Route from the nearest point on the line to the station and double it" does not work.** A truck cannot turn around on a controlled-access highway, so a router asked for that trip correctly returns a long one — to the next interchange and back. The provider is right; the question is wrong. The truck is already driving past and will use the interchange that serves the station.

Measure the detour against the route the truck was taking anyway:

```
detour = d(before → station) + d(station → after) − d(before → after)
```

`before` and `after` are points on the route ten miles either side, via `ST_LineInterpolatePoint`. `d(before → after)` is the route's own arc length — already known, never requested from the provider.

**Measured 2026-09-21 (T-14 step 14.3).** Live ORS free tier, `driving-hgv`, the `volvo-vnl-860`'s restrictions, on the I-40 lane LOVES #200 (Amarillo, TX) → LOVES #429 (Nashville, TN): 930.84 mi, 38 priced stations within 25 miles on 2026-08-22's prices, from 0.01 to 21.5 mi off the route. The **true detour** is the direct route re-run through the station minus the direct route, taken for 20 of the 38 (0.01 to 18.7 mi off the route, #759 among them). Reproduced offline, figure for figure, from `backend/test/fixtures/ors/detour-*.json` by `detour.recorded.test.ts`.

| Against the true detour, 20 stations | naive (route there, double) | estimate (2 × perp × 1.35) | bracket |
|---|---|---|---|
| LOVES #759, Hazen AR, 0.25 mi off (true: 0.43 mi) | **38.31 mi** | 0.67 mi | **0.25 mi** |
| Mean absolute error | 15.51 mi | 2.41 mi | **0.70 mi** |
| Mean signed error (model − true) | +15.26 mi | +2.15 mi | −0.18 mi |
| Worst underestimate | 2.46 mi | 0.89 mi | 5.75 mi |
| Worst overestimate | 37.87 mi | 10.80 mi | 2.56 mi |

- **The naive model's failure reproduces.** #759 is 38.31 mi naive (v3.4: 38). The bracket figure does not: 0.25 mi against 0.43 mi driven, not v3.4's 1.98. v3.4's 9.8 → 2.4 mi mean error and 37.6 → 3.0 mi worst underestimate are superseded by the table; the lane and the sample differ, so they were never comparable.
- **The bracket is the closest by a wide margin, and errs in both directions.** Its worst miss, 5.75 mi low, is a station 12.6 mi off the route (26.03 mi against 31.78 mi driven): a station that far out is a different journey, not a detour from the route.
- **Four of 38 came out below 0** before flooring (−0.03 to −0.20 mi), where the router's path between the two snapped points beat the stored line. The floor is doing real work.
- **The 1.35 leans high, and this is the evidence §15.4.1 says the comparison exists to give.** Close in it is fine: within 0.45 mi of the truth for stations 0.15–0.3 mi off, and at worst 0.89 mi low for those under the 200 m floor. Past 3 mi it runs high — the true detour is 0.52 to 1.26 times `2 × perp` (median 1.06, seven stations), so the multiplier that fits them is nearer 1.1. **Not changed here:** it is one lane and seven far stations, and 1.35 is a Decided value. Re-measure on a second lane before touching it.

**Two stages:**

1. **Estimate, for filtering:** `d_i ≈ 2 × perp_offset_miles × 1.35` (ramps, frontage roads, no left turns for a 53-foot trailer). If `perp_offset_miles < 0.124` (200 m), treat `d_i = 0`.
2. **Real distances for survivors:** matrix calls for the top-K candidates (K ≈ 40).

**Cost: two matrix calls, not one.** The two legs point in opposite directions, and a single call covering both needs a 2N × 2N grid — 5,184 pairs at N=36, past what ORS accepts. Two separate N × N calls stay well inside the limit.

**Measured 2026-09-21 (T-14 step 14.3): the ceiling is 3,500 routes a request, not 2,500.** A 50 × 50 request (2,500 pairs, 100 locations) was accepted for `driving-hgv` on the free tier, and a 60 × 60 (3,600 pairs) was refused with error 6004, *"Only a total of 3500 routes are allowed"*; the largest square that fits is 59 × 59 (3,481), which was not tried. **K = 40 is safe and needs no chunking** — 1,600 pairs a call, and the 38-station lane above ran as two 38 × 38 calls. `MAX_MATRIX_SIDE` stays at 50, the size seen to work; only a lane long enough for K to widen past 50 chunks. A refused request still counts: ORS's remaining matrix quota went from 46 to 45 on the 60 × 60. The run spent 5 matrix and 21 directions calls, and both meters agreed at the end (ours 5 and 21; ORS 45 of 50 and 179 of 200 remaining).

**Decided 21 September 2026 (T-14): sizes and route ends.**
- **N is the number measured, K the target.** `stratifiedTopK` returns at most K candidates, or the bucket count when a lane passes 2,000 miles and K widens. Two N × N calls fit while N is within the provider's per-call ceiling; above it the pairs are chunked into diagonal blocks (only d(before_i → station_i) and d(station_i → after_i) are ever used), costing 2 × ⌈N / side⌉ calls. A 2N × 2N grid is never built. The ceiling is the measured one below.
- **`before` and `after` clamp to the route.** For a station at offset *s* on a route of length *L*: `before = max(0, s − 10)`, `after = min(L, s + 10)`. Near the origin `before` is the origin itself; near the destination `after` is the destination. The term subtracted is the clamped arc `(after − before)`, not a fixed 20 miles, computed with the same `frac × distance_miles` mapping as the offsets so the two stay consistent. The fractions are planar and the mapping to miles approximate, so "ten miles" can drift by about a mile; the arc drifts with it, and the difference cancels.
- **The measured detour can come out below 0** when the router's path between the two snapped points beats the stored polyline. The optimiser sees it floored at 0; the raw figure is kept beside it.

**Keep `estimatedDetourMiles` beside the measurement rather than overwriting it.** The comparison between the two is the only evidence that would ever show the 1.35 multiplier badly chosen — and, per v3.4, it is what caught the naive model's error in the first place.

### 15.5 The validation loop — mandatory

Everything above uses distances along the **baseline** polyline. The waypointed route will differ, because inserting a stop can change which highway the router picks.

```
1. DP on baseline distances                      → stop set S
2. route(origin, destination, via=S)             → real per-leg distances
3. Re-check the 500-mile cap and reserve floor against REAL distances
4. IF violated:
     recompute with real distances, re-run the DP
     IF the stop set changed → go to 2
     cap at 3 iterations → Infeasible(NO_STABLE_PLAN)
5. Recompute costs and cumulative values from the REAL route
6. Build the Google Maps URL, persist
```

Converges on the first or second pass almost always.

**Decided 21 September 2026 (T-13): how step 4 "recomputes with real distances".** A routed leg measures only the stops that were routed, so every other candidate is placed by scaling its *baseline* position within the segment between the two routed stops around it; the routed stops sit exactly at their measured distance and the destination at the measured total. It is always rescaled from the baseline with the latest route's stops, never compounded onto a previous rescale. This is a model, not a measurement, and is safe only because whatever the DP then picks is routed and checked again. If the DP re-chooses the stops that just failed there is nothing new to measure, so the loop stops with `NO_STABLE_PLAN` without another route call. A plan with no stops is the direct route, already measured, and needs no call.

**Decided 21 September 2026 (T-13): what step 5 rebuilds.** Each stop keeps the DP's *departure* fuel level; the purchase is what it takes to reach that level from the real arrival, and the cost follows. Holding the purchase fixed instead would let a leg that measured long silently break the reserve at the next stop. Arrival fuel is exact, not bucketed.

**Decided 21 September 2026 (T-13): the loop re-checks the cap and the reserve only.** The 300-mile floor is applied when the DP picks stops (§5.1) and is not re-checked against real legs: a real leg of 297 on an unrelaxed plan carries no disclaimer, because `MIN_LEG_RELAXED` fires only when the second pass ran. When it did, the short legs are named from the *real* legs, and if none is under the floor after all, the plan is not called relaxed. **Open:** whether floor drift on an unrelaxed plan should trigger a recompute — it would make the floor measured too, at the cost of more passes that end in `NO_STABLE_PLAN`.

**Without this, the 500-mile guarantee is a claim you have not verified.** This is why §19 places it before the API surface: everything upstream measures distance along the base route, so until waypoints are inserted and the legs re-measured, the guarantee is an assertion. An assertion like that should not be given an endpoint to be served from.

### 15.6 Test cases for the optimiser

At minimum, and all runnable with no database and no network:

- single candidate; zero candidates; candidate at mile 0. (Zero candidates is infeasible only when the trip needs a stop; within `max_leg_miles` it is a plan with no stops. A candidate at mile 0 is under the floor, so it is selectable only once the floor is relaxed.)
- monotonically rising prices; monotonically falling prices
- gap exactly 500 miles; gap 501 miles (must be rejected)
- gap exactly 300 miles; gap 299 miles (must be rejected)
- a station 200 miles out that is cheapest but violates the floor
- **final leg under 300 miles — must be ACCEPTED** (no floor on arrival, §5.1)
- destination exactly 500 miles from the last stop
- arrival reserve forcing a larger purchase
- **a cheap station early where carrying fuel forward beats a later expensive mandatory stop**
- a route feasible only after relaxation (assert `MIN_LEG_RELAXED`)
- `maxStops` binding

**That bolded case is the one that distinguishes the DP from a simple shortest path.** If it is missing, the test suite does not prove the algorithm is doing anything a greedy could not. Make sure it is in the suite.

---

## 16. Truck profiles

The Volvo VNL figures below are **sourced averages from published specs and real-world reports, not CH Logistics's actual fleet.** Adjust once real numbers are available — each is a single UPDATE. `truck_number` is likewise a **placeholder** pending the real fleet roster — dispatchers identify a truck by its fleet unit number (D6), not its model name, so seeding one from day one keeps the selector meaningful; correct it the same way, with a single UPDATE.

| slug | display_name | truck_number | tank_gal | mpg | reserve | max_leg | min_leg |
|---|---|---|---|---|---|---|---|
| `volvo-vnl-300` | Volvo VNL 300 — day cab, regional | 022 | 150 | 6.5 | 0.15 | 500 | 300 |
| `volvo-vnl-760` | Volvo VNL 760 — sleeper, standard haul | 056 | 200 | 7.5 | 0.15 | 500 | 300 |
| `volvo-vnl-860` | Volvo VNL 860 — dual tank, long haul | 091 | 250 | 7.2 | 0.15 | 500 | 300 |

**Where these come from:**

- **Tanks.** Volvo VNL tanks run 100–150 gallons each, with dual configurations totalling 200–300. For the VNL 860, capacity spans 125–275 gallons; dual tanks totalling 250 are the most common long-haul spec. Day cabs commonly run a 100 + 75 split.
- **MPG.** Modern Class 8 trucks reach roughly 7–10 MPG under good highway conditions. The VNL 860 with the D13TC turbo-compound engine is reported at 7.9–8.5 MPG in mixed OTR driving; the 760 at 7.8–8.4. The figures above sit slightly below those, because published numbers skew toward optimised specs, new equipment and favourable conditions — loaded weight, terrain, weather and idle time all pull real fleet averages down.

**MPG is the number worth correcting first.** It drives gallons purchased and therefore every dollar figure the app reports. **Tank capacity barely matters:** under a 500-mile cap, even the smallest profile carries 975 miles of range, so the tank is never the binding constraint. It only affects how much cheap fuel can be carried forward past an expensive mandatory stop (§5.4).

**This table is also why the v1 window is flat (§5.6).** `max_leg` and `min_leg` are identical across all three profiles and independent of the `tank_gal` and `mpg` beside them — the physical range of the weakest profile is nearly twice the cap, so deriving the window from those columns would return the same 500 on every row.

Suggested physical spec for `volvo-vnl-860`, passed to the routing provider: 36,287 kg gross, 411 cm height, 259 cm width, 2,250 cm length, 5 axles.

**Adding a fourth profile is an INSERT.** The schema in §12 carries `truck_number` so a profile can be tied to a real fleet unit when that matters.

---

## 17. Data retention and licensing

| Data | Origin | Retention | Rationale |
|---|---|---|---|
| Station city/state/name/prices | BVD sheet | **Permanent** | Your own data |
| Station coordinates (tier 1) | Love's store export | **Permanent** | Operator's own published site locations; no cap — §17.1 |
| Station coordinates (tier 2) | OpenStreetMap | **Permanent** | ODbL — attribution required |
| Station coordinates (tier 3) | Census Gazetteer | **Permanent** | US public domain |
| Route geometry (`routes.line`, `polyline`, `legs`) | ORS | **Permanent** | ODbL carries no storage cap — see below |
| Route geometry, distances, matrix | HERE / Google *(if adopted)* | **30 days, contractually** | Their developer terms. Not in use in v1 |
| Address geocodes (`saved_locations`) | whichever geocoder is used | **30 days** | Provider terms; the table carries its own expiry |
| Recorded provider responses (test fixtures) | ORS | **Permanent** | ODbL. Committed with attribution so the suite runs offline. HERE fixtures would never be committed. |
| Computed plans (`plans`, `plan_stops`) | Yours | **Permanent** | Your business record. Must not embed provider **geometry**; scalar distances are facts about a journey, not redistributable material. |

**`routes` is a cache. `plans` and `plan_stops` are the record. Nothing expires in v1.**

This distinction is still the one people get wrong, and it still matters — but in v1 it governs *what may be overwritten*, not *what gets deleted*. Nulling `plan_stops` on the theory that its distances are provider-derived destroys the audit trail — the thing you need when reconciling a plan against a driver's actual fuel receipts. Keeping `routes.line` indefinitely would be a licence breach **under HERE or Google**; under ORS's ODbL it is permitted outright, which is why v1 keeps it.

**Decided 10 September 2026: route geometry does not expire in v1.** ORS is the only routing provider and ODbL imposes no storage cap, so the 30-day cap the earlier design applied to every provider alike had no licence behind it. The remaining argument for expiring anyway was that a routing result older than 30 days is stale for planning — but stored geometry is only ever used to *draw* a historical plan, never to plan against, and the plan's authoritative figures are already scalars in `plans`/`plan_stops`. A cached line is in fact the more faithful record of what was planned than a re-fetch would be, since a re-fetch reflects today's road network. An old plan is read as historical reference, not as current truth. This removes `routes.expires_at`, the `set_route_expiry()` trigger, the retention job and the `geometryExpired` response field from v1; adopting HERE or Google reintroduces all four, and the notes below are kept for that day.

**The line between them: geometry is the shape, and it is a cache entry — refreshable, and expirable the day a capped provider arrives. A scalar is a measurement, and it stays regardless.** `plan_stops.leg_distance_miles` records that a truck was planned to travel 214.3 miles between two stops. That is a fact about your operation, in the same way `unit_price_usd` is — which is precisely why `plan_stops` stores the price as a literal number alongside the `station_price_id` foreign key rather than relying on a join.

**Implementation in v1:**

- `routes` carries **no `expires_at` column and no expiry trigger.** Nothing deletes or nulls route geometry.
- `line`, `polyline` and `legs` stay **nullable** even so. A provider may legitimately return no geometry, and adopting a capped provider later then needs a job rather than a schema change.
- A route is refreshed through its `UNIQUE (provider, request_hash)` upsert, which updates `computed_at` rather than inserting a duplicate.
- **A refreshed line still writes to `routes` only — never to `plans` or `plan_stops`.** This rule survives the removal of expiry and is the one to keep: the fresh line reflects *today's* road network, so the stored totals remain authoritative. Silently overwriting `plans.total_distance_miles` with a new figure would corrupt the historical record.
- **Re-optimising an old route against that day's prices is a different operation producing a new plan**, not a restoration. `station_prices.valid_on` is permanent and dated, so this is always possible; it is the backtesting work in §20.
- Attribution for the routing provider and for OSM ships **in the API response** so the frontend cannot omit it. Under ORS that is "© openrouteservice.org (HeiGIT)" plus "© OpenStreetMap contributors (ODbL)", and ODbL makes it a licence condition rather than a courtesy. **Removing expiry does not soften this** — indefinite retention of ODbL data is permitted *because* it is attributed.

**Reinstated the day a contractually capped provider is adopted** (HERE, Google) — the design below was worked out and is kept rather than rediscovered:

- `routes.expires_at`, set by a `BEFORE INSERT OR UPDATE OF computed_at` trigger so the cap cannot be forgotten by application code, and declared that way so a refresh extends the window. Make it provider-aware: capped providers get `computed_at + interval '30 days'`, ORS gets `NULL`.
- A daily job nulls `line`, `polyline`, `legs` and any raw provider payload on expired rows. **The row itself stays** — `origin_geom`, `destination_geom`, `truck_profile_id`, `distance_miles` and `duration_s` survive, so geometry can be re-fetched without asking the dispatcher to re-enter anything.
- Plans whose geometry has been nulled still render their table but return `"geometryExpired": true` instead of a broken polyline. Nothing is recomputed and no provider call is made just to display one.

**This is why permanent station coordinates never come from provider geocoding.** Otherwise you would re-geocode 605 stations every 30 days forever, or be out of compliance.

### 17.1 The operator-data exception

Love's publishes its own store list — store number, address, latitude and longitude — through its site locator. CH Logistics is a contracted customer of that fuel network, and **§11.4 verified the export matches 604 of the 605 BVD stations by store number, with the state field agreeing on all 604 independently.**

This is admitted as tier 1 because the reason provider coordinates are barred does not apply to it:

| | HERE / Google | Love's export |
|---|---|---|
| What it is | A licensed geocoding product | An operator saying where its own sites are |
| Retention | Capped at 30 days by contract | No cap |
| Purpose of publication | Sold as a data service | So customers can drive there |

**The distinction is the source's relationship to the site, not the file format.** A third party's geocoding of a Love's address is still provider data and still capped; Love's own coordinate for its own store is not.

It also carries operational facts no geocoder has — `StoreType`, `ParkingSpaces`, `DEFLanes` — which is what settles §11.5 from the operator directly rather than by inference from OSM tagging.

**One thing the export must not be used for: prices.** The file contains a Love's retail price column and a notice that quotes may be delayed and all sales use the price posted at the time of fuelling. Those are street prices, not contract prices, and they are not what this app plans against. `stations.operator_attrs` stores location and amenity fields only. **Never prices.**

**The closed `operator_attrs` set.** A row's `operator_attrs` carries exactly one of two fixed key sets, asserted in `operatorExport.test.ts` rather than eyeballed:

| Source | Keys |
|---|---|
| Love's export (`resolution_source = 'operator_export'`) | `StoreType`, `ParkingSpaces`, `DEFLanes`, `Address`, `Zip`, `HighwayOrExit` |
| BVD travel-centre directory (`resolution_source = 'bvd_directory'`, T-60, D29) | `Status`, `StoreId`, `Address`, `PostalCode`, `Highway`, `Exit`, `DEFAtPump`, `TruckParking`, `CatScale` |

BVD's directory (`data/US-CA-GasStations/bvd-travel-centres-*.csv`) is admitted on the same ground as the Love's export: an operator saying where its own sites are. It carries no prices. Its fuel columns (`Diesel`, `Gasoline 87`, …) are availability flags, and they are not stored either. Unlike the Love's export it *creates* `stations` rows (`country = 'CA'`), and those rows are actuals-only: the planner never sees them.

**OSM and the Census remain in place as tiers 2 and 3.** The export is a snapshot the operator can change or withdraw, it covers only this one supplier, and a second supplier in a later phase may publish nothing at all. The fallback chain is what keeps that from being a rebuild.

---

## 18. Known risks and gaps

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Range gaps under the 500-mile cap** | **High** | 8 states absent, 8 more with ≤4 stations (§4.4). Actionable infeasible response returning candidates (§14). |
| 1b | **Hard 300-mile floor narrows placement windows** | **High** | Some routes admit only a ~33-mile window for a stop. §5.1's automatic relaxation prevents dead ends. |
| 2 | **Google Maps link is not truck-legal** | **Medium-High** | Explicit disclaimer in the payload. No worse than today, but a real gap between what is computed and what is driven. |
| 3 | **The current migration does not run** | **Medium** | §12.1 item 1. Blocks step 1 entirely; a one-character fix plus a schema rewrite. |
| 4 | Price staleness | Medium | §4.3 measured a 41¢/gal median daily swing. `priceAsOf` in every response; daily ingest. |
| 5 | MPG variance ±10% | Medium | 15% reserve absorbs it; conservative bucket rounding (§15.3). |
| 6 | A new brand appears in the sheet | Medium | Graceful degradation to `unresolved` + manual queue (§11.3). |
| 7 | Volvo figures are sourced averages, not the real fleet | Low-Medium | Tank never binds under a 500-mile cap; MPG affects reported cost only. **Correct MPG first.** |
| 8 | Accidental provider overspend | **Low in v1** | ORS needs no card, so the worst case is a refused call, not a bill. Budget guard throws regardless. Reverts to Medium if HERE is adopted. |
| 9 | ORS truck data patchier than HERE's | Low in v1 | Only affects distance estimates and corridor membership, not the roads driven (§8.2). |
| 10 | One station unresolvable by operator export | Low | Store #306 is temporarily closed and stays `unresolved`, so it is never planned against (§11.4 step 4). |
| 11 | BVD changes the sheet format | Low | Validation gate fails the import rather than corrupting data. All 31 January files share one header shape, so the format is stable in practice. |
| 12 | Hours-of-service ignored | Low | `stop_type` enum reserves space. |
| 13 | Single-supplier dependency | Low | `supplier` columns throughout — but see §12.1 item 7, which currently breaks this. |

---

## 19. Build order

Numbered in the order they should be built. Nothing below is done.

| # | Step | Done when |
|---|---|---|
| 1 | **Fix and rewrite the schema.** §12.1 — fix the syntax error, drop `effective_date UNIQUE`, add the missing tables, settle §21's naming questions. Load the Census Gazetteer. Seed 3 truck profiles + the `ULSD` product code. | `npm run db:reset` applies cleanly; a correct empty database |
| 2 | **CSV ingest, single file, no geocoding — as a function plus `npm run ingest`.** §11.1 | 605 stations + 605 prices from the August sheet, with a clean validation report printed to stdout |
| 3 | **CLI bulk backfill** (`npm run backfill`) and the **January 2026 backfill**. §11.2 | 30 days of real price history; the report names the 2026-01-11 gap and skips the byte-identical duplicate |
| 4 | **Station resolution from the operator export.** §11.4 step 1 | 604/605 `exact`; store #306 temporarily closed, left `unresolved` |
| 5 | **Gazetteer fallback + manual review.** §11.4 steps 3–4 | Tiers built and tested; 604/605 placed by step 1, #306 (temporarily closed) left `unresolved` |
| 6 | **Routing adapter** — ORS behind §8.4's interface — **with the budget guard and both meters**. §8.3 | A truck route that differs from a car route at a known low bridge; real rate-limit figures recorded in §8.3 |
| 7 | **Corridor query.** §15.4 — including stratified top-K and the `LEFT JOIN LATERAL` | Candidates for a route, eyeballed on a dev map |
| 8 | **Optimiser strategy interface + `dp_v1`, tests first.** §13.1, §15.3 | Every §15.6 case passes. No database, no network. |
| 9 | **Validation loop + two-pass relaxation.** §15.5, §5.1 | The 500-mile guarantee verified against measured distances, not predicted ones |
| 10 | **Detour costing.** §15.4.1 — bracket model, two matrix calls | `detourEstimateError()` reports the estimate-vs-measurement gap |
| 11 | **Address geocoding + `saved_locations`** with the 30-day expiry. §11.6 | `{address}` or `{lat,lng}` both accepted on `POST /plans` |
| 12 | **Wire up `POST /plans` → `GET /plans/{id}`.** §14 | End-to-end plan, verified on a real lane |
| 13 | **Google Maps URL builder + disclaimers.** §9.4 | Driver-shareable output; disclaimer wording pinned by a test |
| 14 | **Auth** (Auth.js, one seeded account), enforced at the framework boundary. §13 | Anonymous requests get 307 for pages, 401 for API paths. Nothing exempt, including `/health`. |
| 15 | **Frontend: MapLibre map + table.** §9 | Replaces the `trips.js` mock; both call meters visible |
| 16 | **Deployment — Vercel + Neon.** §10 | v1 live |
| 17 | **Stop penalty tuning.** §5.2 | Deferred deliberately — needs real lanes where a detour is actually taken. Do not tune against zero evidence. |

**Two ordering notes, both deliberate:**

**Steps 8 and 9 come before step 12.** The validation loop precedes the API surface because everything upstream measures distance along the *base* route. Until waypoints are inserted and the legs re-measured, a plan's 500-mile guarantee is a claim rather than a verified fact — and a claim like that should not be given an endpoint to serve it from.

**Step 14 (auth) comes late, and sits in front of the API rather than inside it.** Keeping `src/api/` framework-free is what lets the whole API mount in a single Next route file and be tested without a server. Auth is a boundary concern; adding it early would mean every intermediate test carries a session.

**Step 17 is intentionally last and may never be needed.** v3.4 reported that on a verified Dallas → Chicago lane every chosen stop had a measured detour of 0.0 miles, so the penalty term did no work at all — the 300-mile floor was the only structural control, exactly as §5.2 predicts. Tune only when a real lane actually takes a detour.

---

## 20. Future phases

### Phase 2 — Automation and reach

- **Gmail poller → automatic daily ingest.** Vercel Cron; `price_imports` is the seam, and the ingest service does not change. **Promoted in priority by the CLI-only decision (§11.2)** — with no upload UI, this is what makes daily operation hands-off, and it is the smaller of the two builds.
- **Dispatcher-facing upload — the `/imports` routes (§14) plus a drag-a-folder UI.** Deferred from v1. Worth building for corrected re-sends and one-off gap fills even after the poller lands, since those are exactly the cases the poller does not cover.
- **Canada support.** A second BVD CSV exists in the same format. Work required: `country` column already present; Statistics Canada gazetteer for place centroids; OSM coverage for Canadian truck stops; cross-border routing; litres/kilometres via the existing units toggle; CAD/USD handling.
- Multi-stop deliveries (A→B→C)
- Round trips (A→B→A) with joint cross-leg optimisation
- User-defined truck profiles

### Phase 3 — Measurement

- **Receipt vs. plan backtesting.** Two input channels exist and they are not equally good:
  - **Driver invoices** record spend and location per driver account. Structured or semi-structured data, and the **preferred path** — parsing an invoice export is ordinary data work.
  - **Receipt photos, PDFs and paper** need OCR to extract station, date, gallons and price. A project in its own right.

  Start with invoices. Photos are the fallback for gaps, not the primary source.

  **Reconcile against `plans.dispatched_at IS NOT NULL` only** (§12.2) — an invoice will not match a plan the dispatcher computed and discarded in favour of another truck profile, and matching against every completed plan would manufacture false mismatches.
- Metrics and graphs: spend over time, savings realised, price trends by state and corridor, station usage.
- Plan accuracy: predicted vs actual gallons and cost. This is what finally corrects §16's MPG figures with real numbers.

### Phase 4 — Intelligence

- **Fuel price forecasting.** Needs the historical backfill; ten years is available in Gmail. §4.3's measured 41¢/gal daily swing is the signal to forecast against.
- "Wait a day" recommendations when prices trend down.
- Hours-of-service-aware stop placement.
- **Range-derived leg window (§5.6).** Replace the flat 500/300 with a cap computed from tank, MPG and a reserve buffer. Depends on Phase 3 producing a trustworthy MPG, and on a truck existing whose range actually falls below the policy cap.
- More complex optimiser strategies dropped into the registry — no orchestration changes needed (§13.1).
- Possible move to self-hosted routing, which eliminates retention caps but needs a persistent box.

---

## 21. Open questions

These need answers before the steps that depend on them.

| # | Question | Affects | Recommendation |
|---|---|---|---|
| **Q1** | ~~Drizzle or Kysely?~~ | §7, all data access | **Closed — see `TICKETS.md` D1.** Decided: no ORM/query builder, raw parameterised SQL over `pg`. |
| **Q2** | ~~`reserve_fraction`: 0.15 (spec) or 0.10 (current migration)?~~ | §5.5, §12.1 item 6, step 1 | **Closed — see `TICKETS.md` D2.** Decided: 0.15. |
| **Q3** | ~~`uuid` or `bigserial` primary keys?~~ | §12, step 1 | **Closed — see `TICKETS.md` D3.** Decided: mixed by rule — `bigserial` for high-volume rows, `uuid` for anything exposed in a URL. |
| **Q4** | **What is the real MPG of the fleet?** | §16, every dollar figure | Cannot be answered from here. Until it is, the app's costs are directionally right and absolutely wrong. Flag it in the UI. |
| **Q5** | ~~Exact wording of the Google Maps disclaimer.~~ | §9.4, step 13 | **Closed 22 September 2026 — see `TICKETS.md`'s Q5 row.** Wording pinned by `backend/src/planning/disclaimers.test.ts` (T-17). |
| **Q6** | **Does this count as business use for Vercel?** | §10, $20/mo | Almost certainly yes. Budget for Pro. |
| **Q7** | **Ten-year backfill: all of it, or a recent window?** | §11.2, storage | Start with January 2026 (on disk). Extend once the pipeline is proven. 2.2M rows is not a storage problem; it is a "do not do it before it works" problem. |
| **Q8** | **Is `min_leg_miles = 300` right, or was 350 better?** | §5.1 | 300 is the current decision. It was 350 through v3.3. The value is a profile column, not a constant — so this is tunable per truck rather than a one-way door. |
| **Q9** | **Where does the 500-mile cap come from — driver hours and stop cadence, or an assumption about range?** | §5.6 | Ask dispatch. If it is a policy rule it stays a constant and §5.6 is never worth building; if it is a range proxy, §5.6 replaces it once Q4 has a real MPG. |

---

## 22. Rejected approaches

Recorded so they do not get re-litigated. Each was seriously considered.

### 22.1 "HERE's EV routing can be repurposed for diesel with a custom price table" — false

`ev[makeReachable]=true` inserts stops from **HERE's own charging POI database**. No parameter accepts your own candidate list, and the engine has **no price term** — it optimises travel time plus charging time.

**Consequence:** routing and stop selection are fully separate systems. This is the origin of §13's architecture.

### 22.2 "Isolines are needed for range reachability" — not needed

With stations snapped to a route polyline, reachability is one-dimensional subtraction (§15.3). ORS also caps isochrones at 120 km, far below any useful truck range.

### 22.3 "Greedy refuelling is the right algorithm" — superseded

Lin, Gertsch & Russell's optimality proof assumes free pass-by and no per-stop cost. Detours and the stop penalty violate both. More decisively, the problem is small enough that an exact DP costs milliseconds. Retained as `greedy_v1`, a comparison baseline only.

A related earlier error: the classic greedy rule is **nearest cheaper**, not **cheapest within range**. Moot now, but it is the kind of mistake that looks right in a code review.

### 22.4 "`PROD` needs careful disambiguation" — de-risked, guard retained

One value today (`ULSD`, 605/605, and unchanged across all 31 January files). The `product_codes` mapping table stays as a **tripwire** for the day BVD adds dyed diesel or DEF — an unmapped code fails the row rather than being guessed at.

### 22.5 "Purchases are fully determined by the next leg" — false under a relaxable floor

Briefly concluded when the minimum leg was assumed strictly hard. Because the floor relaxes and the cap forces stops regardless of need, surplus fuel can be carried and used — so the fuel-level dimension is required. See §5.4.

### 22.6 "`validity tstzrange` with an EXCLUDE constraint" — replaced by a plain date

Earlier drafts modelled "valid until superseded". A sheet arrives every single day, so validity is always exactly one day. `valid_on date` with a unique constraint expresses the same guarantee more simply, keeps bulk backfill order-independent, and leaves a skipped day visible as a gap. §4.3's missing 2026-01-11 is the case that vindicates this.

### 22.7 "Vercel cannot handle this workload" — retracted

With Fluid Compute, Hobby gets 300s and Pro up to 800s. Plan computation is 3–10s of mostly I/O wait, which Active CPU billing does not charge for.

### 22.8 "Geocoding needs a general-purpose pipeline" — massively simplified

All 605 stations are Love's with distinct store numbers, and the operator's own export resolves 604 of them (§11.4, verified). This is a one-time script, not a subsystem. The fallback chain in §11.4 exists for new brands, not for this one.

### 22.9 Python for the ingest pipeline — rejected

See §7.1 for the full reasoning. Short version: the ingest shares validation rules and types with the API, and must run in-process on a Vercel deployment once the upload route and the Gmail poller land. **v1's CLI-only ingest (§11.2) weakens this — a standalone CLI is the one shape Python would handle comfortably — but it does not overturn it, because the CLI is not the ingest's last caller.** Python remains permitted and encouraged for one-time analysis whose output is data rather than code.

---

## 23. Sources

**Provider capability and terms**

- HERE EV routing: <https://www.here.com/docs/bundle/routing-api-developer-guide-v8/page/concepts/ev-routing.html>
- HERE developer terms (30-day cap): <https://developers.here.com/terms-and-conditions>
- HERE plan restrictions: <https://www.here.com/get-started/pricing/limited-plan-restrictions>
- HERE Vector Tile API with MapLibre: <https://docs.here.com/map-rendering/docs/maplibre>
- Google Large Vehicle Routing GA, 17 Aug 2026: <https://mapsplatform.google.com/resources/blog/introducing-large-vehicle-routing-address-the-unique-logistics-needs-of-large-vehicle-fleets/>
- Google Geocoding caching policy: <https://developers.google.com/maps/documentation/geocoding/policies>
- OpenRouteService restrictions: <https://openrouteservice.org/restrictions/>
- GraphHopper deployment resources: <https://github.com/graphhopper/graphhopper/blob/master/docs/core/deploy.md>

**Infrastructure**

- Vercel function limits: <https://vercel.com/docs/functions/limitations>
- Vercel Fluid Compute limits: <https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute>

**Data sources**

- US Census Gazetteer: <https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html>
- OSM `amenity=fuel` tagging: <https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dfuel>

**Algorithms**

- Lin, Gertsch & Russell (2007), *A linear-time algorithm for finding optimal vehicle refueling policies*, Oper. Res. Lett. 35(3):290–296
- Khuller, Malekian & Mestre (2011), *To Fill or Not to Fill: The Gas Station Problem*, ACM Trans. Algorithms 7(3):36 — <https://www.cs.umd.edu/~samir/grant/gas-j.pdf>

**Truck specifications**

- Volvo VNL 860 tank configurations, Volvo VNL Gen II tank sizes, VNL 860 and 760 real-world MPG reports, Volvo VNL official specifications: <https://www.volvotrucks.ca/en-ca/trucks/vnl/specifications>

**Project data — in this repository**

- `data/bvd-prices/pcn-usd-9206810-981.csv` — BVD price sheet, received 21 Aug 2026, effective 2026-08-22, 605 rows. Analysed 4 September 2026.
- `data/bvd-prices/2026-01/` — 31 files, 30 distinct dates (2026-01-01 to 2026-01-31, missing 01-11), 594 rows each. Analysed 4 September 2026.
- `data/US-CA-GasStations/LovesSearchResults.xlsx` — Love's operator export, 732 stores, header on row 3. Joined to BVD at 604/605. Analysed 4 September 2026.
