-- ============================================================
-- Per-user color preference
-- ------------------------------------------------------------
-- Adds a `color_preference` column to profiles. Stores a palette
-- KEY string (see src/lib/palette.ts) — e.g. "mist", "sage". The
-- calendar resolves this through the palette helper at render
-- time, so the visual mapping can be retuned without touching
-- stored data.
--
-- Defaults are intentionally NULL so the application layer can
-- backfill sensibly based on parent role (parent_a → mist,
-- parent_b → cream) instead of giving everyone the same color.
-- See the bottom of this file for the optional backfill step.
-- ============================================================

alter table profiles
  add column if not exists color_preference text;

-- Optional backfill: assign mist to parent_a and cream to parent_b
-- across every custody schedule. Idempotent — only fills NULLs.
update profiles
   set color_preference = 'mist'
 where color_preference is null
   and id in (select parent_a_id from custody_schedules);

update profiles
   set color_preference = 'cream'
 where color_preference is null
   and id in (select parent_b_id from custody_schedules);

-- Anything still null (no custody schedule yet) → mist as a
-- neutral default. Users can change it any time from settings.
update profiles
   set color_preference = 'mist'
 where color_preference is null;
