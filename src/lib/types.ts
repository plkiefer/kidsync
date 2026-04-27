// ============================================================
// KidSync Type Definitions
// These mirror the Supabase schema from the backend scaffold
// ============================================================

// ── Enums ───────────────────────────────────────────────────

export type EventType =
  | "school"
  | "sports"
  | "medical"
  | "custody"
  | "activity"
  | "travel"
  | "holiday"
  | "other";

export type UserRole = "parent" | "viewer";

export type DocumentStatus = "packed" | "in_wallet" | "needed" | "digital";

export type FlightDirection = "outbound" | "return";

// ── Core Models ─────────────────────────────────────────────

export interface Family {
  id: string;
  name: string;
  created_at: string;
}

// ── Trips ───────────────────────────────────────────────────
// First-class trip container. See docs/travel-trips-plan.md §2.1.
// Segments (lodgings, flights, etc.) live in calendar_events with
// a trip_id; this row holds trip-level metadata only.

export type TripType =
  | "vacation"
  | "custody_time"
  | "visit_family"
  | "business"
  | "other";

export type TripStatus = "draft" | "planned" | "canceled";

export interface TripGuest {
  /** Client-generated stable id ("guest_xxxx") so segment guest_ids
   *  can reference guests without duplicating contact data. */
  id: string;
  name: string;
  relationship: string;
  phone?: string;
  email?: string;
}

