"use client";

import { useState, useRef } from "react";
import {
  CalendarEvent,
  EventFormData,
  EventType,
  Kid,
  EVENT_TYPE_CONFIG,
  getEventKidIds,
} from "@/lib/types";
import { toDateTimeLocal, parseTimestamp } from "@/lib/dates";
import {
  getBrowserTimezone,
  localTimeToUtc,
  utcToLocalTimeString,
} from "@/lib/timezones";
import RecurrencePicker from "@/components/RecurrencePicker";
import TimezonePicker from "@/components/TimezonePicker";
import { kidColorCss } from "@/lib/palette";
import {
  X,
  Clock,
  MapPin,
  FileText,
  Plane,
  Trash2,
  Building2,
  Phone,
  Paperclip,
} from "lucide-react";

interface EventModalProps {
  event?: CalendarEvent | null;
  initialDate?: Date;
  kids: Kid[];
  onSave: (data: EventFormData, files?: File[]) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
  onOpenTravel?: (eventId: string) => void;
  onCreateCustodyExchange?: (data: {
    kidIds: string[];
    pickupDate: string;
    pickupTime: string;
    pickupLocation: string;
    dropoffDate: string;
    dropoffTime: string;
    dropoffLocation: string;
    notes: string;
  }) => void;
  /** When the user picks "Travel" on a NEW event, the modal redirects
   *  to the Trip creation flow. Calendar page handles the redirect:
   *  closes EventModal, opens TripCreationModal. */
  onCreateTripRequested?: (initialTitle: string) => void;
}

const EVENT_TYPES = Object.entries(EVENT_TYPE_CONFIG) as [
  EventType,
  (typeof EVENT_TYPE_CONFIG)[EventType],
][];

