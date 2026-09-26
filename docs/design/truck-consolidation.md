# Collapsing `trucks` + `truck_profiles` into one table

**Status:** proposed, not yet implemented. This document is the record of the
reasoning session that produced the design below — read it before touching
schema or code.

## The problem this fixes

Planning a route (Dallas, TX → Atlanta, GA, truck 031) silently did nothing.
Root cause: the New Plan screen's visible "Truck" selector only sets
`plans.truck_id` (a real fleet unit — used later to match this plan against
actual invoices). The optimizer doesn't read that field at all — it needs
`truckProfileId`, an abstract mpg/tank/leg-cap *class*, settable only from
the buried "Dev Tools" panel. None of the 27 real trucks have a
`truck_profile_id` set, so there's no way to infer one from the truck you
pick even if the UI tried to. "Plan route" just disables itself
(`buildCreatePlanRequest` returns `null`) with zero explanation.

The fix isn't a UI patch — it's removing the abstract-class layer entirely.
With 27 known real trucks, there's no need for an indirection between "the
truck" and "the truck's specs." One row per real truck, carrying its own
unit number *and* its own mpg/tank/dimensions, is both simpler and matches
how the fleet actually works.

## Current schema (six tables touch this)

| Table | Migration | Role today |
|---|---|---|
| `trucks` | 0003 | 27 real units. `truck_profile_id` FK, always NULL. |
| `truck_profiles` | 0001 | 3 abstract vehicle classes. 20 columns; only 7 are ever read by any planning/optimizer code (`tank_gallons`, `avg_mpg`, `reserve_fraction`, `max_leg_miles`, `min_leg_miles`, `cost_per_mile_usd`, `fixed_stop_minutes`). |
| `truck_assignments` | 0003 | Driver→truck history, effective-dated. **Already** driver-owned, not truck-owned — a truck can have many drivers over time, even concurrently (confirmed from the real 999210 invoice: units 072, 1012 and 1019 were each genuinely shared by two different drivers on different days that week). Nothing to fix here — the design already matches "a truck shouldn't have one driver attached." |
| `plans` | 0001 | Has **both** `truck_profile_id` (NOT NULL, the spec used to solve) and `truck_id` (nullable, the real-unit tag) — two FKs that hold the same value once merged. |
| `routes` | 0001 | Has `truck_profile_id` (NOT NULL), stored but not part of the actual cache key (`UNIQUE(provider, request_hash)`) — informational only. |
| `fuel_stops` / `express_charges` | 0003 | `truck_id` FK straight to `trucks` — unaffected by any of this. |

Also found in `transactions.ts`: `getTransactionById`'s "link to the plan
that covered this truck/date" query joins `fuel_stops`'s resolved truck to a
plan **via `truck_profile_id`** — meaning today it can match a plan for the
wrong real truck as long as it's the same abstract class. The merge fixes
this as a side effect (the join becomes `truck_id = truck_id`, unambiguous).

## Decisions made in the reasoning session

1. **Drop the abstract-class use case entirely.** Every plan is for one of
   the 27 real trucks. Planning "for a truck like unit 072" just means
   picking 072 — no capability lost, just reframed.
2. **Keep the 8 currently-unused dimension columns**
   (`height_cm`, `width_cm`, `length_cm`, `gross_weight_kg`, `axle_count`,
   `trailer_count`, `hazmat_class`, `max_gallons_per_fill`), moved onto the
   merged table as real per-truck fields. Not wired into ORS routing calls
   yet — this sets up low-bridge/weight-restriction routing later without
   another schema change.
3. **Drop `owner_user_id` and `is_system`.** Vestigial multi-tenant
   scaffolding (multiple users each with their own custom profiles) for a
   constraint this project has already decided against — single user
   (CLAUDE.md).
4. **Collapse `plans`'/`routes`' two truck FKs into one NOT NULL `truck_id`
   each.** No more `truck_profile_id` anywhere.
5. **Specs are nullable at the schema level, but seeded with a working
   default.** We have zero real per-unit data for any of the 27 trucks'
   mpg/tank/dimensions — only the 3 old abstract classes' numbers. Rather
   than guess a distribution across 27 trucks with no evidence (the same
   mistake the driver/truck pairing fix corrected), **every truck seeds to
   one default spec** (below) so planning works immediately, explicitly
   flagged for correction once real fleet data is available — same pattern
   as `migrations/0005_fleet_roster_seed.sql`'s own "plausible, not
   verified" caveat.

Also decided implicitly by the above: `slug` and the legacy `truck_number`
(v1's placeholder int — 22/56/91, unrelated to the real fleet's unit
numbers) are dropped — `unit_number` (already unique, already real) is the
only identifier a truck needs. `display_name` is dropped too — nothing in
the app displays a truck by a stored label; everywhere already renders the
raw unit number (`RawResolved`, `TransactionsTable`, etc.), and a plan
result can just say "Unit 072" without a stored string for it.

## The new `trucks` table

