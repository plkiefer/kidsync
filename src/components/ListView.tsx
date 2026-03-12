"use client";

import { CalendarEvent, Kid, Profile, EVENT_TYPE_CONFIG } from "@/lib/types";
import {
  isSameMonth,
  formatShortDate,
  formatTime,
} from "@/lib/dates";

interface ListViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  members: Profile[];
  onEventClick: (event: CalendarEvent) => void;
}

export default function ListView({
  currentDate,
  events,
  kids,
  members,
  onEventClick,
}: ListViewProps) {
  const monthEvents = events
    .filter((e) => isSameMonth(new Date(e.starts_at), currentDate))
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    );

  const getKid = (kidId: string) => kids.find((k) => k.id === kidId);
  const getMember = (userId: string) => members.find((m) => m.id === userId);

  if (monthEvents.length === 0) {
    return (
      <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] p-12 text-center">
        <span className="text-4xl mb-3 block">📅</span>
        <p className="text-[var(--color-text-muted)] text-sm">No events this month</p>
        <p className="text-[var(--color-text-faint)] text-xs mt-1">
          Click the + button to add one
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] overflow-hidden">
      {monthEvents.map((evt, i) => {
        const kid = getKid(evt.kid_id);
        const creator = getMember(evt.created_by);
        const typeConfig = EVENT_TYPE_CONFIG[evt.event_type];

        return (
          <div
            key={evt.id}
            onClick={() => onEventClick(evt)}
            className={`
              flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors
              hover:bg-[var(--color-surface-alt)]/60
              ${i < monthEvents.length - 1 ? "border-b border-[var(--color-divider)]" : ""}
            `}
          >
            {/* Type icon */}
            <div className="text-xl shrink-0">{typeConfig.icon}</div>

            {/* Event info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                {evt.title}
              </div>
              <div className="text-xs text-[var(--color-text-faint)]">
                {formatShortDate(evt.starts_at)} ·{" "}
                {formatTime(evt.starts_at)} – {formatTime(evt.ends_at)}
              </div>
              {evt.notes && (
                <div className="text-[11px] text-[var(--color-text-faint)] mt-0.5 truncate">
                  {evt.notes}
                </div>
              )}
            </div>

            {/* Kid badge + creator */}
            <div className="text-right shrink-0">
              <div
                className="text-[11px] font-semibold px-2.5 py-1 rounded-md mb-1 inline-block"
                style={{
                  backgroundColor: `${kid?.color || "var(--color-kid-2)"}22`,
                  color: kid?.color || "var(--color-kid-2)",
                }}
              >
                {kid?.name}
              </div>
              <div className="text-[10px] text-[var(--color-text-faint)]">
                by {creator?.full_name || "Unknown"}
              </div>
            </div>

            {/* Travel indicator */}
            {evt.event_type === "travel" && (
              <div className="text-xs" title="Travel event">
                ✈️
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
