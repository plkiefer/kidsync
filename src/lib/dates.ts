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

/** Format a datetime string to readable time: "4:00 PM" */
export function formatTime(dateStr: string): string {
  return format(parseISO(dateStr), "h:mm a");
}

/** Format a datetime string to readable date: "Mon, Mar 10" */
export function formatShortDate(dateStr: string): string {
  return format(parseISO(dateStr), "EEE, MMM d");
}

/** Format for display in event cards: "Mar 10, 4:00 PM" */
export function formatEventDateTime(dateStr: string): string {
  return format(parseISO(dateStr), "MMM d, h:mm a");
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
