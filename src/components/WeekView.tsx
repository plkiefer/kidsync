"use client";

import { useEffect, useRef } from "react";
import { CalendarEvent, Kid, getEventKidIds, getEventTypeColor } from "@/lib/types";
import {
  isToday,
  formatTime,
  parseTimestamp,
  getHourFromDateStr,
  eventCoversDay,
  getWeekDays,
} from "@/lib/dates";

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  onDayClick?: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  getCustodyForDate?: (date: Date) => Record<string, { parentId: string; isParentA: boolean }>;
  currentUserId?: string;
  /** parent_a (alt-weekend parent) UUID. See MonthView for color rationale. */
  parentAId?: string;
}

const HOUR_HEIGHT = 56;
const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getTimeRange(events: CalendarEvent[]): [number, number] {
  const timedEvents = events.filter((e) => !e.all_day);
  if (timedEvents.length === 0) return [7, 20];
  let earliest = 24;
  let latest = 0;
  for (const evt of timedEvents) {
    const startH = getHourFromDateStr(evt.starts_at);
    const endH = getHourFromDateStr(evt.ends_at);
    if (startH < earliest) earliest = startH;
    if (endH > latest) latest = endH;
  }
  return [Math.max(0, Math.floor(earliest) - 1), Math.min(24, Math.ceil(latest) + 1)];
}

/** Format a Date to a compact calendar time like "3:00p" / "10:15a". */
function formatShortTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const meridian = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, "0");
  return `${h12}:${mm}${meridian}`;
}

