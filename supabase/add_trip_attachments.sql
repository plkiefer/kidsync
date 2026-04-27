-- ============================================================
-- Trip-level attachments
-- ------------------------------------------------------------
-- Phase 5 of the Travel + Trips plan. Trips can carry trip-level
-- file attachments (passport scans, custody letters, custody court
-- order PDFs for international travel) in addition to per-segment
-- attachments which already work via calendar_events.attachments.
--
-- Storage path convention: same bucket (event-attachments) but
-- under "trip/<trip_id>/..." instead of "<event_id>/...".
--
-- Mirrors the existing calendar_events.attachments shape:
--   [{ name, path, size, type, uploaded_at }, ...]
-- ============================================================

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
