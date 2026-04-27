# Travel + Trips — Plan Document

**Status:** all 6 phases shipped to `main` 2026-04-27. Tip is `f9844b9`.
This doc remains the source of truth for *what* we built — if a future
change diverges, update this doc first.

See **§ 0a Session handoff** below for the recap a fresh session needs:
exact commits per phase, the one DB migration that still needs to be
run by the user, and what to test next.

---

## 0a. Session handoff (2026-04-27)

The conversation that produced all this hit context limits and was
compacted. This section is the breadcrumb trail so the next session
can pick up cold.

### What's done

All six phases in § 12 are committed on `main`. Tip: `f9844b9`. Phase-by-phase commits:

| Phase | Commit(s) | What landed |
|---|---|---|
| 0 — schema + types | `e478470` | trips table, segment columns on calendar_events, custody override link column, types.ts updates, hard-migration SQL |
| 1 — trip lifecycle | `d59573c`, `06d1bf1`, `13c80ee`, `9cbfb66` | useTrips hook, TripCreationModal, TripView shell, Stays section + LodgingForm, city-grouped stay ribbons in MonthView, /trips list page |
| 2 — transport + custody | `ca04977`, `1854f88` | TransportForm (flight/drive/train/ferry), drive chain shortcut, CustodySection, TripOverrideProposalModal with ±1-day stepper, override↔trip linkage |
| 3 — cruise | `b607853`, `09aaee6` | CruiseForm with structured cabins + port stops, two-ribbon cruise rendering, PortStopPopover |
| 4 — comms | `6f5ce53`, `82e6497` | tripValidation.ts advisory warnings, notification triggers on structural trip/segment changes |
| 5 — iCal + files | `d201756`, `4c67b3e` | trip-level + per-segment file attachments, segment-aware iCal emission with VTIMEZONE, per-segment emoji |
| 6 — polish | `f9844b9` | mobile bottom-sheet styling on all 7 trip modals, trip search on /trips, empty-state copy fixes |

### One thing the user still needs to do

Run this against the production Supabase project before testing
trip-level file attachments — Phase 5 (chunk 1) added the column to
`supabase/add_trip_attachments.sql` but the migration is not auto-applied:

```sql
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
```

(Per-segment attachments work without this — they piggyback on
`calendar_events.attachments` which already exists. Only the trip-level
"Files" tab in TripView needs this column.)

The other Phase-0/1/2/3 SQL migrations (`add_trips_table.sql`,
`add_segment_columns.sql`, `add_override_trip_link.sql`,
`migrate_travel_events_to_trips.sql`) were run when those phases shipped.
If you're picking this up against a fresh DB, run all five in order.

### Where to start testing

User has real travel coming up (the reason for the whole redesign).
Concrete things to exercise end-to-end:

1. **Create a trip** from "+ New event" → "Travel" pill → trip-creation modal.
2. **Add a stay** with city + dates → confirm the city-grouped ribbon shows on month view.
3. **Add a multi-leg flight** with different departure / arrival timezones → confirm pills render in correct local time.
4. **Add a drive** then click "Save & next leg" → confirm the from-location prefills.
5. **Trip with a custody conflict** → "Propose override" enables → ±1-day stepper works → override creates and links via `created_from_trip_id`.
6. **Cruise** with port stops → two-ribbon rendering, port-stop ribbon click → popover.
7. **Trip-level file attachment** (after running the migration above).
8. **Subscribe to iCal feed** and confirm segments show up with correct timezones (lodging = all-day multi-day, flights/drives = timed UTC events).
9. **Mobile** (≤ 640px): all seven modals should stick to the bottom edge of the viewport.
10. **Edit then change trip dates after override approval** → conflict warning should surface.

### Deviations from plan

A handful of small things diverged during build; document them so we don't get confused later.

