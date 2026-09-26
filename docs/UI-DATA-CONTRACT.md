# UI Data Contract — what the frontend needs from the backend

Derived from the **Route Fuel Wireframes** design canvas, as implemented in
`frontend/src/`. Every value in the UI today is a hard-coded placeholder in
`frontend/src/data/trips.ts`. This document lists what has to replace each one.

Read it alongside **§14 API design** of `PROJECT-SCOPE.md`. Where the existing
`GET /plans/{id}` contract already covers a field, this document names the field
and moves on. Section 6 is the part that matters most: **what the UI needs that
§14 does not yet return.**

**v2 note (redesign, D15/A7).** This document predates the sidebar redesign —
it was written against the v1 tab-bar shell (`Header.tsx` + Plan / Recent / Dev
Tools tabs). `PROJECT-SCOPE-v2.md` A7–A9 and `CH Fuel App.dc.html` are the
current shell authority; **§2 below is superseded and marked as such.**
Everything else here — the Plan tab's map/form/stat-grid contract (§3), the
Recent table (§4), and Dev Tools (§5) — still describes real, still-needed data
shapes; only their *container* changes, from the old tab bar to T-39's sidebar
+ `TopBar`. Component paths below are `.tsx` — T-04 migrated the tree off
`.jsx` some time ago; this document's file references were simply never
updated to match until now.

---

## 1. Conventions

**Return numbers, not display strings.** The placeholder data is full of
pre-formatted strings (`"$286.62"`, `"7h 40m"`, `"+4.7 mi of detour · direct
481.8 mi"`) purely so the wireframe renders without a formatter. The API should
return `286.62`, `27600` (seconds), `4.7` and `481.8`, and the frontend will
compose the labels. Nothing in this document should be read as a request for
server-side formatting.

**Units.** Imperial by default, per §14's `?units=`. Every distance below is
miles, every volume gallons, every price USD per gallon, every duration seconds.

**Nulls are meaningful.** Several constraint inputs are explicitly "blank means
no cap" (max detour per stop, max stops). `null` must survive the round trip and
must not be coerced to `0`.

**One array feeds both views.** §14 already establishes that `stops[]` drives the
map markers and the table. The design holds to this — the numbered map pins, the
hover card and the "Recommended order" list are three renderings of the same
array, and must never diverge.

---

## 2. Screen: header and sub-bar — SUPERSEDED

**This whole section describes the v1 tab bar, which D15 replaced with A7's
sidebar before it was ever built.** `Header.tsx` and its "Tabs (Plan / Recent /
Dev Tools)" row do not get built as specified below — T-39 builds `Sidebar.tsx`
+ `TopBar.tsx` + `InvoicePeriodSelector.tsx` instead, per A7. It is kept here,
struck through, only so the still-real *data* needs it named don't get lost:

| UI element | Placeholder | Needed from backend | Where it lives now |
|---|---|---|---|
| ~~Brand mark~~ | static asset | — | `Sidebar.tsx` (T-39) |
| ~~Tabs (Plan / Recent / Dev Tools)~~ | client state | — | Sidebar nav, A7's eleven destinations (T-39) |
| User name + role ("M. Hodson", "Dispatch") | hard-coded | Session identity: `displayName`, `role` | `Sidebar.tsx`'s footer (T-39) — same data need, new location |
| ~~Sign out~~ | inert | — | `Sidebar.tsx`'s footer (T-39) |
| **Truck selector** | `trucks[]` string array | See below — **this one is not a styling change, read it** | New Plan's own truck field (T-21), unrelated to the shell |
| Fuel type tag ("Diesel") | hard-coded | `station_prices.product_type` for the active plan; comes from the plan request | `TopBar.tsx`'s plan context tags (T-39) |
| Trip tag ("T-1042") | `trip.id` | `planId`, plus a human reference number if `planId` is a UUID (see §7) | `TopBar.tsx`'s plan context tags (T-39) |

