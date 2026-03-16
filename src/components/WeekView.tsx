"use client";

import { CalendarEvent, Kid, EVENT_TYPE_CONFIG, getEventKidIds, getEventIcon, getEventTypeColor } from "@/lib/types";
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
  onDayClick?: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeekView({
  currentDate,
  events,
  kids,
  onDayClick,
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

  const getEventKidsFor = (event: CalendarEvent) => {
    const kidIds = getEventKidIds(event);
    return kids.filter((k) => kidIds.includes(k.id));
  };

  return (
    <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7">
        {days.map((date, i) => {
          const today = isToday(date);
          return (
            <div
              key={i}
              className={`
                px-2 py-3 text-center border-b border-[var(--color-divider)]
                ${i < 6 ? "border-r border-r-[var(--color-divider)]" : ""}
              `}
            >
              <div className="text-xs font-bold text-[var(--color-text-faint)] uppercase tracking-wider">
                {DAY_HEADERS[i]}
              </div>
              <div
                className={`
                  inline-flex items-center justify-center w-8 h-8 rounded-full text-lg font-semibold mt-0.5
                  ${today
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text)]"
                  }
                `}
              >
                {date.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Events grid */}
      <div className="grid grid-cols-7 min-h-[420px]">
        {days.map((date, i) => {
          const dayEvents = getEventsForDay(date);
          const today = isToday(date);

          return (
            <div
              key={i}
              onClick={() => onDayClick?.(date)}
              className={`
                p-1.5 cursor-pointer border-[var(--color-divider)]
                ${i < 6 ? "border-r" : ""}
                ${today ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-alt)]/60"}
              `}
            >
              <div className="space-y-1">
                {dayEvents.map((evt) => {
                  const evtKids = getEventKidsFor(evt);
                  const typeColor = getEventTypeColor(evt);

                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(evt);
                      }}
                      className="text-[11px] px-1.5 py-1 rounded cursor-pointer font-semibold transition-opacity hover:opacity-80"
                      style={{
                        backgroundColor: `${typeColor}20`,
                        borderLeft: `2.5px solid ${typeColor}`,
                        color: typeColor,
                      }}
                    >
                      <div className="flex items-center gap-0.5">
                        {evtKids.map((k) => (
                          <span
                            key={k.id}
                            className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full text-[7px] font-bold text-white shrink-0"
                            style={{ backgroundColor: k.color }}
                            title={k.name}
                          >
                            {k.name.charAt(0)}
                          </span>
                        ))}
                        <span className="truncate ml-0.5">
                          {getEventIcon(evt)} {evt.title}
                        </span>
                      </div>
                      <div className="text-[9px] font-normal opacity-70 truncate">
                        {evt.all_day ? "All day" : formatTime(evt.starts_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
