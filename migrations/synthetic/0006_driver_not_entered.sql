-- T-127: the "Driver name not entered" anomaly rule. A fuel line can print a
-- unit and no driver name (real CA invoice 945798). The engine throws on a
-- rule with no anomaly_thresholds row, so the row ships with the rule.
--
-- No tunable knob: the invoice printed a driver name or it did not.
-- Identical in migrations/synthetic and migrations/real.

INSERT INTO anomaly_thresholds (rule, config) VALUES
  ('driver_not_entered', '{}')
ON CONFLICT (rule) DO NOTHING;
