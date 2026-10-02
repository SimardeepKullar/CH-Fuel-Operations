-- Fleet roster (T-25 step 25.4): this company's data, replaceable — unlike the
-- required config in 0004. The 27 cards, 27 units and 27
-- drivers from PROJECT-SCOPE-v2.md §A19 (plus the CA invoice's additions,
-- T-62, at the end of this file), each card given its one permanent
-- driver and each driver one or more current truck_assignments rows.
-- Idempotent — re-running this file must not duplicate rows or clobber a
-- real reassignment.
--
-- The card→driver pairing and the driver→truck assignments below are
-- derived from one week's real invoice import, not guessed: every one of
-- the 27 cards appears with exactly one distinct raw driver name across
-- all its transactions that week, and most drivers show one consistent raw
-- unit number. Two pairs of drivers genuinely shared a truck at different
-- points in the week (Taylor/Finn Gray on 1019, Kit Barnes moving from 1012
-- to 101) — modelled below as sequential effective-dated rows, exactly what
-- `truck_assignments` exists for (a truck isn't owned by a driver; it's
-- whatever was assigned that day). Jordan and Harper Lane both genuinely
-- used 072 on overlapping days — left as two coexisting rows, which the
-- driver-scoped EXCLUDE constraint (migrations/0003_actuals_schema.sql)
-- allows. A handful of raw entries stay genuine mismatches on purpose:
-- Jordan's "0" (§A10's own worked example), Blake Hale's "31" and Iris Mae
-- Bentley's "3224" are not real unit numbers at all — real data-entry
-- errors, not a pairing to fix.
--
-- Names and card numbers are synthetic placeholders, not the real roster —
-- see T-58's history scrub. The pairing, the shared-truck scenarios and the
-- deliberate bad-unit rows are real and preserved exactly.

-- ─── Drivers ──────────────────────────────────────────────────────────────
-- No unique constraint on display_name (two real drivers could share a
-- name), so idempotency is a NOT EXISTS guard rather than ON CONFLICT.

INSERT INTO drivers (display_name)
SELECT v.display_name FROM (VALUES
  ('JORDAN'), ('TAYLOR'), ('HARPER LANE'), ('MORGAN'), ('CASEY'),
  ('ROBIN CROSS'), ('DANA FOX'), ('ELLIS PARK'), ('SAGE MOORE'),
  ('TATUM REED'), ('KIT BARNES'), ('LOU FIELD'), ('BLAKE HALE'),
  ('WREN OTIS'), ('IVY CRANE'), ('RILEY'), ('ARDEN LEE SHAW'),
  ('QUINN'), ('NILE BOND'), ('RORY VANCE'), ('TESS KANE'),
  ('FINN GRAY'), ('IRIS MAE BENTLEY'), ('NOVA REESE'), ('AVERY'),
  ('DREW'), ('SAWYER')
) AS v(display_name)
WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE d.display_name = v.display_name);

-- ─── Fuel cards ───────────────────────────────────────────────────────────

INSERT INTO fuel_cards (card_number)
VALUES
  ('9000001'), ('9000002'), ('9000003'), ('9000004'), ('9000005'),
  ('9000006'), ('9000007'), ('9000008'), ('9000009'), ('9000010'),
  ('9000011'), ('9000012'), ('9000013'), ('9000014'), ('9000015'),
  ('9000016'), ('9000017'), ('9000018'), ('9000019'), ('9000020'),
  ('9000021'), ('9000022'), ('9000023'), ('9000024'), ('9000025'),
  ('9000026'), ('9000027')
ON CONFLICT (card_number) DO NOTHING;

-- ─── Trucks (fleet units) ───────────────────────────────────────────────
-- T-56: trucks now carries its own mpg/tank spec directly (no more separate
-- truck_profiles class). There is zero real per-unit data for any of the 27
-- trucks, so every row seeds to one flagged working default — the old
-- "standard haul" middle-tier spec — rather than guessing a distribution
-- across 27 trucks with no evidence (the same mistake the driver/truck
-- pairing fix above corrected). Correct with a one-line UPDATE once real
-- per-unit figures are known. Dimension columns stay NULL: no seed data.

