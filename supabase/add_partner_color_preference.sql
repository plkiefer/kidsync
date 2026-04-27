-- ============================================================
-- Per-viewer co-parent color
-- ------------------------------------------------------------
-- Adds `partner_color_preference` to profiles. Stores a palette
-- KEY string (see src/lib/palette.ts) — the color THIS user wants
-- to see for the OTHER parent's days. Combined with the existing
-- `color_preference` (own color), each parent now has full control
-- over both colors they see, and the two parents can disagree.
--
-- Rendering rule (calendar/page.tsx):
--   - Look up the signed-in user's profile.
--   - own days  → profile.color_preference
--   - co-parent → profile.partner_color_preference
--             ↳ falls back to the co-parent's own color_preference
--               if NULL (back-compat for existing rows).
--
-- Default backfill: leave NULL. The fallback above means the UX
-- starts identical to the previous behavior — nothing changes
-- visually until someone customizes.
-- ============================================================

alter table profiles
  add column if not exists partner_color_preference text;
