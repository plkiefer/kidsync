"use client";

import { CalendarEvent, Kid, EVENT_TYPE_CONFIG, getEventKidIds, getEventIcon } from "@/lib/types";
import { getCalendarDays, isSameDay, isSameMonth, isToday } from "@/lib/dates";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthView({
  currentDate,
  events,
  kids,
  onDayClick,
  onEventClick,
}: MonthViewProps) {
  const days = getCalendarDays(currentDate);

  // Group into weeks
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const getEventsForDay = (date: Date) =>
    events.filter((e) => isSameDay(new Date(e.starts_at), date));

  const getEventKids = (event: CalendarEvent) => {
    const kidIds = getEventKidIds(event);
    return kids.filter((k) => kidIds.includes(k.id));
  };

  return (
    <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="px-2 py-3 text-center text-xs font-bold text-[var(--color-text-faint)] uppercase tracking-wider border-b border-[var(--color-divider)]"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day, di) => {
            const dayEvents = getEventsForDay(day);
            const today = isToday(day);
            const inMonth = isSameMonth(day, currentDate);

            return (
              <div
                key={di}
                onClick={() => onDayClick(day)}
                className={`
                  min-h-[100px] p-1.5 cursor-pointer transition-colors border-r border-b border-[var(--color-divider)]
                  ${today ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-alt)]/60"}
                  ${di === 6 ? "border-r-0" : ""}
                  ${wi === weeks.length - 1 ? "border-b-0" : ""}
                `}
              >
                {/* Day number */}
                <div
                  className={`
                    w-7 h-7 flex items-center justify-center rounded-full text-xs font-medium mb-1
                    ${
                      today
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-bold"
                        : inMonth
                        ? "text-[var(--color-text-muted)]"
                        : "text-[var(--color-text-faint)]"
                    }
                  `}
                >
                  {day.getDate()}
                </div>

                {/* Events */}
                {dayEvents.slice(0, 3).map((evt) => {
                  const evtKids = getEventKids(evt);
                  const primaryColor = evtKids[0]?.color || "var(--color-kid-2)";
                  const typeConfig = EVENT_TYPE_CONFIG[evt.event_type];
                  const borderStyle =
                    evtKids.length > 1
                      ? { borderImage: `linear-gradient(to bottom, ${evtKids.map((k) => k.color).join(", ")}) 1` }
                      : {};

                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(evt);
                      }}
                      className="text-[10px] px-1.5 py-0.5 mb-0.5 rounded truncate cursor-pointer font-semibold transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: `${primaryColor}22`,
                        borderLeft: `2.5px solid ${primaryColor}`,
                        color: primaryColor,
                        ...borderStyle,
                      }}
                    >
                      {getEventIcon(evt)} {evt.title}
                    </div>
                  );
                })}

                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-[var(--color-text-faint)] pl-1.5">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
