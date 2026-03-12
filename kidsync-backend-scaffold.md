# KidSync — Full Supabase Backend Scaffold

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        FRONTEND                               │
│                  Next.js / React App                          │
│          (Auth via @supabase/auth-helpers-nextjs)             │
└──────────────┬────────────────────────┬──────────────────────┘
               │                        │
               ▼                        ▼
┌──────────────────────┐  ┌──────────────────────────────────┐
│   Supabase Auth      │  │   Supabase Realtime              │
│   (Magic Link /      │  │   (Live updates when other       │
│    Email+Password)   │  │    parent makes changes)         │
└──────────┬───────────┘  └──────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│                    SUPABASE POSTGRES                          │
│                                                              │
│   families ──< profiles ──< calendar_events                  │
│                               │                              │
│                               ├──< event_travel_details      │
│                               └──< event_change_log          │
│                                                              │
│   RLS: Both parents in same family can CRUD all events       │
│                                                              │
│   TRIGGERS:                                                  │
│     on calendar_events INSERT/UPDATE/DELETE                   │
│       → log to event_change_log                              │
│       → call Edge Function via pg_net for email              │
└──────────────────────────────────────────────────────────────┘
               │                        │
               ▼                        ▼
┌──────────────────────┐  ┌──────────────────────────────────┐
│  Edge Function:      │  │  Edge Function:                  │
│  notify-parent       │  │  ical-feed                       │
│  (sends email via    │  │  (returns .ics at                │
│   Resend on change)  │  │   /ical/:userId?token=...)       │
└──────────────────────┘  └──────────────────────────────────┘
```

---

## 1. SQL Migration: Core Schema

```sql
-- ============================================================
-- MIGRATION 001: Core Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "moddatetime" WITH SCHEMA "extensions";