export default function WeekView({
  currentDate,
  events,
  kids,
  onDayClick,
  onEventClick,
  getCustodyForDate,
  currentUserId,
  parentAId,
}: WeekViewProps) {
  const days = getWeekDays(currentDate);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [startHour, endHour] = getTimeRange(events);
  const totalHours = endHour - startHour;
  const gridHeight = totalHours * HOUR_HEIGHT;

  const hours = Array.from({ length: totalHours }, (_, i) => startHour + i);

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
      .filter(
        (e) =>
          eventCoversDay(e.starts_at, e.ends_at, e.all_day, date) &&
          (allDay ? e.all_day : !e.all_day)
      )
      .sort(
        (a, b) =>
          parseTimestamp(a.starts_at).getTime() - parseTimestamp(b.starts_at).getTime()
      );

  const getEventKidsFor = (event: CalendarEvent) => {
    const kidIds = getEventKidIds(event);
    return kids.filter((k) => kidIds.includes(k.id));
  };

  const singleKidIndicator = (evt: CalendarEvent): "ethan" | "harrison" | null => {
    if (evt.id.startsWith("holiday-")) return null;
    const evtKids = getEventKidsFor(evt);
    if (evtKids.length !== 1) return null;
    const idx = kids.findIndex((k) => k.id === evtKids[0].id);
    if (idx === 0) return "ethan";
    if (idx === 1) return "harrison";
    return null;
  };

  const getTopAndHeight = (evt: CalendarEvent) => {
    const startH = getHourFromDateStr(evt.starts_at);
    const endH = getHourFromDateStr(evt.ends_at);
    const top = (startH - startHour) * HOUR_HEIGHT;
    const height = Math.max((endH - startH) * HOUR_HEIGHT, 22);
    return { top, height };
  };

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

  /** Token-based custody bg for a week-day column.
   *   You  → --you-bg  (cool paper)
   *   Them → --them-bg (warm cream)
   *   Turnover this day → vertical gradient that splits at the handoff
   *     time (top = pre-handoff parent, bottom = post-handoff parent).
   *   Kids diverge (no turnover) → horizontal 50/50 split between kids.
   */
  function custodyBgFor(day: Date, dayEvents: CalendarEvent[]): string | undefined {
    if (!getCustodyForDate || !currentUserId) return undefined;
    const custody = getCustodyForDate(day);
    const kidIds = Object.keys(custody);
    if (kidIds.length === 0) return undefined;

    const firstParentId = custody[kidIds[0]].parentId;
    const allSame = kidIds.every((k) => custody[k].parentId === firstParentId);
    // Parent-role-based color identity (see MonthView). parent_a → cool,
    // parent_b → cream, regardless of which user is signed in.
    const colorFor = (parentId: string | undefined): string => {
      if (parentAId) {
        return parentId === parentAId
          ? "var(--them-bg)"
          : "var(--you-bg)";
      }
      return parentId === currentUserId
        ? "var(--you-bg)"
        : "var(--them-bg)";
    };

    // If there's a turnover (custody transition) on this day, split the
    // column vertically at the handoff time so each parent owns their
    // portion of the column.
    const turnoverEvt = dayEvents.find((e) => e.id.startsWith("turnover-"));
    if (turnoverEvt && allSame) {
      const isPickup = turnoverEvt.id.endsWith("-pickup");
      const turnoverHour = getHourFromDateStr(turnoverEvt.starts_at);
      const rawPct = ((turnoverHour - startHour) / totalHours) * 100;
      const splitPct = Math.max(0, Math.min(100, rawPct));

      const adjacent = new Date(day);
      adjacent.setDate(adjacent.getDate() + (isPickup ? -1 : 1));
      const adjacentCustody = getCustodyForDate(adjacent);
      const adjacentParentId = adjacentCustody[kidIds[0]]?.parentId;

      const todayColor = colorFor(firstParentId);
      const adjacentColor = colorFor(adjacentParentId);

      // Pickup day: adjacent (yesterday) parent owns the top, today's
      // parent owns the bottom. Dropoff day: today's parent owns the
      // top, adjacent (tomorrow) parent owns the bottom.
      const preBg = isPickup ? adjacentColor : todayColor;
      const postBg = isPickup ? todayColor : adjacentColor;
      return `linear-gradient(to bottom, ${preBg} 0%, ${preBg} ${splitPct}%, ${postBg} ${splitPct}%, ${postBg} 100%)`;
    }

    if (allSame) {
      return colorFor(firstParentId);
    }

    // Kid-split (rare) — split horizontally 50/50 for each kid's parent.
    const ordered = kids.map((k) => k.id).filter((id) => custody[id]);
    const topBg = colorFor(custody[ordered[0]]?.parentId);
    const bottomBg = colorFor(custody[ordered[1]]?.parentId);
    return `linear-gradient(to bottom, ${topBg} 50%, ${bottomBg} 50%)`;
  }

  const kidIndicatorClass: Record<"ethan" | "harrison", string> = {
    ethan: "bg-kid-ethan",
    harrison: "bg-kid-harrison",
  };

  return (
    <div className="bg-[var(--bg)] border border-[var(--border-strong)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col flex-1">
      {/* Day headers + all-day events */}
      <div className="shrink-0 border-b-[3px] border-[var(--border-heavy)]">
        <div className="grid" style={{ gridTemplateColumns: "52px repeat(7, 1fr)" }}>
          <div className="border-r border-[var(--border)]" />
          {days.map((date, i) => {
            const today = isToday(date);
            const allDayEvents = getEventsForDay(date, true);
            return (
              <div
                key={i}
                className="px-1 py-2 text-center border-r border-[var(--border-strong)] last:border-r-0"
              >
                <div className="text-[10.5px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em]">
                  {DAY_HEADERS[i]}
                </div>
                <div
                  className={`
                    inline-flex items-center justify-center w-8 h-8 text-base font-semibold tabular-nums
                    ${today ? "bg-action text-action-fg rounded-sm" : "text-[var(--ink)]"}
                  `}
                >
                  {date.getDate()}
                </div>
                {/* All-day events */}
                {allDayEvents.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {allDayEvents.map((evt) => {
                      const typeColor = getEventTypeColor(evt);
                      const kidBadge = singleKidIndicator(evt);
                      return (
                        <div
                          key={evt.id}
                          onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                          className="flex items-center gap-1 text-[10.5px] px-1 py-0.5 truncate cursor-pointer font-medium border-l-[3px] bg-white text-[var(--ink)] shadow-[0_0_0_1px_var(--border)]"
                          style={{ borderLeftColor: typeColor }}
                        >
                          {kidBadge && (
                            <span
                              className={`
                                inline-flex items-center justify-center shrink-0
                                w-[12px] h-[12px] rounded-sm
                                text-[7px] font-bold text-white
                                ${kidIndicatorClass[kidBadge]}
                              `}
                            >
                              {kidBadge === "ethan" ? "E" : "H"}
                            </span>
                          )}
                          <span className="truncate">{evt.title}</span>
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
          <div className="relative border-r border-[var(--border)]">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[10.5px] text-[var(--text-muted)] font-medium -translate-y-1/2 tabular-nums"
                style={{ top: (hour - startHour) * HOUR_HEIGHT }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((date, i) => {
            const timedEvents = getEventsForDay(date, false);
            const custodyBg = custodyBgFor(date, timedEvents);

            return (
              <div
                key={i}
                className="relative border-r border-[var(--border-strong)] last:border-r-0"
                style={custodyBg ? { background: custodyBg } : undefined}
                onClick={() => onDayClick?.(date)}
              >
                {/* Hour gridlines */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-[var(--border)]/60"
                    style={{ top: (hour - startHour) * HOUR_HEIGHT }}
                  />
                ))}

                {/* Events */}
                {timedEvents.map((evt) => {
                  const typeColor = getEventTypeColor(evt);
                  const kidBadge = singleKidIndicator(evt);
                  const { top, height } = getTopAndHeight(evt);
                  const dashed = evt._tentative;
                  const timeStr = formatShortTime(parseTimestamp(evt.starts_at));

                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                      className={`
                        absolute left-0.5 right-0.5 px-1 py-0.5 overflow-hidden
                        bg-white text-[var(--ink)]
                        border-l-[3px]
                        ${dashed ? "border-dashed opacity-75" : "border-solid"}
                        shadow-[0_0_0_1px_var(--border)]
                        cursor-pointer hover:translate-x-[1px] transition-transform
                      `}
                      style={{
                        top,
                        height,
                        borderLeftColor: typeColor,
                        zIndex: 10,
                      }}
                    >
                      <div className="flex items-center gap-1 text-[11px] font-medium">
                        {kidBadge && (
                          <span
                            className={`
                              inline-flex items-center justify-center shrink-0
                              w-[14px] h-[14px] rounded-sm
                              text-[8px] font-bold text-white
                              ${kidIndicatorClass[kidBadge]}
                            `}
                          >
                            {kidBadge === "ethan" ? "E" : "H"}
                          </span>
                        )}
                        <span className="truncate">{evt.title}</span>
                      </div>
                      {height > 30 && (
                        <div className="text-[10px] tabular-nums text-[var(--text-muted)] truncate mt-0.5">
                          {timeStr} – {formatTime(evt.ends_at)}
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
              className="absolute h-[2px] bg-action z-20 pointer-events-none"
              style={{
                top: nowTop,
                left: `calc(52px + ${todayInWeek} * ((100% - 52px) / 7))`,
                width: `calc((100% - 52px) / 7)`,
              }}
            >
              <div className="absolute -left-1 -top-[3px] w-2 h-2 rounded-sm bg-action" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