export interface Trip {
  id: string;
  family_id: string;
  title: string;
  trip_type: TripType;
  /** Auto-derived from segments. Null while trip has no segments. */
  starts_at: string | null;
  ends_at: string | null;
  kid_ids: string[];
  member_ids: string[];
  guests: TripGuest[];
  status: TripStatus;
  notes: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ── Segments ────────────────────────────────────────────────
// Segments are calendar_events with a discriminated segment_type.
// segment_data carries type-specific fields. See plan §2.3.

export type SegmentType =
  | "lodging"
  | "flight"
  | "drive"
  | "train"
  | "ferry"
  | "cruise"
  | "cruise_port_stop"
  | "other_transport";

export interface LodgingSegmentData {
  name: string;
  address: string;
  phone?: string;
  confirmation?: string;
  city: string;
  state: string;
  country: string;
}

export interface FlightSegmentData {
  carrier: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_timezone?: string | null;
  arrival_timezone?: string | null;
  confirmation?: string;
  seats?: string[];
  departure_terminal?: string;
  arrival_terminal?: string;
}

export interface DriveSegmentData {
  vehicle_type: "personal" | "rental_car" | "rideshare" | "other";
  vehicle_details?: string;
  rental_confirmation?: string;
  from_location: string;
  to_location: string;
  from_timezone?: string | null;
  to_timezone?: string | null;
}

export interface TrainSegmentData {
  carrier: string;
  train_number?: string;
  origin_station: string;
  destination_station: string;
  origin_timezone?: string | null;
  destination_timezone?: string | null;
  confirmation?: string;
  seats?: string[];
}

export interface FerrySegmentData {
  carrier: string;
  vessel_name?: string;
  origin_terminal: string;
  destination_terminal: string;
  origin_timezone?: string | null;
  destination_timezone?: string | null;
  confirmation?: string;
  vehicle_aboard?: boolean;
}

export interface CruiseCabin {
  number: string;
  occupants_kid_ids: string[];
  occupants_member_ids: string[];
  occupants_guest_ids: string[];
}

export interface CruiseSegmentData {
  cruise_line: string;
  ship_name: string;
  confirmation?: string;
  embark_port: string;
  embark_timezone?: string | null;
  disembark_port: string;
  disembark_timezone?: string | null;
  cabins: CruiseCabin[];
}

export interface CruisePortStopSegmentData {
  port: string;
  arrival_timezone?: string | null;
  departure_timezone?: string | null;
  /** Tender boat to shore (vs. docked at pier). */
  tender?: boolean;
  notes?: string;
}

export interface OtherTransportSegmentData {
  label: string;
  from_location?: string;
  to_location?: string;
  confirmation?: string;
}

/** Discriminated union over segment_type. Use a type guard
 *  (isLodgingSegment etc.) to narrow before reading specific
 *  fields off segment_data. */
export type SegmentData =
  | LodgingSegmentData
  | FlightSegmentData
  | DriveSegmentData
  | TrainSegmentData
  | FerrySegmentData
  | CruiseSegmentData
  | CruisePortStopSegmentData
  | OtherTransportSegmentData;

export interface Profile {
  id: string;
  family_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  ical_token: string | null;
  /** Palette key (see src/lib/palette.ts). Resolved to bg/swatch
   *  at render time. Optional for back-compat with existing rows
   *  that haven't been backfilled yet. */
  color_preference: string | null;
  /** Palette key for the co-parent's days, FROM THIS USER'S point
   *  of view. Lets each parent customize both colors they see; the
   *  two parents can disagree. NULL → fall back to the co-parent's
   *  own color_preference. */
  partner_color_preference: string | null;
  created_at: string;
  updated_at: string;
}

export interface Kid {
  id: string;
  family_id: string;
  name: string;
  color: string;
  birth_date: string | null;
  notes: string | null;
  created_at: string;
}

export interface EventAttachment {
  name: string;
  path: string;
  size: number;
  type: string;
  uploaded_at: string;
}

export interface CalendarEvent {
  id: string;
  family_id: string;
  kid_id: string;
  kid_ids?: string[];
  /** Profiles on this event/segment (parents). Used by per-leg
   *  roster on transport segments and per-lodging "who's staying
   *  here" overrides. Empty array for non-trip events. */
  member_ids?: string[];
  /** Guest ids referencing trip.guests[i].id. Lets transport &
   *  lodging segments include named non-family travelers without
   *  duplicating their contact info. */
  guest_ids?: string[];
  /** Links the event to its parent Trip. Null for non-trip events. */
  trip_id?: string | null;
  /** Discriminator for segment_data interpretation. Null for
   *  non-trip events. */
  segment_type?: SegmentType | null;
  /** Type-specific payload. Shape narrows by segment_type — see
   *  the SegmentData union. */
  segment_data?: SegmentData | null;
  /** Used only by cruise_port_stop to point at its parent cruise
   *  (so the port stop can inherit cabin info and render as the
   *  cruise's bottom ribbon). */
  parent_segment_id?: string | null;
  title: string;
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  /** IANA timezone the event was authored in (e.g. "America/New_York").
   *  starts_at/ends_at remain UTC; this anchors the event to a wall-
   *  clock zone so display + iCal can render it correctly. NULL on
   *  legacy rows; app defaults to America/New_York. */
  time_zone?: string | null;
  location: string | null;
  notes: string | null;
  recurring_rule: string | null;
  recurrence_exceptions?: string[]; // dates (YYYY-MM-DD) excluded from the series
  attachments?: EventAttachment[];
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // Virtual flag for auto-generated events (birthdays, recurrence instances)
  _virtual?: boolean;
  // Tentative flag for events based on pending (not yet approved) overrides
  _tentative?: boolean;
  // Parent event ID for recurrence instances
  _recurrence_parent?: string;
  // Joined relations (optional)
  kid?: Kid;
  travel?: EventTravelDetails | null;
  creator?: Profile;
}

// ── Travel & Logistics ──────────────────────────────────────

export interface FlightLeg {
  leg: number;
  direction: FlightDirection;
  carrier: string;
  flight_number: string;
  departure_airport: string;
  arrival_airport: string;
  departure_time: string;
  arrival_time: string;
  /** IANA zone the departure clock-time is anchored to. departure_time
   *  is still UTC; this lets the form/details UI render & edit in the
   *  origin airport's local zone (e.g. NY for JFK, Tokyo for HND).
   *  Falls back to the parent event's time_zone when null. */
  departure_timezone?: string | null;
  /** Same idea for arrival — anchored to the destination airport's
   *  local zone so a JFK→HND flight reads as "10:00pm JFK → 2:30am+1
   *  HND" regardless of where the viewer is. */
  arrival_timezone?: string | null;
  confirmation: string;
  seat: string;
  notes: string;
}

export interface GroundTransport {
  type: "rental_car" | "shuttle" | "rideshare" | "train" | "other";
  company: string;
  confirmation: string;
  pickup_location: string;
  pickup_time: string;
  /** IANA zone the pickup time is anchored to. Defaults to event TZ. */
  pickup_timezone?: string | null;
  dropoff_location?: string;
  dropoff_time: string;
  /** IANA zone for the dropoff time — typically the destination
   *  city for cross-zone trips (e.g. drop-off after a Tokyo→NY
   *  return needs the home zone). */
  dropoff_timezone?: string | null;
  notes: string;
}

export interface TravelDocument {
  type:
    | "passport"
    | "birth_certificate"
    | "insurance_card"
    | "travel_consent"
    | "medication_list"
    | "custody_order"
    | "other";
  for: string; // kid name or "family"
  number_last4?: string;
  carrier?: string;
  expiry?: string;
  notes?: string;
  status: DocumentStatus;
}

export interface PackingItem {
  item: string;
  packed: boolean;
}

export interface EventTravelDetails {
  id: string;
  event_id: string;