export default function EventModal({
  event,
  initialDate,
  kids,
  onSave,
  onDelete,
  onClose,
  onOpenTravel,
  onCreateCustodyExchange,
  onCreateTripRequested,
}: EventModalProps) {
  const isNew = !event?.id;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultStart = initialDate || new Date();
  if (!initialDate) defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(defaultStart.getTime() + 3600000);

  // Get initial travel fields from existing travel details
  const existingTravel = event?.travel;
  const existingFlight =
    existingTravel?.flights && existingTravel.flights.length > 0
      ? existingTravel.flights[0]
      : null;

  // Default timezone: existing event's saved zone, falling back to
  // the browser's. Once set, all the form's local-time strings are
  // interpreted in this zone for the local→UTC round-trip.
  const initialTz = event?.time_zone || getBrowserTimezone();

  const [form, setForm] = useState<EventFormData>({
    title: event?.title || "",
    kid_ids: event ? getEventKidIds(event) : kids[0] ? [kids[0].id] : [],
    event_type: event?.event_type || "other",
    // For new events, the default Date objects are already in
    // browser time and toDateTimeLocal renders them as such — fine
    // since the default tz is browserTimezone. For existing events,
    // render the saved UTC instant in the saved tz so the inputs
    // match what the user originally entered.
    starts_at: event?.starts_at
      ? utcToLocalTimeString(parseTimestamp(event.starts_at), initialTz)
      : toDateTimeLocal(defaultStart),
    ends_at: event?.ends_at
      ? utcToLocalTimeString(parseTimestamp(event.ends_at), initialTz)
      : toDateTimeLocal(defaultEnd),
    all_day: event?.all_day || false,
    time_zone: initialTz,
    recurring_rule: event?.recurring_rule || "",
    location: event?.location || "",
    notes: event?.notes || "",
    // Inline travel — each flight time has its OWN zone (origin
    // for departure, destination for arrival). Defaults to the
    // event's main zone so single-zone trips just work.
    travel_departure_airport: existingFlight?.departure_airport || "",
    travel_arrival_airport: existingFlight?.arrival_airport || "",
    travel_departure_timezone:
      existingFlight?.departure_timezone || initialTz,
    travel_arrival_timezone:
      existingFlight?.arrival_timezone || initialTz,
    travel_departure_time: existingFlight?.departure_time
      ? utcToLocalTimeString(
          parseTimestamp(existingFlight.departure_time),
          existingFlight.departure_timezone || initialTz
        )
      : "",
    travel_arrival_time: existingFlight?.arrival_time
      ? utcToLocalTimeString(
          parseTimestamp(existingFlight.arrival_time),
          existingFlight.arrival_timezone || initialTz
        )
      : "",
    travel_lodging_name: existingTravel?.lodging_name || "",
    travel_lodging_address: existingTravel?.lodging_address || "",
    travel_lodging_phone: existingTravel?.lodging_phone || "",
    travel_lodging_confirmation: existingTravel?.lodging_confirmation || "",
  });

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Custody exchange specific state
  const isCustodyMode = form.event_type === "custody" && onCreateCustodyExchange;
  const defaultDateStr = (initialDate || new Date()).toISOString().slice(0, 10);
  const [custodyPickupDate, setCustodyPickupDate] = useState(defaultDateStr);
  const [custodyPickupTime, setCustodyPickupTime] = useState("15:00");
  const [custodyPickupLocation, setCustodyPickupLocation] = useState("");
  const [custodyDropoffDate, setCustodyDropoffDate] = useState(
    (() => { const d = new Date(initialDate || new Date()); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); })()
  );
  const [custodyDropoffTime, setCustodyDropoffTime] = useState("17:00");
  const [custodyDropoffLocation, setCustodyDropoffLocation] = useState("");
  const [custodyNotes, setCustodyNotes] = useState("");

  const update = (field: keyof EventFormData, value: string | boolean | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleKid = (kidId: string) => {
    setForm((prev) => {
      const current = prev.kid_ids;
      if (current.includes(kidId)) {
        // Don't allow deselecting all
        if (current.length <= 1) return prev;
        return { ...prev, kid_ids: current.filter((id) => id !== kidId) };
      }
      return { ...prev, kid_ids: [...current, kidId] };
    });
  };

  const selectAllKids = () => {
    setForm((prev) => ({ ...prev, kid_ids: kids.map((k) => k.id) }));
  };

  const handleSubmit = () => {
    // Custody exchange mode — delegate to the custody handler
    if (isCustodyMode) {
      onCreateCustodyExchange!({
        kidIds: form.kid_ids,
        pickupDate: custodyPickupDate,
        pickupTime: custodyPickupTime,
        pickupLocation: custodyPickupLocation,
        dropoffDate: custodyDropoffDate,
        dropoffTime: custodyDropoffTime,
        dropoffLocation: custodyDropoffLocation,
        notes: custodyNotes,
      });
      return;
    }
    if (!form.title.trim()) return;
    // Anchor each local clock-time to form.time_zone before
    // serialising. This is what makes the picker actually MEAN
    // anything: 3pm in Asia/Tokyo is a different UTC instant than
    // 3pm in America/New_York, and the new helper computes the
    // right one regardless of where the browser is running.
    onSave(
      {
        ...form,
        starts_at: localTimeToUtc(form.starts_at, form.time_zone).toISOString(),
        ends_at: localTimeToUtc(form.ends_at, form.time_zone).toISOString(),
        travel_departure_time: form.travel_departure_time
          ? localTimeToUtc(
              form.travel_departure_time,
              form.travel_departure_timezone || form.time_zone
            ).toISOString()
          : "",
        travel_arrival_time: form.travel_arrival_time
          ? localTimeToUtc(
              form.travel_arrival_time,
              form.travel_arrival_timezone || form.time_zone
            ).toISOString()
          : "",
      },
      pendingFiles
    );
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setPendingFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = "";
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Color bar: gradient if multiple kids, single color otherwise
  const selectedKids = kids.filter((k) => form.kid_ids.includes(k.id));
  const colorBarStyle =
    selectedKids.length > 1
      ? {
          background: `linear-gradient(to right, ${selectedKids.map((k) => kidColorCss(k.color)).join(", ")})`,
        }
      : {
          backgroundColor: selectedKids[0]
            ? kidColorCss(selectedKids[0].color)
            : "var(--color-accent)",
        };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-md max-h-[90vh] flex flex-col border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Kid identity bar */}
        <div className="h-1.5 shrink-0" style={colorBarStyle} />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Title — hidden in custody mode */}
          {isCustodyMode ? (
            <h2 className="text-xl font-display text-[var(--ink)] pb-2 mb-5 border-b border-[var(--border-strong)]">
              Custom Custody Exchange
            </h2>
          ) : (
            <input
              type="text"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="Add title"
              autoFocus
              className="w-full text-xl font-display text-[var(--ink)] placeholder-[var(--text-faint)] bg-transparent border-0 border-b border-[var(--border-strong)] focus:border-[var(--action)] focus:outline-none pb-2 mb-5 transition-colors"
            />
          )}

          {/* Event type pills */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EVENT_TYPES.map(([type, config]) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  // Travel for a NEW event redirects to the Trip
                  // creation flow. Editing an existing trip-linked
                  // event opens TripView (handled by the calendar
                  // page) — by the time we're here on an edit, the
                  // type pill is informational only.
                  if (
                    type === "travel" &&
                    isNew &&
                    onCreateTripRequested
                  ) {
                    onCreateTripRequested(form.title || "");
                    return;
                  }
                  update("event_type", type);
                }}
                className={`
                  inline-flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border
                  ${
                    form.event_type === type
                      ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                      : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
                  }
                `}
              >
                <span aria-hidden>{config.icon}</span>
                {config.label}
              </button>
            ))}
          </div>

          {/* Kid selector — multi-select with "All" option */}
          <div className="flex gap-2 mb-5 flex-wrap">
            {kids.length > 1 && (
              <button
                type="button"
                onClick={selectAllKids}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors border
                  ${
                    form.kid_ids.length === kids.length
                      ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                      : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
                  }
                `}
              >
                All Kids
              </button>
            )}
            {kids.map((kid) => {
              const selected = form.kid_ids.includes(kid.id);
              return (
                <button
                  key={kid.id}
                  type="button"
                  onClick={() => toggleKid(kid.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors border"
                  style={{
                    backgroundColor: selected ? kidColorCss(kid.color) : "var(--bg)",
                    color: selected ? "#ffffff" : "var(--text-muted)",
                    borderColor: selected ? kidColorCss(kid.color) : "var(--border)",
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundColor: selected ? "#ffffff" : kidColorCss(kid.color),
                      opacity: selected ? 0.8 : 1,
                    }}
                  />
                  {kid.name}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-divider)] mb-4" />

          {/* Custody Exchange Mode */}
          {isCustodyMode ? (
            <div className="space-y-4">
              {/* Pickup */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-sm bg-action-bg flex items-center justify-center text-action shrink-0">
                    <Clock size={14} />
                  </div>
                  <span className="t-label text-action">Pickup</span>
                </div>
                <div className="ml-10 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={custodyPickupDate}
                    onChange={(e) => setCustodyPickupDate(e.target.value)}
                    className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                  />
                  <input
                    type="time"
                    value={custodyPickupTime}
                    onChange={(e) => setCustodyPickupTime(e.target.value)}
                    className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                  />
                  <input
                    type="text"
                    value={custodyPickupLocation}
                    onChange={(e) => setCustodyPickupLocation(e.target.value)}
                    placeholder="Pickup location"
                    className="col-span-2 px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                  />
                </div>
              </div>

              {/* Drop-off */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-sm bg-[var(--accent-amber-tint)] flex items-center justify-center text-[var(--accent-amber)] shrink-0">
                    <Clock size={14} />
                  </div>
                  <span className="t-label" style={{ color: "var(--accent-amber)" }}>Drop-off</span>
                </div>
                <div className="ml-10 grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={custodyDropoffDate}
                    onChange={(e) => setCustodyDropoffDate(e.target.value)}
                    className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                  />
                  <input
                    type="time"
                    value={custodyDropoffTime}
                    onChange={(e) => setCustodyDropoffTime(e.target.value)}
                    className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                  />
                  <input
                    type="text"
                    value={custodyDropoffLocation}
                    onChange={(e) => setCustodyDropoffLocation(e.target.value)}
                    placeholder="Drop-off location"
                    className="col-span-2 px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                  />
                </div>
              </div>

              {/* Notes */}
              <div className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                  <FileText size={14} />
                </div>
                <input
                  type="text"
                  value={custodyNotes}
                  onChange={(e) => setCustodyNotes(e.target.value)}
                  placeholder="Reason or notes"
                  className="flex-1 px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                />
              </div>

              {/* Compliance note */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-sm border border-[var(--accent-amber)]/30 bg-[var(--accent-amber-tint)]">
                <Plane size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent-amber)" }} />
                <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--accent-amber)" }}>
                  This creates a custody change request. The other parent will
                  be notified and must approve.
                </p>
              </div>
            </div>
          ) : (

          /* Standard event fields */
          <div className="space-y-1">
            {/* All-day + Date/Time */}
            <div className="py-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                  <Clock size={14} />
                </div>
                <span className="text-sm text-[var(--color-text)] flex-1">
                  All-day
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.all_day}
                  onClick={() => update("all_day", !form.all_day)}
                  className={`
                    w-11 h-6 rounded-sm relative transition-colors shrink-0 border
                    ${form.all_day ? "bg-action border-action" : "bg-[var(--bg-sunken)] border-[var(--border)]"}
                  `}
                >
                  <span
                    className={`
                      absolute top-0.5 w-5 h-5 rounded-sm bg-white shadow-[var(--shadow-sm)] transition-transform
                      ${form.all_day ? "left-[22px]" : "left-0.5"}
                    `}
                  />
                </button>
              </div>

              <div className="ml-10 space-y-2">
                <input
                  type={form.all_day ? "date" : "datetime-local"}
                  value={
                    form.all_day
                      ? form.starts_at.split("T")[0]
                      : form.starts_at
                  }
                  onChange={(e) => {
                    if (form.all_day) {
                      update("starts_at", e.target.value + "T00:00");
                    } else {
                      update("starts_at", e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                />
                <input
                  type={form.all_day ? "date" : "datetime-local"}
                  value={
                    form.all_day ? form.ends_at.split("T")[0] : form.ends_at
                  }
                  onChange={(e) => {
                    if (form.all_day) {
                      update("ends_at", e.target.value + "T23:59");
                    } else {
                      update("ends_at", e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                />
                {/* Timezone picker — hidden for all-day events
                    (those are zone-independent calendar dates). The
                    saved zone applies to both starts_at and ends_at
                    so a single event has one consistent anchor. */}
                {!form.all_day && (
                  <TimezonePicker
                    value={form.time_zone}
                    onChange={(tz) => update("time_zone", tz)}
                    compact
                  />
                )}
              </div>
            </div>

            {/* Recurrence */}
            <div className="py-2">
              <RecurrencePicker
                value={form.recurring_rule}
                startDate={form.starts_at}
                onChange={(rrule) => update("recurring_rule", rrule)}
              />
            </div>

            <div className="border-t border-[var(--color-divider)] my-1" />

            {/* Location */}
            <div className="flex items-center gap-2 py-2">
              <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                <MapPin size={14} />
              </div>
              <input
                type="text"
                value={form.location}
                onChange={(e) => update("location", e.target.value)}
                placeholder="Add location"
                className="flex-1 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] bg-transparent focus:outline-none border-0 py-1"
              />
            </div>

            <div className="border-t border-[var(--color-divider)] my-1" />

            {/* Notes */}
            <div className="flex items-start gap-2 py-2">
              <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                <FileText size={14} />
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Add description or notes"
                rows={2}
                className="flex-1 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] bg-transparent focus:outline-none border-0 py-1 resize-y"
              />
            </div>

            {/* Inline travel fields — only when type is travel */}
            {form.event_type === "travel" && (
              <>
                <div className="border-t border-[var(--color-divider)] my-1" />

                {/* Departure / Arrival */}
                <div className="py-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--ink)] shrink-0">
                      <Plane size={14} />
                    </div>
                    <span className="t-label">Flight Info</span>
                  </div>
                  <div className="ml-10 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={form.travel_departure_airport || ""}
                      onChange={(e) =>
                        update("travel_departure_airport", e.target.value)
                      }
                      placeholder="From (e.g. DCA)"
                      className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                    />
                    <input
                      type="text"
                      value={form.travel_arrival_airport || ""}
                      onChange={(e) =>
                        update("travel_arrival_airport", e.target.value)
                      }
                      placeholder="To (e.g. MCI)"
                      className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                    />
                    <div className="flex flex-col gap-1">
                      <input
                        type="datetime-local"
                        value={form.travel_departure_time || ""}
                        onChange={(e) =>
                          update("travel_departure_time", e.target.value)
                        }
                        className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                      />
                      <TimezonePicker
                        value={form.travel_departure_timezone || form.time_zone}
                        onChange={(tz) => update("travel_departure_timezone", tz)}
                        compact
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <input
                        type="datetime-local"
                        value={form.travel_arrival_time || ""}
                        onChange={(e) =>
                          update("travel_arrival_time", e.target.value)
                        }
                        className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                      />
                      <TimezonePicker
                        value={form.travel_arrival_timezone || form.time_zone}
                        onChange={(tz) => update("travel_arrival_timezone", tz)}
                        compact
                      />
                    </div>
                  </div>
                </div>

                {/* Lodging */}
                <div className="py-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--ink)] shrink-0">
                      <Building2 size={14} />
                    </div>
                    <span className="t-label">Lodging</span>
                  </div>
                  <div className="ml-10 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={form.travel_lodging_name || ""}
                      onChange={(e) =>
                        update("travel_lodging_name", e.target.value)
                      }
                      placeholder="Hotel / Address name"
                      className="col-span-2 px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                    />
                    <input
                      type="text"
                      value={form.travel_lodging_address || ""}
                      onChange={(e) =>
                        update("travel_lodging_address", e.target.value)
                      }
                      placeholder="Address"
                      className="col-span-2 px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                    />
                    <input
                      type="text"
                      value={form.travel_lodging_phone || ""}
                      onChange={(e) =>
                        update("travel_lodging_phone", e.target.value)
                      }
                      placeholder="Phone"
                      className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                    />
                    <input
                      type="text"
                      value={form.travel_lodging_confirmation || ""}
                      onChange={(e) =>
                        update("travel_lodging_confirmation", e.target.value)
                      }
                      placeholder="Confirmation #"
                      className="px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-xs placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                    />
                  </div>
                </div>

                {/* More travel details link */}
                {!isNew && onOpenTravel && (
                  <button
                    type="button"
                    onClick={() => onOpenTravel(event!.id)}
                    className="ml-10 text-xs text-action font-medium hover:text-action-hover transition-colors py-1 underline-offset-4 hover:underline"
                  >
                    More travel details (packing, documents, emergency)...
                  </button>
                )}
              </>
            )}

            {/* Attachments */}
            <div className="border-t border-[var(--color-divider)] my-1" />

            <div className="py-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 w-full text-left group"
              >
                <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                  <Paperclip size={14} />
                </div>
                <span className="text-sm text-[var(--color-text-faint)] group-hover:text-[var(--color-text-muted)] transition-colors">
                  Attach files
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Existing attachments */}
              {event?.attachments && event.attachments.length > 0 && (
                <div className="ml-10 mt-2 space-y-1">
                  {event.attachments.map((att, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm px-2.5 py-1.5"
                    >
                      <Paperclip size={10} />
                      <span className="flex-1 truncate">{att.name}</span>
                      <span className="text-[var(--color-text-faint)] shrink-0">
                        {(att.size / 1024).toFixed(0)}KB
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pending files (to upload after save) */}
              {pendingFiles.length > 0 && (
                <div className="ml-10 mt-2 space-y-1">
                  {pendingFiles.map((file, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs text-action bg-action-bg border border-action/30 rounded-sm px-2.5 py-1.5"
                    >
                      <Paperclip size={10} />
                      <span className="flex-1 truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePendingFile(i)}
                        className="text-[var(--color-text-faint)] hover:text-[var(--color-tag-deleted-text)]"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[var(--color-divider)] shrink-0">
          {!isNew && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(event!.id)}
              className="p-2 rounded-sm text-[var(--accent-red)] hover:bg-[var(--accent-red-tint)] transition-colors"
              title="Delete event"
            >
              <Trash2 size={16} />
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-sm text-[var(--text-muted)] text-xs font-semibold hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isCustodyMode ? !custodyPickupDate || !custodyDropoffDate : !form.title.trim()}
            className="px-6 py-2 rounded-sm bg-action text-action-fg text-xs font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--action-ring)]"
          >
            {isCustodyMode ? "Submit Request" : isNew ? "Save" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
