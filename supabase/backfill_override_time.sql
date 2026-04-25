-- ============================================================
-- One-time backfill: extract override_time from the note text
-- on rows where the structured column is null but the note
-- contains a time stamp.
--
-- Two existing patterns the app generates:
--   1. QuickCustodyChange:
--      "Pickup for X moved from DATE to DATE at HH:MM — note"
--   2. EventModal "Custom custody":
--      "Custom custody: X with Y — Pickup DATE at HH:MM,
--       Drop-off DATE at HH:MM — note"
--
-- Both put the PICKUP time as the first 'at HH:MM' in the note.
-- The single override_time column carries the pickup time;
-- dropoff falls back to the schedule's default (17:00 in our
-- agreement). When the dropoff time deviates from the default,
-- you'll need a separate override row keyed on the dropoff date —
-- but for the existing two rows, this single-time backfill is
-- correct.
--
-- Run this ONCE in Supabase SQL Editor → New query → Run.
-- ============================================================

UPDATE custody_overrides
SET override_time = (regexp_match(note, ' at (\d{1,2}:\d{2})'))[1]
WHERE override_time IS NULL
  AND note ~ ' at \d{1,2}:\d{2}';

-- Verify what got updated:
SELECT id, kid_id, start_date, end_date, override_time, status,
       LEFT(note, 80) AS note_preview
FROM custody_overrides
WHERE start_date <= '2026-04-30' AND end_date >= '2026-04-15'
ORDER BY start_date, kid_id, created_at;
