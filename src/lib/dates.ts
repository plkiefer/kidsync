import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  parseISO,
} from "date-fns";

export {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  parseISO,
};

/**
 * Parse a Supabase timestamptz string. Supabase may return bare ISO strings
 * (no Z or offset) which JS interprets as local time. Since Supabase stores
 * in UTC, we append Z if no timezone indicator is present.
 */
export function parseTimestamp(dateStr: string): Date {
  if (
    !dateStr.endsWith("Z") &&
    !/[+-]\d{2}:\d{2}$/.test(dateStr) &&
    !/[+-]\d{4}$/.test(dateStr)
  ) {
    return new Date(dateStr + "Z");
  }
  return new Date(dateStr);
}

/** Format a datetime string to readable time: "4:00 PM" */
export function formatTime(dateStr: string): string {
  return format(parseTimestamp(dateStr), "h:mm a");
}

/** Format a datetime string to readable date: "Mon, Mar 10" */
export function formatShortDate(dateStr: string): string {
  return format(parseTimestamp(dateStr), "EEE, MMM d");
}

/** Format for display in event cards: "Mar 10, 4:00 PM" */
export function formatEventDateTime(dateStr: string): string {
  return format(parseTimestamp(dateStr), "MMM d, h:mm a");
}

/** Format for month header: "March 2026" */
export function formatMonthYear(date: Date): string {
  return format(date, "MMMM yyyy");
}

/** Convert Date to datetime-local input value */
export function toDateTimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

/** Get all calendar grid days for a month view (includes padding days) */
export function getCalendarDays(date: Date): Date[] {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);

  return eachDayOfInterval({ start: calStart, end: calEnd });
}

/** Get all days in a week containing the given date */
export function getWeekDays(date: Date): Date[] {
  const weekStart = startOfWeek(date);
  const weekEnd = endOfWeek(date);
  return eachDayOfInterval({ start: weekStart, end: weekEnd });
}

/** Get fractional hour from a datetime string (e.g., 5:30 PM = 17.5) */
export function getHourFromDateStr(dateStr: string): number {
  const d = parseTimestamp(dateStr);
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * Does an event cover the given calendar day?
 *
 * Timed events: only on their start day (calendars traditionally anchor timed
 * events where they begin — a 6pm → 9pm event doesn't "span" two days).
 * All-day events: cover every day from starts_at date through ends_at date,
 * inclusive. Lets multi-day breaks / vacations / school closures render on
 * every cell in their range.
 */
export function eventCoversDay(
  starts_at: string,
  ends_at: string,
  all_day: boolean,
  day: Date
): boolean {
  const start = parseTimestamp(starts_at);
  if (!all_day) return isSameDay(start, day);
  const end = parseTimestamp(ends_at);
  // Compare at date-granularity. Zero out the hour portion so TZ noise from
  // the timestamptz round-trip can't flip the comparison.
  const dayKey = day.getFullYear() * 10000 + day.getMonth() * 100 + day.getDate();
  const startKey =
    start.getFullYear() * 10000 + start.getMonth() * 100 + start.getDate();
  const endKey =
    end.getFullYear() * 10000 + end.getMonth() * 100 + end.getDate();
  return dayKey >= startKey && dayKey <= endKey;
}
