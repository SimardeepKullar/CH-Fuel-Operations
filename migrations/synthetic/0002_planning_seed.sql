-- Seed reference data (T-03): the BVD/ULSD product code. Idempotent —
-- re-running this file must not duplicate rows.
--
-- The three §16 abstract truck profiles this file used to seed are gone
-- (T-56, folded into 0005_fleet_roster_seed.sql's real trucks instead).

-- ─── Product code ────────────────────────────────────────────────────────
-- A tripwire, not a lookup: its job is to fail an unmapped raw code at
-- ingest, never to enrich or default-map one (§22.4).

INSERT INTO product_codes (supplier, raw_code, product_type, mapped_by, notes)
VALUES ('BVD', 'ULSD', 'highway_diesel', 'seed', 'Confirmed from 2026-08-22 sheet')
ON CONFLICT (supplier, raw_code) DO NOTHING;
