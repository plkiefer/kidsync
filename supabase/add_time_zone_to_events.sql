-- ============================================================
-- Per-event timezone
-- ------------------------------------------------------------
-- Adds `time_zone` (IANA name) to calendar_events. Stores the
-- zone the user authored the event in — the canonical timestamp
-- in starts_at/ends_at remains UTC. The pair (UTC instant + IANA
-- name) lets the calendar (and future iCal export logic) display
-- "5:30pm Eastern" correctly even if the viewer is somewhere else.
--
-- 1. Add column (nullable to keep the migration cheap)
-- 2. Backfill every existing row with the family's home zone —
--    safe because the family is currently Eastern and starts_at
--    already encodes the correct UTC instant.
-- 3. Idempotent: rerunning is a no-op.
-- ============================================================

alter table calendar_events
  add column if not exists time_zone text;

-- Backfill existing rows. America/New_York is the family's home
-- zone today; once we add a per-family time_zone column we can
-- migrate this default to read from the family record instead.
update calendar_events
   set time_zone = 'America/New_York'
 where time_zone is null;