```sql
CREATE TABLE trucks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_number          text NOT NULL UNIQUE,

  -- the 7 fields the optimizer actually reads — nullable by design (see
  -- decision 5), but every row is seeded with a value so planning never
  -- silently no-ops the way it does today.
  tank_gallons         numeric(6,1),
  avg_mpg              numeric(4,2),
  reserve_fraction     numeric(4,3),
  max_leg_miles        numeric(6,1),
  min_leg_miles        numeric(6,1),
  cost_per_mile_usd    numeric(6,3),
  fixed_stop_minutes   integer,

  -- real per-truck physical attributes, informational until a routing
  -- feature reads them (decision 2).
  max_gallons_per_fill numeric(6,1),
  gross_weight_kg      integer,
  height_cm            integer,
  width_cm             integer,
  length_cm            integer,
  axle_count           smallint,
  trailer_count        smallint,
  hazmat_class         text,

  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CHECK (avg_mpg IS NULL OR avg_mpg > 0),
  CHECK (tank_gallons IS NULL OR tank_gallons > 0),
  CHECK (min_leg_miles IS NULL OR max_leg_miles IS NULL OR min_leg_miles <= max_leg_miles),
  CHECK (reserve_fraction IS NULL OR (reserve_fraction >= 0 AND reserve_fraction < 0.5))
);
```

Dropped from the old `truck_profiles`: `id` (self-ref removed with the
table itself), `slug`, `display_name`, `truck_number`, `owner_user_id`,
`is_system`, `truck_profile_id` (the FK from the old `trucks` — gone, it's
one table now).

**Seed default** (all 27 units, until corrected): the old "standard haul"
middle-tier spec — `tank_gallons = 200`, `avg_mpg = 7.5`,
`reserve_fraction = 0.150`, `max_leg_miles = 500`, `min_leg_miles = 300`,
`cost_per_mile_usd = 0.000`, `fixed_stop_minutes = 20`. Flag this exactly
like migration 0005 flags its own pairing guess: a working placeholder, not
a verified fleet spec.

## Downstream changes

- **`plans`**: drop `truck_profile_id`; `truck_id` becomes `NOT NULL`.
- **`routes`**: drop `truck_profile_id`; add `truck_id NOT NULL REFERENCES trucks(id)` in its place.
- **`fuel_stops` / `express_charges` / `truck_assignments`**: untouched — already FK straight to `trucks(id)`.
- **New validation**: since specs are nullable, `POST /plans` needs an explicit check — a chosen truck missing any of the 7 planning fields should return a clear `400 problem+json` ("truck 057 has no mpg/tank spec set") instead of either crashing deep in the optimizer or (worse) reproducing today's silent no-op.

## Application-layer blast radius (21 files, from grep, non-test)

**Backend** — `catalog/trucks.ts` and `catalog/truckProfiles.ts` likely
merge into one; `api/routes/truckProfiles.ts` goes away (folded into
`api/routes/trucks.ts` if that exists, or `trucks.ts` gains what
`truckProfiles.ts` did); `planning/planDefaults.ts`, `planning/planService.ts`,
`planning/planPersistence.ts`, `planning/routePersistence.ts` all read a
`profile` object today — the object's *shape* barely changes (same 7
fields), but its *source query* changes from `truck_profiles` to `trucks`,
and every one of these needs the new "spec is null" guard;
`domain/planResponse.ts`'s `truckProfile: {slug, displayName, maxLegMiles}`
field needs a new shape (something like `truck: {unitNumber, maxLegMiles}`);
`domain/planResponseUnits.ts`, `planActual/match.ts`, `actuals/transactions.ts`
(the plan-link join fix described above), `db/schema.ts`, `db/types.ts`,
`api/app.ts` (route wiring) all need the rename follow-through.

**Frontend** — `hooks/useTruckProfiles.ts` and `hooks/useTrucks.ts` merge
into one; `components/DevToolsTab.tsx` loses its truck-profile picker
entirely (this is the buried control causing yesterday's bug — it goes
away, not just gets relabeled); `components/PlanTab.tsx`'s existing real
unit-number selector becomes the *only* truck picker, now correctly driving
both the plan's tag and the optimizer's math; `lib/planRequestForm.ts` drops
the separate `truckProfileId` field and the "disabled until Dev Tools sets
a profile" logic entirely — this is the actual fix for the bug, falling out
of the schema change rather than needing its own patch; `lib/api.ts`
updates its typed client calls accordingly.

## Migration mechanics (flag for the implementation session, not resolved here)

No deploy has happened yet (T-49 is still open), so per CLAUDE.md every
migration file listed above is still squashable/editable in place rather
than needing new append-only files. But `truck_profiles` lives in
**migration 0001** (alongside `routes`/`plans`, which reference it), while
the real `trucks` table lives in **migration 0003** (after 0001). A clean
merge needs `trucks` (fully speced) defined *before* `routes`/`plans`
reference it — which means resequencing, not just editing columns in place.
The implementation session should decide: move `trucks`'s creation into
0001 (where `truck_profiles` used to be), or restructure more broadly.
Either way, `truck_assignments`/`fuel_stops`/`express_charges` (currently
0003, referencing `trucks`) need to keep working against wherever `trucks`
ends up.

## Suggested next step

Register this as a numbered ticket (`docs/TICKETS-v2.md`) before branching,
per the project's own one-ticket-one-branch workflow (CLAUDE.md) — this is
real schema/app work, not a hotfix.
