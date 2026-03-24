import { CalendarEvent, CustodySchedule, CustodyOverride, CustodyAgreement, ParsedCustodyTerms, Kid } from "./types";
import { computeCustodyForDate, DayCustodyInfo } from "./custody";
import { getHolidaysForYear } from "./holidays";
import { eachDayOfInterval, addDays, format } from "date-fns";

// ── Custody Turnover Events ─────────────────────────────────

/**
 * Detect custody turnovers by comparing custody parent on consecutive days.
 *
 * Key logic:
 *  - PICKUP (primary→weekend parent): event on the day the weekend parent STARTS,
 *    at pickup time (e.g., Friday 3 PM — Father picks up).
 *  - DROPOFF (weekend→primary parent): event on the LAST day the weekend parent HAS
 *    custody, at dropoff time (e.g., Sunday 5 PM — Father drops off).
 */
export function generateTurnoverEvents(
  rangeStart: Date,
  rangeEnd: Date,
  schedules: CustodySchedule[],
  overrides: CustodyOverride[],
  agreements: CustodyAgreement[],
  kids: Kid[],
  members: { id: string; full_name: string }[]
): CalendarEvent[] {
  if (schedules.length === 0) return [];

  const approvedOverrides = overrides.filter(
    (o) => o.status === "approved" || o.status === "pending"
  );

  // Get pickup/dropoff times from the latest parsed agreement
  const latestAgreement = agreements.length > 0 ? agreements[0] : null;
  const terms = latestAgreement?.parsed_terms as ParsedCustodyTerms | null;
  const pickupTime = terms?.alternating_weekends?.pickup_time || "3:00 PM";
  const dropoffTime = terms?.alternating_weekends?.dropoff_time || "5:00 PM";

  // Extend range by 1 day on each side to detect boundary transitions
  const extStart = addDays(rangeStart, -1);
  const extEnd = addDays(rangeEnd, 1);
  const days = eachDayOfInterval({ start: extStart, end: extEnd });

  // Key: "eventDate|toParentId" → merged transition info
  const transitionMap = new Map<string, {
    eventDate: Date;
    dateStr: string;
    toParentId: string;
    isPickup: boolean;
    isTentative: boolean;
    kidIds: string[];
    familyId: string;
    overrideTime: string | null;
  }>();

  let prevCustody: DayCustodyInfo = {};

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const custody = computeCustodyForDate(day, schedules, approvedOverrides);

    if (i > 0) {
      for (const schedule of schedules) {
        const kidId = schedule.kid_id;
        const prev = prevCustody[kidId];
        const curr = custody[kidId];

        if (prev && curr && prev.parentId !== curr.parentId) {
          const isPickup = curr.isParentA;
          const eventDate = isPickup ? day : days[i - 1];

          // Check if this transition involves a pending override
          const isTentative = !!(curr.isPending || prev.isPending);

          if (eventDate >= rangeStart && eventDate <= rangeEnd) {
            const dateStr = format(eventDate, "yyyy-MM-dd");
            const key = `${dateStr}|${curr.parentId}|${isPickup}`;

            // Check if any override on the event date carries a time override
            const matchingOverride = approvedOverrides.find(
              (o) =>
                o.kid_id === kidId &&
                o.override_time &&
                o.start_date <= dateStr &&
                o.end_date >= dateStr
            );
            const overrideTime = matchingOverride?.override_time || null;

            const existing = transitionMap.get(key);
            if (existing) {
              if (!existing.kidIds.includes(kidId)) {
                existing.kidIds.push(kidId);
              }
              if (isTentative) existing.isTentative = true;
              if (overrideTime && !existing.overrideTime) existing.overrideTime = overrideTime;
            } else {
              transitionMap.set(key, {
                eventDate,
                dateStr,
                toParentId: curr.parentId,
                isPickup,
                isTentative,
                kidIds: [kidId],
                familyId: schedule.family_id,
                overrideTime,
              });
            }
          }
        }
      }
    }

    prevCustody = custody;
  }

  // Build one event per unique transition (merged across kids)
  const events: CalendarEvent[] = [];
  for (const t of transitionMap.values()) {
    const timeStr = t.overrideTime || (t.isPickup ? pickupTime : dropoffTime);
    const hour = parseTimeToHour(timeStr);

    // Build a proper local→UTC ISO string so parseTimestamp handles it correctly
    const [y, m, d] = t.dateStr.split("-").map(Number);
    const h = Math.floor(hour);
    const min = Math.round((hour - h) * 60);
    const localDate = new Date(y, m - 1, d, h, min, 0);
    const isoStr = localDate.toISOString(); // converts local time to UTC with Z

    const receivingParent = members.find((m) => m.id === t.toParentId);
    const receivingName = receivingParent?.full_name?.split(" ")[0] || "Other Parent";

    const baseTitle = t.isPickup
      ? `Pickup — ${receivingName}`
      : `Drop-off — ${receivingName}`;
    const title = t.isTentative ? `${baseTitle} (pending)` : baseTitle;

    events.push({
      id: `turnover-${t.dateStr}-${t.isPickup ? "pickup" : "dropoff"}`,
      family_id: t.familyId,
      kid_id: t.kidIds[0],
      kid_ids: t.kidIds,
      title,
      event_type: "custody",
      starts_at: isoStr,
      ends_at: isoStr,
      all_day: false,
      location: null,
      notes: t.isTentative ? "Pending approval" : null,
      recurring_rule: null,
      created_by: "",
      updated_by: null,
      created_at: "",
      updated_at: "",
      _virtual: true,
      _tentative: t.isTentative,
    });
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
      starts_at: `${dateStr}T12:00:00`,
      ends_at: `${dateStr}T12:00:00`,
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

/** Format a fractional hour to "HH:MM" */
function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