-- ============================================================
-- FAMILIES
-- Links two co-parents together. One row per family unit.
-- ============================================================
CREATE TABLE public.families (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT 'Family',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROFILES
-- Extends Supabase auth.users with app-specific fields.
-- ============================================================
CREATE TABLE public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'parent' CHECK (role IN ('parent', 'viewer')),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_family ON public.profiles(family_id);

-- Auto-update updated_at
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- ============================================================
-- KIDS
-- Each child in the family. Enables per-kid filtering & colors.
-- ============================================================
CREATE TABLE public.kids (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3B82F6',     -- hex for UI
  birth_date  DATE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_kids_family ON public.kids(family_id);

-- ============================================================
-- CALENDAR EVENTS
-- Core event table. Every appointment, exchange, activity.
-- ============================================================
CREATE TYPE event_type AS ENUM (
  'school', 'sports', 'medical', 'birthday',
  'custody', 'activity', 'travel', 'other'
);

CREATE TABLE public.calendar_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  kid_id          UUID NOT NULL REFERENCES public.kids(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  event_type      event_type NOT NULL DEFAULT 'other',
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  all_day         BOOLEAN NOT NULL DEFAULT false,
  location        TEXT,
  notes           TEXT,
  recurring_rule  TEXT,               -- iCal RRULE string (future use)
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_time_range CHECK (ends_at > starts_at)
);

CREATE INDEX idx_events_family     ON public.calendar_events(family_id);
CREATE INDEX idx_events_kid        ON public.calendar_events(kid_id);
CREATE INDEX idx_events_starts_at  ON public.calendar_events(starts_at);
CREATE INDEX idx_events_type       ON public.calendar_events(event_type);

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

---

## 2. SQL Migration: Travel & Logistics Details

This is the refined travel model. Instead of cramming everything into the events table, we use a dedicated `event_travel_details` table that's 1:1 with any event marked as `travel` type (or optionally attached to any event that involves travel).

```sql
-- ============================================================
-- MIGRATION 002: Travel & Logistics Details
-- ============================================================

-- ============================================================
-- EVENT TRAVEL DETAILS
-- Attached to any calendar_event that involves travel.
-- Covers: flights, lodging, emergency contacts, documents.
--
-- Design rationale:
--   - Separate table keeps calendar_events lean for the 90%
--     of events that don't involve travel
--   - JSONB arrays for flights/legs allow multi-segment trips
--     (connecting flights, round trips) without extra tables
--   - Emergency contact is per-trip, not per-family, because
--     it changes based on who's traveling and where
-- ============================================================

CREATE TABLE public.event_travel_details (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL UNIQUE REFERENCES public.calendar_events(id) ON DELETE CASCADE,

  -- ── LODGING ──────────────────────────────────────────────
  lodging_name        TEXT,               -- "Marriott Residence Inn"
  lodging_address     TEXT,               -- Full address
  lodging_phone       TEXT,               -- Hotel front desk
  lodging_confirmation TEXT,              -- Confirmation #
  lodging_check_in    TIMESTAMPTZ,
  lodging_check_out   TIMESTAMPTZ,
  lodging_notes       TEXT,               -- "Room block under Smith"

  -- ── FLIGHTS / TRANSPORT ──────────────────────────────────
  -- JSONB array allows multiple legs:
  -- [
  --   {
  --     "leg": 1,
  --     "direction": "outbound",
  --     "carrier": "United",
  --     "flight_number": "UA 1234",
  --     "departure_airport": "DCA",
  --     "arrival_airport": "MCI",
  --     "departure_time": "2026-03-15T08:30:00Z",
  --     "arrival_time": "2026-03-15T10:45:00Z",
  --     "confirmation": "ABC123",
  --     "seat": "12A",
  --     "notes": "Ethan has window seat"
  --   },
  --   {
  --     "leg": 2,
  --     "direction": "return",
  --     "carrier": "United",
  --     "flight_number": "UA 5678",
  --     ...
  --   }
  -- ]
  flights             JSONB DEFAULT '[]'::jsonb,

  -- ── GROUND TRANSPORT ─────────────────────────────────────
  -- Car rental, shuttle, etc.
  ground_transport    JSONB DEFAULT '[]'::jsonb,
  -- [
  --   {
  --     "type": "rental_car",
  --     "company": "Enterprise",
  --     "confirmation": "XYZ789",
  --     "pickup_location": "MCI Airport",
  --     "pickup_time": "2026-03-15T11:00:00Z",
  --     "dropoff_time": "2026-03-18T09:00:00Z",
  --     "notes": "Car seat reserved"
  --   }
  -- ]

  -- ── EMERGENCY CONTACT (trip-specific) ────────────────────
  emergency_name      TEXT,               -- "Grandma Jane"
  emergency_phone     TEXT,
  emergency_relation  TEXT,               -- "Maternal grandmother"
  emergency_notes     TEXT,               -- "Staying nearby at..."

  -- ── DOCUMENTS & IDS ──────────────────────────────────────
  -- Track what documents are needed/packed
  -- [
  --   {
  --     "type": "passport",
  --     "for": "Ethan",
  --     "number_last4": "4521",
  --     "expiry": "2029-06-15",
  --     "status": "packed"
  --   },
  --   {
  --     "type": "insurance_card",
  --     "for": "Harrison",
  --     "carrier": "Tricare",
  --     "status": "in_wallet"
  --   },
  --   {
  --     "type": "custody_order",
  --     "notes": "Travel consent letter signed",
  --     "status": "packed"
  --   }
  -- ]
  documents           JSONB DEFAULT '[]'::jsonb,

  -- ── DESTINATION INFO ─────────────────────────────────────
  destination_address TEXT,               -- Where you're actually going
  destination_phone   TEXT,               -- Contact at destination
  destination_notes   TEXT,               -- "Pool has no lifeguard"

  -- ── PACKING / CHECKLIST ──────────────────────────────────
  -- Optional structured checklist
  -- [
  --   { "item": "Car seat", "packed": true },
  --   { "item": "Medication (inhaler)", "packed": false },
  --   { "item": "Favorite blanket", "packed": true }
  -- ]
  packing_checklist   JSONB DEFAULT '[]'::jsonb,

  -- ── META ──────────────────────────────────────────────────
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_travel_event ON public.event_travel_details(event_id);

CREATE TRIGGER travel_updated_at
  BEFORE UPDATE ON public.event_travel_details
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
```

---

## 3. SQL Migration: Change Log & Notification Trigger

```sql
-- ============================================================
-- MIGRATION 003: Change Log & Notification Trigger
-- ============================================================

-- ============================================================
-- EVENT CHANGE LOG
-- Audit trail: who changed what, when. Powers the activity
-- feed and email notification content.
-- ============================================================
CREATE TABLE public.event_change_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  family_id   UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changed_by  UUID NOT NULL REFERENCES auth.users(id),
  changes     JSONB,               -- { field: { old: x, new: y } }
  event_snapshot JSONB,            -- Full event at time of change
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_changelog_family ON public.event_change_log(family_id);
CREATE INDEX idx_changelog_event  ON public.event_change_log(event_id);
CREATE INDEX idx_changelog_time   ON public.event_change_log(created_at DESC);

-- ============================================================
-- TRIGGER FUNCTION: Log changes + fire email notification
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_event_change()
RETURNS TRIGGER AS $$
DECLARE
  v_action      TEXT;
  v_event       RECORD;
  v_family_id   UUID;
  v_changed_by  UUID;
  v_snapshot    JSONB;
BEGIN
  -- Determine action type
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_event := NEW;
    v_family_id := NEW.family_id;
    v_changed_by := NEW.created_by;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated';
    v_event := NEW;
    v_family_id := NEW.family_id;
    v_changed_by := COALESCE(NEW.updated_by, NEW.created_by);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_event := OLD;
    v_family_id := OLD.family_id;
    v_changed_by := OLD.updated_by;  -- Set before deleting in app code
  END IF;

  -- Build snapshot
  v_snapshot := to_jsonb(v_event);

  -- Insert change log
  INSERT INTO public.event_change_log
    (event_id, family_id, action, changed_by, event_snapshot)
  VALUES
    (v_event.id, v_family_id, v_action, v_changed_by, v_snapshot);

  -- Fire Edge Function for email notification via pg_net
  -- The Edge Function URL is your Supabase project's function endpoint
  PERFORM net.http_post(
    url := current_setting('app.settings.notify_function_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'action', v_action,
      'event', v_snapshot,
      'family_id', v_family_id::text,
      'changed_by', v_changed_by::text
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger
CREATE TRIGGER on_event_change
  AFTER INSERT OR UPDATE OR DELETE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_event_change();
```

---

## 4. SQL Migration: Row Level Security

```sql
-- ============================================================
-- MIGRATION 004: Row Level Security Policies
-- ============================================================

ALTER TABLE public.families            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kids                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_travel_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_change_log    ENABLE ROW LEVEL SECURITY;

-- ── Helper: Get current user's family_id ────────────────────
CREATE OR REPLACE FUNCTION public.get_my_family_id()
RETURNS UUID AS $$
  SELECT family_id FROM public.profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── FAMILIES ────────────────────────────────────────────────
CREATE POLICY "Users can view own family"
  ON public.families FOR SELECT
  USING (id = public.get_my_family_id());

-- ── PROFILES ────────────────────────────────────────────────
CREATE POLICY "Users can view family members"
  ON public.profiles FOR SELECT
  USING (family_id = public.get_my_family_id());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── KIDS ────────────────────────────────────────────────────
CREATE POLICY "Family members can view kids"
  ON public.kids FOR SELECT
  USING (family_id = public.get_my_family_id());

CREATE POLICY "Parents can manage kids"
  ON public.kids FOR ALL
  USING (family_id = public.get_my_family_id())
  WITH CHECK (family_id = public.get_my_family_id());

-- ── CALENDAR EVENTS ─────────────────────────────────────────
-- Both parents can do everything within their family
CREATE POLICY "Family members can view events"
  ON public.calendar_events FOR SELECT
  USING (family_id = public.get_my_family_id());

CREATE POLICY "Family members can create events"
  ON public.calendar_events FOR INSERT
  WITH CHECK (
    family_id = public.get_my_family_id()
    AND created_by = auth.uid()
  );

CREATE POLICY "Family members can update events"
  ON public.calendar_events FOR UPDATE
  USING (family_id = public.get_my_family_id())
  WITH CHECK (family_id = public.get_my_family_id());

CREATE POLICY "Family members can delete events"
  ON public.calendar_events FOR DELETE
  USING (family_id = public.get_my_family_id());

-- ── TRAVEL DETAILS ──────────────────────────────────────────
-- Access follows the parent event's family_id
CREATE POLICY "Family members can view travel details"
  ON public.event_travel_details FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.calendar_events ce
      WHERE ce.id = event_id AND ce.family_id = public.get_my_family_id()
    )
  );

CREATE POLICY "Family members can manage travel details"
  ON public.event_travel_details FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.calendar_events ce
      WHERE ce.id = event_id AND ce.family_id = public.get_my_family_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.calendar_events ce
      WHERE ce.id = event_id AND ce.family_id = public.get_my_family_id()
    )
  );

-- ── CHANGE LOG ──────────────────────────────────────────────
CREATE POLICY "Family members can view change log"
  ON public.event_change_log FOR SELECT
  USING (family_id = public.get_my_family_id());
```

---

## 5. Edge Function: `notify-parent`

Save as `supabase/functions/notify-parent/index.ts`:

```typescript
// supabase/functions/notify-parent/index.ts
//
// Triggered by pg_net from the Postgres trigger whenever
// a calendar event is created, updated, or deleted.
// Sends an email to the OTHER parent in the family.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "KidSync <notifications@yourdomain.com>";

serve(async (req) => {
  try {
    const { action, event, family_id, changed_by } = await req.json();

    // Initialize Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get all family members except the one who made the change
    const { data: recipients } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("family_id", family_id)
      .neq("id", changed_by);

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ message: "No recipients" }), {
        status: 200,
      });
    }

    // Get the actor's name
    const { data: actor } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", changed_by)
      .single();

    // Get kid name
    const { data: kid } = await supabase
      .from("kids")
      .select("name")
      .eq("id", event.kid_id)
      .single();

    // Build email content
    const actionVerb = {
      created: "added a new event",
      updated: "updated an event",
      deleted: "removed an event",
    }[action] || "changed an event";

    const eventDate = new Date(event.starts_at).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const subject = `KidSync: ${actor?.full_name} ${actionVerb} for ${kid?.name}`;

    const htmlBody = `
      <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto;">
        <div style="background: #1E293B; padding: 24px; border-radius: 12px;">
          <h2 style="color: #F8FAFC; margin: 0 0 4px 0;">📅 KidSync Update</h2>
          <p style="color: #94A3B8; margin: 0 0 20px 0; font-size: 14px;">
            ${actor?.full_name} ${actionVerb}
          </p>

          <div style="background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px; border-left: 4px solid #3B82F6;">
            <h3 style="color: #F8FAFC; margin: 0 0 8px 0;">${event.title}</h3>
            <p style="color: #94A3B8; margin: 0; font-size: 14px;">
              👤 ${kid?.name}<br/>
              📅 ${eventDate}<br/>
              ${event.location ? `📍 ${event.location}<br/>` : ""}
              ${event.notes ? `📝 ${event.notes}` : ""}
            </p>
          </div>

          <a href="https://yourdomain.com/calendar"
             style="display: inline-block; margin-top: 20px; padding: 10px 20px;
                    background: #3B82F6; color: #fff; border-radius: 8px;
                    text-decoration: none; font-weight: 600; font-size: 14px;">
            View Calendar →
          </a>
        </div>
      </div>
    `;

    // Send via Resend
    for (const recipient of recipients) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipient.email,
          subject,
          html: htmlBody,
        }),
      });
    }

    return new Response(
      JSON.stringify({ message: `Notified ${recipients.length} recipient(s)` }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Notification error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});
```

---

## 6. Edge Function: `ical-feed`

Save as `supabase/functions/ical-feed/index.ts`:

```typescript
// supabase/functions/ical-feed/index.ts
//
// Returns an iCal feed (.ics) for a user's family calendar.
// Subscribe to this URL from Apple Calendar, Google Calendar, Outlook, etc.
//
// URL: /ical-feed?token=<user_ical_token>&kid=<optional_kid_id>

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function toICalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcal(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const kidFilter = url.searchParams.get("kid");

    if (!token) {
      return new Response("Missing token", { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Look up user by their ical token (stored in profiles)
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, family_id, full_name")
      .eq("ical_token", token)
      .single();

    if (!profile) {
      return new Response("Invalid token", { status: 401 });
    }

    // Fetch events for this family (last 6 months + next 12 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    let query = supabase
      .from("calendar_events")
      .select(`
        *,
        kid:kids(name),
        travel:event_travel_details(*)
      `)
      .eq("family_id", profile.family_id)
      .gte("starts_at", sixMonthsAgo.toISOString())
      .order("starts_at", { ascending: true });

    if (kidFilter) {
      query = query.eq("kid_id", kidFilter);
    }

    const { data: events } = await query;

    // Build iCal
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//KidSync//Co-Parent Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:KidSync Calendar",
      "X-WR-TIMEZONE:America/New_York",
    ];

    for (const evt of events || []) {
      const kidName = evt.kid?.name || "Unknown";
      const start = new Date(evt.starts_at);
      const end = new Date(evt.ends_at);

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${evt.id}@kidsync`);
      lines.push(`DTSTART:${toICalDate(start)}`);
      lines.push(`DTEND:${toICalDate(end)}`);
      lines.push(`SUMMARY:[${escapeIcal(kidName)}] ${escapeIcal(evt.title)}`);

      // Build rich description with travel details if present
      let description = "";
      if (evt.notes) description += evt.notes;

      if (evt.travel && evt.travel.length > 0) {
        const t = evt.travel[0];
        if (t.lodging_name) {
          description += `\\n\\nLODGING: ${t.lodging_name}`;
          if (t.lodging_address) description += `\\n${t.lodging_address}`;
          if (t.lodging_phone) description += `\\nPhone: ${t.lodging_phone}`;
          if (t.lodging_confirmation) description += `\\nConf#: ${t.lodging_confirmation}`;
        }
        if (t.flights) {
          try {
            const flights = typeof t.flights === "string" ? JSON.parse(t.flights) : t.flights;
            for (const f of flights) {
              description += `\\n\\nFLIGHT: ${f.carrier} ${f.flight_number}`;
              description += `\\n${f.departure_airport} → ${f.arrival_airport}`;
              if (f.departure_time) description += `\\nDeparts: ${new Date(f.departure_time).toLocaleString()}`;
              if (f.confirmation) description += `\\nConf#: ${f.confirmation}`;
            }
          } catch {}
        }
        if (t.emergency_name) {
          description += `\\n\\nEMERGENCY: ${t.emergency_name} ${t.emergency_phone || ""}`;
        }
      }

      if (description) lines.push(`DESCRIPTION:${escapeIcal(description)}`);
      if (evt.location) lines.push(`LOCATION:${escapeIcal(evt.location)}`);
      lines.push(`LAST-MODIFIED:${toICalDate(new Date(evt.updated_at))}`);
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");

    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="kidsync.ics"',
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("iCal feed error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
```

---

## 7. Seed Data Script

```sql
-- ============================================================
-- SEED: Set up Patrick's family for development
-- Run AFTER creating two auth users via Supabase dashboard
-- Replace the UUIDs with your actual auth.users IDs
-- ============================================================

-- Create family
INSERT INTO public.families (id, name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'The Family');

-- Create profiles (replace UUIDs with your Supabase auth user IDs)
INSERT INTO public.profiles (id, family_id, full_name, email, ical_token) VALUES
  ('REPLACE_WITH_PATRICK_AUTH_ID',   'aaaaaaaa-0000-0000-0000-000000000001', 'Patrick',   'patrick@example.com',   'ical_patrick_token_abc123'),
  ('REPLACE_WITH_COPARENT_AUTH_ID',  'aaaaaaaa-0000-0000-0000-000000000001', 'Co-Parent', 'coparent@example.com',  'ical_coparent_token_def456');

-- Create kids
INSERT INTO public.kids (id, family_id, name, color, birth_date) VALUES
  ('kid-ethan-001',    'aaaaaaaa-0000-0000-0000-000000000001', 'Ethan',    '#3B82F6', '2022-03-20'),
  ('kid-harrison-001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Harrison', '#F59E0B', NULL);

-- Sample events
INSERT INTO public.calendar_events
  (family_id, kid_id, title, event_type, starts_at, ends_at, location, notes, created_by)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'kid-ethan-001', 'Soccer Practice', 'sports',
   '2026-03-10 16:00:00-05', '2026-03-10 17:30:00-05',
   'Burke Lake Park Field 3', 'Bring shin guards', 'REPLACE_WITH_PATRICK_AUTH_ID'),

  ('aaaaaaaa-0000-0000-0000-000000000001', 'kid-harrison-001', 'Pediatrician Checkup', 'medical',
   '2026-03-14 10:00:00-05', '2026-03-14 11:00:00-05',
   'Dr. Thompson - Inova Pediatrics', 'Annual wellness visit', 'REPLACE_WITH_COPARENT_AUTH_ID');

-- Sample travel event with details
WITH travel_event AS (
  INSERT INTO public.calendar_events
    (id, family_id, kid_id, title, event_type, starts_at, ends_at, location, notes, created_by)
  VALUES
    ('evt-travel-001', 'aaaaaaaa-0000-0000-0000-000000000001', 'kid-ethan-001',
     'Spring Break - KC Visit', 'travel',
     '2026-03-28 06:00:00-05', '2026-04-02 20:00:00-05',
     'Kansas City, MO', 'Visiting grandparents', 'REPLACE_WITH_PATRICK_AUTH_ID')
  RETURNING id
)
INSERT INTO public.event_travel_details
  (event_id, lodging_name, lodging_address, lodging_phone,
   flights, emergency_name, emergency_phone, emergency_relation,
   documents, packing_checklist)
VALUES
  ('evt-travel-001',
   'Grandma & Grandpa''s House', '123 Oak St, Overland Park, KS 66204', '(913) 555-0100',
   '[
     {"leg":1,"direction":"outbound","carrier":"Southwest","flight_number":"WN 1842","departure_airport":"DCA","arrival_airport":"MCI","departure_time":"2026-03-28T08:30:00-05:00","arrival_time":"2026-03-28T10:45:00-05:00","confirmation":"SW8K2M","seat":"","notes":"Window seat requested"},
     {"leg":2,"direction":"return","carrier":"Southwest","flight_number":"WN 2215","departure_airport":"MCI","arrival_airport":"DCA","departure_time":"2026-04-02T17:00:00-05:00","arrival_time":"2026-04-02T20:15:00-05:00","confirmation":"SW8K2M","seat":"","notes":""}
   ]'::jsonb,
   'Grandma Jane', '(913) 555-0100', 'Paternal grandmother',
   '[
     {"type":"birth_certificate","for":"Ethan","status":"packed"},
     {"type":"insurance_card","for":"Ethan","carrier":"Tricare","status":"in_wallet"},
     {"type":"travel_consent","notes":"Signed consent letter for air travel","status":"packed"}
   ]'::jsonb,
   '[
     {"item":"Car seat","packed":false},
     {"item":"Medication","packed":false},
     {"item":"Favorite blanket","packed":false},
     {"item":"iPad + charger","packed":false},
     {"item":"Extra clothes (5 days)","packed":false}
   ]'::jsonb
  );
