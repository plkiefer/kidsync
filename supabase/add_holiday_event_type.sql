-- ─── Add `holiday` to the event_type enum ─────────────────────────────────
-- The original scaffold defined event_type as:
--   ('school', 'sports', 'medical', 'birthday', 'custody', 'activity',
--    'travel', 'other')
-- The TS layer and EVENT_TYPE_CONFIG both reference a "holiday" value that
-- was never added here, so any INSERT of event_type='holiday' fails with
--   22P02: invalid input value for enum event_type: "holiday"
-- The Schedule Import flow emits holiday rows for school-calendar closures,
-- federal holidays, and religious breaks — it needs this value to exist.
--
-- ALTER TYPE ADD VALUE is idempotent with IF NOT EXISTS and is safe to run
-- against a live database. Must NOT be inside a larger transaction block —
-- run as-is in the Supabase SQL editor.
-- ────────────────────────────────────────────────────────────────────────

ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'holiday';
