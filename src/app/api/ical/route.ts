import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { getHolidaysForYear, getHolidayIcon } from "@/lib/holidays";
import { computeCustodyForDate } from "@/lib/custody";
import { eachDayOfInterval, addDays, format } from "date-fns";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const pad = (n: number) => String(n).padStart(2, "0");

function toICalDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function toICalDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * Format a calendar-day Date plus an HH:MM-of-day pair as an iCal
 * "floating" datetime string ("YYYYMMDDTHHMMSS", no Z) suitable for
 * pairing with a TZID parameter. Avoids Date.setHours() which would
 * use the server's local timezone (Vercel = UTC) and produce the
 * wrong instant for Eastern-time exchange events.
 *
 * Uses getUTC* on the day-Date because date-fns' eachDayOfInterval
 * produces midnight-local Date objects; on a UTC server that's
 * midnight UTC, and getUTC* extracts the calendar Y/M/D unambiguously.
 */
function toICalLocalDateTime(day: Date, hour: number, minute: number): string {
  const yr = day.getUTCFullYear();
  const mo = day.getUTCMonth() + 1;
  const dy = day.getUTCDate();
  return `${yr}${pad(mo)}${pad(dy)}T${pad(hour)}${pad(minute)}00`;
}

/**
 * VTIMEZONE block for America/New_York. Without this, calendars
 * receiving DTSTART;TZID=... can't resolve the offset and may
 * fall back to UTC interpretation. Uses the post-2007 US DST rules
 * (second Sunday in March → first Sunday in November). Hardcoded
 * for now since the family is in Eastern time; if other timezones
 * become a thing we can compute this from a profile setting.
 */