- **Per-segment forms collapsed.** Plan § 14 listed `LodgingForm`, `FlightForm`, `DriveForm`, `TrainForm`, `FerryForm` as separate files. We shipped `LodgingForm.tsx` + a single shared `TransportForm.tsx` that branches on type internally. Less duplication, same UX.
- **Smart batching deferred.** Plan § 8.2 calls for collapsing notifications within a 5-minute window into a single email. We wired the trigger calls but did not implement batching — every structural change still fires one email. Out of scope for v1; user can ask for batching as a follow-up.
- **City picker is free-text.** Plan § 13 flagged this as a deferred decision; v1 stayed free-text (no geocoding).
- **Activity log granularity:** one entry per change (not per "edit session"). This was the simpler path; revisit if it proves noisy.

### What's explicitly out of v1 (do not start without confirmation)

Per § 11 of this doc — listed here just so the next session doesn't
accidentally sweep them in:

- Activities, dining, packing lists
- International-travel approval workflow
- Recurring trips
- External sharing (non-app guests)
- Real-time travel tracking, push notifications
- Smart notification batching (see deviation note above)

If the user asks for any of these, do another short interview and add a
new section to this doc — don't extend Phase 6 in place.

### File index for fresh context

The key files a new session will need to read to make changes:

- `src/lib/types.ts` — Trip / segment discriminated union + type guards
- `src/lib/tripCustody.ts` — conflict detection + 15-day-window check
- `src/lib/tripValidation.ts` — advisory warnings
- `src/hooks/useTrips.ts` — trip CRUD + attachment helpers
- `src/hooks/useEvents.ts` — `createSegment` / `updateSegment` paths
- `src/components/TripView.tsx` — main editing surface (large)
- `src/components/TripCreationModal.tsx` — minimal create form
- `src/components/LodgingForm.tsx`, `TransportForm.tsx`, `CruiseForm.tsx` — segment editors
- `src/components/PortStopPopover.tsx`, `TripOverrideProposalModal.tsx`
- `src/components/MonthView.tsx` — `deriveStayRibbonEvents` + `deriveCruiseRibbonEvents`
- `src/app/trips/page.tsx` — list + search
- `src/app/calendar/page.tsx` — modal wiring + click router
- `src/app/api/ical/route.ts` — segment-aware emission
- `supabase/*.sql` — five migrations listed above

---

## 0. Operating principles

These came out of the interview and shape every decision below.

1. **Trip is a first-class container.** Title, type, roster, guests. Auto-derives dates from segments. Lives in its own table.
2. **Segments are calendar events.** A lodging, a flight, a cruise — each is a row in `calendar_events` with a `trip_id` and a `segment_type`. The calendar is the source of truth for what shows on the calendar.
3. **Calendar visualization is location-based, not trip-based.** Multi-day stays = ribbons labeled "City, ST". One ribbon per location, regardless of how many lodgings within. Multiple parallel ribbons only when family members are on **different** trips.
4. **The app is for planning + coordination, not tactical updates.** No real-time flight delay tracking. No mid-trip "we're switching hotels" tooling beyond standard editing.
5. **Incremental build.** Trips are filled in over time. Every form accepts partial data. No aggressive required-field validation.
6. **Validation = advisory warnings, never blocking.** Surface inconsistencies in Trip View; never prevent saves.
7. **Creator-only editing.** Co-parent reads + approves overrides. Activity log captures changes.
8. **Override decoupled from trip lifecycle.** Trip auto-proposes the override; once approved, the override has its own life. Cancel-prompt + conflict detection bridge them.

---

## 1. Glossary

| Term | Definition |
|---|---|
| **Trip** | First-class container with title, type, roster, optional guests. Holds segments. |
| **Segment** | A calendar event tied to a trip. Either a Stay (lodging) or a Transport (flight, drive, train, ferry, cruise, cruise port stop, or other). |
| **Stay** | A lodging segment — where someone is sleeping. Multi-day. Renders as a ribbon. |
| **Lodging** | A specific accommodation entry within a stay (Hilton, Marriott, etc.). One stay-day can contain multiple lodgings (e.g., parents at one, grandparents at another, same city). |
| **Transport** | A movement segment — flight, drive, train, ferry, cruise, port stop. Single-day or duration-block. Renders as a regular event or, for cruise + port stops, as ribbons. |
| **Roster** | Who's on the trip. Mix of kids + parents + named guests. |
| **Guest** | Non-family person on the trip. Has name, relationship, contact info. |
| **Override (custody)** | An approved deviation from the default custody schedule. Existing concept; trips can propose new ones. |

