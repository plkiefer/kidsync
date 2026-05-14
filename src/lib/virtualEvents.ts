import { CalendarEvent, CustodySchedule, CustodyOverride, CustodyAgreement, ParsedCustodyTerms, Kid } from "./types";
import { computeCustodyForDate, DayCustodyInfo, parseLocalDate } from "./custody";
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

  // Tentative chips include the first contributing override id so two
  // pending requests on the same day don't share an id (React key
  // collisions, click routing ambiguity).
  const tentativeSuffix =
    options.tentative && options.pendingOverrideIds?.[0]
      ? `-pending-${options.pendingOverrideIds[0].slice(0, 8)}`
      : options.tentative
      ? "-pending"
      : "";
  return {
    id: `turnover-${t.dateStr}-${t.isPickup ? "pickup" : "dropoff"}${tentativeSuffix}`,
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
 * Pending turnover events — emitted DIRECTLY from each pending
 * override row, not via transition arithmetic on the projected
 * schedule. The diff approach was brittle in scenarios where
 * approved overrides had already absorbed the underlying transition
 * (e.g. Patrick already has Thu via approved override, so a pending
 * Fri time-change has no transition to "shift" against).
 *
 * Per pending request (overrides grouped by date+parent+time+note,
 * collapsing N per-kid rows into one logical chip):
 *   - Ownership-change request → emit a "(proposed)" pickup chip on
 *     start_date. (We skip the matching dropoff for now to keep the
 *     calendar uncluttered; the popover surfaces the full diff.)
 *   - Time-only request → emit a "(proposed)" pickup chip on
 *     start_date at override_time, alongside the still-solid
 *     standard chip.
 *
 * Both stripe + chip click route to the PendingDiffPopover via
 * `_pendingOverrideIds`.
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

  const { pickupTime, dropoffTime } = defaultTurnoverTimes(agreements);

  // Group per-kid override rows that belong to the same logical
  // request — same date range, same proposed parent, same time, same
  // note. The popover deals in this grouped form too.
  const groupKey = (o: CustodyOverride) =>
    `${o.start_date}|${o.end_date}|${o.parent_id}|${o.override_time ?? ""}|${
      o.note ?? ""
    }`;
  const groups = new Map<string, CustodyOverride[]>();
  for (const o of pendingOverrides) {
    const k = groupKey(o);
    const list = groups.get(k);
    if (list) list.push(o);
    else groups.set(k, [o]);
  }

  const events: CalendarEvent[] = [];
  for (const group of groups.values()) {
    const primary = group[0];
    const startDate = parseLocalDate(primary.start_date);
    const endDate = parseLocalDate(primary.end_date);
    // Skip groups entirely outside the visible range
    if (endDate < rangeStart || startDate > rangeEnd) continue;

    const kidIds = group.map((o) => o.kid_id);
    const overrideIds = group.map((o) => o.id);

    // Detect ownership change at the request's start date — if
    // approved-only custody for any of these kids has a different
    // parent than what's being proposed, this is an ownership change.
    const startCustody = computeCustodyForDate(
      startDate,
      schedules,
      approvedOverrides
    );
    const ownershipChange = kidIds.some((kidId) => {
      const cur = startCustody[kidId]?.parentId;
      return cur && cur !== primary.parent_id;
    });

    // No-op request (same parent, no time change). Don't emit a chip
    // — the dashed cell stripe is still drawn by the view since the
    // override exists.
    if (!ownershipChange && !primary.override_time) continue;

    // Both branches emit a pickup-style chip on start_date. For
    // ownership changes the chip carries the proposed parent's name
    // ("Pick Up — Patrick (proposed)"); for time-only changes it
    // carries the same parent and the proposed time. The popover
    // handles the full semantic detail.
    const transition: TurnoverTransition = {
      eventDate: startDate,
      dateStr: primary.start_date,
      toParentId: primary.parent_id,
      isPickup: true,
      kidIds,
      familyId: primary.family_id,
      overrideTime: primary.override_time || null,
      key: `pending-${primary.id}`,
    };
    events.push(
      transitionToEvent(transition, pickupTime, dropoffTime, members, {
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
