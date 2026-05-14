import { CalendarEvent, CustodySchedule, CustodyOverride, CustodyAgreement, ParsedCustodyTerms, Kid } from "./types";
import { computeCustodyForDate, DayCustodyInfo } from "./custody";
import { getHolidaysForYear } from "./holidays";
import { formatAllDayTimestamp } from "./allDay";
import { eachDayOfInterval, addDays, format } from "date-fns";

// ── Custody Turnover Events ─────────────────────────────────

interface TurnoverTransition {
  eventDate: Date;
  dateStr: string;
  toParentId: string;
  isPickup: boolean;
  kidIds: string[];
  familyId: string;
  overrideTime: string | null;
  /** Stable key — one transition per (date, receiving parent, direction). */
  key: string;
}

/**
 * Walk consecutive days within [rangeStart, rangeEnd] and detect
 * custody transitions, given the supplied set of overrides. Pure
 * computation — no event objects yet, no styling. Both
 * `generateTurnoverEvents` and `generatePendingTurnoverEvents`
 * lean on this.
 */
function detectTransitions(
  rangeStart: Date,
  rangeEnd: Date,
  schedules: CustodySchedule[],
  overrides: CustodyOverride[]
): Map<string, TurnoverTransition> {
  const transitions = new Map<string, TurnoverTransition>();
  if (schedules.length === 0) return transitions;

  // Extend range by 1 day on each side to detect boundary transitions
  const extStart = addDays(rangeStart, -1);
  const extEnd = addDays(rangeEnd, 1);
  const days = eachDayOfInterval({ start: extStart, end: extEnd });

  let prevCustody: DayCustodyInfo = {};

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const custody = computeCustodyForDate(day, schedules, overrides);

    if (i > 0) {
      for (const schedule of schedules) {
        const kidId = schedule.kid_id;
        const prev = prevCustody[kidId];
        const curr = custody[kidId];

        if (prev && curr && prev.parentId !== curr.parentId) {
          const isPickup = curr.isParentA;
          const eventDate = isPickup ? day : days[i - 1];

          if (eventDate >= rangeStart && eventDate <= rangeEnd) {
            const dateStr = format(eventDate, "yyyy-MM-dd");
            const key = `${dateStr}|${curr.parentId}|${isPickup}`;

            // Match an override carrying a time on this exact boundary
            // day. See the original docstring (pre-split) for why we
            // only match start_date here.
            const matchingOverride = overrides.find(
              (o) =>
                o.kid_id === kidId &&
                o.override_time &&
                o.start_date === dateStr
            );
            const overrideTime = matchingOverride?.override_time || null;

            const existing = transitions.get(key);
            if (existing) {
              if (!existing.kidIds.includes(kidId)) {
                existing.kidIds.push(kidId);
              }
              if (overrideTime && !existing.overrideTime) {
                existing.overrideTime = overrideTime;
              }
            } else {
              transitions.set(key, {
                eventDate,
                dateStr,
                toParentId: curr.parentId,
                isPickup,
                kidIds: [kidId],
                familyId: schedule.family_id,
                overrideTime,
                key,
              });
            }
          }
        }
      }
    }

    prevCustody = custody;
  }

  return transitions;
}

/**
 * Build a CalendarEvent from a transition. Tentative events get a
 * dashed left border in the rendering layer (driven by `_tentative`)
 * and carry `_pendingOverrideIds` so a click on the chip can route
 * to the diff popover.
 */
function transitionToEvent(
  t: TurnoverTransition,
  defaultPickupTime: string,
  defaultDropoffTime: string,
  members: { id: string; full_name: string }[],
  options: { tentative?: boolean; pendingOverrideIds?: string[] } = {}
): CalendarEvent {
  const timeStr = t.overrideTime || (t.isPickup ? defaultPickupTime : defaultDropoffTime);
  const hour = parseTimeToHour(timeStr);

  const [y, m, d] = t.dateStr.split("-").map(Number);
  const h = Math.floor(hour);
  const min = Math.round((hour - h) * 60);
  const localDate = new Date(y, m - 1, d, h, min, 0);
  const isoStr = localDate.toISOString();

  const receivingParent = members.find((mem) => mem.id === t.toParentId);
  const receivingName = receivingParent?.full_name?.split(" ")[0] || "Other Parent";

  const baseTitle = t.isPickup ? `Pickup — ${receivingName}` : `Drop-off — ${receivingName}`;
  const title = options.tentative ? `${baseTitle} (proposed)` : baseTitle;

  return {
    id: `turnover-${t.dateStr}-${t.isPickup ? "pickup" : "dropoff"}${
      options.tentative ? "-pending" : ""
    }`,
    family_id: t.familyId,
    kid_id: t.kidIds[0],
    kid_ids: t.kidIds,
    title,
    event_type: "custody",
    starts_at: isoStr,
    ends_at: isoStr,
    all_day: false,
    location: null,
    notes: options.tentative ? "Pending approval" : null,
    recurring_rule: null,
    created_by: "",
    updated_by: null,
    created_at: "",
    updated_at: "",
    _virtual: true,
    _tentative: !!options.tentative,
    _pendingOverrideIds: options.pendingOverrideIds,
  };
}

function defaultTurnoverTimes(agreements: CustodyAgreement[]): {
  pickupTime: string;
  dropoffTime: string;
} {
  const latestAgreement = agreements.length > 0 ? agreements[0] : null;
  const terms = latestAgreement?.parsed_terms as ParsedCustodyTerms | null;
  return {
    pickupTime: terms?.alternating_weekends?.pickup_time || "3:00 PM",
    dropoffTime: terms?.alternating_weekends?.dropoff_time || "5:00 PM",
  };
}

