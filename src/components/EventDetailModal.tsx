"use client";

import { CalendarEvent, Kid, EVENT_TYPE_CONFIG, Profile } from "@/lib/types";
import { formatShortDate, formatTime } from "@/lib/dates";
import { X, Pencil, Trash2, MapPin, Clock, User, FileText, Plane } from "lucide-react";

interface EventDetailModalProps {
  event: CalendarEvent;
  kids: Kid[];
  members: Profile[];
  onEdit: () => void;
  onDelete: (id: string) => void;
  onOpenTravel?: (eventId: string) => void;
  onClose: () => void;
}

export default function EventDetailModal({
  event,
  kids,
  members,
  onEdit,
  onDelete,
  onOpenTravel,
  onClose,
}: EventDetailModalProps) {
  const kid = kids.find((k) => k.id === event.kid_id);
  const creator = members.find((m) => m.id === event.created_by);
  const typeConfig = EVENT_TYPE_CONFIG[event.event_type];

  const handleDelete = () => {
    if (window.confirm("Delete this event? This cannot be undone.")) {
      onDelete(event.id);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header bar with kid color */}
        <div
          className="h-2 rounded-t-2xl"
          style={{ backgroundColor: kid?.color || "var(--color-accent)" }}
        />

        <div className="p-6">
          {/* Top row: type badge + close */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{typeConfig.icon}</span>
              <span
                className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: `${kid?.color || "var(--color-accent)"}18`,
                  color: kid?.color || "var(--color-accent)",
                }}
              >
                {typeConfig.label}
              </span>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-[var(--color-input)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Title */}
          <h2 className="font-display text-xl text-[var(--color-text)] mb-4">
            {event.title}
          </h2>

          {/* Details grid */}
          <div className="space-y-3 mb-6">
            {/* Kid */}
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: `${kid?.color || "var(--color-accent)"}22`,
                  color: kid?.color || "var(--color-accent)",
                }}
              >
                {kid?.name?.charAt(0) || "?"}
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Child</div>
                <div className="text-sm font-medium text-[var(--color-text)]">{kid?.name || "Unknown"}</div>
              </div>
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)]">
                <Clock size={14} />
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">When</div>
                <div className="text-sm font-medium text-[var(--color-text)]">
                  {event.all_day ? (
                    <>{formatShortDate(event.starts_at)} — All day</>
                  ) : (
                    <>
                      {formatShortDate(event.starts_at)}
                      <span className="text-[var(--color-text-faint)] mx-1.5">·</span>
                      {formatTime(event.starts_at)} – {formatTime(event.ends_at)}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Location */}
            {event.location && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)]">
                  <MapPin size={14} />
                </div>
                <div>
                  <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Location</div>
                  <div className="text-sm font-medium text-[var(--color-text)]">{event.location}</div>
                </div>
              </div>
            )}

            {/* Notes */}
            {event.notes && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                  <FileText size={14} />
                </div>
                <div>
                  <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Notes</div>
                  <div className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">
                    {event.notes}
                  </div>
                </div>
              </div>
            )}

            {/* Created by */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)]">
                <User size={14} />
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Created by</div>
                <div className="text-sm font-medium text-[var(--color-text)]">
                  {creator?.full_name || "Unknown"}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-divider)]">
            <button
              onClick={handleDelete}
              className="px-3.5 py-2.5 rounded-xl border border-[var(--color-tag-deleted-bg)] bg-red-500/10 text-[var(--color-tag-deleted-text)] text-xs font-semibold hover:bg-red-500/20 transition-colors flex items-center gap-1.5"
            >
              <Trash2 size={12} />
              Delete
            </button>

            {event.event_type === "travel" && onOpenTravel && (
              <button
                onClick={() => onOpenTravel(event.id)}
                className="px-3.5 py-2.5 rounded-xl border border-[var(--color-border)] bg-cyan-500/10 text-[var(--color-text-muted)] text-xs font-semibold hover:bg-cyan-500/20 transition-colors flex items-center gap-1.5"
              >
                <Plane size={12} />
                Travel Details
              </button>
            )}

            <div className="flex-1" />

            <button
              onClick={onEdit}
              className="px-5 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-xs font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all flex items-center gap-1.5"
            >
              <Pencil size={12} />
              Edit Event
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
