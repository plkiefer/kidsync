"use client";

import {
  CalendarEvent,
  Kid,
  getEventKidIds,
  getEventIcon,
  getEventTypeColor,
} from "@/lib/types";
import {
  getCalendarDays,
  isSameMonth,
  isToday,
  parseTimestamp,
  eventCoversDay,
} from "@/lib/dates";
import { TransitionPill } from "./ui/TransitionPill";
import type { KidId } from "./ui/KidChip";

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

/** Map a kid to the Phase-1 KidId union used by the token system. */
function kidSlot(kid: Kid | undefined, kids: Kid[]): KidId | undefined {
  if (!kid) return undefined;
  const idx = kids.findIndex((k) => k.id === kid.id);
  if (idx === 0) return "ethan";
  if (idx === 1) return "harrison";
  return undefined;
}

/** Tailwind class for the "E"/"H" kid indicator chip inside an event. */
const kidIndicatorClass: Record<"ethan" | "harrison", string> = {
  ethan:    "bg-kid-ethan",
  harrison: "bg-kid-harrison",
};

/** Format a Date to a compact calendar time like "3:00p" / "10:15a". */
function formatShortTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const meridian = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, "0");
  return `${h12}:${mm}${meridian}`;
}

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
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const getEventsForDay = (date: Date) =>
    events
      .filter((e) => eventCoversDay(e.starts_at, e.ends_at, e.all_day, date))
      .sort((a, b) => {
        if (a.all_day && !b.all_day) return -1;
        if (!a.all_day && b.all_day) return 1;
        return 0;
      });

  const getEventKids = (event: CalendarEvent) =>
    kids.filter((k) => getEventKidIds(event).includes(k.id));

  /** Split events into regular chips + transition pills. */
  function partitionDayEvents(dayEvents: CalendarEvent[]) {
    const transitions: CalendarEvent[] = [];
    const regular: CalendarEvent[] = [];
    for (const e of dayEvents) {
      if (e.id.startsWith("turnover-")) transitions.push(e);
      else regular.push(e);
    }
    return { transitions, regular };
  }

  /** For a turnover event on `eventDate`, figure out handoff vs drop-off. */
  function transitionDirectionFor(e: CalendarEvent, eventDate: Date): "handoff" | "dropoff" {
    if (!getCustodyForDate || !currentUserId) return "handoff";
    const isPickup = e.id.endsWith("-pickup");
    const checkDate = new Date(eventDate);
    if (!isPickup) checkDate.setDate(checkDate.getDate() + 1);
    const custody = getCustodyForDate(checkDate);
    const kidIdInCustody = e.kid_id || Object.keys(custody)[0];
    const newParentId = custody[kidIdInCustody]?.parentId;
    return newParentId === currentUserId ? "handoff" : "dropoff";
  }

  /** Pick the kid slot for the transition pill (undefined = whole household). */
  function transitionKidFor(e: CalendarEvent): KidId | undefined {
    const kidIds = e.kid_ids && e.kid_ids.length > 0 ? e.kid_ids : (e.kid_id ? [e.kid_id] : []);
    if (kidIds.length !== 1) return undefined; // multi-kid transition = whole household
    const kid = kids.find((k) => k.id === kidIds[0]);
    return kidSlot(kid, kids);
  }

  /**
   * Pick the single-kid indicator slot for an event, or null if:
   *   - no kids on the event (holiday / unassigned)
   *   - multi-kid event (the chip is omitted — event type color is enough)
   */
  function singleKidIndicator(e: CalendarEvent): "ethan" | "harrison" | null {
    if (e.id.startsWith("holiday-")) return null;
    const evtKids = getEventKids(e);
    if (evtKids.length !== 1) return null;
    const slot = kidSlot(evtKids[0], kids);
    return slot === "ethan" || slot === "harrison" ? slot : null;
  }

  /**
   * Compute the custody background for a day cell.
   *
   * Uses the full-day cell as the custody canvas (replaces the short
   * ribbon strip which read too small in real widths).
   *
   *  - Whole household with current user    → warm cream (var(--you-bg))
   *  - Whole household with co-parent       → cool paper (var(--them-bg))
   *  - Kids split between parents (rare)    → horizontal two-color band:
   *       top half = kid-1's parent, bottom half = kid-2's parent
   *  - No custody data                      → undefined (default bg)
   */
  function custodyBgFor(day: Date): string | undefined {
    if (!getCustodyForDate || !currentUserId) return undefined;
    const custody = getCustodyForDate(day);
    const kidIds = Object.keys(custody);
    if (kidIds.length === 0) return undefined;

    // Check unified (all kids same parent)
    const firstParentId = custody[kidIds[0]].parentId;
    const allSame = kidIds.every((k) => custody[k].parentId === firstParentId);
    if (allSame) {
      return firstParentId === currentUserId ? "var(--you-bg)" : "var(--them-bg)";
    }

    // Split: use kids array ordering for lane assignment
    const orderedKidIds = kids.map((k) => k.id).filter((id) => custody[id]);
    const topKidId = orderedKidIds[0];
    const bottomKidId = orderedKidIds[1];
    const topBg =
      custody[topKidId]?.parentId === currentUserId ? "var(--you-bg)" : "var(--them-bg)";
    const bottomBg =
      custody[bottomKidId]?.parentId === currentUserId ? "var(--you-bg)" : "var(--them-bg)";
    return `linear-gradient(to bottom, ${topBg} 50%, ${bottomBg} 50%)`;
  }

  return (
    <div className="bg-[var(--bg)] border border-[var(--border)] overflow-hidden flex flex-col flex-1">
      {/* Day-of-week header — heavy divider separates it from the first week */}
      <div className="grid grid-cols-7 shrink-0 border-b-[3px] border-[var(--border-heavy)]">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="px-3 py-2.5 text-[10.5px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em]"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="flex-1 flex flex-col">
        {weeks.map((week, wi) => {
          const isLast = wi === weeks.length - 1;
          return (
            <div
              key={wi}
              className={`grid grid-cols-7 flex-1 ${isLast ? "" : "border-b-[3px] border-[var(--border-heavy)]"}`}
            >
              {week.map((day, di) => {
                const { transitions, regular } = partitionDayEvents(getEventsForDay(day));
                const today = isToday(day);
                const inMonth = isSameMonth(day, currentDate);
                const isLastCol = di === 6;
                const custodyBg = custodyBgFor(day);

                return (
                  <div
                    key={di}
                    onClick={() => onDayClick(day)}
                    className={`
                      min-h-0 p-1.5 cursor-pointer transition-colors
                      ${isLastCol ? "" : "border-r border-[var(--border)]"}
                      ${inMonth ? "" : "opacity-55"}
                    `}
                    style={custodyBg ? { background: custodyBg } : undefined}
                  >
                    {/* Day number */}
                    <div
                      className={`
                        inline-flex items-center justify-center h-[26px] min-w-[26px] px-1.5 text-[13px] font-medium mb-1 tabular-nums
                        ${today ? "bg-action text-action-fg font-semibold rounded-full" : ""}
                        ${!today && inMonth ? "text-[var(--ink)]" : ""}
                        ${!today && !inMonth ? "text-[var(--text-faint)] font-normal" : ""}
                      `}
                    >
                      {day.getDate()}
                    </div>

                    {/* Transition pills — rendered BEFORE regular events to surface handoffs */}
                    {transitions.map((e) => {
                      const startDate = parseTimestamp(e.starts_at);
                      const time = formatShortTime(startDate);
                      const direction = transitionDirectionFor(e, day);
                      const kid = transitionKidFor(e);
                      return (
                        <div key={e.id} className="mb-1">
                          <TransitionPill
                            time={time}
                            direction={direction}
                            kid={kid}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onEventClick(e);
                            }}
                          />
                        </div>
                      );
                    })}

                    {/* Regular events (max 3) — color-coded by event type.
                        Kid indicator chip (E/H) appears only for single-kid
                        events; multi-kid events omit it (the type color
                        carries the semantic). */}
                    {regular.slice(0, 3).map((evt) => {
                      const typeColor = getEventTypeColor(evt);
                      const kidBadge = singleKidIndicator(evt);
                      const dashed = evt._tentative;
                      return (
                        <div
                          key={evt.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onEventClick(evt);
                          }}
                          className={`
                            flex items-center gap-1.5
                            text-[11px] font-medium leading-tight
                            px-1.5 py-[3px] mb-0.5
                            border-l-[2.5px]
                            ${dashed ? "border-dashed opacity-75" : "border-solid"}
                            cursor-pointer hover:translate-x-[1px] transition-transform
                            overflow-hidden
                          `}
                          style={{
                            backgroundColor: `${typeColor}20`,
                            borderLeftColor: typeColor,
                            color: typeColor,
                          }}
                        >
                          <span className="text-[10.5px] opacity-80 shrink-0">
                            {getEventIcon(evt)}
                          </span>
                          {kidBadge && (
                            <span
                              className={`
                                inline-flex items-center justify-center shrink-0
                                w-[14px] h-[14px] rounded-full
                                text-[8px] font-bold text-white
                                ${kidIndicatorClass[kidBadge]}
                              `}
                              title={kidBadge === "ethan" ? "Ethan" : "Harrison"}
                            >
                              {kidBadge === "ethan" ? "E" : "H"}
                            </span>
                          )}
                          <span className="truncate">{evt.title}</span>
                        </div>
                      );
                    })}

                    {regular.length > 3 && (
                      <div className="text-[10.5px] text-[var(--text-faint)] pl-1.5 font-medium">
                        +{regular.length - 3} more
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