  // Lodging
  lodging_name: string | null;
  lodging_address: string | null;
  lodging_phone: string | null;
  lodging_confirmation: string | null;
  lodging_check_in: string | null;
  lodging_check_out: string | null;
  lodging_notes: string | null;

  // Flights
  flights: FlightLeg[];

  // Ground transport
  ground_transport: GroundTransport[];

  // Emergency contact
  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relation: string | null;
  emergency_notes: string | null;

  // Documents
  documents: TravelDocument[];

  // Destination
  destination_address: string | null;
  destination_phone: string | null;
  destination_notes: string | null;

  // Packing
  packing_checklist: PackingItem[];

  created_at: string;
  updated_at: string;
}

// ── Change Log ──────────────────────────────────────────────

export interface EventChangeLog {
  id: string;
  event_id: string | null;
  family_id: string;
  action: "created" | "updated" | "deleted";
  changed_by: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  event_snapshot: Partial<CalendarEvent> | null;
  created_at: string;
  // Joined
  changer?: Profile;
}

// ── Custody ─────────────────────────────────────────────────

export interface CustodySchedule {
  id: string;
  family_id: string;
  kid_id: string;
  pattern_type: "alternating_weeks" | "fixed_days";
  parent_a_id: string; // e.g., Dad
  parent_b_id: string; // e.g., Mom
  anchor_date: string; // DATE — a known date when parent_a's period starts
  pattern_days: number[]; // day-of-week (0=Sun, 5=Fri, 6=Sat)
  fixed_day_map: Record<number, string> | null;
  created_at: string;
  updated_at: string;
}

export type OverrideStatus = "pending" | "approved" | "disputed" | "withdrawn";
export type ComplianceStatus = "unchecked" | "compliant" | "flagged";

export interface CustodyOverride {
  id: string;
  family_id: string;
  kid_id: string;
  start_date: string;
  end_date: string;
  parent_id: string;
  note: string | null;
  reason: string | null;
  // Compliance
  compliance_status: ComplianceStatus;
  compliance_issues: string[] | null;
  compliance_checked_at: string | null;
  // Approval workflow
  status: OverrideStatus;
  created_by: string | null;
  responded_by: string | null;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
  // Optional time override for turnover events (e.g. "10:00" or "3:00 PM")
  override_time?: string | null;
  /** When this override was auto-proposed by a Trip's "Propose
   *  override" flow, points back at the trip. Null when the
   *  override was created independently. Used by trip-cancel
   *  prompt logic (plan §15e): only prompt for trip-linked
   *  overrides on cancel. */
  created_from_trip_id?: string | null;
}

export interface CustodyAgreement {
  id: string;
  family_id: string;
  file_name: string;
  file_path: string;
  parsed_terms: ParsedCustodyTerms | null;
  raw_text: string | null;
  parsed_at: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface ParsedCustodyTerms {
  // Regular schedule
  primary_custodian: string; // "mother" or "father"
  alternating_weekends: {
    enabled: boolean;
    parent: string; // who gets alternating weekends
    days: string[]; // e.g., ["Friday", "Saturday", "Sunday"]
    pickup_time?: string;
    dropoff_time?: string;
    start_date?: string; // anchor date, e.g. "2026-01-02"
  };
  weekday_schedule?: {
    monday?: string;
    tuesday?: string;
    wednesday?: string;
    thursday?: string;
    friday?: string;
  };
  // Holiday/vacation provisions
  holidays: Array<{
    name: string;
    rule: string; // e.g., "alternating years", "always with father", etc.
  }>;
  summer_schedule?: string;
  spring_break?: string;
  winter_break?: string;
  // Constraints
  restrictions: string[];
  // Right of first refusal, notification requirements, etc.
  provisions: string[];
  // Raw summary for display
  summary: string;
}

// ── UI / Form Types ─────────────────────────────────────────

export interface EventFormData {
  title: string;
  kid_ids: string[];
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  /** IANA timezone the user is authoring this event in. Defaults
   *  to the browser timezone; can be changed via the picker. */
  time_zone: string;
  recurring_rule: string;
  location: string;
  notes: string;
  // Inline travel fields (only used when event_type === "travel")
  travel_departure_airport?: string;
  travel_arrival_airport?: string;
  travel_departure_time?: string;
  travel_arrival_time?: string;
  /** IANA zone for the departure time. Defaults to event time_zone. */
  travel_departure_timezone?: string;
  /** IANA zone for the arrival time. Defaults to event time_zone. */
  travel_arrival_timezone?: string;
  travel_lodging_name?: string;
  travel_lodging_address?: string;
  travel_lodging_phone?: string;
  travel_lodging_confirmation?: string;
}

export interface TravelFormData {
  lodging_name: string;
  lodging_address: string;
  lodging_phone: string;
  lodging_confirmation: string;
  lodging_check_in: string;
  lodging_check_out: string;
  lodging_notes: string;
  flights: FlightLeg[];
  ground_transport: GroundTransport[];
  emergency_name: string;
  emergency_phone: string;
  emergency_relation: string;
  emergency_notes: string;
  documents: TravelDocument[];
  destination_address: string;
  destination_phone: string;
  destination_notes: string;
  packing_checklist: PackingItem[];
}

// ── Constants ───────────────────────────────────────────────

export const EVENT_TYPE_CONFIG: Record<
  EventType,
  { label: string; icon: string; color: string }
> = {
  school: { label: "School", icon: "📚", color: "#8B5CF6" },
  sports: { label: "Sports", icon: "⚽", color: "#10B981" },
  medical: { label: "Medical", icon: "🏥", color: "#EF4444" },
  custody: { label: "Custody Exchange", icon: "🔄", color: "#6366F1" },
  activity: { label: "Activity", icon: "🎨", color: "#F59E0B" },
  travel: { label: "Travel", icon: "✈️", color: "#0EA5E9" },
  holiday: { label: "Holiday", icon: "🎉", color: "#DC2626" },
  other: { label: "Other", icon: "📌", color: "var(--color-kid-2)" },
};

export const DOCUMENT_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "birth_certificate", label: "Birth Certificate" },
  { value: "insurance_card", label: "Insurance Card" },
  { value: "travel_consent", label: "Travel Consent Letter" },
  { value: "medication_list", label: "Medication List" },
  { value: "custody_order", label: "Custody Order" },
  { value: "other", label: "Other" },
] as const;

