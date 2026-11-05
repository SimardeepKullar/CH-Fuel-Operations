# Plan: Dev / Prod Split for CH Fuel Operations

Repo: `SimardeepKullar/CH-Fuel-Operations` (checked at `e55a27e`, T-89).
This plan is written against the repo as it is today. Read `CLAUDE.md` first; this plan follows its workflow (one ticket = one branch = one squashed commit) and does not override any rule in it.

---

## 1. What exists today

- **Stack:** Next.js frontend and API mount (`frontend/`) and `@ch/core` (`backend/`), Postgres 18 + PostGIS with raw `pg`, and its own migration runner (`backend/src/db/migrate.ts`, `schema_migrations` table).
- **Planned hosting** (PROJECT-SCOPE §10): Vercel + Neon. Not deployed yet. No `vercel.json`. The first deploy is T-49.
- **One local database for everything:** `ch_fuel_planner` in the Docker volume `db-data`, on port 5433. The same database is used for:
  - day-to-day dev (synthetic migrations)
  - real-data testing (`db:migrate:real`, real invoices imported from `data/bvd-invoices/`)
  - integration tests (they create and drop throwaway schemas in it; `sweepStaleSchemas.ts` runs `DROP SCHEMA … CASCADE`)
- **Config:** `backend/src/db/pool.ts` loads only the root `.env`. There's no notion of which environment is running.

### Why data got deleted
`db:reset` and `db:reset:real` both run `docker compose down -v`. The `-v` deletes the entire Postgres volume, so every database and every row goes. `db:reset:real` rebuilds what it can from files in `data/`. Anything entered **through the app** can't be rebuilt from files and is gone for good: receipt checks, FX rates, truck assignments made in Settings, saved plans, saved locations.

The migration runner's orphan error message also tells you to run `npm run db:reset`. That's fine locally but must never be what someone does to prod.

---

## 2. Target structure

| Environment | Where | Database | Migrations | Can be reset? |
|---|---|---|---|---|
| **dev** | your machine | `ch_fuel_dev` (Docker) | `migrations/synthetic` | Yes, freely |
| **test** | your machine and CI | `ch_fuel_test` (Docker / CI service) | `migrations/synthetic` | Yes, tests own it |
| **real-local** | your machine | `ch_fuel_real` (Docker) | `migrations/real` | Yes, rebuilt from `data/` or from a prod dump |
| **preview** | Vercel preview deployments (PR branches) | Neon branch `preview` | `migrations/real` | Yes, re-branch from prod |
| **prod** | Vercel production (`main`) | Neon `production` branch | `migrations/real` | **Never** |

Key ideas:
1. **Separate databases, not one database used for everything.** All three local databases live in the same Docker container and volume, but a reset drops and recreates **one database**, never the volume.
2. **Prod is only ever migrated forward.** No reset, no seed beyond the one-time dispatcher account, no test runs.
3. **Neon branching gives you a free copy of prod** for testing risky migrations and for Vercel previews.

---

## 3. Work, split into tickets

Use the next free ticket numbers (check the board). Each is its own branch and PR. Do them in this order, all **before T-49**, so the first deploy ships with the safety rails already in place.

### Ticket A — Environment config
- Add `APP_ENV` with the values `development | test | real | production`.
- Change `pool.ts` to load `.env.${APP_ENV}` if it exists, then fall back to `.env` (keep the current "don't overwrite an already-set var" behaviour).
- Files:
  - `.env.development` → `DATABASE_URL=postgres://ch_fuel:ch_fuel@localhost:5433/ch_fuel_dev`
  - `.env.test` → `.../ch_fuel_test`
  - `.env.real` → `.../ch_fuel_real`
  - `.env.production.local` → Neon prod URL. **Only on your machine, for running prod migrations by hand.** Never loaded unless `APP_ENV=production` is set explicitly.
- Move `backend/.env.example` to the root (or keep it and document it), listing every variable including `APP_ENV`.
- `.gitignore`: add `.env.*` with an exception for `.env.example`, plus `backups/`.
- On startup (`serve`, the CLIs, the Next server), log one line: environment, database host and database name. Never the password.

### Ticket B — Destructive-operation guard (the most important one)
Create `backend/src/db/guard.ts`:

```ts
export function assertSafeToDestroy(connectionString: string, env = process.env): void
```

It throws unless **all** of these are true:
- `APP_ENV` is not `production`
- the host is `localhost` or `127.0.0.1`
- the database name is one of `ch_fuel_dev`, `ch_fuel_test` or `ch_fuel_real`
- the host doesn't contain `neon.tech`

Call it at the top of:
- the new `db:reset*` scripts (Ticket C)
- `backend/test/support/sweepStaleSchemas.ts` (it drops schemas)
- the integration-test fixtures that create and drop schemas (`actualsFixtures.ts` and the other `support/` helpers). Simplest: put one check in the vitest `globalSetup`, so the whole integration suite refuses to start against a non-local database.

Tests (written first, per CLAUDE.md):
- the guard rejects a Neon-style URL, `APP_ENV=production`, an unknown database name, and a remote host
- the guard accepts the three local databases

### Ticket C — Replace the volume-wiping reset
- New CLI `backend/src/cli/dbAdmin.ts` with these commands:
  - `create`: `CREATE DATABASE` for `ch_fuel_dev`, `ch_fuel_test` and `ch_fuel_real` if missing, plus `CREATE EXTENSION postgis` in each (or in a migration, if one already does that).
  - `reset <name>`: guard → terminate connections → `DROP DATABASE` → `CREATE DATABASE` → run migrations.
