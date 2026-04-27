-- ============================================================
-- Segment columns on calendar_events
-- ------------------------------------------------------------
-- Phase 0 of the Travel + Trips plan (docs/travel-trips-plan.md).
-- Each trip segment (lodging, flight, drive, train, ferry, cruise,
-- cruise_port_stop, other_transport) IS a calendar_event with these
-- new fields. Non-trip events leave them NULL.
--
-- segment_data is type-specific JSON; see plan §2.3 for shapes.
-- parent_segment_id is only used by cruise_port_stop, linking it
-- to the cruise body it belongs to (so port stops can render as
-- the cruise's bottom ribbon and inherit its cabin/roster info).
-- ============================================================

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS trip_id           UUID REFERENCES trips(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS segment_type      TEXT
    CHECK (segment_type IN (
      'lodging', 'flight', 'drive', 'train', 'ferry',
      'cruise', 'cruise_port_stop', 'other_transport'
    )),
  ADD COLUMN IF NOT EXISTS segment_data      JSONB,
  ADD COLUMN IF NOT EXISTS member_ids        UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS guest_ids         TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS parent_segment_id UUID REFERENCES calendar_events(id) ON DELETE CASCADE;

-- Trip View loads all events for a trip; Trips list page shows
-- recent + upcoming trips; both query by trip_id frequently.
CREATE INDEX IF NOT EXISTS calendar_events_trip_idx
  ON calendar_events (trip_id);

-- Cruise body needs to find its port stops; port stops need to
-- find their parent cruise to inherit cabin info.
CREATE INDEX IF NOT EXISTS calendar_events_parent_segment_idx
  ON calendar_events (parent_segment_id);
