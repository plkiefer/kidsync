"use client";

import { useEffect, useRef } from "react";
import { CalendarEvent, Kid, EVENT_TYPE_CONFIG, getEventKidIds, getEventIcon, getEventTypeColor } from "@/lib/types";
import {
  getWeekDays,
  isSameDay,
  isToday,
  formatTime,
  parseTimestamp,
  getHourFromDateStr,
} from "@/lib/dates";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  onDayClick?: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  getCustodyForDate?: (date: Date) => Record<string, { parentId: string; isParentA: boolean }>;
  currentUserId?: string;
}

const HOUR_HEIGHT = 56; // px per hour
const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getTimeRange(events: CalendarEvent[]): [number, number] {
  const timedEvents = events.filter((e) => !e.all_day);
  if (timedEvents.length === 0) return [7, 20]; // 7 AM - 8 PM default

  let earliest = 24;
  let latest = 0;
  for (const evt of timedEvents) {
    const startH = getHourFromDateStr(evt.starts_at);
    const endH = getHourFromDateStr(evt.ends_at);
    if (startH < earliest) earliest = startH;
    if (endH > latest) latest = endH;
  }

  // Pad by 1 hour on each side, clamp
  return [Math.max(0, Math.floor(earliest) - 1), Math.min(24, Math.ceil(latest) + 1)];
}