- Root `package.json`:
  - `db:create` → create the three databases
  - `db:reset` → `APP_ENV=development`: reset `ch_fuel_dev`, then migrate (synthetic), then seed
  - `db:reset:real` → `APP_ENV=real`: reset `ch_fuel_real`, then the existing real rebuild chain (gazetteer, ingest, backfill, resolve, import invoices)
  - `db:nuke` → the old `docker compose down -v`, kept but renamed so it's never typed by habit, printing a warning first
  - `test` / `test:integration` → run with `APP_ENV=test`
- Use `cross-env` (or a small Node wrapper) so `APP_ENV=…` works on Windows. Repos live under `C:\Users\simar\...`, so this matters.
- Change the runner's orphaned-migrations error so it only suggests `db:reset` when the target passes `assertSafeToDestroy`. Otherwise it should say "restore from backup / investigate; do not reset".
- Update CI (`.github/workflows/ci.yml`): set the service's `POSTGRES_DB` and `DATABASE_URL` to `ch_fuel_test` and set `APP_ENV=test`.
- Update the commands section of `CLAUDE.md` and the README.

### Ticket D — Backups and prod snapshots
- `db:backup` → `pg_dump -Fc` of the current `DATABASE_URL` into `backups/<env>-<timestamp>.dump` (gitignored: it contains real data).
- `db:restore-to-real <file>` → guard → reset `ch_fuel_real` → `pg_restore`. This gives you a local copy of real prod data to test against, instead of rebuilding from `data/` files.
- Document the Neon side: before every prod migration, create a Neon branch from `production` named `pre-<ticket>-<date>` as a snapshot. Check Neon's current plan limits for restore windows and branch counts. Don't assume them.

### Ticket E — Prod migration command
- `db:migrate:prod` script that:
  1. requires `APP_ENV=production` **and** a `--confirm` flag
  2. loads `.env.production.local`
  3. prints the target host, database name and the list of **pending** migrations, then stops unless `--confirm` was passed
  4. applies `migrations/real` (prod needs the real `0005` fleet roster, which is gitignored, so this runs from your machine, not from CI or Vercel)
- It never calls reset or seed. The one-time dispatcher account is created once with the existing `npm run seed`, which already refuses to overwrite.
- Add a check that `migrations/synthetic` and `migrations/real` contain the same filenames, so a new migration can't be added to one and forgotten in the other.

### Fold into T-49 (first deploy)
- **Migration freeze (D21):** do any last squash **before** the first prod migration. From then on, migrations are append-only and every change is a new numbered file.
- **Vercel:**
  - Production branch = `main`.
  - Set env vars per Vercel environment. **Production** gets the Neon `production` branch URL, `APP_ENV=production`, and its own `AUTH_SECRET` and `AUTH_URL`. **Preview** gets the Neon `preview` branch URL and `APP_ENV=preview` (treat it like production for the guard). Never reuse the prod URL in Preview.
- **Neon:** create the `preview` branch from `production` after the first prod migration, and re-create it whenever you want fresh prod-shaped data.
- Check what `DevToolsTab` exposes and hide it when `APP_ENV=production` if it can change data.

---

## 4. Day-to-day after this lands

**Building a feature**
1. `git checkout -b ticket/T-NN-…`
2. `npm run db:reset` whenever you want a clean slate. Only `ch_fuel_dev` is touched.
3. `npm run db:reset:real` or `db:restore-to-real` to see the feature against real invoices. Only `ch_fuel_real` is touched.
4. `npm run verify`. Tests run in `ch_fuel_test`.
5. Push → PR → a Vercel preview deploys against the Neon `preview` branch.

**Releasing**
1. Merge the PR into `main` only when CI is green.
2. If the ticket adds a migration:
   - create the Neon snapshot branch (`pre-T-NN-<date>`)
   - optionally run the migration against the `preview` branch first
   - run `npm run db:migrate:prod -- --confirm` **before** the code that needs it goes live
   - migrations must be additive so the currently live code keeps working until the deploy finishes
3. Vercel deploys `main` to production.
4. Check that the app loads and existing invoices, receipt checks and assignments are still there.

**If something goes wrong in prod:** restore from the Neon snapshot branch. Never run a reset.

---

## 5. Rules for Claude Code while doing this

- Do not run `db:reset`, `db:reset:real`, `db:nuke`, `docker compose down -v` or any `DROP` statement without first confirming that the target is a local `ch_fuel_dev`, `ch_fuel_test` or `ch_fuel_real` database.
- Never put a Neon URL, real driver name or real card number in a committed file (see CLAUDE.md's real-data rules).
- Ask before anything that touches `.env.production.local` or a Neon database.
- One ticket per branch, and `npm run verify` green before each PR, as CLAUDE.md requires.
- Don't start Ticket C until Ticket B is merged, so the guard exists before any reset script is rewritten.

---

## 6. Neon facts (already set up)

- Neon project: `ch-fuel-operations`, region AWS US East 1 (N. Virginia), Postgres only (no Auth, Storage, Functions or Realtime).
- The prod branch is named **`production`** (not `main`). Database `neondb`, role `neondb_owner`.
- Two connection strings exist: **pooled** (host contains `-pooler`, for the app on Vercel) and **direct** (for migrations). They are stored in the owner's password manager only.
- **Do not run `neon init` or `neon deploy`**, and do not follow the Neon agent prompt. `neon deploy` pulls env vars into `.env.local`, which Next.js loads automatically and could point local dev at prod. Wiring Neon into the repo happens only through Tickets A and E of this plan.
- Never run SQL against the `production` branch from Claude Code unless the owner says "run this on prod" in the same message. Use a separate Neon branch for any testing.
