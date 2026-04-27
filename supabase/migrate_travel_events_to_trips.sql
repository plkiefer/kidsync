-- ============================================================
-- Hard migration: travel calendar_events → trips + segments
-- ------------------------------------------------------------
-- Phase 0 of the Travel + Trips plan (docs/travel-trips-plan.md).
-- Run AFTER the three schema migrations in this order:
--   1. add_trips_table.sql
--   2. add_segment_columns.sql
--   3. add_override_trip_link.sql
--   4. (this file)
--
-- BEFORE RUNNING: take a database snapshot. This script transforms
-- every existing calendar_event with event_type='travel' by:
--   1. Creating a Trip from the event metadata.
--   2. Creating a Lodging segment from event_travel_details lodging
--      fields (if present).
--   3. Creating one Flight segment per item in
--      event_travel_details.flights (if present).
--   4. Deleting the original calendar_event row (it's now decomposed
--      into segments — keeping it would create a phantom event with
--      no segment_type that doesn't fit any rendering path).
--
-- ground_transport, documents, packing_checklist, emergency_*, and
-- destination_* fields are NOT migrated — they're out of scope for
-- v1 per the plan and there's no UI to read them yet. They remain
-- in event_travel_details rows whose parent event has been deleted;
-- run a final cleanup of orphaned event_travel_details rows after
-- verifying the migration looked right.
--
-- Idempotency: this script runs once. Re-running would create
-- duplicate trips. Don't re-run.
-- ============================================================

DO $$
DECLARE
  e         RECORD;
  flight    JSONB;
  new_trip  UUID;
  fcount    INTEGER;
BEGIN
  FOR e IN
    SELECT
      ce.id              AS event_id,
      ce.family_id,
      ce.kid_id,
      ce.kid_ids,
      ce.title,
      ce.starts_at,
      ce.ends_at,
      ce.notes,
      ce.time_zone,
      ce.created_by,
      ce.updated_by,
      ce.created_at,
      ce.updated_at,
      etd.lodging_name,
      etd.lodging_address,
      etd.lodging_phone,
      etd.lodging_confirmation,
      etd.lodging_check_in,
      etd.lodging_check_out,
      etd.flights
    FROM calendar_events ce
    LEFT JOIN event_travel_details etd ON etd.event_id = ce.id
    WHERE ce.event_type = 'travel'
  LOOP
    -- 1. Create the Trip
    INSERT INTO trips (
      family_id, title, trip_type,
      starts_at, ends_at,
      kid_ids, member_ids, guests,
      status, notes,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      e.family_id,
      COALESCE(NULLIF(e.title, ''), 'Untitled trip'),
      'vacation',
      e.starts_at,
      e.ends_at,
      COALESCE(e.kid_ids, ARRAY[e.kid_id]),
      ARRAY[e.created_by]::UUID[],   -- creator is implicitly on the trip
      '[]'::JSONB,
      'planned',                      -- existing events are real, not drafts
      e.notes,
      e.created_by,
      e.updated_by,
      e.created_at,
      e.updated_at
    )
    RETURNING id INTO new_trip;

    -- 2. Lodging segment (if any lodging info exists)
    IF e.lodging_name IS NOT NULL OR e.lodging_address IS NOT NULL THEN
      INSERT INTO calendar_events (
        family_id, kid_id, kid_ids,
        title, event_type, all_day,
        starts_at, ends_at, time_zone,
        notes,
        trip_id, segment_type, segment_data,
        member_ids, guest_ids,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        e.family_id,
        e.kid_id,
        COALESCE(e.kid_ids, ARRAY[e.kid_id]),
        COALESCE(NULLIF(e.lodging_name, ''), 'Lodging'),
        'travel',
        FALSE,
        COALESCE(e.lodging_check_in, e.starts_at),
        COALESCE(e.lodging_check_out, e.ends_at),
        e.time_zone,
        NULL,
        new_trip,
        'lodging',
        jsonb_build_object(
          'name',          COALESCE(e.lodging_name, ''),
          'address',       COALESCE(e.lodging_address, ''),
          'phone',         COALESCE(e.lodging_phone, ''),
          'confirmation',  COALESCE(e.lodging_confirmation, ''),
          'city',          '',
          'state',         '',
          'country',       ''
        ),
        ARRAY[]::UUID[],
        ARRAY[]::TEXT[],
        e.created_by,
        e.updated_by,
        e.created_at,
        e.updated_at
      );
    END IF;

    -- 3. Flight segments (one per FlightLeg in flights[])
    IF e.flights IS NOT NULL AND jsonb_typeof(e.flights) = 'array' THEN
      fcount := 0;
      FOR flight IN SELECT * FROM jsonb_array_elements(e.flights)
      LOOP
        fcount := fcount + 1;
        -- Skip empty leg objects produced by partially-filled forms
        IF (flight->>'departure_airport') IS NULL
           AND (flight->>'arrival_airport') IS NULL
           AND (flight->>'departure_time') IS NULL THEN
          CONTINUE;
        END IF;

        INSERT INTO calendar_events (
          family_id, kid_id, kid_ids,
          title, event_type, all_day,
          starts_at, ends_at,
          notes,
          trip_id, segment_type, segment_data,
          member_ids, guest_ids,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          e.family_id,
          e.kid_id,
          COALESCE(e.kid_ids, ARRAY[e.kid_id]),
          TRIM(BOTH FROM
            CONCAT_WS(' ',
              NULLIF(flight->>'carrier', ''),
              NULLIF(flight->>'flight_number', ''),
              CASE
                WHEN flight->>'departure_airport' IS NOT NULL
                  AND flight->>'arrival_airport' IS NOT NULL
                THEN CONCAT(flight->>'departure_airport', ' → ', flight->>'arrival_airport')
                ELSE NULL
              END
            )
          ),
          'travel',
          FALSE,
          COALESCE((flight->>'departure_time')::TIMESTAMPTZ, e.starts_at),
          COALESCE((flight->>'arrival_time')::TIMESTAMPTZ, e.ends_at),
          NULLIF(flight->>'notes', ''),
          new_trip,
          'flight',
          jsonb_build_object(
            'carrier',             COALESCE(flight->>'carrier', ''),
            'flight_number',       COALESCE(flight->>'flight_number', ''),
            'departure_airport',   COALESCE(flight->>'departure_airport', ''),
            'arrival_airport',     COALESCE(flight->>'arrival_airport', ''),
            'departure_terminal',  flight->>'departure_terminal',
            'arrival_terminal',    flight->>'arrival_terminal',
            'departure_timezone',  flight->>'departure_timezone',
            'arrival_timezone',    flight->>'arrival_timezone',
            'confirmation',        COALESCE(flight->>'confirmation', ''),
            'seats',               CASE
                                     WHEN NULLIF(flight->>'seat', '') IS NOT NULL
                                     THEN jsonb_build_array(flight->>'seat')
                                     ELSE '[]'::JSONB
                                   END
          ),
          ARRAY[]::UUID[],
          ARRAY[]::TEXT[],
          e.created_by,
          e.updated_by,
          e.created_at,
          e.updated_at
        );
      END LOOP;
    END IF;

    -- 4. Delete the original wrapper event
    DELETE FROM calendar_events WHERE id = e.event_id;

    RAISE NOTICE 'Migrated event % → trip % (% flights)',
      e.event_id, new_trip, COALESCE(fcount, 0);
  END LOOP;
END $$;

-- Optional cleanup (run only after eyeballing the migration):
-- DELETE FROM event_travel_details
--  WHERE event_id NOT IN (SELECT id FROM calendar_events);