INSERT INTO trucks
  (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles,
   min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
SELECT v.unit_number, 200, 7.5, 0.150, 500, 300, 0.000, 20
FROM (VALUES
  ('031'), ('039'), ('041'), ('044'), ('047'), ('050'), ('051'), ('052'),
  ('057'), ('061'), ('063'), ('064'), ('065'), ('066'), ('069'), ('070'),
  ('071'), ('072'), ('073'), ('101'), ('1012'), ('1013'), ('1016'), ('1017'),
  ('1019'), ('1022'), ('1023')
) AS v(unit_number)
ON CONFLICT (unit_number) DO NOTHING;

-- ─── Card → driver (permanent) ──────────────────────────────────────────
-- Each card belongs to exactly one driver, for the card's whole life. An
-- UPDATE, not an assignment row: there is nothing to date-range here (a
-- lost card becomes a new card_number, not a repointed driver_id). The
-- driver_id IS NULL guard means re-running this file never overwrites a
-- real reassignment made through the app.

UPDATE fuel_cards fc
SET driver_id = d.id
FROM (VALUES
  ('9000001', 'WREN OTIS'),
  ('9000002', 'DREW'),
  ('9000003', 'CASEY'),
  ('9000004', 'KIT BARNES'),
  ('9000005', 'JORDAN'),
  ('9000006', 'LOU FIELD'),
  ('9000007', 'AVERY'),
  ('9000008', 'RORY VANCE'),
  ('9000009', 'IRIS MAE BENTLEY'),
  ('9000010', 'NOVA REESE'),
  ('9000011', 'SAWYER'),
  ('9000012', 'ROBIN CROSS'),
  ('9000013', 'TATUM REED'),
  ('9000014', 'RILEY'),
  ('9000015', 'QUINN'),
  ('9000016', 'BLAKE HALE'),
  ('9000017', 'NILE BOND'),
  ('9000018', 'MORGAN'),
  ('9000019', 'TAYLOR'),
  ('9000020', 'HARPER LANE'),
  ('9000021', 'DANA FOX'),
  ('9000022', 'SAGE MOORE'),
  ('9000023', 'ELLIS PARK'),
  ('9000024', 'FINN GRAY'),
  ('9000025', 'TESS KANE'),
  ('9000026', 'ARDEN LEE SHAW'),
  ('9000027', 'IVY CRANE')
) AS pairing(card_number, display_name)
JOIN drivers d ON d.display_name = pairing.display_name
WHERE fc.card_number = pairing.card_number
  AND fc.driver_id IS NULL;

-- ─── Driver → truck (effective-dated) ───────────────────────────────────
-- Effective from well before the earliest invoice date on disk, so every
-- real stop this week resolves against it. Most drivers get one
-- always-current row. Three exceptions, per the real invoice data (see the
-- header comment above): Taylor held 1019 through 2026-09-06, then handed
-- it to Finn Gray from 2026-09-07; Kit Barnes held 1012 through 2026-09-03,
-- then moved to 101 from 2026-09-04. Jordan and Harper Lane both genuinely
-- used 072 on overlapping days this week, so both simply get an
-- always-current row for it — the EXCLUDE constraint only scopes one
-- driver's own ranges, not a truck's, so two drivers sharing a truck is not
-- a conflict.

INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
SELECT d.id, t.id, v.effective_from::date, v.effective_to::date
FROM (VALUES
  ('JORDAN',            '072',  '2026-01-01', NULL),
  ('HARPER LANE',       '072',  '2026-01-01', NULL),
  ('TAYLOR',            '1019', '2026-01-01', '2026-09-06'),
  ('FINN GRAY',         '1019', '2026-09-07', NULL),
  ('ROBIN CROSS',       '057',  '2026-01-01', NULL),
  ('LOU FIELD',         '061',  '2026-01-01', NULL),
  ('MORGAN',            '1013', '2026-01-01', NULL),
  ('CASEY',             '039',  '2026-01-01', NULL),
  ('DANA FOX',          '047',  '2026-01-01', NULL),
  ('ELLIS PARK',        '050',  '2026-01-01', NULL),
  ('SAGE MOORE',        '1016', '2026-01-01', NULL),
  ('TATUM REED',        '052',  '2026-01-01', NULL),
  ('KIT BARNES',        '1012', '2026-01-01', '2026-09-03'),
  ('KIT BARNES',        '101',  '2026-09-04', NULL),
  ('BLAKE HALE',        '1012', '2026-01-01', NULL),
  ('WREN OTIS',         '051',  '2026-01-01', NULL),
  ('IVY CRANE',         '065',  '2026-01-01', NULL),
  ('RILEY',             '063',  '2026-01-01', NULL),
  ('ARDEN LEE SHAW',    '1022', '2026-01-01', NULL),
  ('QUINN',             '041',  '2026-01-01', NULL),
  ('NILE BOND',         '1017', '2026-01-01', NULL),
  ('RORY VANCE',        '071',  '2026-01-01', NULL),
  ('TESS KANE',         '1023', '2026-01-01', NULL),
  ('IRIS MAE BENTLEY',  '064',  '2026-01-01', NULL),
  ('NOVA REESE',        '073',  '2026-01-01', NULL),
  ('AVERY',             '070',  '2026-01-01', NULL),
  ('DREW',              '044',  '2026-01-01', NULL),
  ('SAWYER',            '069',  '2026-01-01', NULL)
) AS v(display_name, unit_number, effective_from, effective_to)
JOIN drivers d ON d.display_name = v.display_name
JOIN trucks t ON t.unit_number = v.unit_number
ON CONFLICT DO NOTHING;

-- ─── CA invoice additions (T-62) ──────────────────────────────────────────
-- The CA invoice 999217 (week ending 2026-09-09) carries 34 cards: 13 are
-- already above, under the same drivers as on the US invoice; the 21 below
-- are new, each with exactly one raw driver name across its stops. Their
-- stops entered 20 unit numbers not yet in the roster — added as trucks
-- with the same flagged working default as the 27 above.
--
-- Assignments, decided 2026-10-01: the 16 new drivers whose CA stops all
-- carry one unit, and a unit no other new driver entered, are assigned it
-- from the invoice's first transaction date, 2026-09-03. The other 5 get no
-- assignment until one is set in Settings (T-47): one entered 067, 1017 and
-- 056; one entered 1002 and 062; one more entered 062; two entered 031.
-- Their stops resolve a driver (by card) and no truck. One existing driver
-- entered 074 on the CA invoice — 074 is added as a truck but that driver's
-- assignment above is left as it is, so the unit-mismatch flag fires.

INSERT INTO drivers (display_name)
SELECT v.display_name FROM (VALUES
  ('MILES HARTE'), ('JUNE ABBOTT'), ('COLE WINTER'), ('PIPER STONE'),
  ('REMY'), ('ELLIOT'), ('HAZEL PRICE'), ('OWEN DALE'),
  ('MARLO KEY'), ('SKYLER'), ('BEAU NASH'), ('PAXTON'),
  ('EMERY'), ('JADE MERCER'), ('ROWAN'), ('ASH'),
  ('KAI'), ('BRIAR'), ('SUTTON'), ('LENNOX'),
  ('CLEO MARSH')
) AS v(display_name)
WHERE NOT EXISTS (SELECT 1 FROM drivers d WHERE d.display_name = v.display_name);

INSERT INTO fuel_cards (card_number)
VALUES
  ('9000028'), ('9000029'), ('9000030'), ('9000031'), ('9000032'),
  ('9000033'), ('9000034'), ('9000035'), ('9000036'), ('9000037'),
  ('9000038'), ('9000039'), ('9000040'), ('9000041'), ('9000042'),
  ('9000043'), ('9000044'), ('9000045'), ('9000046'), ('9000047'),
  ('9000048')
ON CONFLICT (card_number) DO NOTHING;

INSERT INTO trucks
  (unit_number, tank_gallons, avg_mpg, reserve_fraction, max_leg_miles,
   min_leg_miles, cost_per_mile_usd, fixed_stop_minutes)
SELECT v.unit_number, 200, 7.5, 0.150, 500, 300, 0.000, 20
FROM (VALUES
  ('005'), ('028'), ('029'), ('033'), ('034'), ('035'), ('037'), ('038'),
  ('040'), ('049'), ('054'), ('056'), ('058'), ('059'), ('062'), ('067'),
  ('074'), ('1002'), ('1004'), ('1010')
) AS v(unit_number)
ON CONFLICT (unit_number) DO NOTHING;

UPDATE fuel_cards fc
SET driver_id = d.id
FROM (VALUES
  ('9000028', 'MILES HARTE'),
  ('9000029', 'JUNE ABBOTT'),
  ('9000030', 'COLE WINTER'),
  ('9000031', 'PIPER STONE'),
  ('9000032', 'REMY'),
  ('9000033', 'ELLIOT'),
  ('9000034', 'HAZEL PRICE'),
  ('9000035', 'OWEN DALE'),
  ('9000036', 'MARLO KEY'),
  ('9000037', 'SKYLER'),
  ('9000038', 'BEAU NASH'),
  ('9000039', 'PAXTON'),
  ('9000040', 'EMERY'),
  ('9000041', 'JADE MERCER'),
  ('9000042', 'ROWAN'),
  ('9000043', 'ASH'),
  ('9000044', 'KAI'),
  ('9000045', 'BRIAR'),
  ('9000046', 'SUTTON'),
  ('9000047', 'LENNOX'),
  ('9000048', 'CLEO MARSH')
) AS pairing(card_number, display_name)
JOIN drivers d ON d.display_name = pairing.display_name
WHERE fc.card_number = pairing.card_number
  AND fc.driver_id IS NULL;

INSERT INTO truck_assignments (driver_id, truck_id, effective_from, effective_to)
SELECT d.id, t.id, v.effective_from::date, v.effective_to::date
FROM (VALUES
  ('MILES HARTE',      '038',  '2026-09-03', NULL),
  ('JUNE ABBOTT',      '035',  '2026-09-03', NULL),
  ('PIPER STONE',      '1004', '2026-09-03', NULL),
  ('HAZEL PRICE',      '037',  '2026-09-03', NULL),
  ('OWEN DALE',        '059',  '2026-09-03', NULL),
  ('MARLO KEY',        '049',  '2026-09-03', NULL),
  ('SKYLER',           '058',  '2026-09-03', NULL),
  ('BEAU NASH',        '066',  '2026-09-03', NULL),
  ('PAXTON',           '1010', '2026-09-03', NULL),
  ('EMERY',            '029',  '2026-09-03', NULL),
  ('JADE MERCER',      '033',  '2026-09-03', NULL),
  ('ASH',              '005',  '2026-09-03', NULL),
  ('KAI',              '034',  '2026-09-03', NULL),
  ('BRIAR',            '054',  '2026-09-03', NULL),
  ('SUTTON',           '040',  '2026-09-03', NULL),
  ('CLEO MARSH',       '028',  '2026-09-03', NULL)
) AS v(display_name, unit_number, effective_from, effective_to)
JOIN drivers d ON d.display_name = v.display_name
JOIN trucks t ON t.unit_number = v.unit_number
ON CONFLICT DO NOTHING;
