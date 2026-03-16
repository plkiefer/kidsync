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
import RecurrencePicker from "@/components/RecurrencePicker";
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

  const [form, setForm] = useState<EventFormData>({
    title: event?.title || "",
    kid_ids: event ? getEventKidIds(event) : kids[0] ? [kids[0].id] : [],
    event_type: event?.event_type || "other",
    starts_at: event?.starts_at
      ? toDateTimeLocal(parseTimestamp(event.starts_at))
      : toDateTimeLocal(defaultStart),
    ends_at: event?.ends_at
      ? toDateTimeLocal(parseTimestamp(event.ends_at))
      : toDateTimeLocal(defaultEnd),
    all_day: event?.all_day || false,
    recurring_rule: event?.recurring_rule || "",
    location: event?.location || "",
    notes: event?.notes || "",
    // Inline travel
    travel_departure_airport: existingFlight?.departure_airport || "",
    travel_arrival_airport: existingFlight?.arrival_airport || "",
    travel_departure_time: existingFlight?.departure_time
      ? toDateTimeLocal(parseTimestamp(existingFlight.departure_time))
      : "",
    travel_arrival_time: existingFlight?.arrival_time
      ? toDateTimeLocal(parseTimestamp(existingFlight.arrival_time))
      : "",
    travel_lodging_name: existingTravel?.lodging_name || "",
    travel_lodging_address: existingTravel?.lodging_address || "",
    travel_lodging_phone: existingTravel?.lodging_phone || "",
    travel_lodging_confirmation: existingTravel?.lodging_confirmation || "",
  });

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

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
    if (!form.title.trim()) return;
    onSave(
      {
        ...form,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        travel_departure_time: form.travel_departure_time
          ? new Date(form.travel_departure_time).toISOString()
          : "",
        travel_arrival_time: form.travel_arrival_time
          ? new Date(form.travel_arrival_time).toISOString()
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
          background: `linear-gradient(to right, ${selectedKids.map((k) => k.color).join(", ")})`,
        }
      : {
          backgroundColor: selectedKids[0]?.color || "var(--color-accent)",
        };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Color bar */}
        <div className="h-2 rounded-t-2xl shrink-0" style={colorBarStyle} />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Title */}
          <input
            type="text"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Add title"
            autoFocus
            className="w-full text-xl font-display text-[var(--color-text)] placeholder-[var(--color-text-faint)] bg-transparent border-0 border-b-2 border-[var(--color-border)] focus:border-[var(--color-accent)] focus:outline-none pb-2 mb-5 transition-colors"
          />

          {/* Event type pills */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EVENT_TYPES.map(([type, config]) => (
              <button
                key={type}
                type="button"
                onClick={() => update("event_type", type)}
                className={`
                  px-2.5 py-1.5 rounded-full text-[11px] font-semibold transition-all
                  ${
                    form.event_type === type
                      ? "bg-[var(--color-accent)] text-white"
                      : "bg-[var(--color-input)] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
                  }
                `}
              >
                {config.icon} {config.label}
              </button>
            ))}
          </div>

          {/* Kid selector — multi-select with "All" option */}
          <div className="flex gap-2 mb-5 flex-wrap">
            {kids.length > 1 && (
              <button
                type="button"
                onClick={selectAllKids}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  backgroundColor:
                    form.kid_ids.length === kids.length
                      ? "var(--color-accent-soft)"
                      : "var(--color-input)",
                  color:
                    form.kid_ids.length === kids.length
                      ? "var(--color-accent)"
                      : "var(--color-text-faint)",
                  border: `1.5px solid ${
                    form.kid_ids.length === kids.length
                      ? "var(--color-accent)"
                      : "transparent"
                  }`,
                }}
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                  style={{
                    backgroundColor: selected
                      ? `${kid.color}22`
                      : "var(--color-input)",
                    color: selected ? kid.color : "var(--color-text-faint)",
                    border: `1.5px solid ${selected ? kid.color : "transparent"}`,
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: kid.color }}
                  />
                  {kid.name}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-divider)] mb-4" />

          {/* Icon rows */}
          <div className="space-y-1">
            {/* All-day + Date/Time */}
            <div className="py-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                  <Clock size={14} />
                </div>
                <span className="text-sm text-[var(--color-text)] flex-1">
                  All-day
                </span>
                <button
                  type="button"
                  onClick={() => update("all_day", !form.all_day)}
                  className={`
                    w-11 h-6 rounded-full relative transition-colors shrink-0
                    ${form.all_day ? "bg-[var(--color-accent)]" : "bg-[var(--color-input)] border border-[var(--color-border)]"}
                  `}
                >
                  <span
                    className={`
                      absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform
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
                  className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-all"
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
                  className="w-full px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-all"
                />
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
              <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
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
              <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
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
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-600 shrink-0">
                      <Plane size={14} />
                    </div>
                    <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                      Flight Info
                    </span>
                  </div>
                  <div className="ml-10 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={form.travel_departure_airport || ""}
                      onChange={(e) =>
                        update("travel_departure_airport", e.target.value)
                      }
                      placeholder="From (e.g. DCA)"
                      className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]"
                    />
                    <input
                      type="text"
                      value={form.travel_arrival_airport || ""}
                      onChange={(e) =>
                        update("travel_arrival_airport", e.target.value)
                      }
                      placeholder="To (e.g. MCI)"
                      className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]"
                    />
                    <input
                      type="datetime-local"
                      value={form.travel_departure_time || ""}
                      onChange={(e) =>
                        update("travel_departure_time", e.target.value)
                      }
                      className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all"
                    />
                    <input
                      type="datetime-local"
                      value={form.travel_arrival_time || ""}
                      onChange={(e) =>
                        update("travel_arrival_time", e.target.value)
                      }
                      className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all"
                    />
                  </div>
                </div>

                {/* Lodging */}
                <div className="py-2">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
                      <Building2 size={14} />
                    </div>
                    <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                      Lodging
                    </span>
                  </div>
                  <div className="ml-10 grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={form.travel_lodging_name || ""}
                      onChange={(e) =>
                        update("travel_lodging_name", e.target.value)
                      }
                      placeholder="Hotel / Address name"
                      className="col-span-2 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]"
                    />
                    <input
                      type="text"
                      value={form.travel_lodging_address || ""}
                      onChange={(e) =>
                        update("travel_lodging_address", e.target.value)
                      }
                      placeholder="Address"
                      className="col-span-2 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]"
                    />
                    <input
                      type="text"
                      value={form.travel_lodging_phone || ""}
                      onChange={(e) =>
                        update("travel_lodging_phone", e.target.value)
                      }
                      placeholder="Phone"
                      className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]"
                    />
                    <input
                      type="text"
                      value={form.travel_lodging_confirmation || ""}
                      onChange={(e) =>
                        update("travel_lodging_confirmation", e.target.value)
                      }
                      placeholder="Confirmation #"
                      className="px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all placeholder-[var(--color-text-faint)]"
                    />
                  </div>
                </div>

                {/* More travel details link */}
                {!isNew && onOpenTravel && (
                  <button
                    type="button"
                    onClick={() => onOpenTravel(event!.id)}
                    className="ml-10 text-xs text-cyan-600 font-medium hover:text-cyan-700 transition-colors py-1"
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
                <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
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
                      className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] bg-[var(--color-input)] rounded-lg px-2.5 py-1.5"
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
                      className="flex items-center gap-2 text-xs text-[var(--color-accent)] bg-[var(--color-accent-soft)] rounded-lg px-2.5 py-1.5"
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
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[var(--color-divider)] shrink-0">
          {!isNew && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(event!.id)}
              className="p-2.5 rounded-xl text-[var(--color-tag-deleted-text)] hover:bg-red-500/10 transition-colors"
              title="Delete event"
            >
              <Trash2 size={16} />
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-[var(--color-text-muted)] text-xs font-semibold hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!form.title.trim()}
            className="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-xs font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isNew ? "Save" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