---

## 2. Data model

### 2.1 New table: `trips`

```sql
create table trips (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references families(id) on delete cascade,
  title           text not null,
  trip_type       text not null check (trip_type in (
                    'vacation', 'custody_time', 'visit_family',
                    'business', 'other'
                  )) default 'vacation',
  -- Auto-computed from segments. Denormalized for fast querying;
  -- a server-side trigger or app-level recompute keeps it fresh.
  starts_at       timestamptz,
  ends_at         timestamptz,
  -- Trip roster. kid_ids + member_ids + named guests with contact info.
  kid_ids         uuid[] not null default '{}',
  member_ids      uuid[] not null default '{}',
  guests          jsonb  not null default '[]',
  -- Lifecycle
  status          text not null check (status in ('draft', 'planned', 'canceled'))
                  default 'draft',
  notes           text,
  created_by      uuid not null references profiles(id),
  updated_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- index for family scoping (RLS) and date queries
create index trips_family_dates_idx on trips (family_id, starts_at, ends_at);
```

`guests` is jsonb shaped:
```json
[
  {
    "id": "guest_xxxx",        // client-generated stable ID for segment refs
    "name": "Grandma Smith",
    "relationship": "grandmother",
    "phone": "+1 555-1234",
    "email": "grandma@example.com" // optional
  }
]
```

`status`:
- **`draft`** — Patrick is still planning. Visible to Danielle but flagged as draft.
- **`planned`** — Patrick has clicked "Mark as planned" (or proposed an override). Trip is real.
- **`canceled`** — Trip canceled. Stays in DB for history.

### 2.2 New columns on `calendar_events`

```sql
alter table calendar_events
  add column if not exists trip_id uuid references trips(id) on delete cascade,
  add column if not exists segment_type text check (segment_type in (
    'lodging', 'flight', 'drive', 'train', 'ferry',
    'cruise', 'cruise_port_stop', 'other_transport'
  )),
  add column if not exists segment_data jsonb,
  add column if not exists member_ids uuid[] default '{}',
  add column if not exists guest_ids text[] default '{}',
  add column if not exists parent_segment_id uuid references calendar_events(id);
```

- **`trip_id`**: links the segment to its trip. NULL for non-trip events (regular soccer practice, etc.).
- **`segment_type`**: discriminator for the segment.
- **`segment_data`**: jsonb with type-specific fields (see 2.3).
- **`member_ids`**: parents on this segment (for per-leg roster). Adds to existing `kid_ids` field.
- **`guest_ids`**: array of `guest.id` strings from `trips.guests`. Lets us reference guests on segments without duplicating their data.
- **`parent_segment_id`**: only used by cruise port stops to link to the parent cruise segment.

### 2.3 `segment_data` shapes per `segment_type`

#### Lodging
```json
{
  "name": "Hilton Hawaiian Village",
  "address": "2005 Kalia Rd, Honolulu, HI 96815",
  "phone": "+1 808-949-4321",
  "confirmation": "ABC123",
  "city": "Honolulu",
  "state": "HI",
  "country": "USA"
}
```
- `city + state` (or `city + country` for international) drives the ribbon label.
- `starts_at` = check-in datetime. `ends_at` = check-out datetime. `time_zone` = lodging's local zone.

#### Flight
```json
{
  "carrier": "AA",
  "flight_number": "123",
  "departure_airport": "JFK",
  "arrival_airport": "HNL",
  "confirmation": "DEF456",
  "seats": ["12A", "12B", "12C"],
  "departure_terminal": "8",
  "arrival_terminal": "1"
}
```
- `starts_at` = departure UTC. `ends_at` = arrival UTC.
- Two timezones: store `departure_timezone` in segment_data (since `time_zone` on the calendar event applies to one anchor only).

```json
{
  "carrier": "AA",
  "flight_number": "123",
  "departure_airport": "JFK",
  "departure_timezone": "America/New_York",
  "arrival_airport": "HNL",
  "arrival_timezone": "Pacific/Honolulu",
  "confirmation": "DEF456",
  "seats": ["12A","12B","12C"]
}
```

