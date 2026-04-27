-- ============================================================
-- Per-event timezone
-- ------------------------------------------------------------
-- Adds `time_zone` (IANA name) to calendar_events. Stores the
-- zone the user authored the event in — the canonical timestamp
-- in starts_at/ends_at remains UTC. The pair (UTC instant + IANA
-- name) lets the calendar (and future iCal export logic) display
-- "5:30pm Eastern" correctly even if the viewer is somewhere else.
--
-- NULL is a valid value (existing rows). The application falls
-- back to America/New_York for legacy rows.
-- ============================================================

alter table calendar_events
  add column if not exists time_zone text;