// ── Helpers ─────────────────────────────────────────────────

/** Get the kid_ids for an event, falling back to [kid_id] for backward compat */
export function getEventKidIds(event: CalendarEvent): string[] {
  if (event.kid_ids && event.kid_ids.length > 0) return event.kid_ids;
  return [event.kid_id];
}

// ── Sport-specific emoji lookup ────────────────────────────

const SPORT_EMOJIS: [RegExp, string][] = [
  [/basketball/i, "🏀"],
  [/baseball|softball/i, "⚾"],
  [/football/i, "🏈"],
  [/soccer|futbol|fútbol/i, "⚽"],
  [/tennis/i, "🎾"],
  [/golf/i, "⛳"],
  [/swim/i, "🏊"],
  [/hockey/i, "🏒"],
  [/volleyball/i, "🏐"],
  [/lacrosse/i, "🥍"],
  [/bowling/i, "🎳"],
  [/boxing|martial|karate|taekwondo|judo/i, "🥊"],
  [/gymnast/i, "🤸"],
  [/ski/i, "⛷️"],
  [/snowboard/i, "🏂"],
  [/surf/i, "🏄"],
  [/skateboard|skating/i, "🛹"],
  [/wrestling/i, "🤼"],
  [/rugby/i, "🏉"],
  [/ping.?pong|table.?tennis/i, "🏓"],
  [/badminton/i, "🏸"],
  [/cricket/i, "🏏"],
  [/fenc/i, "🤺"],
  [/climb/i, "🧗"],
  [/cycling|bike|biking/i, "🚴"],
  [/run|track|marathon|cross.?country/i, "🏃"],
  [/cheer/i, "📣"],
  [/dance|ballet/i, "💃"],
  [/yoga/i, "🧘"],
  [/fish/i, "🎣"],
  [/horse|equestrian|riding/i, "🏇"],
  [/archery/i, "🏹"],
  [/water.?polo/i, "🤽"],
  [/rowing|crew/i, "🚣"],
  [/sail/i, "⛵"],
];

