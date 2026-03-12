// ============================================================
// KidSync Type Definitions
// These mirror the Supabase schema from the backend scaffold
// ============================================================

// ── Enums ───────────────────────────────────────────────────

export type EventType =
  | "school"
  | "sports"
  | "medical"
  | "birthday"
  | "custody"
  | "activity"
  | "travel"
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

export interface CalendarEvent {
  id: string;
  family_id: string;
  kid_id: string;
  title: string;
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  recurring_rule: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
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

// ── UI / Form Types ─────────────────────────────────────────

export interface EventFormData {
  title: string;
  kid_id: string;
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  recurring_rule: string;
  location: string;
  notes: string;
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
  birthday: { label: "Birthday", icon: "🎂", color: "#EC4899" },
  custody: { label: "Custody Exchange", icon: "🔄", color: "#6366F1" },
  activity: { label: "Activity", icon: "🎨", color: "#F59E0B" },
  travel: { label: "Travel", icon: "✈️", color: "#0EA5E9" },
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