**The truck selector is a separate, still-open problem — not just a relocation.**
This document originally specified `GET /trucks` → `[{ id, unitLabel, profileId,
... }]`: a picker over real, individually-identified fleet units, each with its
own profile. What actually got built in v1 (T-16) diverged from that —
`POST /plans` only ever took `truckProfileId`, choosing an abstract mpg/tank
*class* (one of three), because the real fleet roster didn't exist as a table
yet. **T-38 (v2) added `plans.truck_id uuid REFERENCES trucks(id)`** specifically
to close this gap, once the real 27-unit roster (`trucks`, from T-25) existed to
point at (D22). So this document's original instinct — a picker over real units,
not profiles — was correct all along; T-16 just couldn't build it yet.

**T-21, when picked up, must wire the New Plan truck field against `trucks`
(the real roster) and `plans.truck_id`, not `truck_profiles`.** `truck_profiles`
remains what the *optimiser* solves against (`truckProfileId`, tank/mpg/cost
class) — a plan needs both fields, and they are not interchangeable: A16's T-03
note is explicit that `truck_profiles.truck_number` (022/056/091) are
placeholders, never the roster. `GET /trucks` already exists (T-37) but is
period-scoped and 400s with no `period` — Plan screens carry no period (A7), so
it cannot serve this picker as built. **D23** (`PROJECT-SCOPE-v2.md` A15) makes
`period` optional on that endpoint instead of adding a second one: omitted, it
returns the plain roster (`id`, `unitNumber`) this picker needs; supplied, T-37's
existing spend-scoped shape is unchanged. Confirmed necessary, not speculative:
`CH Fuel App.dc.html`'s New Plan screen already has a `Truck` select bound to
`planTruck`/`setPlanTruck`, and its Plans list already has a `Truck` column —
both need this data today, not eventually.

**Truck unit numbering — resolved.** The design shows fleet units as `072`,
`1012` (not `Truck 14-B` — that was this document's own placeholder guess,
before the real roster (A19) was known). D18 settled this: `unit_number` is
`text`, stored exactly as the fleet writes it, never zero-padded.
`formatUnitNumber()` (`backend/src/domain/units.ts`) already implements the
current contract.

---

## 3. Screen: Plan tab

`frontend/src/components/PlanTab.tsx`, `frontend/src/components/RouteMap.tsx`

### 3.1 Map

The wireframe draws a fake diagonal with pins positioned by index
(`pinPos()` in `RouteMap.tsx`). The real map (MapLibre, §9) needs:

| Layer | Needed from backend |
|---|---|
| Planned route line | `optimized.polyline` (precision-5), `optimized.bounds` |
| Origin / destination markers | resolved `origin` / `destination` coordinates — **not currently echoed** in the §14 response, only the address that was submitted |
| Numbered fuel-stop pins | `stops[].seq`, `stops[].station.location.{lat,lng}` |
| Candidate dots ("candidate, not chosen") | `candidateStations[].location.{lat,lng}` |
| Baseline route, if it is ever drawn | `baseline.polyline` — present in §14, unused by this design |

Geometry expiry **no longer applies in v1.** §17 was revised on 10 September 2026
to drop route-geometry expiry — ORS is ODbL and carries no storage cap — so
`geometryExpired` is never returned and a plan of any age draws its map. The
missing empty state is therefore no longer a gap. It becomes one again if a
contractually capped provider (HERE, Google) is adopted.

### 3.2 Fuel-stop hover card

Six rows, all per-stop. All already in §14's `stops[]`:

| Row | Field |
|---|---|
| title | `seq` + `station.name` |
| place | `station.city`, `station.state` |
| Price | `unitPriceUsd` |
| Buy | `purchaseGallons` |
| Arrive with | `arrivalGallons` |
| Detour | `detourMiles` |
| Cumulative | `cumulativeDistanceMiles` |
| Stop cost | `stopCostUsd` |