/**
 * Get the display icon for an event.
 * Birthday virtual events → 🎂
 * Sports events → sport-specific emoji based on title, fallback ⚽
 * Other types → default from EVENT_TYPE_CONFIG
 */
export function getEventIcon(event: CalendarEvent): string {
  // Birthday virtual events
  if (event.id.startsWith("birthday-")) return "🎂";

  // Holiday events — look up icon by name (title has no embedded emoji)
  if (event.id.startsWith("holiday-")) {
    return getHolidayIconForEvent(event.title);
  }

  // Custody turnover events
  if (event.id.startsWith("turnover-")) return "🔄";

  const config = EVENT_TYPE_CONFIG[event.event_type as keyof typeof EVENT_TYPE_CONFIG];

  if (event.event_type === "sports") {
    for (const [pattern, emoji] of SPORT_EMOJIS) {
      if (pattern.test(event.title)) return emoji;
    }
  }

  return config?.icon || "📌";
}

/**
 * Get the display color for an event based on its type.
 * Birthday events get a festive pink. Everything else uses EVENT_TYPE_CONFIG.
 */
export function getEventTypeColor(event: CalendarEvent): string {
  if (event.id.startsWith("birthday-")) return "#E91E8F";
  const config = EVENT_TYPE_CONFIG[event.event_type as keyof typeof EVENT_TYPE_CONFIG];
  return config?.color || "#607080";
}

// ── Human-readable RRULE description ───────────────────────

const DAY_NAMES_SHORT: Record<string, string> = {
  SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat",
};

export function describeRRule(rrule: string): string {
  if (!rrule) return "Does not repeat";

  const parts: Record<string, string> = {};
  rrule.split(";").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v) parts[k] = v;
  });

  const freq = parts.FREQ || "WEEKLY";
  const interval = parseInt(parts.INTERVAL || "1", 10);
  const byDay = parts.BYDAY ? parts.BYDAY.split(",") : [];
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : 0;
  const until = parts.UNTIL || "";

  let desc = "Every ";
  if (interval > 1) desc += `${interval} `;

  switch (freq) {
    case "DAILY":
      desc += interval > 1 ? "days" : "day";
      break;
    case "WEEKLY": {
      desc += interval > 1 ? "weeks" : "week";
      if (byDay.length > 0 && byDay.length < 7) {
        const weekdays = ["MO", "TU", "WE", "TH", "FR"];
        if (byDay.length === 5 && weekdays.every((d) => byDay.includes(d))) {
          desc = "Every weekday";
        } else {
          desc += " on " + byDay.map((d) => DAY_NAMES_SHORT[d] || d).join(", ");
        }
      }
      break;
    }
    case "MONTHLY":
      desc += interval > 1 ? "months" : "month";
      break;
    case "YEARLY":
      desc += interval > 1 ? "years" : "year";
      break;
  }

  if (count) desc += `, ${count} times`;
  if (until) {
    const m = until.match(/(\d{4})(\d{2})(\d{2})/);
    if (m) {
      const uDate = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      desc += `, until ${uDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }

  return desc;
}

// ── Holiday icon lookup (inline to avoid circular imports) ──

const HOLIDAY_ICONS: [RegExp, string][] = [
  [/new year.*eve/i, "🥂"],
  [/new year/i, "🎆"],
  [/mlk|martin luther king/i, "✊"],
  [/washington/i, "🏛️"],
  [/memorial/i, "🇺🇸"],
  [/juneteenth/i, "✊"],
  [/independence/i, "🎇"],
  [/labor day/i, "⚒️"],
  [/columbus/i, "🗺️"],
  [/veteran/i, "🎖️"],
  [/thanksgiving/i, "🦃"],
  [/christmas eve/i, "🌟"],
  [/christmas/i, "🎄"],
  [/valentine/i, "💝"],
  [/st\. patrick/i, "☘️"],
  [/good friday/i, "✝️"],
  [/easter/i, "🐣"],
  [/mother/i, "💐"],
  [/father/i, "👔"],
  [/grandparent/i, "👴"],
  [/halloween/i, "🎃"],
  [/election/i, "🗳️"],
];

function getHolidayIconForEvent(title: string): string {
  for (const [pattern, emoji] of HOLIDAY_ICONS) {
    if (pattern.test(title)) return emoji;
  }
  return "🎉";
}
