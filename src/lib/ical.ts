import { CalendarEvent, Kid, EventTravelDetails, FlightLeg } from "./types";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toICalDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate()
  )}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
    date.getUTCSeconds()
  )}Z`;
}

function escapeIcal(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function buildTravelDescription(travel: EventTravelDetails): string {
  const parts: string[] = [];

  if (travel.lodging_name) {
    parts.push(`LODGING: ${travel.lodging_name}`);
    if (travel.lodging_address) parts.push(travel.lodging_address);
    if (travel.lodging_phone) parts.push(`Phone: ${travel.lodging_phone}`);
    if (travel.lodging_confirmation)
      parts.push(`Conf#: ${travel.lodging_confirmation}`);
  }

  if (travel.flights && travel.flights.length > 0) {
    for (const f of travel.flights) {
      parts.push("");
      parts.push(
        `FLIGHT: ${f.carrier} ${f.flight_number} (${f.direction})`
      );
      parts.push(`${f.departure_airport} → ${f.arrival_airport}`);
      if (f.departure_time) {
        parts.push(
          `Departs: ${new Date(f.departure_time).toLocaleString()}`
        );
      }
      if (f.arrival_time) {
        parts.push(
          `Arrives: ${new Date(f.arrival_time).toLocaleString()}`
        );
      }
      if (f.confirmation) parts.push(`Conf#: ${f.confirmation}`);
    }
  }

  if (travel.emergency_name) {
    parts.push("");
    parts.push(
      `EMERGENCY: ${travel.emergency_name} ${travel.emergency_phone || ""}`
    );
    if (travel.emergency_relation) parts.push(travel.emergency_relation);
  }

  return parts.join("\\n");
}

export function generateICal(
  events: CalendarEvent[],
  kids: Kid[]
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KidSync//Co-Parent Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:KidSync Calendar",
    "X-WR-TIMEZONE:America/New_York",
  ];

  for (const evt of events) {
    const kid = kids.find((k) => k.id === evt.kid_id);
    const kidName = kid?.name || "Unknown";
    const start = new Date(evt.starts_at);
    const end = new Date(evt.ends_at);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${evt.id}@kidsync`);
    lines.push(`DTSTART:${toICalDate(start)}`);
    lines.push(`DTEND:${toICalDate(end)}`);
    lines.push(
      `SUMMARY:[${escapeIcal(kidName)}] ${escapeIcal(evt.title)}`
    );

    // Build description
    let description = evt.notes || "";
    if (evt.travel) {
      const travelDesc = buildTravelDescription(evt.travel);
      if (travelDesc) {
        description += (description ? "\\n\\n" : "") + travelDesc;
      }
    }
    if (description) {
      lines.push(`DESCRIPTION:${escapeIcal(description)}`);
    }

    if (evt.location) {
      lines.push(`LOCATION:${escapeIcal(evt.location)}`);
    }

    lines.push(`LAST-MODIFIED:${toICalDate(new Date(evt.updated_at))}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadICal(
  events: CalendarEvent[],
  kids: Kid[],
  filename = "kidsync-calendar.ics"
): void {
  const ical = generateICal(events, kids);
  const blob = new Blob([ical], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