### 3.3 Candidate hover card

| Row | Field |
|---|---|
| title / place | `candidateStations[].name`, `.city`, `.state` |
| Price | `candidateStations[].unitPriceUsd` |
| Along route | `candidateStations[].distanceAlongRouteMiles` |

§14 declares `candidateStations` as a comment stub. **Its shape has to be
specified** — at minimum: `id`, `name`, `city`, `state`, `location`,
`unitPriceUsd`, `distanceAlongRouteMiles`, `detourMiles`. The design uses it for
three things: the candidate dot layer, the in-corridor-not-selected layer and
its count (§3.8), and the cheapest-along-route chart (§3.7). Each candidate must
carry a stable `id` so the frontend can diff it against `stops[]`.

### 3.4 Lane form

`Source` / `Destination` are read-only echoes of the plan request today. When
"Plan route" becomes live it is a `POST /plans` with the header's selected truck
and the Dev Tools constraint block. The response's resolved addresses should be
echoed back so the fields show what was actually geocoded, not what was typed.

### 3.5 Summary stat grid — six cells

| Cell | Value | Sub-caption | Field |
|---|---|---|---|
| Fuel cost | `$286.62` | `68 gal` | `optimized.totalFuelCostUsd`, `optimized.totalGallons` |
| Saved | `−$41.00` | "vs the corridor baseline" | `optimized.savingsVsBaselineUsd` |
| Distance | `486.5 mi` | `+4.7 mi of detour · direct 481.8 mi` | `optimized.distanceMiles`, `optimized.addedDistanceMiles`, `baseline.distanceMiles` |
| Driving time | `7h 40m` | "excludes time at the pump" | `optimized.durationSeconds` |
| Stops | `5` | "within the leg bounds" | `stops.length`; the caption should become conditional — see below |
| Detour cost | `$3.39` | "driver pay only, $0.60/mi" | **New — see §6** |

Two captions are asserted by the wireframe but are really computed claims:

- **"within the leg bounds"** is false whenever §5.1's relaxation pass ran. §14
  already emits a `MIN_LEG_RELAXED` disclaimer for exactly this; the caption
  should read from it and name the short legs.
- **"excludes time at the pump"** implies `optimized.durationSeconds` is drive
  time only. If `fixedStopMinutes` is folded into it, the caption is wrong. The
  backend should return drive time and dwell time separately.

### 3.6 Price-sheet selector

The design puts a **sheet date picker** at the top of the right column, and
turns the whole column amber when a sheet other than the newest is selected:

- Today: `Daily price CSV loaded 05:58 CT · 412 stations`
- Archived: `Archived sheet — not today's prices. Historical reference only.`

This is entirely new. It needs:

- `GET /price-sheets` → `[{ effectiveOn, importedAt, rowCount, stationCount }]`,
  newest first. The frontend decides "is newest" by comparing to index 0.
- `POST /plans` accepting `priceEffectiveOn` so a dispatcher can re-price a lane
  against a historical sheet.
- `GET /plans/{id}` already returns `priceAsOf` — that selects the picker's
  value when an existing plan is opened.

`price_imports` in `migrations/0001_planning_schema.sql` already carries `effective_date`,
`imported_at` and `row_count`. Only `stationCount` (distinct stations priced on
that sheet) is missing, and it is derivable from `station_prices`.

### 3.7 Cheapest along route — bar chart

Five rows: station name, a bar, a `$/gal` figure. The bar width is a
presentation concern — the frontend will scale it from the price range and the
backend should not send a percentage.

Source: the cheapest N of `candidateStations[]` **plus** selected stops, ranked
by `unitPriceUsd`. Two things need deciding:

- Does "along route" mean the corridor set (candidates + chosen), or only the
  unchosen candidates? The design's placeholder list overlaps with the chosen
  stops, which suggests the former.
