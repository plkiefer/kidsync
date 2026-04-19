/**
 * All-day event date convention — single source of truth.
 *
 * The DB column calendar_events.starts_at / ends_at is a PostgreSQL timestamptz.
 * For timed events that's the right primitive. For all-day events (breaks,
 * holidays, closures, birthdays) it isn't — there's no meaningful time of day,
 * but we still have to pick one so Supabase can store it.
 *
 * Industry standard (iCalendar DTSTART;VALUE=DATE) is a floating date with no
 * timezone. We don't have that column. Until we migrate to a proper DATE
 * column, every all-day row MUST be anchored at 12:00:00 UTC. Rationale:
 *   - Noon UTC is safely inside the calendar date in any Western timezone
 *     (UTC-12 through UTC+11). T00:00 would shift back a day in negative
 *     offsets; T23:59 would shift forward in positive offsets.
 *   - Reading the stored value with UTC-aware getters returns the ORIGINAL
 *     calendar date regardless of the viewer's timezone — so a "Dec 25"
 *     imported from a US user renders as Dec 25 for a Tokyo user too.
 *
 * EVERY place that writes or reads an all-day date goes through this module.
 * Don't hand-roll `${date}T12:00:00` inline — use formatAllDayTimestamp.
 * Don't call getFullYear/getMonth/getDate on an all-day stored value — use
 * extractAllDayDate.
 */

/**
 * Compose the DB-ready timestamptz string for an all-day event.
 *
 * Input:  "2026-11-23"                   (calendar date, any source)
 * Output: "2026-11-23T12:00:00.000Z"     (UTC noon, ready for Supabase insert)
 * Output: "2026-11-23T12:00:00.001Z"     (asEnd=true, 1ms later)
 *
 * The explicit `.000Z` suffix is non-optional. A bare "T12:00:00" is parsed by
 * Supabase using the session timezone — the Z makes the serialization
 * self-describing.
 *
 * The `asEnd` flag adds 1 millisecond so single-day all-day events can satisfy
 * the DB's `CHECK (ends_at > starts_at)` constraint. 1ms is still the same
 * noon instant for every UTC-aware extractor, so the date round-trip is
 * unaffected.
 */
export function formatAllDayTimestamp(
  dateStr: string,
  opts?: { asEnd?: boolean }
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(
      `formatAllDayTimestamp expects YYYY-MM-DD, got "${dateStr}"`
    );
  }
  const ms = opts?.asEnd ? "001" : "000";
  return `${dateStr}T12:00:00.${ms}Z`;
}

/**
 * Extract the calendar date (YYYY-MM-DD) from a stored all-day timestamp.
 *
 * Uses UTC-aware getters so the caller's local timezone can't shift the
 * returned date across a boundary. The convention guarantees the stored value
 * is at UTC noon, so extracting UTC year/month/day gives us the ORIGINAL date
 * the event was authored for.
 *
 * Do NOT call new Date(stored).getFullYear() etc. — that reads in local TZ and
 * will silently shift Dec 25 to Dec 24 for viewers west of UTC around midnight.
 */
export function extractAllDayDate(stored: string): string {
  const d = new Date(stored);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Get the Date object representing the viewer's local midnight for the day an
 * all-day event falls on. Useful for comparisons against a day cell's Date.
 *
 * Round-trips through extractAllDayDate so it's TZ-safe.
 */
export function allDayAsLocalDate(stored: string): Date {
  const [y, m, d] = extractAllDayDate(stored).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Does an all-day event span the given calendar day?
 *
 * Compares at date granularity (year-month-day integer key). Safe across
 * timezone boundaries because we extract the stored UTC date on both sides.
 * Returns true for every day in [startsAt date, endsAt date], inclusive.
 */
export function allDayCoversDay(
  startsAtStored: string,
  endsAtStored: string,
  day: Date
): boolean {
  const startKey = dateKey(extractAllDayDate(startsAtStored));
  const endKey = dateKey(extractAllDayDate(endsAtStored));
  const dayStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(day.getDate()).padStart(2, "0")}`;
  const dKey = dateKey(dayStr);
  return dKey >= startKey && dKey <= endKey;
}

function dateKey(yyyymmdd: string): number {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return y * 10000 + m * 100 + d;
}
