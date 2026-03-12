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
import { X } from "lucide-react";

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
  (typeof EVENT_TYPE_CONFIG)[EventType]
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

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl text-[var(--color-text)]">
            {isNew ? "New Event" : "Edit Event"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[var(--color-input)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Event Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. Soccer Practice"
              className="w-full px-3.5 py-2.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-sm placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[rgba(56,56,56,0.12)] transition-all"
            />
          </div>

          {/* Kid selection */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Child
            </label>
            <div className="flex gap-2">
              {kids.map((kid) => (
                <button
                  key={kid.id}
                  type="button"
                  onClick={() => update("kid_id", kid.id)}
                  className="flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    border: `1.5px solid ${
                      form.kid_id === kid.id
                        ? kid.color
                        : "var(--color-border)"
                    }`,
                    backgroundColor:
                      form.kid_id === kid.id ? `${kid.color}22` : "transparent",
                    color:
                      form.kid_id === kid.id ? kid.color : "var(--color-text-muted)",
                  }}
                >
                  {kid.name}
                </button>
              ))}
            </div>
          </div>

          {/* Event type */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Type
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map(([type, config]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => update("event_type", type)}
                  className={`
                    px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                    ${
                      form.event_type === type
                        ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                        : "bg-transparent border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
                    }
                  `}
                  style={{
                    border: `1.5px solid ${
                      form.event_type === type
                        ? "#3B82F6"
                        : "var(--color-border)"
                    }`,
                  }}
                >
                  {config.icon} {config.label}
                </button>
              ))}
            </div>
          </div>

          {/* All day toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => update("all_day", !form.all_day)}
              className={`
                w-10 h-6 rounded-full relative transition-colors
                ${form.all_day ? "bg-[var(--color-accent)]" : "bg-[var(--color-input)]"}
              `}
            >
              <span
                className={`
                  absolute top-1 w-4 h-4 rounded-full bg-white transition-transform
                  ${form.all_day ? "left-5" : "left-1"}
                `}
              />
            </button>
            <span className="text-xs text-[var(--color-text-muted)] font-medium">
              All day event
            </span>
          </div>

          {/* Date/time */}
          {!form.all_day && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  Start
                </label>
                <input
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={(e) => update("starts_at", e.target.value)}
                  className="w-full px-3 py-2.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
                  End
                </label>
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(e) => update("ends_at", e.target.value)}
                  className="w-full px-3 py-2.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-xs focus:outline-none focus:border-[var(--color-accent)] transition-all"
                />
              </div>
            </div>
          )}

          {/* Location */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Location
            </label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Address or place name"
              className="w-full px-3.5 py-2.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-sm placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-all"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Any details for the other parent..."
              rows={3}
              className="w-full px-3.5 py-2.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-sm placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-all resize-y"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-[var(--color-divider)]">
          {!isNew && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(event!.id)}
              className="px-4 py-2.5 rounded-xl border border-[var(--color-tag-deleted-bg)] bg-red-500/10 text-[var(--color-tag-deleted-text)] text-xs font-semibold hover:bg-red-500/20 transition-colors"
            >
              Delete
            </button>
          )}

          {!isNew && form.event_type === "travel" && onOpenTravel && (
            <button
              type="button"
              onClick={() => onOpenTravel(event!.id)}
              className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] bg-cyan-500/10 text-[var(--color-text-muted)] text-xs font-semibold hover:bg-cyan-500/20 transition-colors"
            >
              ✈️ Travel Details
            </button>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] text-xs font-semibold hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!form.title.trim()}
            className="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-xs font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isNew ? "Add Event" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