/**
 * Standard (approved-truth) custody turnover events. Pending
 * overrides are intentionally excluded — pass approvedOverrides only.
 * The companion `generatePendingTurnoverEvents` emits the diff.
 */
export function generateTurnoverEvents(
  rangeStart: Date,
  rangeEnd: Date,
  schedules: CustodySchedule[],
  approvedOverrides: CustodyOverride[],
  agreements: CustodyAgreement[],
  kids: Kid[],
  members: { id: string; full_name: string }[]
): CalendarEvent[] {
  if (schedules.length === 0) return [];
  const transitions = detectTransitions(
    rangeStart,
    rangeEnd,
    schedules,
    approvedOverrides
  );
  const { pickupTime, dropoffTime } = defaultTurnoverTimes(agreements);
  return Array.from(transitions.values()).map((t) =>
    transitionToEvent(t, pickupTime, dropoffTime, members)
  );
}

/**
 * Pending-diff turnover events. Computes the projected transitions
 * (approved + pending) and emits ONLY the ones that don't already
 * appear in the approved-only set — by key AND time, so a same-day
 * same-parent time-only change emits a second chip.
 *
 * Each emitted event is `_tentative` and tagged with the
 * `_pendingOverrideIds` that contributed to its date — the calendar
 * uses that to open the PendingDiffPopover when the chip is clicked.
 */
export function generatePendingTurnoverEvents(
  rangeStart: Date,
  rangeEnd: Date,
  schedules: CustodySchedule[],
  approvedOverrides: CustodyOverride[],
  pendingOverrides: CustodyOverride[],
  agreements: CustodyAgreement[],
  members: { id: string; full_name: string }[]
): CalendarEvent[] {
  if (schedules.length === 0 || pendingOverrides.length === 0) return [];

  const approvedTransitions = detectTransitions(
    rangeStart,
    rangeEnd,
    schedules,
    approvedOverrides
  );
  const projectedTransitions = detectTransitions(
    rangeStart,
    rangeEnd,
    schedules,
    [...approvedOverrides, ...pendingOverrides]
  );

  const { pickupTime, dropoffTime } = defaultTurnoverTimes(agreements);

  // Build a "key|time" set of approved transitions so we can detect
  // which projected transitions are genuinely new (date and/or time
  // shifts). Time is included so a same-day, same-parent time-only
  // change still shows up as a pending-diff chip.
  const approvedSig = new Set<string>();
  for (const t of approvedTransitions.values()) {
    const tStr = t.overrideTime || (t.isPickup ? pickupTime : dropoffTime);
    approvedSig.add(`${t.key}|${tStr}`);
  }

  const events: CalendarEvent[] = [];
  for (const t of projectedTransitions.values()) {
    const tStr = t.overrideTime || (t.isPickup ? pickupTime : dropoffTime);
    const sig = `${t.key}|${tStr}`;
    if (approvedSig.has(sig)) continue;

    // Find which pending override(s) cover this transition's date for
    // the involved kids — this is the click target for the popover.
    const overrideIds = pendingOverrides
      .filter(
        (o) =>
          t.kidIds.includes(o.kid_id) &&
          o.start_date <= t.dateStr &&
          t.dateStr <= o.end_date
      )
      .map((o) => o.id);

    events.push(
      transitionToEvent(t, pickupTime, dropoffTime, members, {
        tentative: true,
        pendingOverrideIds: overrideIds,
      })
    );
  }

  return events;
}

// ── Holiday Events ──────────────────────────────────────────

export function generateHolidayEvents(
  rangeStart: Date,
  rangeEnd: Date,
  kids: Kid[],
  familyId: string
): CalendarEvent[] {
  const startYear = rangeStart.getFullYear();
  const endYear = rangeEnd.getFullYear();

  const allHolidays = [];
  for (let y = startYear; y <= endYear; y++) {
    allHolidays.push(...getHolidaysForYear(y));
  }

  // Filter to range
  const inRange = allHolidays.filter(
    (h) => h.date >= rangeStart && h.date <= rangeEnd
  );

  const kidIds = kids.map((k) => k.id);
  const firstKidId = kidIds[0] || "";

  return inRange.map((holiday) => {
    const dateStr = format(holiday.date, "yyyy-MM-dd");
    const tierLabel = holiday.tier === "federal"
      ? "Federal Holiday"
      : holiday.tier === "state"
      ? "VA State Holiday"
      : "";

    return {
      id: `holiday-${dateStr}-${holiday.name.replace(/\s+/g, "-").toLowerCase()}`,
      family_id: familyId,
      kid_id: firstKidId,
      kid_ids: kidIds,
      title: holiday.name,
      event_type: "holiday" as const,
      starts_at: formatAllDayTimestamp(dateStr),
      ends_at: formatAllDayTimestamp(dateStr, { asEnd: true }),
      all_day: true,
      location: null,
      notes: tierLabel,
      recurring_rule: null,
      created_by: "",
      updated_by: null,
      created_at: "",
      updated_at: "",
      _virtual: true,
    };
  });
}

// ── Time parsing helpers ────────────────────────────────────

/** Parse "3:00 PM" or "15:00" to a fractional hour (e.g., 15.0) */
function parseTimeToHour(timeStr: string): number {
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h + m / 60;
  }
  const mil = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (mil) {
    return parseInt(mil[1], 10) + parseInt(mil[2], 10) / 60;
  }
  return 15; // default 3 PM
}
