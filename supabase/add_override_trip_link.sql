-- ============================================================
-- created_from_trip_id on custody_overrides
-- ------------------------------------------------------------
-- Phase 0 of the Travel + Trips plan (docs/travel-trips-plan.md).
-- Records which trip generated this override. Plan §15e uses this
-- to decide whether to prompt for override withdrawal when a trip
-- is canceled (only when the override was created from the trip).
--
-- ON DELETE SET NULL keeps the override around even if the trip is
-- later deleted — the override may have been used to bake other
-- arrangements (e.g. the parent took time off work).
-- ============================================================

ALTER TABLE custody_overrides
  ADD COLUMN IF NOT EXISTS created_from_trip_id UUID
    REFERENCES trips(id) ON DELETE SET NULL;
