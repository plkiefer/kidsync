import { CalendarEvent } from "./types";

// ── RRULE Parser ─────────────────────────────────────────────

const DAY_INDEX: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

interface ParsedRRule {
  freq: string;
  interval: number;
  byDay: number[];
  count: number;
  until: Date | null;
  hasEnd: boolean;
}

function parseRRule(rrule: string): ParsedRRule {
  const parts: Record<string, string> = {};
  rrule.split(";").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v) parts[k] = v;
  });

  let until: Date | null = null;
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/(\d{4})(\d{2})(\d{2})/);
    if (m)
      until = new Date(
        parseInt(m[1]),
        parseInt(m[2]) - 1,
        parseInt(m[3]),
        23,
        59,
        59
      );
  }

  return {
    freq: parts.FREQ || "WEEKLY",
    interval: parseInt(parts.INTERVAL || "1", 10),
    byDay: parts.BYDAY
      ? parts.BYDAY.split(",")
          .map((d) => DAY_INDEX[d])
          .filter((d) => d !== undefined)
          .sort((a, b) => a - b)
      : [],
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : 0,
    until,
    hasEnd: !!(parts.COUNT || parts.UNTIL),
  };
}

// ── Date helpers ─────────────────────────────────────────────

/** Replace the date portion of a datetime string, keeping the time. */
function replaceDate(originalDateTime: string, newDate: Date): string {
  let timePart = "00:00:00";
  const tIdx = originalDateTime.indexOf("T");
  if (tIdx !== -1) {
    timePart = originalDateTime
      .substring(tIdx + 1)
      .replace(/Z.*$/, "")
      .replace(/[+-]\d{2}:?\d{2}$/, "")
      .replace(/\.\d+$/, "");
  }
  const y = newDate.getFullYear();
  const m = String(newDate.getMonth() + 1).padStart(2, "0");
  const d = String(newDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${timePart}`;
}

// ── Main expansion ───────────────────────────────────────────

/**
 * Expand recurring events into individual virtual occurrences.
 * The original event (first occurrence) stays unchanged.
 * Additional occurrences are copies with `_virtual: true`.
 */
export function expandRecurringEvents(
  events: CalendarEvent[]
): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  const MAX_OCCURRENCES = 365;
  const MAX_FUTURE_DAYS = 365;

  for (const event of events) {
    // Always keep the original
    result.push(event);

    if (!event.recurring_rule || event._virtual) continue;

    const rule = parseRRule(event.recurring_rule);
    const startDate = new Date(event.starts_at);
    const endDate = new Date(event.ends_at);
    const durationMs = endDate.getTime() - startDate.getTime();

    // Hard cap for rules with no end
    const hardLimit = new Date(startDate);
    hardLimit.setDate(hardLimit.getDate() + MAX_FUTURE_DAYS);

    const occDates: Date[] = [];
    let total = 1; // the original counts as #1

    const shouldStop = (d: Date): boolean => {
      if (rule.count > 0 && total >= rule.count) return true;
      if (rule.until && d > rule.until) return true;
      if (!rule.hasEnd && d > hardLimit) return true;
      if (occDates.length >= MAX_OCCURRENCES) return true;
      return false;
    };

    if (rule.freq === "WEEKLY" && rule.byDay.length > 0) {
      // ── Weekly with BYDAY ──────────────────────────────
      // Walk week-by-week starting from the start date's week
      const weekSunday = new Date(startDate);
      weekSunday.setDate(weekSunday.getDate() - weekSunday.getDay());

      let weekNum = 0;
      outer: while (true) {
        const wk = new Date(weekSunday);
        wk.setDate(wk.getDate() + weekNum * 7 * rule.interval);

        for (const dayIdx of rule.byDay) {
          const occ = new Date(wk);
          occ.setDate(occ.getDate() + dayIdx);
          occ.setHours(
            startDate.getHours(),
            startDate.getMinutes(),
            startDate.getSeconds(),
            0
          );

          // Skip anything on or before the original start
          if (occ.getTime() <= startDate.getTime()) continue;
          if (shouldStop(occ)) break outer;

          occDates.push(occ);
          total++;
        }
        weekNum++;
      }
    } else {
      // ── DAILY / WEEKLY (no BYDAY) / MONTHLY / YEARLY ──
      let n = 1;
      while (true) {
        const next = new Date(startDate);

        switch (rule.freq) {
          case "DAILY":
            next.setDate(startDate.getDate() + rule.interval * n);
            break;
          case "WEEKLY":
            next.setDate(startDate.getDate() + 7 * rule.interval * n);
            break;
          case "MONTHLY": {
            const targetDay = startDate.getDate();
            next.setMonth(startDate.getMonth() + rule.interval * n);
            // Handle overflow (e.g., Jan 31 → Mar 3 → snap to Feb 28)
            if (next.getDate() !== targetDay) {
              next.setDate(0); // last day of the intended month
            }
            break;
          }
          case "YEARLY":
            next.setFullYear(startDate.getFullYear() + rule.interval * n);
            if (next.getDate() !== startDate.getDate()) {
              next.setDate(0); // leap-year Feb 29 → Feb 28
            }
            break;
        }

        if (shouldStop(next)) break;

        occDates.push(next);
        total++;
        n++;
      }
    }

    // Build virtual events for each occurrence
    for (let i = 0; i < occDates.length; i++) {
      const occStart = occDates[i];
      const occEnd = new Date(occStart.getTime() + durationMs);

      result.push({
        ...event,
        id: `${event.id}_rec_${i + 1}`,
        starts_at: replaceDate(event.starts_at, occStart),
        ends_at: replaceDate(event.ends_at, occEnd),
        _virtual: true,
        _recurrence_parent: event.id,
      });
    }
  }

  return result;
}