- Is N fixed at 5, or a parameter?

### 3.8 Map layer toggles — two buttons

The map panel carries a pair of toggle buttons side by side, each with a count
in its label. They reveal two different, non-overlapping layers:

| Button | Layer | Count | Needed from backend |
|---|---|---|---|
| `Show all sheet stations on map (412)` | every priced station on the selected sheet | sheet station count | `stationCount` from `GET /price-sheets` for the selected sheet, and the points themselves from a bbox-paged `GET /stations` (§14) scoped to the sheet |
| `Show in-corridor not selected (37)` | corridor candidates the solver considered but did **not** choose | candidates minus chosen | `candidateStations[]` filtered to those whose `id` is not in `stops[].station.id` |

The distinction matters because the two counts come from different places and
must not be conflated: the first is the whole sheet (thousands, paged, mostly
nowhere near the lane), the second is the solver's own consideration set with
the chosen stops removed. Previously one button carried a `sheetStationCount`
constant doing both jobs.

Rendering: sheet stations are plotted as small green dots, in-corridor-not-
selected as amber-ringed hollow dots, chosen stops as the numbered accent pins.
Both candidate layers share the §3.3 hover card; the in-corridor layer's card
adds the qualifier "in corridor, not selected", so `candidateStations[]` should
carry enough to say *why* a station was passed over — at minimum
`detourMiles` and `unitPriceUsd`, ideally a short `rejectionReason`
(`price`, `detour`, `leg length`, `max stops`) if the DP can cheaply emit one.
That reason is **new** and optional; without it the label stays generic.

### 3.9 Recommended order

One row per stop: rank, `station · milepost`, `detour · action`, price. Fields:
`seq`, `station.name`, `cumulativeDistanceMiles`, `detourMiles`,
`unitPriceUsd`, and an **action label**.

The action label (`60 gal fill`, `top-off`, `40 gal`, `reserve`) is a derived
description of `purchaseGallons` relative to tank capacity. Deriving it in the
frontend is fine, but the rules need pinning down — what counts as a "top-off"
versus a named gallon amount, and what "reserve" means as distinct from a small
fill.

### 3.10 Driver route link

`googleMapsUrl` from §14. The design shows it read-only in an input, with
**Open** and **Copy**. The `GOOGLE_LINK_NOT_TRUCK_LEGAL` disclaimer that §14
always emits has **no home in this design** — the card's footnote is generic
marketing copy, not the warning. Somewhere in this card needs to carry it.

**"Sent to driver" checkbox.** The card's footer row now ends in a checkbox
marking whether this plan has been handed to the driver. It is dispatcher
bookkeeping, not a solve output, and it must persist — a dispatcher who ticks
it, leaves and reopens the plan has to see it still ticked. Needs:

- `sentToDriver: boolean` on `GET /plans/{id}`.
- A write path — `PATCH /plans/{id}` with `{ sentToDriver }`, ideally recording
  `sentToDriverAt` and the acting user so the Recent table can show *when*.
- A decision on whether ticking it is purely a flag or should also mean
  something (freeze the plan, stop re-pricing, emit a notification). The design
  assumes a flag only.

This also interacts with §4's status question: "sent to driver" is a third axis
alongside solve status and trip lifecycle. It is deliberately a checkbox rather
than a status badge for that reason.

---

## 4. Screen: Recent tab

`frontend/src/components/RecentTab.tsx` — seven columns:

| Column | Field |
|---|---|
| Trip | `planId` / reference number |
| Date | `createdAt` |
| Route | origin + destination labels, rendered `A → B` |
| Distance | `optimized.distanceMiles` |
| Truck | truck unit label |
| Saved | `optimized.savingsVsBaselineUsd` |
| Status | `status` |

`GET /plans` needs to return this as a list projection — not full plan payloads.
Pagination is not in the design; it will be needed.