const VTIMEZONE_NY: string[] = [
  "BEGIN:VTIMEZONE",
  "TZID:America/New_York",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "TZNAME:EDT",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "TZNAME:EST",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function escapeIcal(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up user by their ical token
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, family_id, full_name")
    .eq("ical_token", token)
    .single();

  if (!profile) {
    return new Response("Invalid token", { status: 401 });
  }

  // Fetch all data needed
  const [eventsRes, kidsRes, schedulesRes, overridesRes, agreementsRes] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("*, kid:kids(name), travel:event_travel_details(*)")
      .eq("family_id", profile.family_id)
      .gte("starts_at", "2026-01-01T00:00:00")
      .order("starts_at", { ascending: true }),
    supabase.from("kids").select("*").eq("family_id", profile.family_id),
    supabase.from("custody_schedules").select("*").eq("family_id", profile.family_id),
    supabase.from("custody_overrides").select("*").eq("family_id", profile.family_id).neq("status", "withdrawn"),
    supabase.from("custody_agreements").select("parsed_terms").eq("family_id", profile.family_id).order("created_at", { ascending: false }).limit(1),
  ]);

  const events = eventsRes.data || [];
  const kids = kidsRes.data || [];
  const schedules = schedulesRes.data || [];
  const overrides = overridesRes.data || [];
  const agreement = agreementsRes.data?.[0];
  const terms = agreement?.parsed_terms as any;
  const pickupTime = terms?.alternating_weekends?.pickup_time || "3:00 PM";
  const dropoffTime = terms?.alternating_weekends?.dropoff_time || "5:00 PM";
  const members = (await supabase.from("profiles").select("id, full_name").eq("family_id", profile.family_id)).data || [];

  // Build iCal
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KidSync//Co-Parent Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:KidSync Calendar",
    "X-WR-TIMEZONE:America/New_York",
    ...VTIMEZONE_NY,
  ];

  // ── DB Events ──────────────────────────────────────────
  for (const evt of events) {
    const kidName = (evt.kid as any)?.name || "Unknown";
    const start = new Date(evt.starts_at);
    const end = new Date(evt.ends_at);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${evt.id}@kidsync`);

    if (evt.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${toICalDate(start)}`);
      const endDate = new Date(end);
      endDate.setDate(endDate.getDate() + 1); // iCal all-day end is exclusive
      lines.push(`DTEND;VALUE=DATE:${toICalDate(endDate)}`);
    } else {
      lines.push(`DTSTART:${toICalDateTime(start)}`);
      lines.push(`DTEND:${toICalDateTime(end)}`);
    }

    lines.push(`SUMMARY:[${escapeIcal(kidName)}] ${escapeIcal(evt.title)}`);

    // Add RRULE for recurring events
    if (evt.recurring_rule) {
      lines.push(`RRULE:${evt.recurring_rule}`);
    }

    // Add EXDATE for recurrence exceptions
    const exceptions = evt.recurrence_exceptions as string[] | null;
    if (exceptions && exceptions.length > 0) {
      for (const exDate of exceptions) {
        const [y, m, d] = exDate.split("-").map(Number);
        const exDateTime = new Date(y, m - 1, d, start.getHours(), start.getMinutes());
        lines.push(`EXDATE:${toICalDateTime(exDateTime)}`);
      }
    }

    // Description with travel details
    let description = evt.notes || "";
    const travel = evt.travel as any;
    if (travel && Array.isArray(travel) && travel.length > 0) {
      const t = travel[0];
      if (t.lodging_name) {
        description += `\\nLODGING: ${t.lodging_name}`;
        if (t.lodging_address) description += `\\n${t.lodging_address}`;
      }
      if (t.flights) {
        try {
          const flights = typeof t.flights === "string" ? JSON.parse(t.flights) : t.flights;
          for (const f of flights) {
            description += `\\nFLIGHT: ${f.carrier} ${f.flight_number} ${f.departure_airport}-${f.arrival_airport}`;
          }
        } catch { /* ignore */ }
      }
    }
    if (description) lines.push(`DESCRIPTION:${escapeIcal(description)}`);
    if (evt.location) lines.push(`LOCATION:${escapeIcal(evt.location)}`);
    lines.push("END:VEVENT");
  }

  // ── Birthdays ──────────────────────────────────────────
  for (const kid of kids) {
    if (!kid.birth_date) continue;
    const [bYear, bMonth, bDay] = kid.birth_date.split("-").map(Number);
    for (let year = 2026; year <= 2041; year++) {
      const age = year - bYear;
      const dateStr = `${year}${pad(bMonth)}${pad(bDay)}`;
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:birthday-${kid.id}-${year}@kidsync`);
      lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
      const nextDay = new Date(year, bMonth - 1, bDay + 1);
      lines.push(`DTEND;VALUE=DATE:${toICalDate(nextDay)}`);
      lines.push(`SUMMARY:🎂 ${escapeIcal(kid.name)}'s Birthday${age > 0 ? ` (${age})` : ""}`);
      lines.push("END:VEVENT");
    }
  }

  // ── Holidays (2026-2041) ───────────────────────────────
  for (let year = 2026; year <= 2041; year++) {
    const holidays = getHolidaysForYear(year);
    for (const h of holidays) {
      const dateStr = `${h.date.getFullYear()}${pad(h.date.getMonth() + 1)}${pad(h.date.getDate())}`;
      const icon = getHolidayIcon(h.name);
      const tierLabel = h.tier === "federal" ? " (Federal)" : h.tier === "state" ? " (VA)" : "";
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:holiday-${dateStr}-${h.name.replace(/\s+/g, "-")}@kidsync`);
      lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
      const nextDay = new Date(h.date);
      nextDay.setDate(nextDay.getDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${toICalDate(nextDay)}`);
      lines.push(`SUMMARY:${icon} ${escapeIcal(h.name)}${tierLabel}`);
      lines.push("TRANSP:TRANSPARENT");
      lines.push("END:VEVENT");
    }
  }

  // ── Custody Turnovers (next 6 months) ──────────────────
  if (schedules.length > 0) {
    const approvedOverrides = overrides.filter(
      (o: any) => o.status === "approved" || o.status === "pending"
    );
    const rangeStart = new Date();
    const rangeEnd = new Date();
    rangeEnd.setMonth(rangeEnd.getMonth() + 6);
    const days = eachDayOfInterval({ start: addDays(rangeStart, -1), end: addDays(rangeEnd, 1) });

    let prevCustody: Record<string, any> = {};
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const custody = computeCustodyForDate(day, schedules as any, approvedOverrides as any);

      if (i > 0 && day >= rangeStart && day <= rangeEnd) {
        // Check first kid for transitions
        const firstKid = schedules[0] as any;
        const prev = prevCustody[firstKid.kid_id];
        const curr = custody[firstKid.kid_id];

        if (prev && curr && prev.parentId !== curr.parentId) {
          const isPickup = curr.isParentA;
          const eventDate = isPickup ? day : days[i - 1];
          const dateStr = format(eventDate, "yyyy-MM-dd");

          const receivingParent = members.find((m: any) => m.id === (isPickup ? curr.parentId : curr.parentId));
          const name = (receivingParent as any)?.full_name?.split(" ")[0] || "Parent";
          const title = isPickup ? `Pickup — ${name}` : `Drop-off — ${name}`;
          const timeStr = isPickup ? pickupTime : dropoffTime;

          // Parse time
          const ampm = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
          let hour = 15, min = 0;
          if (ampm) {
            hour = parseInt(ampm[1]);
            min = parseInt(ampm[2]);
            if (ampm[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
            if (ampm[3].toUpperCase() === "AM" && hour === 12) hour = 0;
          }

          // Emit the local datetime + TZID rather than a UTC Z-stamp.
          // Prevents Date.setHours() from baking the server's UTC
          // local-time into the export (which used to ship 3pm-Eastern
          // exchanges as 15:00Z = 11am-Eastern in subscribers' clients).
          const dtLocal = toICalLocalDateTime(eventDate, hour, min);
          // 30-minute window so calendars actually render the event
          // as a block instead of a zero-length point.
          const endHour = min >= 30 ? hour + 1 : hour;
          const endMin = (min + 30) % 60;
          const dtLocalEnd = toICalLocalDateTime(eventDate, endHour, endMin);

          lines.push("BEGIN:VEVENT");
          lines.push(`UID:turnover-${dateStr}-${isPickup ? "pickup" : "dropoff"}@kidsync`);
          lines.push(`DTSTART;TZID=America/New_York:${dtLocal}`);
          lines.push(`DTEND;TZID=America/New_York:${dtLocalEnd}`);
          lines.push(`SUMMARY:🔄 ${escapeIcal(title)}`);
          lines.push("END:VEVENT");
        }
      }
      prevCustody = custody;
    }
  }

  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kidsync.ics"',
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
