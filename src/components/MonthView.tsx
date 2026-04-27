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
import type { KidId } from "./ui/KidChip";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  kids: Kid[];
  onDayClick: (date: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
  getCustodyForDate?: (date: Date) => Record<string, { parentId: string; isParentA: boolean }>;
  currentUserId?: string;
  /**
   * UUID of parent_a in this family (the alternating-weekend / "visiting"
   * parent — typically the one who picks up on weekends). Color identity
   * is keyed off this so each parent is a fixed color regardless of
   * which account is signed in. When undefined we fall back to the
   * legacy you/them mapping based on currentUserId.
   */
  parentAId?: string;
  /** Resolved bg tint (hex) for parent_a's day cells. Defaults to --them-bg. */
  parentABg?: string;
  /** Resolved bg tint (hex) for parent_b's day cells. Defaults to --you-bg. */
  parentBBg?: string;
  /** Saturated swatch (hex) for parent_a — used for parent-name text in
   *  split-day kid pills. */
  parentASwatch?: string;
  /** Saturated swatch (hex) for parent_b — same purpose. */
  parentBSwatch?: string;
  /** Map of profile id → display name. Powers the parent-name text in
   *  split-day kid pills (e.g. "E → Patrick 7:00p"). */
  memberNames?: Record<string, string>;
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

/** Format a Date to a transition-pill time like "6:00pm" / "5:00am". */
function formatTransitionTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const meridian = h >= 12 ? "pm" : "am";
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
  parentAId,
  parentABg,
  parentBBg,
  parentASwatch,
  parentBSwatch,
  memberNames,
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
  /**
   * A horizontal time-band within a day cell. The cell's vertical
   * extent represents the 24-hour day; each band covers a sub-range
   * and is filled either with a single parent's color (when both kids
   * are with the same parent during that band) or with diagonal
   * stripes (when kids are with different parents — i.e. actually
   * split during that band).
   */
  type CustodyBand = {
    startPct: number;
    endPct: number;
    fill:
      | { type: "solid"; color: string }
      | { type: "stripes" };
  };
  /**
   * A pill describing one handoff (turnover event group). Multiple
   * kids being acted on together at the same time/parent collapse
   * into one pill with multiple kid chips. Format:
   *   [time] [parent] [Pick Up | Drop-off] [E][H]
   */
  type TurnoverPill = {
    time: string;
    timeIso: string;
    isPickup: boolean;
    parentId: string;
    parentName: string;
    parentSwatch: string;
    kidIds: string[];
    events: CalendarEvent[];
  };
  type WholeCustodyView = {
    mode: "whole";
    background: string | undefined;
    splitPct: number | null;
    turnoverPills: TurnoverPill[];
  };
  type SplitCustodyView = {
    mode: "split";
    bands: CustodyBand[];
    turnoverPills: TurnoverPill[];
  };
  type CustodyView = WholeCustodyView | SplitCustodyView;

  function custodyView(day: Date, dayEvents: CalendarEvent[]): CustodyView {
    if (!getCustodyForDate || !currentUserId) {
      return { mode: "whole", background: undefined, splitPct: null, turnoverPills: [] };
    }
    const custody = getCustodyForDate(day);
    const kidIds = Object.keys(custody);
    if (kidIds.length === 0) {
      return { mode: "whole", background: undefined, splitPct: null, turnoverPills: [] };
    }
    // Color identity is parent-role-based: parent_a → parentABg,
    // parent_b → parentBBg. Each parent picks their own color in
    // settings, so each side of the family sees their preferred
    // tint regardless of which account is signed in. Falls back to
    // the legacy --them-bg / --you-bg CSS vars when prop colors
    // aren't supplied (e.g. before a schedule exists), and further
    // back to currentUserId-relative when parentAId is also missing.
    const parentAColor = parentABg ?? "var(--them-bg)";
    const parentBColor = parentBBg ?? "var(--you-bg)";
    const colorFor = (parentId: string | undefined): string => {
      if (parentAId) {
        return parentId === parentAId ? parentAColor : parentBColor;
      }
      return parentId === currentUserId
        ? "var(--you-bg)"
        : "var(--them-bg)";
    };

    // ─── Per-kid pre/post state ────────────────────────────────────
    // Today's parent (from getCustodyForDate) is the END-OF-DAY state.
    // If a kid transitioned today, their pre-handoff parent comes from
    // the adjacent day. We need this for both band geometry AND mode
    // selection — a day can be split during the morning even if it
    // ends whole (e.g. one kid joins the other's parent at 3pm), and
    // that case must surface stripes.
    const orderedKids = kids.filter((k) => custody[k.id]);
    const kidStates = orderedKids.map((kid) => {
      const turnoverEvt =
        dayEvents.find(
          (e) =>
            e.id.startsWith("turnover-") &&
            (e.kid_ids ?? []).includes(kid.id)
        ) ?? null;
      const todayParent = custody[kid.id]?.parentId;
      if (!turnoverEvt) {
        return {
          kid,
          handoffPct: null as number | null,
          preParent: todayParent,
          postParent: todayParent,
        };
      }
      const isPickup = turnoverEvt.id.endsWith("-pickup");
      const turnoverDate = parseTimestamp(turnoverEvt.starts_at);
      const hourFrac =
        turnoverDate.getHours() + turnoverDate.getMinutes() / 60;
      const handoffPct = Math.max(0, Math.min(100, (hourFrac / 24) * 100));
      const adjacent = new Date(day);
      adjacent.setDate(adjacent.getDate() + (isPickup ? -1 : 1));
      const adjacentParent = getCustodyForDate!(adjacent)[kid.id]?.parentId;
      // Pickup: pre-handoff = yesterday (adjacent), post-handoff = today.
      // Dropoff: pre-handoff = today, post-handoff = tomorrow (adjacent).
      const preParent = isPickup ? adjacentParent : todayParent;
      const postParent = isPickup ? todayParent : adjacentParent;
      return { kid, handoffPct, preParent, postParent };
    });

    // ─── Bands ─────────────────────────────────────────────────────
    // Boundaries = union of all kid handoff %s plus 0 and 100. Within
    // each band, every kid's parent is constant (they're either before
    // or after their handoff, no ambiguity). Band fill is solid when
    // all kids share a parent in that window; stripes otherwise.
    const boundarySet = new Set<number>([0, 100]);
    kidStates.forEach((ks) => {
      if (ks.handoffPct !== null) boundarySet.add(ks.handoffPct);
    });
    const boundaries = Array.from(boundarySet).sort((a, b) => a - b);

    const bands: CustodyBand[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const startPct = boundaries[i];
      const endPct = boundaries[i + 1];
      const mid = (startPct + endPct) / 2;
      const parentsHere = kidStates.map((ks) =>
        ks.handoffPct === null
          ? ks.postParent
          : mid < ks.handoffPct
            ? ks.preParent
            : ks.postParent
      );
      const allSameInBand = parentsHere.every((p) => p === parentsHere[0]);
      bands.push({
        startPct,
        endPct,
        fill: allSameInBand
          ? { type: "solid", color: colorFor(parentsHere[0]) }
          : { type: "stripes" },
      });
    }
    const hasStripes = bands.some((b) => b.fill.type === "stripes");

    // ─── Turnover pills ────────────────────────────────────────────
    // Group all turnover events by (time, action, today's-parent) so
    // multi-kid joint handoffs collapse into one pill. Format target:
    //   "7:00pm  Patrick  Pick Up  [E][H]"
    const turnoverGroups = new Map<string, TurnoverPill>();
    dayEvents.forEach((evt) => {
      if (!evt.id.startsWith("turnover-")) return;
      const evtKidIds =
        evt.kid_ids && evt.kid_ids.length > 0 ? evt.kid_ids : [evt.kid_id];
      if (evtKidIds.length === 0) return;
      const todayParent = custody[evtKidIds[0]]?.parentId;
      if (!todayParent) return;
      const isPickup = evt.id.endsWith("-pickup");
      const key = `${evt.starts_at}|${isPickup ? "pickup" : "dropoff"}|${todayParent}`;
      if (turnoverGroups.has(key)) {
        const g = turnoverGroups.get(key)!;
        evtKidIds.forEach((kid) => {
          if (!g.kidIds.includes(kid)) g.kidIds.push(kid);
        });
        g.events.push(evt);
        return;
      }
      const parentName =
        memberNames?.[todayParent] ||
        (todayParent === parentAId ? "Parent A" : "Parent B");
      const parentSwatch = parentAId
        ? todayParent === parentAId
          ? parentASwatch ?? "var(--ink)"
          : parentBSwatch ?? "var(--ink)"
        : "var(--ink)";
      turnoverGroups.set(key, {
        time: formatTransitionTime(parseTimestamp(evt.starts_at)),
        timeIso: evt.starts_at,
        isPickup,
        parentId: todayParent,
        parentName,
        parentSwatch,
        kidIds: [...evtKidIds],
        events: [evt],
      });
    });
    const turnoverPills = Array.from(turnoverGroups.values()).sort((a, b) =>
      a.timeIso.localeCompare(b.timeIso)
    );

    // ─── Mode selection ────────────────────────────────────────────
    // Whole mode whenever no band has stripes — including the joint-
    // handoff case where both kids transition together (bands look
    // like solidA → solidB; we synthesize a vertical gradient that
    // matches the existing whole-mode visual). Bands mode otherwise.
    if (!hasStripes) {
      if (bands.length === 1) {
        return {
          mode: "whole",
          background:
            bands[0].fill.type === "solid" ? bands[0].fill.color : undefined,
          splitPct: null,
          turnoverPills,
        };
      }
      const firstBand = bands[0];
      const lastBand = bands[bands.length - 1];
      const firstColor =
        firstBand.fill.type === "solid" ? firstBand.fill.color : "";
      const lastColor =
        lastBand.fill.type === "solid" ? lastBand.fill.color : "";
      if (firstColor === lastColor) {
        return {
          mode: "whole",
          background: firstColor || undefined,
          splitPct: null,
          turnoverPills,
        };
      }
      const splitPct = firstBand.endPct;
      return {
        mode: "whole",
        background: `linear-gradient(to bottom, ${firstColor} 0%, ${firstColor} ${splitPct}%, ${lastColor} ${splitPct}%, ${lastColor} 100%)`,
        splitPct,
        turnoverPills,
      };
    }

    return { mode: "split", bands, turnoverPills };
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
                    {/* Split-mode: bands-by-time backdrop. Each band is
                        either solid (joint parent for that time-window)
                        or diagonal stripes (kids actually divergent here).
                        Stripes only appear in the post-handoff portion of
                        the cell when the day starts whole and becomes
                        split — so the cell still reads correctly as
                        "morning was Mom, evening is split." */}
                    {view.mode === "split" && (
                      <div className="absolute inset-0 pointer-events-none">
                        {view.bands.map((band, idx) => {
                          const stripeBg = `repeating-linear-gradient(45deg, ${
                            parentABg ?? "var(--them-bg)"
                          } 0px, ${
                            parentABg ?? "var(--them-bg)"
                          } 14px, ${
                            parentBBg ?? "var(--you-bg)"
                          } 14px, ${
                            parentBBg ?? "var(--you-bg)"
                          } 28px)`;
                          return (
                            <div
                              key={idx}
                              className="absolute left-0 right-0"
                              style={{
                                top: `${band.startPct}%`,
                                height: `${band.endPct - band.startPct}%`,
                                background:
                                  band.fill.type === "solid"
                                    ? band.fill.color
                                    : stripeBg,
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                    {/* Day number */}
                    <div
                      className={`
                        relative z-[2] inline-flex items-center justify-center h-[22px] min-w-[22px] px-1.5 text-[13px] font-medium mb-1 tabular-nums
                        ${today ? "bg-action text-action-fg font-semibold rounded-sm" : ""}
                        ${!today && inMonth ? "text-[var(--ink)]" : ""}
                        ${!today && !inMonth ? "text-[var(--text-faint)] font-normal" : ""}
                      `}
                    >
                      {day.getDate()}
                    </div>

                    {/* Turnover pills — one per handoff group, rendered
                        inline below the day number. Format:
                          [time]  [parent acting]  [Pick Up | Drop-off]  [E][H]
                        Multi-kid handoffs (e.g. both kids picked up at
                        the same time by the same parent) collapse into
                        one pill with both kid chips. Click opens the
                        underlying turnover event. */}
                    {view.turnoverPills.length > 0 && (
                      <div className="relative z-[2] mb-1 space-y-[2px]">
                        {view.turnoverPills.map((pill) => {
                          const matchingKids = kids.filter((k) =>
                            pill.kidIds.includes(k.id)
                          );
                          const action = pill.isPickup ? "Pick Up" : "Drop-off";
                          return (
                            <div
                              key={`${pill.timeIso}-${pill.parentId}-${pill.isPickup}`}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (pill.events[0]) onEventClick(pill.events[0]);
                              }}
                              className="
                                flex items-center gap-1.5
                                text-[10.5px] font-medium leading-tight
                                bg-white/95 text-[var(--ink)]
                                px-1.5 py-[2px]
                                border-l-[3px]
                                shadow-[0_0_0_1px_var(--border)]
                                cursor-pointer hover:translate-x-[1px] transition-transform
                                overflow-hidden
                              "
                              style={{ borderLeftColor: pill.parentSwatch }}
                              title={`${pill.time} ${pill.parentName} ${action}`}
                            >
                              <span className="tabular-nums text-[var(--text-muted)] shrink-0">
                                {pill.time}
                              </span>
                              <span
                                className="font-semibold truncate"
                                style={{ color: pill.parentSwatch }}
                              >
                                {pill.parentName}
                              </span>
                              <span className="text-[var(--text-muted)] shrink-0">
                                {action}
                              </span>
                              <span className="flex gap-[2px] shrink-0 ml-auto">
                                {matchingKids.map((kid) => {
                                  const slot = kidSlot(kid, kids);
                                  const chipClass =
                                    slot === "ethan" || slot === "harrison"
                                      ? kidIndicatorClass[slot]
                                      : "";
                                  return (
                                    <span
                                      key={kid.id}
                                      title={kid.name}
                                      className={`
                                        inline-flex items-center justify-center
                                        w-[14px] h-[14px] rounded-sm
                                        text-[8px] font-bold text-white
                                        ${chipClass}
                                      `}
                                      style={
                                        chipClass
                                          ? undefined
                                          : { background: kid.color }
                                      }
                                    >
                                      {kid.name.charAt(0).toUpperCase()}
                                    </span>
                                  );
                                })}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

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
                            relative z-[2]
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
                      <div className="relative z-[2] text-[10.5px] text-[var(--text-faint)] pl-1.5 font-medium">
                        +{nonTurnoverEvents.length - 3} more
                      </div>
                    )}

                    {/* All handoff information is rendered inline above
                        as turnoverPills. The whole-mode background
                        gradient still shows the boundary visually; the
                        floating pill on that boundary is gone in favor
                        of the more explicit "[time] [parent] [action]
                        [kids]" pill format. */}
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