#### Drive
```json
{
  "vehicle_type": "rental_car",
  "vehicle_details": "Hertz Toyota Camry",
  "rental_confirmation": "GH789",
  "from_location": "Bozeman Yellowstone Airport",
  "to_location": "Old Faithful Inn",
  "from_timezone": "America/Denver",
  "to_timezone": "America/Denver"
}
```
- `vehicle_type` ∈ `personal | rental_car | rideshare | other`.
- `starts_at`/`ends_at` = drive start/end. Renders as a duration block.

#### Train
```json
{
  "carrier": "Amtrak",
  "train_number": "Acela 2123",
  "origin_station": "Washington Union Station",
  "destination_station": "New York Penn Station",
  "origin_timezone": "America/New_York",
  "destination_timezone": "America/New_York",
  "confirmation": "JK012",
  "seats": ["car 5, seat 23"]
}
```

#### Ferry
```json
{
  "carrier": "Washington State Ferries",
  "vessel_name": "Cathlamet",
  "origin_terminal": "Seattle (Colman Dock)",
  "destination_terminal": "Bainbridge Island",
  "confirmation": "...",
  "vehicle_aboard": true
}
```

#### Cruise (the body)
```json
{
  "cruise_line": "Royal Caribbean",
  "ship_name": "Allure of the Seas",
  "confirmation": "MN345",
  "embark_port": "Miami, FL",
  "embark_timezone": "America/New_York",
  "disembark_port": "Miami, FL",
  "disembark_timezone": "America/New_York",
  "cabins": [
    { "number": "9012", "occupants_kid_ids": ["uuid"], "occupants_member_ids": ["uuid"], "occupants_guest_ids": [] },
    { "number": "9014", "occupants_kid_ids": [], "occupants_member_ids": [], "occupants_guest_ids": ["guest_xxx"] }
  ]
}
```
- `starts_at` = embarkation datetime UTC. `ends_at` = disembarkation datetime UTC.
- Renders as the **top** ribbon labeled e.g. "Royal Caribbean Allure of the Seas".

#### Cruise port stop
```json
{
  "port": "Cozumel, MX",
  "arrival_timezone": "America/Cancun",
  "departure_timezone": "America/Cancun",
  "tender": false,
  "notes": "All-aboard 4:30pm"
}
```
- `parent_segment_id` → the cruise body.
- `starts_at` = arrival UTC. `ends_at` = departure UTC (same day usually).
- Renders as the **bottom** ribbon below the cruise on calendar; click → port info popover (per 10c).

#### Other transport (catch-all)
```json
{
  "label": "Bus shuttle from airport",
  "from_location": "...",
  "to_location": "...",
  "confirmation": "..."
}
```

### 2.4 New column on `custody_overrides`

```sql
alter table custody_overrides
  add column if not exists created_from_trip_id uuid references trips(id) on delete set null;
```

- Links the override back to the trip that proposed it.
- `on delete set null` keeps the override around even if the trip is deleted (the override might have been used to bake other arrangements).
- The 15e cancellation prompt fires only when this column is non-null.

### 2.5 Deprecated: `event_travel_details`

Existing single-event-with-embedded-flight model. After hard migration (§ 6), this table is read-only; new trips don't write to it. We can drop it after a couple of release cycles.

---

## 3. Calendar visualization

### 3.1 Month view ribbons

- **Stays:** one ribbon per (city, contiguous date range). If two lodgings share a city + dates, ribbon is rendered once (label = city). Color = existing `--travel` event-type color.
- **Cruise:** two stacked ribbons during cruise dates:
  - Top: cruise body, label = ship name (configurable to cruise line).
  - Bottom: current port (only on port-call days; absent on at-sea days).
- **Multi-day transport (e.g., 24-hour drive):** rendered as a regular multi-day ribbon, label = "Drive: X → Y". Edge case; rare.
- **Stacking:** existing greedy slot allocator handles overlap. No new logic needed unless we hit a real-world conflict.

### 3.2 Week / day view

- Lodgings + multi-day cruise: render as full-day blocks at the top of each day column (Outlook-style "all-day" strip).
- Single-day transport (flight, drive, train, ferry): time-grid blocks per their start/end. Duration block (β) per branch 6c.
- Cruise port stops: render at the top alongside lodgings (like Outlook all-day items), label = "Cozumel · 8am–5pm".

