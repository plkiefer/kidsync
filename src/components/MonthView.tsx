"use client";

import { CalendarEvent, Kid, EVENT_TYPE_CONFIG, getEventKidIds, getEventIcon, getEventTypeColor } from "@/lib/types";
import { getCalendarDays, isSameDay, isSameMonth, isToday, parseTimestamp } from "@/lib/dates";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  getCustodyForDate?: (date: Date) => Record<string, { parentId: string; isParentA: boolean }>;
  currentUserId?: string;
}

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PARENT_A_COLOR = "rgba(59, 130, 246, 0.07)";
const PARENT_B_COLOR = "rgba(249, 115, 22, 0.07)";
const PARENT_A_COLOR_STRONG = "rgba(59, 130, 246, 0.12)";
const PARENT_B_COLOR_STRONG = "rgba(249, 115, 22, 0.12)";

export default function MonthView({
  currentDate,
  events,
  kids,
  onDayClick,
  onEventClick,
  getCustodyForDate,
  currentUserId,
}: MonthViewProps) {
  const days = getCalendarDays(currentDate);

  // Group into weeks
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const getEventsForDay = (date: Date) =>
    events.filter((e) => isSameDay(parseTimestamp(e.starts_at), date));

  const getEventKids = (event: CalendarEvent) => {
    const kidIds = getEventKidIds(event);
    return kids.filter((k) => kidIds.includes(k.id));
  };

  /** Check if a day has a custody turnover event */
  const isTurnoverDay = (dayEvents: CalendarEvent[]) =>
    dayEvents.some((e) => e.id.startsWith("turnover-"));

  /** Get the previous calendar day */
  const getPrevDay = (date: Date): Date => {
    const prev = new Date(date);
    prev.setDate(prev.getDate() - 1);
    return prev;
  };

  return (
    <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] overflow-hidden flex flex-col flex-1">
      {/* Day headers */}
      <div className="grid grid-cols-7 shrink-0">
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
      <div className="flex-1 flex flex-col">
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 flex-1">
          {week.map((day, di) => {
            const dayEvents = getEventsForDay(day);
            const today = isToday(day);
            const inMonth = isSameMonth(day, currentDate);

            // Custody underlay
            let custodyBg: string | undefined;
            let isSplitDay = false;

            if (getCustodyForDate && !today) {
              const custody = getCustodyForDate(day);
              const kidIds = Object.keys(custody);
              const hasTurnover = isTurnoverDay(dayEvents);

              if (kidIds.length > 0) {
                const allSame = kidIds.every(
                  (k) => custody[k].isParentA === custody[kidIds[0]].isParentA
                );

                if (hasTurnover && allSame) {
                  // Split-day: get previous day's custody to determine "from" color
                  const prevCustody = getCustodyForDate(getPrevDay(day));
                  const prevKids = Object.keys(prevCustody);
                  if (prevKids.length > 0) {
                    const prevAllSame = prevKids.every(
                      (k) => prevCustody[k].isParentA === prevCustody[prevKids[0]].isParentA
                    );
                    if (prevAllSame && prevCustody[prevKids[0]].isParentA !== custody[kidIds[0]].isParentA) {
                      isSplitDay = true;
                      const topColor = prevCustody[prevKids[0]].isParentA
                        ? PARENT_A_COLOR_STRONG
                        : PARENT_B_COLOR_STRONG;
                      const bottomColor = custody[kidIds[0]].isParentA
                        ? PARENT_A_COLOR_STRONG
                        : PARENT_B_COLOR_STRONG;
                      custodyBg = `linear-gradient(to bottom, ${topColor} 0%, ${topColor} 45%, transparent 45%, transparent 55%, ${bottomColor} 55%, ${bottomColor} 100%)`;
                    }
                  }
                }

                if (!isSplitDay) {
                  if (allSame) {
                    custodyBg = custody[kidIds[0]].isParentA
                      ? PARENT_A_COLOR
                      : PARENT_B_COLOR;
                  } else {
                    custodyBg =
                      "repeating-linear-gradient(135deg, rgba(59,130,246,0.05) 0px, rgba(59,130,246,0.05) 4px, rgba(249,115,22,0.05) 4px, rgba(249,115,22,0.05) 8px)";
                  }
                }
              }
            }

            return (
              <div
                key={di}
                onClick={() => onDayClick(day)}
                className={`
                  min-h-0 p-1.5 cursor-pointer transition-colors border-r border-b border-[var(--color-divider)]
                  ${today ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-alt)]/60"}
                  ${di === 6 ? "border-r-0" : ""}
                  ${wi === weeks.length - 1 ? "border-b-0" : ""}
                `}
                style={custodyBg ? { background: custodyBg } : undefined}
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
                  const typeColor = getEventTypeColor(evt);

                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(evt);
                      }}
                      className="text-[10px] px-1.5 py-0.5 mb-0.5 rounded truncate cursor-pointer font-semibold transition-opacity hover:opacity-80 flex items-center gap-0.5"
                      style={{
                        backgroundColor: `${typeColor}20`,
                        borderLeft: `2.5px solid ${typeColor}`,
                        color: typeColor,
                      }}
                    >
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
    </div>
  );
}
