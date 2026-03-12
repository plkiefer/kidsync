import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function toICalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcal(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const kidFilter = request.nextUrl.searchParams.get("kid");

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

  // Fetch events (last 6 months + future)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  let query = supabase
    .from("calendar_events")
    .select(
      `
      *,
      kid:kids(name),
      travel:event_travel_details(*)
    `
    )
    .eq("family_id", profile.family_id)
    .gte("starts_at", sixMonthsAgo.toISOString())
    .order("starts_at", { ascending: true });

  if (kidFilter) {
    query = query.eq("kid_id", kidFilter);
  }

  const { data: events } = await query;

  // Build iCal
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KidSync//Co-Parent Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:KidSync Calendar",
    "X-WR-TIMEZONE:America/New_York",
  ];

  for (const evt of events || []) {
    const kidName = (evt.kid as any)?.name || "Unknown";
    const start = new Date(evt.starts_at);
    const end = new Date(evt.ends_at);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${evt.id}@kidsync`);
    lines.push(`DTSTART:${toICalDate(start)}`);
    lines.push(`DTEND:${toICalDate(end)}`);
    lines.push(
      `SUMMARY:[${escapeIcal(kidName)}] ${escapeIcal(evt.title)}`
    );

    let description = "";
    if (evt.notes) description += evt.notes;

    const travel = evt.travel as any;
    if (travel && Array.isArray(travel) && travel.length > 0) {
      const t = travel[0];
      if (t.lodging_name) {
        description += `\\n\\nLODGING: ${t.lodging_name}`;
        if (t.lodging_address) description += `\\n${t.lodging_address}`;
        if (t.lodging_phone) description += `\\nPhone: ${t.lodging_phone}`;
        if (t.lodging_confirmation)
          description += `\\nConf#: ${t.lodging_confirmation}`;
      }
      if (t.flights) {
        try {
          const flights =
            typeof t.flights === "string"
              ? JSON.parse(t.flights)
              : t.flights;
          for (const f of flights) {
            description += `\\n\\nFLIGHT: ${f.carrier} ${f.flight_number}`;
            description += `\\n${f.departure_airport} → ${f.arrival_airport}`;
            if (f.departure_time)
              description += `\\nDeparts: ${new Date(f.departure_time).toLocaleString()}`;
            if (f.confirmation)
              description += `\\nConf#: ${f.confirmation}`;
          }
        } catch {
          // ignore malformed flight data
        }
      }
      if (t.emergency_name) {
        description += `\\n\\nEMERGENCY: ${t.emergency_name} ${t.emergency_phone || ""}`;
      }
    }

    if (description) lines.push(`DESCRIPTION:${escapeIcal(description)}`);
    if (evt.location) lines.push(`LOCATION:${escapeIcal(evt.location)}`);
    lines.push(`LAST-MODIFIED:${toICalDate(new Date(evt.updated_at))}`);
    lines.push("END:VEVENT");
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
