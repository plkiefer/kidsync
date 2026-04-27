-- ============================================================
-- Trips table
-- ------------------------------------------------------------
-- Phase 0 of the Travel + Trips plan (docs/travel-trips-plan.md).
-- Trip is a first-class container with title, type, roster, and
-- optional named guests. Segments (lodgings, flights, drives, etc.)
-- live in calendar_events with a trip_id link added by the
-- companion migration add_segment_columns.sql.
--
-- starts_at / ends_at are denormalized for fast queries; the app
-- recomputes them whenever a segment is added/removed/edited.
-- ============================================================

CREATE TABLE IF NOT EXISTS trips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID REFERENCES families(id) NOT NULL,

  title           TEXT NOT NULL,
  trip_type       TEXT NOT NULL DEFAULT 'vacation'
                  CHECK (trip_type IN (
                    'vacation', 'custody_time', 'visit_family',
                    'business', 'other'
                  )),

  -- Auto-derived from segments. Nullable while the trip has no
  -- segments yet (Trip View opens with empty stays + transport).
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,

  -- Trip roster: kids + parents + named guests.
  -- guests stored as JSONB array of { id, name, relationship, phone, email? }.
  -- The id is a client-generated stable string ("guest_xxxx") so segments
  -- can reference guests by id without duplicating contact data.
  kid_ids         UUID[]  NOT NULL DEFAULT '{}',
  member_ids      UUID[]  NOT NULL DEFAULT '{}',
  guests          JSONB   NOT NULL DEFAULT '[]',

  -- Lifecycle: draft (Patrick still planning), planned (real,
  -- override may be proposed), canceled (kept for history).
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'planned', 'canceled')),

  notes           TEXT,

  created_by      UUID REFERENCES profiles(id) NOT NULL,
  updated_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Family-scoped queries by date range (Trips list page filters by
-- upcoming/past, calendar query window, etc).
CREATE INDEX IF NOT EXISTS trips_family_dates_idx
  ON trips (family_id, starts_at, ends_at);

-- ─── RLS ───────────────────────────────────────────────────
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view trips"
  ON trips FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Family members can manage trips"
  ON trips FOR ALL
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