### 3.3 Click targets

- **Stay ribbon click:** opens the **Trip View modal** scrolled to the relevant stay.
- **Cruise body ribbon click:** opens the Trip View modal scrolled to the cruise segment.
- **Cruise port-stop ribbon click:** opens a **lightweight popover** with: port, arrival time, departure time, "View trip →" link.
- **Time-grid event click (flight, drive, etc.):** opens Trip View scrolled to that segment.

### 3.4 Ribbon labels (city/state grammar)

| Case | Label |
|---|---|
| Domestic US, in-state stay | "Honolulu, HI" |
| Domestic US, abbreviation when state is part of city name | "Las Vegas, NV" |
| Multiple US states ambiguous (rare) | "Boulder, CO" |
| International | "Tokyo, Japan" or "Paris, France" — full country name |
| Cruise body | Ship name (defaults from cruise_line + ship_name) |
| Port stop | "Cozumel, MX" |

---

## 4. Trip creation flow

### 4.1 Entry

- User clicks **"+ New event"** (existing button).
- Picks **"Travel"** event-type pill.
- The form switches to the trip-creation modal.

### 4.2 Creation modal — minimal fields

```
┌───────────────────────────────────────────┐
│  ⊕  New trip                              │
├───────────────────────────────────────────┤
│  Title                                    │
│  ┌─────────────────────────────────────┐  │
│  │ [e.g. Yellowstone 2026]             │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Type                                     │
│  [vacation] [custody time] [visit]        │
│  [business] [other]                       │
│                                           │
│  Who's going                              │
│  Kids:    [✓ Ethan] [✓ Harrison]         │
│  Parents: [✓ Patrick] [   Danielle]      │
│  Guests:  + Add guest                     │
│                                           │
│  [Cancel]               [Create trip] →   │
└───────────────────────────────────────────┘
```

- No dates yet (auto-derived from segments).
- Creating drops the user into Trip View with no segments yet.

### 4.3 Trip View — empty state

```
┌──────────────────────────────────────────────┐
│  ✕  Yellowstone 2026                          │
│  vacation · Patrick + Ethan + Harrison        │
├──────────────────────────────────────────────┤
│  📍  STAYS                                    │
│                                               │
│      No stays yet                             │
│      [+ Add your first stay]                  │
├──────────────────────────────────────────────┤
│  ✈   TRANSPORTATION                           │
│                                               │
│      No transport yet                         │
│      [+ Add flight] [+ Drive] [+ Train]      │
│      [+ Ferry] [+ Cruise]                     │
├──────────────────────────────────────────────┤
│  ⚖   CUSTODY                                  │
│      No conflict — Patrick has Ethan          │
│      Apr 28-30 by default schedule.           │
│      [Propose override]  ← grayed out         │
├──────────────────────────────────────────────┤
│  📎  FILES                                    │
│      [+ Attach file]                          │
└──────────────────────────────────────────────┘
                                  [Delete trip]
```

### 4.4 Add Stay flow (city first)

1. User clicks **"+ Add stay"**.
2. Modal asks: **"Where?"** Free-text city input with suggestions (browser-based geo? Or just free text v1).
3. User enters dates (check-in / check-out + timezone picker).
4. User can stop here ("save skeleton").
5. Optionally adds lodging details: name, address, phone, confirmation, who's staying here (defaults to trip roster, override per-lodging).
6. To add a second lodging in the same city + dates: from Trip View, click the stay → "+ Add another lodging in this city".

### 4.5 Add Transport flow

1. Click "+ Flight" (or whatever transport type).
2. Form opens with type-specific fields per § 2.3 schemas.
3. Departure + arrival times each get their own timezone (per existing per-leg-tz feature).
4. "Who's on this leg" picker, default = trip roster.
5. Save.
6. **Drive shortcut:** after saving a drive, "+ Add next day's drive" button auto-fills `from_location = previous arrival` and prompts for the next leg.

---

## 5. Trip View design

### 5.1 Sections (in order)

