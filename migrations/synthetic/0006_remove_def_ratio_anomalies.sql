-- T-40A: def_ratio is retired as an anomaly rule (0004, this migration set).
-- One-off cleanup — a past run may already have written def_ratio findings;
-- delete them so no orphaned flag for a since-removed rule lingers in the UI.
-- Harmless (and idempotent) on a database that never had any.

DELETE FROM anomalies WHERE rule = 'def_ratio';
