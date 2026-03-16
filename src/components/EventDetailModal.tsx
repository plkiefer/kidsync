"use client";

import { CalendarEvent, Kid, EVENT_TYPE_CONFIG, Profile, EventAttachment, getEventKidIds, getEventIcon, getEventTypeColor, describeRRule } from "@/lib/types";
import { formatShortDate, formatTime } from "@/lib/dates";
import { X, Pencil, Trash2, MapPin, Clock, User, FileText, Plane, Repeat, Building2, Paperclip, Download } from "lucide-react";

interface EventDetailModalProps {
  event: CalendarEvent;
  kids: Kid[];
  members: Profile[];
  onEdit: () => void;
  onDelete: (id: string) => void;
  onOpenTravel?: (eventId: string) => void;
  onClose: () => void;
  onDownloadAttachment?: (attachment: EventAttachment) => void;
}

export default function EventDetailModal({
  event,
  kids,
  members,
  onEdit,
  onDelete,
  onOpenTravel,
  onClose,
  onDownloadAttachment,
}: EventDetailModalProps) {
  const kidIds = getEventKidIds(event);
  const eventKids = kids.filter((k) => kidIds.includes(k.id));
  const creator = members.find((m) => m.id === event.created_by);
  const typeConfig = EVENT_TYPE_CONFIG[event.event_type as keyof typeof EVENT_TYPE_CONFIG];
  const travel = event.travel;
  const firstFlight = travel?.flights?.[0];

  const handleDelete = () => {
    if (window.confirm("Delete this event? This cannot be undone.")) {
      onDelete(event.id);
    }
  };

  // Color bar — driven by event type
  const typeColor = getEventTypeColor(event);
  const colorBarStyle = { backgroundColor: typeColor };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-md border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        <div className="h-2 rounded-t-2xl" style={colorBarStyle} />

        <div className="p-6">
          {/* Top row */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{getEventIcon(event)}</span>
              <span
                className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{
                  backgroundColor: `${typeColor}20`,
                  color: typeColor,
                }}
              >
                {typeConfig?.label || "Event"}
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

          <div className="space-y-3 mb-6">
            {/* Kids */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 shrink-0">
                {eventKids.map((kid) => (
                  <div
                    key={kid.id}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: kid.color }}
                    title={kid.name}
                  >
                    {kid.name.charAt(0)}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">
                  {eventKids.length > 1 ? "Children" : "Child"}
                </div>
                <div className="flex items-center gap-2">
                  {eventKids.map((kid) => (
                    <span key={kid.id} className="text-sm font-medium" style={{ color: kid.color }}>
                      {kid.name}
                    </span>
                  ))}
                </div>
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

            {/* Recurrence */}
            {event.recurring_rule && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)]">
                  <Repeat size={14} />
                </div>
                <div>
                  <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Repeats</div>
                  <div className="text-sm font-medium text-[var(--color-text)]">
                    {describeRRule(event.recurring_rule)}
                  </div>
                </div>
              </div>
            )}

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

            {/* Inline travel info */}
            {event.event_type === "travel" && travel && (
              <>
                {firstFlight && firstFlight.departure_airport && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-600">
                      <Plane size={14} />
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Flight</div>
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {firstFlight.departure_airport} → {firstFlight.arrival_airport}
                        {firstFlight.departure_time && (
                          <span className="text-[var(--color-text-faint)] ml-2 text-xs">
                            {formatTime(firstFlight.departure_time)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {travel.lodging_name && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
                      <Building2 size={14} />
                    </div>
                    <div>
                      <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">Lodging</div>
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {travel.lodging_name}
                        {travel.lodging_address && (
                          <div className="text-xs text-[var(--color-text-faint)]">{travel.lodging_address}</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
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

            {/* Attachments */}
            {event.attachments && event.attachments.length > 0 && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-input)] flex items-center justify-center text-[var(--color-text-muted)] shrink-0">
                  <Paperclip size={14} />
                </div>
                <div className="flex-1">
                  <div className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">Attachments</div>
                  <div className="space-y-1">
                    {event.attachments.map((att, i) => (
                      <button
                        key={i}
                        onClick={() => onDownloadAttachment?.(att)}
                        className="flex items-center gap-2 text-xs text-[var(--color-accent)] bg-[var(--color-accent-soft)] rounded-lg px-2.5 py-1.5 w-full text-left hover:opacity-80 transition-opacity"
                      >
                        <Download size={10} />
                        <span className="flex-1 truncate">{att.name}</span>
                        <span className="text-[var(--color-text-faint)] shrink-0">
                          {(att.size / 1024).toFixed(0)}KB
                        </span>
                      </button>
                    ))}
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