1. **Header** — title (editable), type, roster, guests, status badge (draft / planned / canceled), date range (read-only).
2. **Stays** — grouped by ribbon (city + date range). Within each ribbon, list of lodgings with their details.
3. **Transportation** — chronological list. Each row: type icon, time, label (e.g. "AA 123 · JFK → HNL · 9am EDT"), roster.
4. **Custody implications** — current override state. Propose-override button (grayed when not needed).
5. **Files** — attachments list. Per-segment + trip-level (separated within section).

### 5.2 Editing pattern

- Click any row → opens edit form (modal-on-modal or inline expansion).
- Autosave on blur.
- Delete = trash icon per row.

### 5.3 Validation warnings

Surface as info banners at the top of the relevant section, not blocking:

| Trigger | Warning |
|---|---|
| Lodging starts before any transport arrives in that city | "No arrival transport before lodging starts" |
| Flight arrives Dec 28 11pm but lodging ends Dec 28 | "Lodging ends before flight arrival" |
| Trip extends past approved override window | "Trip extends past approved custody override (see Custody section)" |
| Kid in trip roster but on no transport | "Ethan is on the trip but on no flight/drive/etc." |
| Lodging in city X but no transport reaches city X | "How are you getting to Honolulu? Add a flight or drive" |

### 5.4 Mobile

Trip View modal becomes a bottom sheet on mobile (full-height, scrollable). Sections collapse by default; user expands what they need.

---

## 6. Migration

Hard migrate existing single-event travel events. One-shot SQL:

```sql
-- For every existing travel event:
-- 1. Create a Trip from the event's title, family, kid_ids, dates.
-- 2. Create a Lodging segment if event_travel_details has lodging fields.
-- 3. Create a Flight segment if event_travel_details has flight fields.
-- 4. Update the original event row to point to the new trip and become
--    a Lodging or Flight segment (whichever is more central).
-- 5. Mark trip status = 'planned'.
```

Implementation will be a Postgres function called once. Backups taken first.

Edge cases:
- Travel event with no flight, no lodging → trip with 0 segments. Acceptable.
- Travel event with multi-leg flights (existing FlightLeg array) → multiple Flight segments under the trip.

---

## 7. Custody override workflow

### 7.1 Proposal trigger

- User clicks **"Propose override"** in Trip View's Custody section.
- Button is **grayed out** when the trip's parent already has default custody for all kids in the trip roster during trip dates.
- Button is **enabled** otherwise.

### 7.2 Proposal form

When clicked, opens an override editor pre-populated with:
- **Kids:** all kids in trip roster whose default custody differs from trip's parent.
- **Dates:** trip dates (editable — can shift earlier/later).
- **Parent:** the parent in the trip's roster.
- **Reason:** "Trip: <trip title>" (auto-prefilled, editable).

User adjusts dates if needed (e.g., "Apr 28 because pickup is the day before flight"), submits → goes through existing override approval flow.

The new `created_from_trip_id` column links the override back to this trip.

### 7.3 Lifecycle

- **Trip dates change after override is approved:**
  - If new trip dates ⊆ approved override dates: silent.
  - If new trip dates extend beyond approved override window: surface conflict in Trip View, offer "Re-propose override" button.
- **Trip canceled:**
  - If override was created from this trip (linked): prompt "Also withdraw the custody override? [Yes / No]".
  - If override was created independently: do nothing — user might be canceling just the lodging/transport, not custody arrangement.

---

## 8. Notifications

### 8.1 What triggers a notification

| Action | Email |
|---|---|
| Trip created (transitions from null → draft) | ✓ |
| Trip status changes to `planned` | ✓ |
| Trip status changes to `canceled` | ✓ |
| Trip dates change | ✓ |
| Trip roster changes (kids/parents/guests added or removed) | ✓ |
| Stay added/removed | ✓ |
| Lodging detail edited (address, phone, confirmation) | ✗ (cosmetic) |
| Transport segment added/removed | ✓ |
| Transport time shifts | ✓ |
| Transport detail (flight number, seats, confirmation) | ✗ |
| Override proposed | ✓ (existing) |
| Override approved/denied | ✓ (existing) |
| File attached | ✗ (visible in calendar) |