**Status values.** The design shows `Planned` and `Completed`. §14's are
`completed` and `infeasible`. These are different vocabularies: §14's describes
whether the *solve* succeeded, the design's appears to describe whether the
*trip* has been driven. Both may be needed — a solve status and a trip
lifecycle status — and the design has room for only one badge. Needs a decision.

An `infeasible` plan must render in this table too; the design has no styling
for it.

---

## 5. Screen: Dev Tools tab

`frontend/src/components/DevToolsTab.tsx`. Every field here is an uncontrolled
placeholder input; nothing is read or written.

### 5.1 Truck panel

**Naming correction:** this is `GET /truck-profiles/{id}` + a `PATCH` on the
same, not `/trucks/{id}` — this panel edits an optimiser profile's tank/mpg
class (`truck_profiles`), which is what existed when this document was
written and the only endpoint that name could have meant. `trucks` is now a
real table too (the fleet roster, T-25) with its own, different `id`; do not
confuse the two paths.

| Field | Column in `truck_profiles` |
|---|---|
| Truck name / unit | `truck_number` — a placeholder int (A16's T-03 note), not the fleet roster; a display name comes from `slug`/`display_name` |
| Tank capacity (gal) | `tank_gallons` |
| Fuel economy (mpg) | `avg_mpg` |
| Starting fuel (gal) / (%) | **not a truck property** — a per-plan input (`startFuelGallons`). The two inputs are two views of one number and must stay in sync against tank capacity. |
| "Range on hand ≈ 440 mi" | derived: `startFuelGallons × avg_mpg` |
| "Trip needs 68 gal" | derived: `optimized.totalGallons` |

### 5.2 Solver defaults panel

Read-only diagnostics, none of which exist today:

| Field | Source |
|---|---|
| Price feed | build/config — the design's `opis-live · v3` is wrong for this project; §4 says the feed is a BVD CSV import. Should show the import identity. |
| Routing engine | ORS per §8.2 — a version/profile string |
| Price cache TTL (min) | config |
| Fuel type | `product_type` |
| "Last solve 1.8 s" | **New** — solve wall time on the plan response |
| "412 stations scanned" | **New** — corridor candidate count considered by the DP |

`GET /health` (§14) already reports provider reachability and the latest sheet
date; that is the natural home for the first four. The last two are per-plan and
belong on the plan response.

### 5.3 Constraints and price basis

These are the `POST /plans` inputs. All eight map to fields §14 already defines,
with one addition:

| Field | `POST /plans` |
|---|---|
| Search corridor (mi) | `maxDetourMiles` — **naming collision, see below** |
| Max detour per stop (mi) | **New.** Post-routing round-trip cap, distinct from the corridor. Nullable. |
| Arrival fuel target (gal) | `minArrivalGallons` |
| Reserve floor (%) | `truck_profiles.reserve_fraction` (not `trucks` — this document's own earlier text named the wrong table; the column lives on the profile T-21 already reads via `GET /truck-profiles`) — read-only here, edited on the profile |
| Max stops | `maxStops` (nullable) |
| Max leg between fills (mi) | `maxLegMiles` |
| Min leg between fills (mi) | `minLegMiles` |
| Price basis | `priceBasis` |

**The corridor / detour distinction is the important one.** The design's own
help text spells it out: the corridor is a straight-line *screening* radius,
inflated by each station's position uncertainty, that decides what gets
considered at all. The max detour per stop is a *post-routing* cap on one
station's actual round-trip drive. §14 has a single `maxDetourMiles` doing both
jobs. Two parameters are needed, and §15.1's constraint list needs the second
one added.

**Price basis options** in the design: `Pump price (YOUR PRICE)`, `Rack price`,
`Pump price less IFTA credit`, `Contract / network price`. These map onto
`station_prices` columns (`your_price`, `cost`/`total_cost`, `retail_price`).
The design's own note says the IFTA question is unresolved; that is a real open
item, not a UI gap.

---

## 6. What the backend must add beyond §14

Ordered by how much of the UI is blocked on it.

1. **`GET /price-sheets`** — the sheet picker cannot exist without it. Needs
   `effectiveOn`, `importedAt`, `stationCount`.
2. **`priceEffectiveOn` on `POST /plans`** — pricing a lane against a chosen
   sheet.
3. **`candidateStations[]` fully specified** — three separate parts of the Plan
   tab consume it (dot layer, hover card, cheapest-along-route list).
4. **`detourCostUsd`** on `optimized`, plus the `costPerMile` used to compute
   it. The design's stat cell hard-codes `$0.60/mi`; that rate is a business
   input and belongs in config, surfaced on the response.
5. **Drive time and dwell time separated** on `optimized`, so the "excludes time
   at the pump" caption is true.
6. **A second detour parameter** — screening corridor vs per-stop routed cap
   (§5.3).
7. **Solve telemetry** — `solveMs`, `stationsScanned`, `optimizerStrategy` (the
   last already exists) on the plan response.
8. **`GET /plans` list projection** for the Recent table, with pagination.
9. **`GET /trucks` with `period` optional (D23)** for New Plan's truck field —
   see §2's truck-selector note. The truck-number type fix landed as D18.
10. **Resolved origin/destination coordinates** echoed on the plan response.
11. **`sentToDriver`** on the plan response, plus a `PATCH /plans/{id}` to set
    it (and `sentToDriverAt` for the Recent table).
12. **Session identity** for the header chip, if auth lands in v1.

---

## 7. Open questions for the backend

- **Trip reference format.** The UI shows `T-1042`. Is that a human-readable
  sequence alongside a UUID `planId`, or is it the id? The Recent table, the
  header tag and any future URL all use it.
- ~~**Truck unit numbering.**~~ Resolved by D18 — see §2.
- **Status vocabulary.** Solve status (`completed` / `infeasible`) and trip
  lifecycle (`Planned` / `Completed`) are different axes; the design has one
  badge.
- **"Cheapest along route" set** — corridor candidates only, or candidates plus
  chosen stops? Fixed at five?
- **"All sheet stations" scope** — confirmed as every station on the selected
  sheet, which means the paged bbox layer is required; the corridor set is now
  the *other* button. Is the sheet layer worth paging, or should it be capped to
  the route bbox?
- **Rejection reasons** — can the DP cheaply say why a corridor candidate was
  not chosen, or does the in-corridor layer stay unexplained?
- **`sentToDriver` semantics** — flag only, or does it lock the plan?
- **Action-label rules** — what makes a stop a "top-off" vs "reserve" vs a named
  gallon amount.
- **IFTA registration**, which decides the default price basis. Unresolved in
  the design and unresolved here.

---

## 8. Missing states

The design has no rendering for any of these, and the frontend currently cannot
express them:

- `status: "infeasible"` — §14 returns a structured `reason` with suggestions
  and still returns `candidateStations`. That is a rich payload with nowhere to
  go.
- ~~`geometryExpired: true`~~ — **no longer applicable in v1.** Route geometry
  does not expire under ORS (§17, revised 10 September 2026), so the field is
  never returned. Returns only with a contractually capped provider.
- **Disclaimers.** §14 returns a `disclaimers[]` array and guarantees at least
  one entry on every plan. The design surfaces none of them.
- Empty states: no recent trips, no candidates in corridor, no price sheet
  imported yet.
- Loading state while a solve runs. `POST /plans` is synchronous (§14, revised) —
  one request, 3–10s, the finished plan comes back in the response — so this is
  a plain "request in flight" spinner around that single `fetch()`, not a poll
  against a job status. Still required: 3–10s is long enough that the UI cannot
  render nothing.
- Error states for a failed geocode or a routing-provider outage.

These are design work, not backend work — but the payloads above will arrive
before there is anywhere to put them.
