"use client";

import { useState } from "react";
import {
  CalendarEvent,
  EventFormData,
  EventType,
  Kid,
  EVENT_TYPE_CONFIG,
} from "@/lib/types";
import { toDateTimeLocal } from "@/lib/dates";
import RecurrencePicker from "@/components/RecurrencePicker";
import {
  X,
  Clock,
  MapPin,
  FileText,
  Plane,
  Trash2,
} from "lucide-react";

interface EventModalProps {
  event?: CalendarEvent | null;
  initialDate?: Date;
  kids: Kid[];
  onSave: (data: EventFormData) => void;
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

  const defaultStart = initialDate || new Date();
  if (!initialDate) defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(defaultStart.getTime() + 3600000);

  const [form, setForm] = useState<EventFormData>({
    title: event?.title || "",
    kid_id: event?.kid_id || kids[0]?.id || "",
    event_type: event?.event_type || "other",
    starts_at: event?.starts_at
      ? toDateTimeLocal(new Date(event.starts_at))
      : toDateTimeLocal(defaultStart),
    ends_at: event?.ends_at
      ? toDateTimeLocal(new Date(event.ends_at))
      : toDateTimeLocal(defaultEnd),
    all_day: event?.all_day || false,
    recurring_rule: event?.recurring_rule || "",
    location: event?.location || "",
    notes: event?.notes || "",
  });

  const update = (field: keyof EventFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    onSave({
      ...form,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: new Date(form.ends_at).toISOString(),
    });
  };

  const selectedKid = kids.find((k) => k.id === form.kid_id);

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
        <div
          className="h-2 rounded-t-2xl shrink-0"
          style={{
            backgroundColor: selectedKid?.color || "var(--color-accent)",
          }}
        />

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Title — large, clean input */}
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

          {/* Kid selector chips */}
          <div className="flex gap-2 mb-5">
            {kids.map((kid) => (
              <button
                key={kid.id}
                type="button"
                onClick={() => update("kid_id", kid.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  backgroundColor:
                    form.kid_id === kid.id ? `${kid.color}22` : "var(--color-input)",
                  color:
                    form.kid_id === kid.id
                      ? kid.color
                      : "var(--color-text-faint)",
                  border: `1.5px solid ${
                    form.kid_id === kid.id ? kid.color : "transparent"
                  }`,
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: kid.color }}
                />
                {kid.name}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-[var(--color-divider)] mb-4" />

          {/* Icon rows */}
          <div className="space-y-1">
            {/* All-day + Date/Time row */}
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

              {/* Date/time inputs */}
              <div className="ml-10 space-y-2">
                <div className="flex items-center gap-3">
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
                    className="flex-1 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-all"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type={form.all_day ? "date" : "datetime-local"}
                    value={
                      form.all_day
                        ? form.ends_at.split("T")[0]
                        : form.ends_at
                    }
                    onChange={(e) => {
                      if (form.all_day) {
                        update("ends_at", e.target.value + "T23:59");
                      } else {
                        update("ends_at", e.target.value);
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-accent)] transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Recurrence row */}
            <div className="py-2">
              <RecurrencePicker
                value={form.recurring_rule}
                startDate={form.starts_at}
                onChange={(rrule) => update("recurring_rule", rrule)}
              />
            </div>

            {/* Divider */}
            <div className="border-t border-[var(--color-divider)] my-1" />

            {/* Location row */}
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

            {/* Divider */}
            <div className="border-t border-[var(--color-divider)] my-1" />

            {/* Notes row */}
            <div className="flex items-start gap-2 py-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                <FileText size={14} />
              </div>
              <textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Add description or notes for the other parent"
                rows={2}
                className="flex-1 text-sm text-[var(--color-text)] placeholder-[var(--color-text-faint)] bg-transparent focus:outline-none border-0 py-1 resize-y"
              />
            </div>

            {/* Travel details row — only for existing travel events */}
            {!isNew && form.event_type === "travel" && onOpenTravel && (
              <>
                <div className="border-t border-[var(--color-divider)] my-1" />
                <button
                  type="button"
                  onClick={() => onOpenTravel(event!.id)}
                  className="flex items-center gap-2 py-2 w-full text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-600 shrink-0">
                    <Plane size={14} />
                  </div>
                  <span className="text-sm text-cyan-600 font-medium group-hover:text-cyan-700 transition-colors">
                    Travel Details
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer actions */}
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
