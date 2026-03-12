"use client";

import { CalendarEvent, Kid, EVENT_TYPE_CONFIG } from "@/lib/types";
import {
  getWeekDays,
  isSameDay,
  isToday,
  format,
  formatTime,
} from "@/lib/dates";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  onEventClick: (event: CalendarEvent) => void;
}

export default function WeekView({
  currentDate,
  events,
  kids,
  onEventClick,
}: WeekViewProps) {
  const days = getWeekDays(currentDate);

  const getEventsForDay = (date: Date) =>
    events
      .filter((e) => isSameDay(new Date(e.starts_at), date))
      .sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );

  const getKid = (kidId: string) => kids.find((k) => k.id === kidId);

  return (
    <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] overflow-hidden">
      {days.map((date, i) => {
        const dayEvents = getEventsForDay(date);
        const today = isToday(date);

        return (
          <div
            key={i}
            className={`
              px-4 py-3 border-b border-[var(--color-divider)] last:border-b-0
              ${today ? "bg-[var(--color-accent-soft)]" : ""}
            `}
          >
            {/* Day header */}
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-sm font-medium ${
                  today ? "text-[var(--color-accent)] font-bold" : "text-[var(--color-text-muted)]"
                }`}
              >
                {format(date, "EEE, MMM d")}
              </span>
              {today && (
                <span className="text-[10px] font-bold text-blue-400/70 uppercase tracking-wider">
                  Today
                </span>
              )}
            </div>

            {/* Events */}
            {dayEvents.length === 0 ? (
              <div className="text-xs text-[var(--color-text-faint)] py-1">No events</div>
            ) : (
              <div className="space-y-1.5">
                {dayEvents.map((evt) => {
                  const kid = getKid(evt.kid_id);
                  const typeConfig = EVENT_TYPE_CONFIG[evt.event_type];

                  return (
                    <div
                      key={evt.id}
                      onClick={() => onEventClick(evt)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all hover:scale-[1.01] hover:shadow-lg"
                      style={{
                        backgroundColor: `${kid?.color || "var(--color-kid-2)"}11`,
                        borderLeft: `3px solid ${kid?.color || "var(--color-kid-2)"}`,
                      }}
                    >
                      <span className="text-base">{typeConfig.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                          {evt.title}
                        </div>
                        <div className="text-xs text-[var(--color-text-faint)] truncate">
                          {formatTime(evt.starts_at)} — {kid?.name}
                          {evt.notes && ` · ${evt.notes}`}
                        </div>
                      </div>
                      <div
                        className="text-[10px] font-semibold px-2.5 py-1 rounded-md shrink-0"
                        style={{
                          backgroundColor: `${kid?.color || "var(--color-kid-2)"}22`,
                          color: kid?.color || "var(--color-kid-2)",
                        }}
                      >
                        {kid?.name}
                      </div>
                      {evt.event_type === "travel" && (
                        <span className="text-xs" title="Has travel details">
                          ✈️
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