```

---

## 8. Environment Setup Checklist

```bash
# .env.local (for Next.js frontend)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Supabase project settings → Edge Functions → Secrets
RESEND_API_KEY=re_xxxxxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Supabase SQL config (run in SQL editor)
ALTER DATABASE postgres SET app.settings.notify_function_url = 'https://your-project.supabase.co/functions/v1/notify-parent';
ALTER DATABASE postgres SET app.settings.service_role_key = 'eyJ...your-service-role-key';

# Add ical_token column to profiles (if not in migration)
ALTER TABLE public.profiles ADD COLUMN ical_token TEXT UNIQUE;
```

---

## 9. Project Structure

```
kidsync/
├── supabase/
│   ├── migrations/
│   │   ├── 001_core_schema.sql
│   │   ├── 002_travel_details.sql
│   │   ├── 003_change_log.sql
│   │   └── 004_rls_policies.sql
│   ├── functions/
│   │   ├── notify-parent/
│   │   │   └── index.ts
│   │   └── ical-feed/
│   │       └── index.ts
│   ├── seed.sql
│   └── config.toml
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx           ← Calendar view
│   │   ├── login/page.tsx     ← Auth
│   │   └── event/[id]/page.tsx ← Event detail + travel
│   ├── components/
│   │   ├── Calendar.tsx
│   │   ├── EventModal.tsx
│   │   ├── TravelDetails.tsx  ← Flight/lodging/docs form
│   │   ├── ActivityFeed.tsx
│   │   └── KidFilter.tsx
│   ├── lib/
│   │   ├── supabase.ts        ← Client init
│   │   ├── types.ts           ← TypeScript types from schema
│   │   └── ical.ts            ← Client-side iCal generation
│   └── hooks/
│       ├── useEvents.ts       ← CRUD + realtime subscription
│       ├── useFamily.ts
│       └── useTravelDetails.ts
├── .env.local
├── package.json
└── README.md
```