Pattern: **structural changes notify; detail polish doesn't.**

### 8.2 Mechanism

- Existing email infra (Supabase edge function `notify-parent`).
- Activity log entries (existing).
- **Smart batching:** changes within a 5-minute window collapse into one email summarizing all changes.
- No push notifications in v1.

---

## 9. Trips list page

A new `/trips` route with its own page (NOT modal — this is browse / search).

### 9.1 Layout

```
┌─────────────────────────────────────────────────────┐
│  KidSync   ☰                       [+ New trip]    │
│                                                     │
│  Trips                                              │
│  [All] [Upcoming] [Past] [Canceled]                │
│                                                     │
│  ─── UPCOMING ─────────────────────────────────────  │
│  ✈  Honolulu Christmas             Dec 20-28 2026  │
│     Patrick · Ethan · Harrison      [planned]       │
│                                                     │
│  🚗  Yellowstone Summer              Jul 8-15 2026  │
│     Patrick · Ethan · Harrison      [draft]         │
│                                                     │
│  ─── PAST ─────────────────────────────────────────  │
│  ✈  Italy 2025                     Jun 15-30 2025  │
│     Patrick · Ethan · Harrison      [planned]       │
└─────────────────────────────────────────────────────┘
```

- Click a trip → opens Trip View modal in-place (same modal as from calendar).
- Filter by status (All / Upcoming / Past / Canceled).
- Future: search by destination, type filter.

### 9.2 Nav entry

Add a "Trips" link to the main navigation alongside "Calendar."

---

## 10. iCal export

Each trip segment becomes its own iCal `VEVENT`. The trip itself does NOT get a separate iCal entry — it's a virtual grouping.

- Stays → multi-day all-day events with summary "Hilton Hawaiian Village · Honolulu, HI".
- Flights → timed events with VTIMEZONE for both departure and arrival zones (existing logic extended for per-leg TZ).
- Drives, trains, ferries → timed events.
- Cruise body → multi-day event.
- Cruise port stops → timed events on their day.

`UID` format: `<segment_id>@kidsync` (matches existing pattern). On regenerate, IDs persist so subscribers see updates rather than duplicates.

---

## 11. Out of scope (v1)

Confirmed during interview:

- Activities (sightseeing, hiking, museum visits)
- Dinner reservations / restaurants
- Packing lists
- Documents (passport scans, custody letters) — though file attachments are in scope for confirmations
- Recurring trips (annual vacation, weekly business trip)
- Sharing trips with external people (grandparents who aren't on the app)
- Real-time travel tracking (delays, gate changes)
- Mobile push notifications
- Trip-level approval workflow for international travel (separate from custody override)
- Bus / motorcoach / rideshare segment types (covered by "other transport" catch-all if needed)

---

## 12. Phased rollout

Each phase ships independently and adds visible value. Phase 0 is foundation; 1-3 are required for the user's upcoming travel test; 4-6 are polish.

> **All six phases shipped 2026-04-27.** Commits per phase listed in § 0a. The bullets below are the original scope; some details diverged during build (see § 0a "Deviations from plan").

### Phase 0 — Foundation ✅ `e478470`
- `trips` table migration.
- `calendar_events` new columns (trip_id, segment_type, segment_data, member_ids, guest_ids, parent_segment_id).
- `custody_overrides.created_from_trip_id` column.
- TypeScript type updates: `Trip`, `Segment` (discriminated union by segment_type), updated `CalendarEvent`.
- Hard migration script for existing travel events.
- No UI changes yet — just data shape.

### Phase 1 — Core trip lifecycle ✅ `d59573c` · `06d1bf1` · `13c80ee` · `9cbfb66`
- "Travel" event-type → trip-creation modal (§ 4.2).
- Trip View modal shell (sections; empty states).
- Stays section: city-first add flow, lodging editor, multi-lodging within stay, "who's staying here" override.
- Calendar location ribbons (one per city, grouped by date contiguity).
- Trip ribbon click → Trip View modal.
- Trips list page (§ 9).

### Phase 2 — Transport + custody bridge ✅ `ca04977` · `1854f88`
- Flight, drive, train, ferry segment types with full forms (using existing per-leg TZ infrastructure).
- Drive shortcut ("+ next day's drive").
- "Who's on this leg" picker on every transport segment.
- Custody section in Trip View.
- "Propose override" button with gray-out logic.
- Override → trip linkage via `created_from_trip_id`.
- Trip dates ↔ override window conflict detection.
- Trip cancel prompt for linked overrides.

### Phase 3 — Cruise + multi-segment polish ✅ `b607853` · `09aaee6`
- Cruise segment type with cabins (structured occupants).
- Cruise port stop sub-segments with `parent_segment_id` linkage.
- Two-ribbon cruise rendering on calendar.
- Port-stop popover (lightweight click-target).
- Drive duration-block rendering (β).

### Phase 4 — Visibility + comms ✅ `6f5ce53` · `82e6497` (smart batching deferred — see § 0a)
- Notification triggers for trip changes (§ 8) with smart batching.
- Activity log entries for trip-related actions.
- Co-parent draft-badge visibility from trip creation.
- Validation warnings in Trip View (§ 5.3).

### Phase 5 — iCal + files ✅ `d201756` · `4c67b3e` (requires `add_trip_attachments.sql` to be run — see § 0a)
- Per-segment iCal export with VTIMEZONE for each TZ used.
- Per-segment file attachments.
- Trip-level file attachments.
- Migration: existing travel-event attachments → segment-level on the migrated lodging/flight.

### Phase 6 — Polish ✅ `f9844b9`
- Mobile bottom-sheet Trip View.
- Empty-state CTAs throughout.
- Trip search on Trips page.
- HTML mockups for review before each phase if useful.

---

## 13. Open questions / decisions deferred

- **City picker UX** for "+ Add stay": free-text only? Geocoding (Mapbox / Google Places)? v1 = free text; revisit if users complain.
- **Trip View modal width on desktop:** 640px? 720px? Will tune during Phase 1.
- **Activity log granularity** for trip changes: one entry per change, or one per "edit session"? Will tune during Phase 4.
- **Trip status transitions:** can a `canceled` trip be un-canceled? Probably yes (set status back to `planned`). Not blocking.
- **Cruise edge case:** disembarkation port differs from embarkation (round-the-world cruise). Schema supports it; UX should make it obvious.

---

## 14. Files affected (initial estimate)

Implementation touch list — to be refined per phase:

| File | Change |
|---|---|
| `supabase/add_trips_table.sql` | NEW |
| `supabase/add_segment_columns.sql` | NEW |
| `supabase/add_override_trip_link.sql` | NEW |
| `supabase/migrate_travel_events_to_trips.sql` | NEW (one-shot) |
| `src/lib/types.ts` | Add `Trip`, segment discriminated union; update `CalendarEvent` |
| `src/lib/timezones.ts` | Possibly extend for cruise multi-zone helpers |
| `src/components/EventModal.tsx` | "Travel" type → trip-creation modal |
| `src/components/TripView.tsx` | NEW — main editing surface |
| `src/components/TripCreationModal.tsx` | NEW |
| `src/components/segments/LodgingForm.tsx` | NEW |
| `src/components/segments/FlightForm.tsx` | NEW |
| `src/components/segments/DriveForm.tsx` | NEW |
| `src/components/segments/TrainForm.tsx` | NEW |
| `src/components/segments/FerryForm.tsx` | NEW |
| `src/components/segments/CruiseForm.tsx` | NEW (Phase 3) |
| `src/components/segments/PortStopRow.tsx` | NEW (Phase 3) |
| `src/components/MonthView.tsx` | Trip ribbon rendering, click target |
| `src/components/WeekView.tsx` | Trip lodging strip + transport blocks |
| `src/components/ListView.tsx` | Trip-aware grouping |
| `src/app/trips/page.tsx` | NEW — Trips list page |
| `src/app/api/ical/route.ts` | Per-segment emission, multi-zone VTIMEZONE blocks |
| `src/hooks/useTrips.ts` | NEW — trip CRUD + segment composition |
| `src/hooks/useEvents.ts` | Add segment-aware update paths |
| `supabase/functions/notify-parent/` | Trip-change templates + smart batching |

---

*End of plan.*
