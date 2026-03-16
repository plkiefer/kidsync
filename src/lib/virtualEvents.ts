import { CalendarEvent, CustodySchedule, CustodyOverride, CustodyAgreement, ParsedCustodyTerms, Kid } from "./types";
import { computeCustodyForDate, DayCustodyInfo } from "./custody";
import { getHolidaysForYear, getHolidayIcon, getHolidayColor, HolidayTier } from "./holidays";
import { eachDayOfInterval, addDays, format } from "date-fns";

// ── Custody Turnover Events ─────────────────────────────────

interface TurnoverInfo {
  kidId: string;
  kidName: string;
  date: Date;
  fromParentId: string;
  toParentId: string;
  isParentAPickup: boolean; // true if parent A is picking up
}

/**
 * Detect custody turnovers by comparing custody parent on consecutive days.
 * Returns turnover events within the given date range.
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
  const dropoffTime = terms?.alternating_weekends?.dropoff_time || "6:00 PM";

  // Extend range by 1 day on each side to detect boundary transitions
  const extStart = addDays(rangeStart, -1);
  const days = eachDayOfInterval({ start: extStart, end: rangeEnd });

  const events: CalendarEvent[] = [];
  let prevCustody: DayCustodyInfo = {};

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const custody = computeCustodyForDate(day, schedules, approvedOverrides);

    if (i > 0 && i < days.length) {
      // Compare each kid's custody parent with previous day
      for (const schedule of schedules) {
        const kidId = schedule.kid_id;
        const kid = kids.find((k) => k.id === kidId);
        if (!kid) continue;

        const prev = prevCustody[kidId];
        const curr = custody[kidId];

        if (prev && curr && prev.parentId !== curr.parentId) {
          // Only generate events within the actual range (not the extended day)
          if (day >= rangeStart && day <= rangeEnd) {
            const toParent = members.find((m) => m.id === curr.parentId);
            const toName = toParent?.full_name?.split(" ")[0] || "Other Parent";

            // Determine if this is a pickup (start of parent's time) or dropoff
            const isPickup = curr.isParentA;
            const timeStr = isPickup ? pickupTime : dropoffTime;
            const hour = parseTimeToHour(timeStr);
            const dateStr = format(day, "yyyy-MM-dd");

            events.push({
              id: `turnover-${kidId}-${dateStr}`,
              family_id: schedule.family_id,
              kid_id: kidId,
              kid_ids: [kidId],
              title: `Custody Exchange — ${toName} picks up`,
              event_type: "custody",
              starts_at: `${dateStr}T${formatHour(hour)}:00`,
              ends_at: `${dateStr}T${formatHour(hour + 0.5)}:00`,
              all_day: false,
              location: null,
              notes: null,
              recurring_rule: null,
              created_by: "",
              updated_by: null,
              created_at: "",
              updated_at: "",
              _virtual: true,
            });
          }
        }
      }
    }

    prevCustody = custody;
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
    const icon = getHolidayIcon(holiday.name);
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
      title: `${icon} ${holiday.name}`,
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
  // Try "H:MM AM/PM" format
  const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h + m / 60;
  }
  // Try "HH:MM" 24-hour format
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
