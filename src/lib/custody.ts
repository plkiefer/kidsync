import { CustodySchedule, CustodyOverride } from "./types";
import { differenceInCalendarDays, addDays, eachDayOfInterval, format } from "date-fns";

export interface DayCustodyEntry {
  parentId: string;
  isParentA: boolean;
  isOverride: boolean;
  isPending?: boolean;
}

export type DayCustodyInfo = Record<string, DayCustodyEntry>; // keyed by kid_id

/**
 * Compute who has custody of each kid on a given date.
 */
export function computeCustodyForDate(
  date: Date,
  schedules: CustodySchedule[],
  overrides: CustodyOverride[]
): DayCustodyInfo {
  const result: DayCustodyInfo = {};

  for (const schedule of schedules) {
    // Check overrides first — use the most recent one if multiple match
    const matchingOverrides = overrides
      .filter((o) => {
        if (o.kid_id !== schedule.kid_id) return false;
        // Skip terminal/inactive statuses. `superseded` rows stay in
        // the DB for audit but never affect computed custody.
        if (
          o.status === "disputed" ||
          o.status === "withdrawn" ||
          o.status === "superseded"
        )
          return false;
        const start = parseLocalDate(o.start_date);
        const end = parseLocalDate(o.end_date);
        return date >= start && date <= end;
      })
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const override = matchingOverrides[0] || null;

    if (override) {
      result[schedule.kid_id] = {
        parentId: override.parent_id,
        isParentA: override.parent_id === schedule.parent_a_id,
        isOverride: true,
        isPending: override.status === "pending",
      };
      continue;
    }

    // Compute from pattern
    if (schedule.pattern_type === "alternating_weeks") {
      const anchor = parseLocalDate(schedule.anchor_date);
      const daysSince = differenceInCalendarDays(date, anchor);
      // Which 2-week cycle period are we in?
      // Normalize negative values
      const weeksSince = Math.floor(daysSince / 7);
      const cycleWeek = ((weeksSince % 2) + 2) % 2; // 0 or 1
      const dayOfWeek = date.getDay();
      const isPatternDay = schedule.pattern_days.includes(dayOfWeek);

      // cycleWeek 0 + pattern day → parent_a has custody
      // cycleWeek 1 + pattern day → parent_b has custody
      // Non-pattern days → parent_b (default/primary custodian for weekdays)
      if (isPatternDay) {
        const isParentA = cycleWeek === 0;
        result[schedule.kid_id] = {
          parentId: isParentA ? schedule.parent_a_id : schedule.parent_b_id,
          isParentA,
          isOverride: false,
        };
      } else {
        result[schedule.kid_id] = {
          parentId: schedule.parent_b_id,
          isParentA: false,
          isOverride: false,
        };
      }
    } else if (schedule.pattern_type === "fixed_days") {
      const dayOfWeek = date.getDay();
      const parentId = schedule.fixed_day_map?.[dayOfWeek] || schedule.parent_b_id;
      result[schedule.kid_id] = {
        parentId,
        isParentA: parentId === schedule.parent_a_id,
        isOverride: false,
      };
    }
  }

  return result;
}

/** Parse a YYYY-MM-DD string as local date (avoids UTC shift) */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Find the pickup and dropoff dates for the custody block nearest a
 * reference date. Scans ±21 days for transitions — wide enough to
 * span multi-week custody blocks created by long approved overrides
 * (e.g. a 9-day Patrick-keeps stretch via two stacked overrides).
 *
 * Pass `effectiveOverrides` to find the EFFECTIVE turnover positions
 * (what's actually rendered on the calendar today). Pass `[]` to find
 * the base-schedule positions.
 *
 * Returns whichever sides were found within the scan window. A
 * pickup-only or dropoff-only result is valid — the caller takes
 * only the side it needs, and `null` is returned ONLY when no
 * transitions of either kind exist in the window (e.g. a fixed-days
 * schedule with no alternation).
 */
export function findStandardTurnoverDates(
  referenceDate: Date,
  schedule: CustodySchedule,
  effectiveOverrides: CustodyOverride[] = []
): { pickupDate: Date | null; dropoffDate: Date | null } | null {
  const scanStart = addDays(referenceDate, -21);
  const scanEnd = addDays(referenceDate, 21);
  const days = eachDayOfInterval({ start: scanStart, end: scanEnd });

  // Closest-to-refDate wins when multiple transitions are found in
  // the wide scan — otherwise a stretch with two pickup transitions
  // would lock onto whichever was iterated last.
  const refTime = referenceDate.getTime();
  let pickupDate: Date | null = null;
  let pickupDist = Infinity;
  let dropoffDate: Date | null = null;
  let dropoffDist = Infinity;

  for (let i = 1; i < days.length; i++) {
    const prev = computeCustodyForDate(days[i - 1], [schedule], effectiveOverrides);
    const curr = computeCustodyForDate(days[i], [schedule], effectiveOverrides);
    const kidId = schedule.kid_id;

    if (prev[kidId] && curr[kidId] && prev[kidId].parentId !== curr[kidId].parentId) {
      if (curr[kidId].isParentA) {
        // Transition to parent_a = pickup day
        const dist = Math.abs(days[i].getTime() - refTime);
        if (dist < pickupDist) {
          pickupDate = days[i];
          pickupDist = dist;
        }
      } else {
        // Transition away from parent_a = dropoff is the day BEFORE
        // (last day parent_a has custody)
        const dist = Math.abs(days[i - 1].getTime() - refTime);
        if (dist < dropoffDist) {
          dropoffDate = days[i - 1];
          dropoffDist = dist;
        }
      }
    }
  }

  if (!pickupDate && !dropoffDate) return null;
  return { pickupDate, dropoffDate };
}

/** Format a date as YYYY-MM-DD */
export function formatDateStr(date: Date): string {
  return format(date, "yyyy-MM-dd");
}
