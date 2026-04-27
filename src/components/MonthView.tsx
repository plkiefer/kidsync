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
import {
  formatTimeInZone,
  getBrowserTimezone,
  tzAbbreviation,
  zonesEquivalent,
} from "@/lib/timezones";

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

/** Format a Date to a compact calendar time like "3:00pm" / "10:15am".
 *  Used for both regular event pills and turnover pills so the cell
 *  reads with one consistent time format. */
function formatShortTime(date: Date): string {
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
 * Derive synthetic "stay ribbon" events from lodging segments.
 * One ribbon per (trip, city, contiguous-date-range). Multiple
 * lodgings in the same city collapse into one ribbon (e.g.
 * Hilton + Marriott in Honolulu = one "Honolulu, HI" ribbon).
 *
 * The synthetic events look like all-day multi-day events to the
 * existing ribbon engine, so they slot in alongside other ribbons
 * (multi-day all-day events like school break) without changes
 * to computeRibbonSpans.
 *
 * Click handling routes to the trip via the trip_id + segment_type,
 * same path as direct lodging clicks (TripView opens).
 */
interface SyntheticStayEvent extends CalendarEvent {
  /** Source lodgings collapsed into this ribbon — useful for click
   *  handlers that want to open one specific lodging. */
  _stay_lodgings: CalendarEvent[];
}
function deriveStayRibbonEvents(
  events: CalendarEvent[]
): SyntheticStayEvent[] {
  const lodgings = events.filter(
    (e) => e.segment_type === "lodging" && e.trip_id
  );
  if (lodgings.length === 0) return [];

  // Group by (trip_id, city, state, country); within a group, sort
  // by starts_at and merge contiguous (or overlapping) ranges.
  type Group = {
    trip_id: string;
    city: string;
    state: string;
    country: string;
    family_id: string;
    runs: { startMs: number; endMs: number; lodgings: CalendarEvent[] }[];
  };
  const groups = new Map<string, Group>();
  for (const l of lodgings) {
    if (!l.segment_data || typeof l.segment_data !== "object") continue;
    const data = l.segment_data as { city?: string; state?: string; country?: string };
    const city = data.city || "";
    const state = data.state || "";
    const country = data.country || "";
    const key = `${l.trip_id}|${city}|${state}|${country}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        trip_id: l.trip_id!,
        city,
        state,
        country,
        family_id: l.family_id,
        runs: [],
      };
      groups.set(key, g);
    }
    const startMs = dayOnly(parseTimestamp(l.starts_at)).getTime();
    // For ribbons, treat ends_at as inclusive of the last day the
    // user is sleeping there. A check-out on Dec 28 11am means the
    // user slept Dec 27 → ribbon should include Dec 27 but not 28.
    // Subtract 1 day so a Dec 20→Dec 28 range renders as Dec 20–27.
    const endMs =
      dayOnly(parseTimestamp(l.ends_at)).getTime() - 24 * 60 * 60 * 1000;
    g.runs.push({ startMs, endMs, lodgings: [l] });
  }

  const synthetic: SyntheticStayEvent[] = [];
  for (const g of groups.values()) {
    // Merge contiguous runs within a group
    g.runs.sort((a, b) => a.startMs - b.startMs);
    const merged: typeof g.runs = [];
    for (const r of g.runs) {
      const last = merged[merged.length - 1];
      // Touching = next run starts within 1 day of previous end
      if (last && r.startMs <= last.endMs + 24 * 60 * 60 * 1000) {
        last.endMs = Math.max(last.endMs, r.endMs);
        last.lodgings.push(...r.lodgings);
      } else {
        merged.push({ ...r });
      }
    }
    for (const run of merged) {
      const startISO = new Date(run.startMs).toISOString();
      // ribbon engine uses `dayOnly(parseTimestamp(ends_at))` so ensure
      // it lands on the inclusive last day.
      const endISO = new Date(run.endMs).toISOString();
      synthetic.push({
        id: `stay-${g.trip_id}-${g.city}-${run.startMs}`,
        family_id: g.family_id,
        kid_id: run.lodgings[0].kid_id,
        kid_ids: run.lodgings[0].kid_ids,
        title: formatStayLabel(g.city, g.state, g.country),
        event_type: "travel",
        starts_at: startISO,
        ends_at: endISO,
        all_day: true,
        location: null,
        notes: null,
        recurring_rule: null,
        created_by: run.lodgings[0].created_by,
        updated_by: null,
        created_at: run.lodgings[0].created_at,
        updated_at: run.lodgings[0].updated_at,
        trip_id: g.trip_id,
        segment_type: "lodging",
        _virtual: true,
        _stay_lodgings: run.lodgings,
      });
    }
  }
  return synthetic;
}

function formatStayLabel(city: string, state: string, country: string): string {
  if (!city) return "Stay";
  if (state) return `${city}, ${state}`;
  if (country && country !== "USA" && country !== "United States") {
    return `${city}, ${country}`;
  }
  return city;
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

  // Lodging segments are not all_day events but should render as
  // multi-day "stay" ribbons grouped by city. Replace them in the
  // event stream with synthetic stay-ribbon events that the ribbon
  // engine can consume directly. Original lodging segments are
  // hidden from per-cell rendering — the ribbon represents them.
  const stayRibbons = deriveStayRibbonEvents(events);
  const eventsWithoutLodgings = events.filter(
    (e) => e.segment_type !== "lodging"
  );
  const eventsForRendering: CalendarEvent[] = [
    ...eventsWithoutLodgings,
    ...stayRibbons,
  ];

  /** All-day events first (holidays, birthdays), then timed events in
   *  chronological order. Keeps turnover events + regular events in a
   *  single unified list so a 3 PM handoff naturally sits between a
   *  10 AM dentist and a 5 PM soccer practice. */
  const getEventsForDay = (date: Date) =>
    eventsForRendering
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
    /** Time-of-day pct (0-100) — where the band boundary SHOULD be
     *  in a strict time-encoded cell. Render layer remaps this to
     *  the pill's rendered slot pct so events can flow naturally
     *  above/below the pill in chronological order. */
    timeOfDayPct: number;
    isPickup: boolean;
    parentId: string;
    parentName: string;
    parentSwatch: string;
    kidIds: string[];
    events: CalendarEvent[];
  };
  /**
   * Unified view shape — every day cell has a list of bands (in
   * time-of-day coordinates) and a list of turnover pills. The
   * render layer maps the time-of-day band coordinates to rendered
   * slot pcts so the layout looks balanced regardless of how early
   * or late in the day the handoff happens.
   */
  type CustodyView = {
    bands: CustodyBand[];
    turnoverPills: TurnoverPill[];
  };

  function custodyView(day: Date, dayEvents: CalendarEvent[]): CustodyView {
    if (!getCustodyForDate || !currentUserId) {
      return { bands: [], turnoverPills: [] };
    }
    const custody = getCustodyForDate(day);
    const kidIds = Object.keys(custody);
    if (kidIds.length === 0) {
      return { bands: [], turnoverPills: [] };
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
      const turnoverDate = parseTimestamp(evt.starts_at);
      const hourFrac =
        turnoverDate.getHours() + turnoverDate.getMinutes() / 60;
      const timeOfDayPct = Math.max(0, Math.min(100, (hourFrac / 24) * 100));
      turnoverGroups.set(key, {
        time: formatShortTime(turnoverDate),
        timeIso: evt.starts_at,
        timeOfDayPct,
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

    // Single unified return — the render layer handles solid/stripes/
    // gradient cases uniformly via bands. Optionally collapse adjacent
    // identical solid bands so a no-transition or same-color day
    // renders as a single backdrop without unnecessary divider lines.
    const collapsed: CustodyBand[] = [];
    bands.forEach((b) => {
      const last = collapsed[collapsed.length - 1];
      if (
        last &&
        last.fill.type === "solid" &&
        b.fill.type === "solid" &&
        last.fill.color === b.fill.color
      ) {
        last.endPct = b.endPct;
      } else {
        collapsed.push({ ...b });
      }
    });
    void hasStripes;
    return { bands: collapsed, turnoverPills };
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
          const ribbonSpans = computeRibbonSpans(week, eventsForRendering);
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

                // ─── Cell layout (single IIFE) ──────────────────────
                // Items (events + turnover pills) are sorted chrono and
                // distributed evenly through the cell. Each pill's
                // rendered slot pct drives the band boundary, so the
                // boundary line passes through the pill's middle and
                // events flow naturally above (pre-handoff) or below
                // (post-handoff) the pill.
                //
                // We don't try to honor exact time-of-day pcts because
                // a 9pm pickup at 87.5% of the cell looks crammed; even
                // distribution reads cleaner and still preserves chrono
                // order top-to-bottom.
                const sortedEvents = [...nonTurnoverEvents].sort((a, b) =>
                  a.starts_at.localeCompare(b.starts_at)
                );
                const TOTAL_SLOTS = 3;
                const remainingSlots = Math.max(
                  0,
                  TOTAL_SLOTS - view.turnoverPills.length
                );
                const visibleEvents = sortedEvents.slice(0, remainingSlots);
                const hiddenCount = sortedEvents.length - visibleEvents.length;
                type CellItem =
                  | { kind: "pill"; sortKey: string; pill: TurnoverPill }
                  | { kind: "event"; sortKey: string; evt: CalendarEvent };
                const items: CellItem[] = [
                  ...view.turnoverPills.map(
                    (p): CellItem => ({
                      kind: "pill",
                      sortKey: p.timeIso,
                      pill: p,
                    })
                  ),
                  ...visibleEvents.map(
                    (e): CellItem => ({
                      kind: "event",
                      sortKey: e.starts_at,
                      evt: e,
                    })
                  ),
                ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

                // Item layout: distribute space-evenly inside [START,END]
                // (top=22% leaves room for the day number; bottom=96%
                // leaves a small margin for "+N more" if present).
                const ITEMS_START = 22;
                const ITEMS_END = 96;
                const itemPct = (idx: number): number => {
                  if (items.length === 0) return 50;
                  return (
                    ITEMS_START +
                    ((idx + 1) / (items.length + 1)) *
                      (ITEMS_END - ITEMS_START)
                  );
                };

                // Build pill timeOfDayPct → renderedPct so we can remap
                // the time-of-day band boundaries onto the cell's
                // rendered layout coordinates.
                const renderedByTodPct = new Map<number, number>();
                items.forEach((item, idx) => {
                  if (item.kind === "pill") {
                    renderedByTodPct.set(
                      item.pill.timeOfDayPct,
                      itemPct(idx)
                    );
                  }
                });
                const remapPct = (timePct: number): number => {
                  if (timePct <= 0) return 0;
                  if (timePct >= 100) return 100;
                  return renderedByTodPct.get(timePct) ?? timePct;
                };
                const renderedBands = view.bands.map((band) => ({
                  ...band,
                  startPct: remapPct(band.startPct),
                  endPct: remapPct(band.endPct),
                }));

                return (
                  <div
                    key={di}
                    onClick={() => onDayClick(day)}
                    className={`
                      relative min-h-0 p-1.5 cursor-pointer transition-colors
                      ${isLastCol ? "" : "border-r border-[var(--border-strong)]"}
                      ${inMonth ? "" : "opacity-55"}
                    `}
                  >
                    {/* Backdrop bands. Solid fills for whole-state
                        bands, diagonal stripes for split-state bands.
                        Crisp ink hairline at every interior boundary so
                        the start/end of stripes is unambiguous. */}
                    {renderedBands.length > 0 && (
                      <div className="absolute inset-0 pointer-events-none">
                        {renderedBands.map((band, idx) => {
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
                        {renderedBands.slice(0, -1).map((band, idx) => (
                          <div
                            key={`bd-${idx}`}
                            className="absolute left-0 right-0"
                            style={{
                              top: `${band.endPct}%`,
                              height: 1,
                              background: "var(--ink)",
                              opacity: 0.7,
                              transform: "translateY(-0.5px)",
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* Day number — flow */}
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

                    {/* Ribbon-area spacer — flow */}
                    {ribbonAreaHeight > 0 && (
                      <div style={{ height: ribbonAreaHeight }} />
                    )}

                    {/* Items — absolute by index pct. Pills sit on the
                        band boundary (boundary pct = pill's itemPct);
                        events flow above/below in chrono order. */}
                    {items.map((item, idx) => {
                      const top = itemPct(idx);
                      const positionStyle: React.CSSProperties = {
                        position: "absolute",
                        left: 6,
                        right: 6,
                        top: `${top}%`,
                        transform: "translateY(-50%)",
                      };
                      if (item.kind === "pill") {
                        const pill = item.pill;
                        const matchingKids = kids.filter((k) =>
                          pill.kidIds.includes(k.id)
                        );
                        const action = pill.isPickup ? "Pick Up" : "Drop-off";
                        return (
                          <div
                            key={`t-${pill.timeIso}-${pill.parentId}-${pill.isPickup}`}
                            style={{ ...positionStyle, zIndex: 5 }}
                            className="pointer-events-none"
                          >
                            <div
                              onClick={(ev) => {
                                ev.stopPropagation();
                                if (pill.events[0])
                                  onEventClick(pill.events[0]);
                              }}
                              className="
                                pointer-events-auto
                                flex items-center gap-1
                                text-[11px] font-medium leading-tight
                                bg-white text-[var(--ink)]
                                px-1.5 py-[3px]
                                border-l-[3px]
                                shadow-[0_0_0_1px_var(--border)]
                                cursor-pointer hover:translate-x-[1px] transition-transform
                                overflow-hidden
                              "
                              style={{ borderLeftColor: pill.parentSwatch }}
                              title={`${pill.time} ${action} (${pill.parentName})`}
                            >
                              <span className="text-[10px] tabular-nums text-[var(--text-muted)] shrink-0">
                                {pill.time}
                              </span>
                              <span className="flex gap-[2px] shrink-0">
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
                              <span className="truncate">
                                {action}{" "}
                                <span className="text-[var(--text-muted)] font-medium">
                                  ({pill.parentName})
                                </span>
                              </span>
                            </div>
                          </div>
                        );
                      }
                      // event
                      const evt = item.evt;
                      const typeColor = getEventTypeColor(evt);
                      const kidBadge = singleKidIndicator(evt);
                      const dashed = evt._tentative;
                      const isHoliday = evt.id.startsWith("holiday-");
                      const showTime = !evt.all_day && !isHoliday;
                      // Render the time in the event's saved zone so a
                      // 10am-Tokyo flight shows "10:00am" regardless
                      // of where the viewer is. If the zone differs
                      // from the browser, append a short label like
                      // "JST" so the user knows they're looking at
                      // a different zone's clock.
                      const browserTz = getBrowserTimezone();
                      const evtTz = evt.time_zone || browserTz;
                      const evtInstant = parseTimestamp(evt.starts_at);
                      const timeStr = showTime
                        ? formatTimeInZone(evtInstant, evtTz)
                        : null;
                      const tzLabel =
                        showTime && !zonesEquivalent(evtTz, browserTz)
                          ? tzAbbreviation(evtTz, evtInstant)
                          : null;
                      return (
                        <div
                          key={evt.id}
                          style={{
                            ...positionStyle,
                            zIndex: 2,
                            borderLeftColor: typeColor,
                          }}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onEventClick(evt);
                          }}
                          className={`
                            flex items-center gap-1
                            text-[11px] font-medium leading-tight
                            bg-white text-[var(--ink)]
                            px-1.5 py-[3px]
                            border-l-[3px]
                            ${dashed ? "border-dashed opacity-75" : "border-solid"}
                            shadow-[0_0_0_1px_var(--border)]
                            cursor-pointer hover:translate-x-[1px] transition-transform
                            overflow-hidden
                          `}
                        >
                          {timeStr && (
                            <span className="text-[10px] tabular-nums text-[var(--text-muted)] shrink-0">
                              {timeStr}
                              {tzLabel && (
                                <span className="ml-0.5 text-[var(--text-faint)]">
                                  {tzLabel}
                                </span>
                              )}
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
                              title={
                                kidBadge === "ethan" ? "Ethan" : "Harrison"
                              }
                            >
                              {kidBadge === "ethan" ? "E" : "H"}
                            </span>
                          )}
                          <span className="truncate">{evt.title}</span>
                        </div>
                      );
                    })}

                    {hiddenCount > 0 && (
                      <div className="absolute bottom-1 left-2 right-2 z-[2] text-[10.5px] text-[var(--text-faint)] font-medium pointer-events-none">
                        +{hiddenCount} more
                      </div>
                    )}
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
