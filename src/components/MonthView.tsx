"use client";

import {
  CalendarEvent,
  Kid,
  getEventKidIds,
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

/** Strip a date down to its calendar day (Y/M/D), no time component. */
function dayOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** True when an event spans 2+ calendar days (Outlook-style ribbon target). */
function isMultiDayEvent(evt: CalendarEvent): boolean {
  if (!evt.all_day) return false;
  const start = dayOnly(parseTimestamp(evt.starts_at));
  const end = dayOnly(parseTimestamp(evt.ends_at));
  return end.getTime() > start.getTime();
}

/**
 * For one week (7 Date[] starting Sunday), compute the multi-day ribbon
 * spans plus their vertical slot assignments. A "span" is one event
 * appearing on this week, clipped to the week's columns.
 *
 * Slot allocation is greedy by start column: each event takes the lowest
 * slot that doesn't conflict with previously-placed events. That keeps
 * stacking compact and predictable.
 */
interface RibbonSpan {
  event: CalendarEvent;
  startCol: number;        // 0-6, day of week start within this week
  endCol: number;          // 0-6, inclusive
  continuesLeft: boolean;  // event began before this week
  continuesRight: boolean; // event ends after this week
  slot: number;            // vertical row within the ribbon area
}
function computeRibbonSpans(week: Date[], events: CalendarEvent[]): RibbonSpan[] {
  const weekStart = dayOnly(week[0]);
  const weekEnd = dayOnly(week[6]);
  const candidates: Omit<RibbonSpan, "slot">[] = [];
  for (const evt of events) {
    if (!isMultiDayEvent(evt)) continue;
    const evStart = dayOnly(parseTimestamp(evt.starts_at));
    const evEnd = dayOnly(parseTimestamp(evt.ends_at));
    // Clip event range to week range
    const visibleStart = evStart > weekStart ? evStart : weekStart;
    const visibleEnd = evEnd < weekEnd ? evEnd : weekEnd;
    if (visibleStart > visibleEnd) continue;
    // Convert to column index (0-6)
    const startCol = Math.round(
      (visibleStart.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)
    );
    const endCol = Math.round(
      (visibleEnd.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)
    );
    candidates.push({
      event: evt,
      startCol,
      endCol,
      continuesLeft: evStart < weekStart,
      continuesRight: evEnd > weekEnd,
    });
  }

  // Sort by start column then by length descending — longer events get
  // lower slots so shorter events tuck in beneath them visually.
  candidates.sort((a, b) => {
    if (a.startCol !== b.startCol) return a.startCol - b.startCol;
    return (b.endCol - b.startCol) - (a.endCol - a.startCol);
  });

  // Greedy slot allocation: per slot, track the rightmost endCol used.
  const slotEnds: number[] = [];
  const result: RibbonSpan[] = [];
  for (const c of candidates) {
    let slot = 0;
    while (slot < slotEnds.length && slotEnds[slot] >= c.startCol) slot++;
    slotEnds[slot] = c.endCol;
    result.push({ ...c, slot });
  }
  return result;
}

// Layout constants for the ribbon row inside each week cell. The day cell
// reserves space at top for: day-number area (28px) + (numSlots × 18px).
const RIBBON_HEIGHT = 18;
const RIBBON_GAP = 2;
const DAY_NUMBER_BLOCK = 28; // h-[22px] + mb-1 + p-1.5 contribution

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

  /** All-day events first (holidays, birthdays), then timed events in
   *  chronological order. Keeps turnover events + regular events in a
   *  single unified list so a 3 PM handoff naturally sits between a
   *  10 AM dentist and a 5 PM soccer practice. */
  const getEventsForDay = (date: Date) =>
    events
      .filter((e) => eventCoversDay(e.starts_at, e.ends_at, e.all_day, date))
      .sort((a, b) => {
        if (a.all_day && !b.all_day) return -1;
        if (!a.all_day && b.all_day) return 1;
        return parseTimestamp(a.starts_at).getTime() - parseTimestamp(b.starts_at).getTime();
      });

  const getEventKids = (event: CalendarEvent) =>
    kids.filter((k) => getEventKidIds(event).includes(k.id));

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
   * Compute the custody view for a day cell — discriminated union over two
   * modes:
   *   - "whole":  one cell-wide background. Solid color on no-transition
   *               days; vertical gradient at handoff-time on transition
   *               days (top = pre-handoff parent, bottom = post). One
   *               TransitionPill, optional, sitting on the split line.
   *   - "split":  kids are with different parents today. Two horizontal
   *               lanes stacked vertically — one per kid — each with its
   *               OWN solid color or time-based gradient based on that
   *               kid's transitions. Pills are per-lane: a kid that
   *               transitions gets a pill at its transition time within
   *               its own lane; the other kid's lane stays solid.
   *
   * When all kids end up at the same parent today (allSame), use whole
   * mode. The transition gradient is computed from the TRANSITIONING
   * kid's adjacent-day parent (not the first kid in custody), so days
   * where only one of two kids transitions still render the right
   * pre/post colors regardless of Object.keys ordering.
   */
  type WholeCustodyView = {
    mode: "whole";
    background: string | undefined;
    splitPct: number | null;
  };
  type KidLane = {
    kid: Kid;
    kidLetter: string;
    kidColor: string;
    background: string;
    splitPct: number | null;
    turnoverEvt: CalendarEvent | null;
  };
  type SplitCustodyView = { mode: "split"; lanes: KidLane[] };
  type CustodyView = WholeCustodyView | SplitCustodyView;

  function custodyView(day: Date, dayEvents: CalendarEvent[]): CustodyView {
    if (!getCustodyForDate || !currentUserId) {
      return { mode: "whole", background: undefined, splitPct: null };
    }
    const custody = getCustodyForDate(day);
    const kidIds = Object.keys(custody);
    if (kidIds.length === 0) {
      return { mode: "whole", background: undefined, splitPct: null };
    }

    const firstParentId = custody[kidIds[0]].parentId;
    const allSame = kidIds.every((k) => custody[k].parentId === firstParentId);
    const colorFor = (parentId: string | undefined) =>
      parentId === currentUserId ? "var(--you-bg)" : "var(--them-bg)";

    // Build a per-kid time-based background + pill position. Used by both
    // whole-mode (when all kids transition together — feed the transitioning
    // kid in) and split-mode (per kid).
    function kidGradient(
      kidId: string,
      turnoverEvt: CalendarEvent | null
    ): { background: string; splitPct: number | null } {
      if (!turnoverEvt) {
        return {
          background: colorFor(custody[kidId]?.parentId),
          splitPct: null,
        };
      }
      const isPickup = turnoverEvt.id.endsWith("-pickup");
      const turnoverDate = parseTimestamp(turnoverEvt.starts_at);
      const hourFrac =
        turnoverDate.getHours() + turnoverDate.getMinutes() / 60;
      const splitPct = Math.max(0, Math.min(100, (hourFrac / 24) * 100));

      const adjacent = new Date(day);
      adjacent.setDate(adjacent.getDate() + (isPickup ? -1 : 1));
      const adjacentParentId = getCustodyForDate!(adjacent)[kidId]?.parentId;
      const todayParentId = custody[kidId]?.parentId;
      const todayColor = colorFor(todayParentId);
      const adjacentColor = colorFor(adjacentParentId);
      // Pickup: adjacent (yesterday) on top, today on bottom.
      // Dropoff: today on top, adjacent (tomorrow) on bottom.
      const preBg = isPickup ? adjacentColor : todayColor;
      const postBg = isPickup ? todayColor : adjacentColor;
      return {
        background: `linear-gradient(to bottom, ${preBg} 0%, ${preBg} ${splitPct}%, ${postBg} ${splitPct}%, ${postBg} 100%)`,
        splitPct,
      };
    }

    if (allSame) {
      // Whole mode. Anchor the gradient on the actual transitioning kid
      // (turnoverEvt.kid_ids[0]) rather than the arbitrary first key —
      // matters when only one of two kids transitioned but both are now
      // with the same parent.
      const turnoverEvt =
        dayEvents.find((e) => e.id.startsWith("turnover-")) ?? null;
      if (turnoverEvt) {
        const transitioningKidId =
          (turnoverEvt.kid_ids && turnoverEvt.kid_ids[0]) || kidIds[0];
        const { background, splitPct } = kidGradient(
          transitioningKidId,
          turnoverEvt
        );
        return { mode: "whole", background, splitPct };
      }
      return {
        mode: "whole",
        background: colorFor(firstParentId),
        splitPct: null,
      };
    }

    // Split mode: per-kid lanes. Order by the family `kids` array so
    // Ethan is consistently the top lane and Harrison the bottom.
    const orderedKids = kids.filter((k) => custody[k.id]);
    const lanes: KidLane[] = orderedKids.map((kid) => {
      // A turnover event involves THIS kid if its kid_ids array includes
      // them. Filter to the first match (typically there's only one
      // turnover per kid per day).
      const turnoverEvt =
        dayEvents.find(
          (e) =>
            e.id.startsWith("turnover-") &&
            (e.kid_ids ?? []).includes(kid.id)
        ) ?? null;
      const { background, splitPct } = kidGradient(kid.id, turnoverEvt);
      return {
        kid,
        kidLetter: kid.name.charAt(0).toUpperCase(),
        kidColor: kid.color,
        background,
        splitPct,
        turnoverEvt,
      };
    });
    return { mode: "split", lanes };
  }

  return (
    <div className="bg-[var(--bg)] border border-[var(--border-strong)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col flex-1">
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
          // Multi-day events render once per week as a ribbon spanning
          // multiple columns, instead of repeating per-cell. Compute spans
          // + slot assignments here so each cell can reserve the correct
          // amount of vertical space for the ribbon area above its single-
          // day events.
          const ribbonSpans = computeRibbonSpans(week, events);
          const ribbonSlots = ribbonSpans.reduce(
            (max, s) => Math.max(max, s.slot + 1),
            0
          );
          const ribbonAreaHeight =
            ribbonSlots > 0
              ? ribbonSlots * (RIBBON_HEIGHT + RIBBON_GAP)
              : 0;
          return (
            <div
              key={wi}
              className={`relative grid grid-cols-7 flex-1 ${isLast ? "" : "border-b-[3px] border-[var(--border-heavy)]"}`}
            >
              {week.map((day, di) => {
                const dayEvents = getEventsForDay(day);
                const today = isToday(day);
                const inMonth = isSameMonth(day, currentDate);
                const isLastCol = di === 6;
                const view = custodyView(day, dayEvents);
                // Strip out turnovers AND multi-day events. Multi-day events
                // render at the week level as ribbons overlaid below this map.
                // Turnovers render as the pill(s) on the split line(s).
                const nonTurnoverEvents = dayEvents.filter(
                  (e) =>
                    !e.id.startsWith("turnover-") && !isMultiDayEvent(e)
                );

                return (
                  <div
                    key={di}
                    onClick={() => onDayClick(day)}
                    className={`
                      relative min-h-0 p-1.5 cursor-pointer transition-colors
                      ${isLastCol ? "" : "border-r border-[var(--border-strong)]"}
                      ${inMonth ? "" : "opacity-55"}
                    `}
                    style={
                      view.mode === "whole" && view.background
                        ? { background: view.background }
                        : undefined
                    }
                  >
                    {/* Split-mode lane backdrops — paint two horizontal bands
                        behind the cell content. Each lane's bg is solid OR
                        a per-kid time-based gradient. Tiny kid-letter at
                        the top-right of each lane disambiguates which lane
                        belongs to which kid (rare event, so the letter
                        stays subdued). */}
                    {view.mode === "split" && (
                      <div className="absolute inset-0 pointer-events-none">
                        {view.lanes.map((lane, laneIdx) => (
                          <div
                            key={lane.kid.id}
                            className="absolute left-0 right-0"
                            style={{
                              top: laneIdx === 0 ? "0%" : "50%",
                              height: "50%",
                              background: lane.background,
                            }}
                          >
                            <div
                              className="absolute top-0.5 right-1 text-[9px] font-bold leading-none uppercase tracking-wider"
                              style={{ color: lane.kidColor, opacity: 0.7 }}
                              title={lane.kid.name}
                            >
                              {lane.kidLetter}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Day number */}
                    <div
                      className={`
                        inline-flex items-center justify-center h-[22px] min-w-[22px] px-1.5 text-[13px] font-medium mb-1 tabular-nums
                        ${today ? "bg-action text-action-fg font-semibold rounded-sm" : ""}
                        ${!today && inMonth ? "text-[var(--ink)]" : ""}
                        ${!today && !inMonth ? "text-[var(--text-faint)] font-normal" : ""}
                      `}
                    >
                      {day.getDate()}
                    </div>

                    {/* Ribbon-area spacer — reserved height equal to the
                        week's multi-day ribbon stack so the ribbons (rendered
                        at the week-row level below) don't sit on top of
                        single-day chips. */}
                    {ribbonAreaHeight > 0 && (
                      <div style={{ height: ribbonAreaHeight }} />
                    )}

                    {/* Chronological event stack (max 3). Turnovers are
                        excluded from this list — they ride on the pill layer
                        below. Events above the pill are pre-handoff, events
                        below are post-handoff (natural chrono order). */}
                    {nonTurnoverEvents.slice(0, 3).map((evt) => {
                      const typeColor = getEventTypeColor(evt);
                      const kidBadge = singleKidIndicator(evt);
                      const dashed = evt._tentative;
                      const isHoliday = evt.id.startsWith("holiday-");
                      const showTime = !evt.all_day && !isHoliday;
                      const timeStr = showTime
                        ? formatShortTime(parseTimestamp(evt.starts_at))
                        : null;
                      return (
                        <div
                          key={evt.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onEventClick(evt);
                          }}
                          className={`
                            flex items-center gap-1
                            text-[11px] font-medium leading-tight
                            bg-white text-[var(--ink)]
                            px-1.5 py-[3px] mb-0.5
                            border-l-[3px]
                            ${dashed ? "border-dashed opacity-75" : "border-solid"}
                            shadow-[0_0_0_1px_var(--border)]
                            cursor-pointer hover:translate-x-[1px] transition-transform
                            overflow-hidden
                          `}
                          style={{ borderLeftColor: typeColor }}
                        >
                          {timeStr && (
                            <span className="text-[10px] tabular-nums text-[var(--text-muted)] shrink-0">
                              {timeStr}
                            </span>
                          )}
                          {kidBadge && (
                            <span
                              className={`
                                inline-flex items-center justify-center shrink-0
                                w-[14px] h-[14px] rounded-sm
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

                    {nonTurnoverEvents.length > 3 && (
                      <div className="text-[10.5px] text-[var(--text-faint)] pl-1.5 font-medium">
                        +{nonTurnoverEvents.length - 3} more
                      </div>
                    )}

                    {/* Whole-mode turnover pill — absolutely positioned on
                        the custody split line so the color transition and
                        the handoff event read as one continuous horizontal
                        rule. */}
                    {view.mode === "whole" &&
                      view.splitPct !== null &&
                      (() => {
                        const turnoverEvt = dayEvents.find((e) =>
                          e.id.startsWith("turnover-")
                        );
                        if (!turnoverEvt) return null;
                        const time = formatShortTime(
                          parseTimestamp(turnoverEvt.starts_at)
                        );
                        const direction = transitionDirectionFor(
                          turnoverEvt,
                          day
                        );
                        const kid = transitionKidFor(turnoverEvt);
                        const clampedTop = Math.max(
                          18,
                          Math.min(92, view.splitPct)
                        );
                        return (
                          <div
                            className="absolute left-1.5 right-1.5 pointer-events-none"
                            style={{
                              top: `${clampedTop}%`,
                              transform: "translateY(-50%)",
                              zIndex: 5,
                            }}
                          >
                            <div className="pointer-events-auto">
                              <TransitionPill
                                time={time}
                                direction={direction}
                                kid={kid}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onEventClick(turnoverEvt);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })()}

                    {/* Split-mode pills — one per kid that transitions today.
                        Each pill rides on its own lane's split line. The
                        lane is 50% of cell height, so we clamp the in-lane
                        splitPct tighter (22%–78%) and convert to cell-
                        relative percent: laneIdx*50 + (splitPct/2). Pill
                        height (~26px) fits inside a typical 70px lane. */}
                    {view.mode === "split" &&
                      view.lanes.map((lane, laneIdx) => {
                        if (!lane.turnoverEvt || lane.splitPct === null)
                          return null;
                        const turnoverEvt = lane.turnoverEvt;
                        const time = formatShortTime(
                          parseTimestamp(turnoverEvt.starts_at)
                        );
                        const direction = transitionDirectionFor(
                          turnoverEvt,
                          day
                        );
                        // Always pill-tag with the lane's kid, since the
                        // lane IS the per-kid context.
                        const kid = kidSlot(lane.kid, kids);
                        const clampedInLane = Math.max(
                          22,
                          Math.min(78, lane.splitPct)
                        );
                        const cellTopPct =
                          laneIdx * 50 + clampedInLane / 2;
                        return (
                          <div
                            key={`pill-${lane.kid.id}`}
                            className="absolute left-1.5 right-1.5 pointer-events-none"
                            style={{
                              top: `${cellTopPct}%`,
                              transform: "translateY(-50%)",
                              zIndex: 5,
                            }}
                          >
                            <div className="pointer-events-auto">
                              <TransitionPill
                                time={time}
                                direction={direction}
                                kid={kid}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onEventClick(turnoverEvt);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}

              {/* Multi-day ribbon overlay — absolute-positioned chips that
                  span N columns at the week-row level. Pointer events scoped
                  to the chip itself so dead zones still pass clicks down to
                  the day cells. */}
              {ribbonSpans.length > 0 && (
                <div className="absolute inset-0 pointer-events-none">
                  {ribbonSpans.map((span) => {
                    const evt = span.event;
                    const typeColor = getEventTypeColor(evt);
                    const kidBadge = singleKidIndicator(evt);
                    const dashed = evt._tentative;
                    const isHoliday = evt.id.startsWith("holiday-");
                    const widthCols = span.endCol - span.startCol + 1;
                    const top =
                      DAY_NUMBER_BLOCK +
                      span.slot * (RIBBON_HEIGHT + RIBBON_GAP);
                    return (
                      <div
                        key={`${evt.id}-w${wi}`}
                        className="absolute pointer-events-auto"
                        style={{
                          top,
                          height: RIBBON_HEIGHT,
                          left: `calc(${(span.startCol / 7) * 100}% + 6px)`,
                          width: `calc(${(widthCols / 7) * 100}% - 12px)`,
                        }}
                      >
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick(evt);
                          }}
                          className={`
                            flex items-center gap-1 h-full overflow-hidden
                            text-[11px] font-medium leading-tight
                            ${isHoliday ? "" : "bg-white"} text-[var(--ink)]
                            px-1.5
                            ${span.continuesLeft ? "" : "border-l-[3px]"}
                            ${dashed ? "border-dashed opacity-75" : "border-solid"}
                            shadow-[0_0_0_1px_var(--border)]
                            cursor-pointer hover:translate-x-[1px] transition-transform
                          `}
                          style={{
                            borderLeftColor: span.continuesLeft
                              ? undefined
                              : typeColor,
                            // Holiday events get the type-color as a soft
                            // fill (not the white paper bg) so the ribbon
                            // visually matches the in-cell holiday chip.
                            background: isHoliday
                              ? `${typeColor}1f`
                              : undefined,
                          }}
                          title={evt.title}
                        >
                          {/* Continuation arrow on the left when this
                              ribbon picks up from a previous week. */}
                          {span.continuesLeft && (
                            <span
                              className="shrink-0 text-[10px]"
                              style={{ color: typeColor }}
                              aria-hidden
                            >
                              ‹
                            </span>
                          )}
                          {kidBadge && (
                            <span
                              className={`
                                inline-flex items-center justify-center shrink-0
                                w-[14px] h-[14px] rounded-sm
                                text-[8px] font-bold text-white
                                ${kidIndicatorClass[kidBadge]}
                              `}
                              title={kidBadge === "ethan" ? "Ethan" : "Harrison"}
                            >
                              {kidBadge === "ethan" ? "E" : "H"}
                            </span>
                          )}
                          <span className="truncate flex-1">{evt.title}</span>
                          {/* Continuation arrow on the right when the event
                              extends into next week. */}
                          {span.continuesRight && (
                            <span
                              className="shrink-0 text-[10px]"
                              style={{ color: typeColor }}
                              aria-hidden
                            >
                              ›
                            </span>
                          )}
                        </div>
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
  );
}