export default function WeekView({
  currentDate,
  events,
  kids,
  onDayClick,
  onEventClick,
  getCustodyForDate,
  currentUserId,
}: WeekViewProps) {
  const days = getWeekDays(currentDate);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [startHour, endHour] = getTimeRange(events);
  const totalHours = endHour - startHour;
  const gridHeight = totalHours * HOUR_HEIGHT;

  const hours = Array.from({ length: totalHours }, (_, i) => startHour + i);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      const offset = (currentHour - startHour) * HOUR_HEIGHT - 100;
      scrollRef.current.scrollTop = Math.max(0, offset);
    }
  }, [startHour]);

  const getEventsForDay = (date: Date, allDay: boolean) =>
    events
      .filter((e) => isSameDay(parseTimestamp(e.starts_at), date) && (allDay ? e.all_day : !e.all_day))
      .sort(
        (a, b) =>
          parseTimestamp(a.starts_at).getTime() - parseTimestamp(b.starts_at).getTime()
      );

  const getEventKidsFor = (event: CalendarEvent) => {
    const kidIds = getEventKidIds(event);
    return kids.filter((k) => kidIds.includes(k.id));
  };

  const getTopAndHeight = (evt: CalendarEvent) => {
    const startH = getHourFromDateStr(evt.starts_at);
    const endH = getHourFromDateStr(evt.ends_at);
    const top = (startH - startHour) * HOUR_HEIGHT;
    const height = Math.max((endH - startH) * HOUR_HEIGHT, 22); // min 22px
    return { top, height };
  };

  // Current time indicator
  const now = new Date();
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = nowHour >= startHour && nowHour <= endHour;
  const nowTop = (nowHour - startHour) * HOUR_HEIGHT;
  const todayInWeek = days.findIndex((d) => isToday(d));

  const formatHourLabel = (hour: number) => {
    const ampm = hour >= 12 ? "PM" : "AM";
    const h = hour % 12 || 12;
    return `${h} ${ampm}`;
  };

  return (
    <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] overflow-hidden flex flex-col flex-1">
      {/* Day headers + all-day events */}
      <div className="shrink-0 border-b border-[var(--color-divider)]">
        <div className="grid" style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}>
          {/* Empty gutter corner */}
          <div className="border-r border-[var(--color-divider)]" />
          {/* Day headers */}
          {days.map((date, i) => {
            const today = isToday(date);
            const allDayEvents = getEventsForDay(date, true);
            return (
              <div
                key={i}
                className={`
                  px-1 py-2 text-center border-r border-[var(--color-divider)] last:border-r-0
                  ${today ? "bg-[var(--color-today)]" : ""}
                `}
              >
                <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                  {DAY_HEADERS[i]}
                </div>
                <div
                  className={`
                    inline-flex items-center justify-center w-9 h-9 rounded-full text-base font-semibold
                    ${today ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text)]"}
                  `}
                >
                  {date.getDate()}
                </div>
                {/* All-day events */}
                {allDayEvents.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {allDayEvents.map((evt) => {
                      const evtKids = getEventKidsFor(evt);
                      const typeColor = getEventTypeColor(evt);
                      return (
                        <div
                          key={evt.id}
                          onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                          className="text-[11px] px-1.5 py-0.5 rounded truncate cursor-pointer font-semibold"
                          style={{ backgroundColor: `${typeColor}25`, color: typeColor }}
                        >
                          {evt.event_type !== "holiday" && evtKids.map((k) => k.name.charAt(0)).join("")} {getEventIcon(evt)} {evt.title}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: "52px repeat(7, 1fr)", height: gridHeight }}>
          {/* Time gutter */}
          <div className="relative border-r border-[var(--color-divider)]">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-xs text-[var(--color-text-muted)] font-medium -translate-y-1/2"
                style={{ top: (hour - startHour) * HOUR_HEIGHT }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((date, i) => {
            const timedEvents = getEventsForDay(date, false);
            const today = isToday(date);

            // Custody underlay
            let custodyBg = "";
            if (getCustodyForDate) {
              const custody = getCustodyForDate(date);
              const kidIds = Object.keys(custody);
              if (kidIds.length > 0) {
                const allSameParent = kidIds.every((k) => custody[k].isParentA === custody[kidIds[0]].isParentA);

                // Check for turnover event to create a time-based split
                const turnoverEvt = timedEvents.find((e) => e.id.startsWith("turnover-"));
                if (turnoverEvt && allSameParent) {
                  const isCurrentA = custody[kidIds[0]].isParentA;
                  const turnoverHour = getHourFromDateStr(turnoverEvt.starts_at);
                  const splitPct = ((turnoverHour - startHour) / totalHours) * 100;

                  // Check prev and next day to determine pickup vs dropoff
                  const prevDay = new Date(date);
                  prevDay.setDate(prevDay.getDate() - 1);
                  const nextDay = new Date(date);
                  nextDay.setDate(nextDay.getDate() + 1);
                  const prevCustody = getCustodyForDate(prevDay);
                  const nextCustody = getCustodyForDate(nextDay);
                  const prevKids = Object.keys(prevCustody);
                  const nextKids = Object.keys(nextCustody);
                  const prevIsA = prevKids.length > 0 && prevCustody[prevKids[0]]?.isParentA;
                  const nextIsA = nextKids.length > 0 && nextCustody[nextKids[0]]?.isParentA;

                  let topColor = "";
                  let bottomColor = "";

                  if (prevIsA !== isCurrentA) {
                    // Pickup day
                    topColor = prevIsA ? "rgba(59, 130, 246, 0.15)" : "rgba(249, 115, 22, 0.15)";
                    bottomColor = isCurrentA ? "rgba(59, 130, 246, 0.15)" : "rgba(249, 115, 22, 0.15)";
                  } else if (nextIsA !== isCurrentA) {
                    // Dropoff day
                    topColor = isCurrentA ? "rgba(59, 130, 246, 0.15)" : "rgba(249, 115, 22, 0.15)";
                    bottomColor = nextIsA ? "rgba(59, 130, 246, 0.15)" : "rgba(249, 115, 22, 0.15)";
                  }

                  if (topColor && bottomColor) {
                    custodyBg = `linear-gradient(to bottom, ${topColor} 0%, ${topColor} ${splitPct}%, transparent ${splitPct}%, transparent ${splitPct + 1}%, ${bottomColor} ${splitPct + 1}%, ${bottomColor} 100%)`;
                  }
                }

                if (!custodyBg) {
                  if (allSameParent) {
                    const isParentA = custody[kidIds[0]].isParentA;
                    custodyBg = isParentA
                      ? "rgba(59, 130, 246, 0.10)"
                      : "rgba(249, 115, 22, 0.10)";
                  } else {
                    custodyBg = "repeating-linear-gradient(135deg, rgba(59,130,246,0.08) 0px, rgba(59,130,246,0.08) 4px, rgba(249,115,22,0.08) 4px, rgba(249,115,22,0.08) 8px)";
                  }
                }
              }
            }

            return (
              <div
                key={i}
                className={`relative border-r border-[var(--color-divider)] last:border-r-0 ${today ? "bg-[var(--color-today)]" : ""}`}
                style={custodyBg && !today ? { background: custodyBg } : undefined}
                onClick={() => onDayClick?.(date)}
              >
                {/* Hour gridlines */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-[var(--color-divider)]"
                    style={{ top: (hour - startHour) * HOUR_HEIGHT }}
                  />
                ))}

                {/* Events */}
                {timedEvents.map((evt) => {
                  const evtKids = getEventKidsFor(evt);
                  const typeColor = getEventTypeColor(evt);
                  const { top, height } = getTopAndHeight(evt);

                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                      className="absolute left-0.5 right-0.5 rounded-md px-1 py-0.5 cursor-pointer overflow-hidden transition-opacity hover:opacity-90 border-l-[3px]"
                      style={{
                        top,
                        height,
                        backgroundColor: `${typeColor}20`,
                        borderLeftColor: typeColor,
                        color: typeColor,
                        zIndex: 10,
                      }}
                    >
                      <div className="flex items-center gap-1 text-xs font-bold">
                        {evt.event_type !== "holiday" && evtKids.map((k) => (
                          <span
                            key={k.id}
                            className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[9px] font-bold text-white shrink-0"
                            style={{ backgroundColor: k.color }}
                          >
                            {k.name.charAt(0)}
                          </span>
                        ))}
                        <span className="truncate">{getEventIcon(evt)} {evt.title}</span>
                      </div>
                      {height > 30 && (
                        <div className="text-[11px] opacity-70 truncate">
                          {formatTime(evt.starts_at)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Current time indicator */}
          {showNowLine && todayInWeek >= 0 && (
            <div
              className="absolute h-[2px] bg-red-500 z-20 pointer-events-none"
              style={{
                top: nowTop,
                left: `calc(52px + ${todayInWeek} * ((100% - 52px) / 7))`,
                width: `calc((100% - 52px) / 7)`,
              }}
            >
              <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
