-- Only if you ran schema.sql BEFORE Nov 20, 2026 (11:45): adds maker + print temps.
-- New databases already have these columns; running this on one errors with "duplicate column", which is harmless.
ALTER TABLE filaments ADD COLUMN maker  TEXT NOT NULL DEFAULT '';
ALTER TABLE filaments ADD COLUMN nozzle TEXT NOT NULL DEFAULT '';
ALTER TABLE filaments ADD COLUMN bed    TEXT NOT NULL DEFAULT '';
