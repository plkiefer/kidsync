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

export interface Profile {
  id: string;
  family_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  avatar_url: string | null;
  ical_token: string | null;
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
  title: string;
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
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
  dropoff_location?: string;
  dropoff_time: string;
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
  recurring_rule: string;
  location: string;
  notes: string;
  // Inline travel fields (only used when event_type === "travel")
  travel_departure_airport?: string;
  travel_arrival_airport?: string;
  travel_departure_time?: string;
  travel_arrival_time?: string;
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
