-- Required config, not roster data: the anomaly engine throws when a rule has
-- no row here, so this must exist in every environment.
--
-- Seeds one anomaly_thresholds row per T-30 rule (D16: thresholds are data,
-- never code constants). config is rule-specific and editable later in
-- Settings (A8.11) without a migration. ON CONFLICT DO NOTHING keeps this
-- idempotent and never clobbers a value someone has since edited.

INSERT INTO anomaly_thresholds (rule, config) VALUES
  -- Below this many gallons on a fuel line, a transaction is implausible
  -- rather than a genuinely tiny top-up (§A10: 0.04 gal at LOVES #277).
  -- Diesel (TA) only — a small DEF (DF) top-off is routine, not implausible
  -- (T-40F).
  ('sub_gallon', '{"minGallons": "1.00", "productCodes": ["TA"]}'),

  -- No tunable knob yet — the entered unit either matches the resolved
  -- truck's unit_number or it doesn't (T-29's own agrees comparison).
  ('unit_mismatch', '{}'),

  -- Two fills on the same card at the same station within this many minutes
  -- are implausible back-to-back purchases (§A10: 78 minutes at LOVES #275).
  ('too_close', '{"maxMinutesApart": 120}'),

  -- A stop with charges but zero fuel gallons on TA/DF (§A10: a $15.25
  -- scale-only stop).
  ('charges_no_fuel', '{"fuelProductCodes": ["TA", "DF"]}'),

  -- Billed diesel price more than this far above BVD's published price for
  -- that station+date (A18 Q5 — degrades to "not computable" without a
  -- published-price row, never to "no anomaly").
  ('price_above_published', '{"maxOverageUsdPerGal": "0.10", "fuelProductCode": "TA"}')
ON CONFLICT (rule) DO NOTHING;
