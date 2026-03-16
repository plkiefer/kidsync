"use client";

import { CalendarEvent, Kid, Profile, EVENT_TYPE_CONFIG, getEventKidIds, getEventIcon, getEventTypeColor } from "@/lib/types";
import {
  isSameMonth,
  formatShortDate,
  formatTime,
  parseTimestamp,
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
    .filter((e) => isSameMonth(parseTimestamp(e.starts_at), currentDate))
    .sort(
      (a, b) =>
        parseTimestamp(a.starts_at).getTime() - parseTimestamp(b.starts_at).getTime()
    );

  const getEventKidsFor = (event: CalendarEvent) => {
    const kidIds = getEventKidIds(event);
    return kids.filter((k) => kidIds.includes(k.id));
  };
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
        const evtKids = getEventKidsFor(evt);
        const creator = getMember(evt.created_by);
        const typeColor = getEventTypeColor(evt);
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
            style={{ borderLeft: `4px solid ${typeColor}` }}
          >
            {/* Type icon */}
            <div className="text-xl shrink-0">{getEventIcon(evt)}</div>

            {/* Event info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--color-text)] truncate">
                  {evt.title}
                </span>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: `${typeColor}20`,
                    color: typeColor,
                  }}
                >
                  {typeConfig?.label || "Event"}
                </span>
              </div>
              <div className="text-xs text-[var(--color-text-faint)]">
                {formatShortDate(evt.starts_at)} ·{" "}
                {evt.all_day ? "All day" : `${formatTime(evt.starts_at)} – ${formatTime(evt.ends_at)}`}
              </div>
              {evt.notes && (
                <div className="text-[11px] text-[var(--color-text-faint)] mt-0.5 truncate">
                  {evt.notes}
                </div>
              )}
            </div>

            {/* Kid badges + creator */}
            <div className="text-right shrink-0">
              <div className="flex items-center gap-1.5 justify-end mb-1">
                {evtKids.map((kid) => (
                  <div
                    key={kid.id}
                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md"
                    style={{
                      backgroundColor: `${kid.color}22`,
                      color: kid.color,
                    }}
                  >
                    <span
                      className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full text-[8px] font-bold text-white"
                      style={{ backgroundColor: kid.color }}
                    >
                      {kid.name.charAt(0)}
                    </span>
                    {kid.name}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-[var(--color-text-faint)]">
                by {creator?.full_name || "Unknown"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
