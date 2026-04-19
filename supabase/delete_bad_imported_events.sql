-- ─── One-shot cleanup: delete Schedule Import rows that landed at UTC midnight ─
-- The first Schedule Import pass wrote all_day events with starts_at at T00:00
-- which Supabase stores as UTC midnight and renders one day early in local TZ.
-- The code fix (commit c72f4fd) switches new imports to T12:00:00, but the 21
-- rows already in the DB need to go before a clean re-import.
--
-- SAFETY: the WHERE clause triple-gates on:
--   1. all_day = true                        — only all-day rows
--   2. starts_at is at UTC midnight          — the bug signature
--                                              (the rest of the app uses T12:00
--                                              so this uniquely matches imports
--                                              from the broken run)
--   3. created_at::date >= '2026-04-19'      — don't touch historical data even
--                                              if something older happened to
--                                              match the first two conditions
--
-- RETURNING prints the deleted rows so you can eyeball what went away.
-- If the preview list doesn't look right, roll back by running it inside a
-- BEGIN; ... ROLLBACK; block.
-- ────────────────────────────────────────────────────────────────────────

-- STEP 1 — preview (run this first; should show ~21 rows)
SELECT id, title, starts_at, ends_at, event_type
FROM calendar_events
WHERE all_day = true
  AND EXTRACT(HOUR FROM starts_at AT TIME ZONE 'UTC') = 0
  AND created_at::date >= '2026-04-19'
ORDER BY starts_at;

-- STEP 2 — delete (uncomment and run after verifying the preview above)
-- DELETE FROM calendar_events
-- WHERE all_day = true
--   AND EXTRACT(HOUR FROM starts_at AT TIME ZONE 'UTC') = 0
--   AND created_at::date >= '2026-04-19'
-- RETURNING id, title, starts_at;
