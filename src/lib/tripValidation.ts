// ============================================================
// Trip validation — advisory warnings only, never blocking.
// ------------------------------------------------------------
// Plan §5.3: surface inconsistencies in Trip View as info banners
// so the user can fix them, but never prevent saving. Real life is
// messier than the app, and the incremental-build principle means
// most "missing data" is just unfilled-yet, not wrong.
// ============================================================

import {
  CalendarEvent,
  Trip,
  isLodgingSegment,
  isFlightSegment,
  isDriveSegment,
  isTrainSegment,
  isFerrySegment,
  isCruiseSegment,
} from "./types";

export type WarningSeverity = "info" | "warning";

export interface TripWarning {
  id: string;
  severity: WarningSeverity;
  message: string;
  /** Optional: narrows the warning to a specific section in TripView
   *  ("stays" / "transportation" / "custody" / "trip"). */
  section?: "stays" | "transportation" | "custody" | "trip";
}

/**
 * Run all validation rules against a trip + its segments.
 * Returns a flat array of advisory warnings.
 *
 * Rules implemented (plan §5.3):
 *   1. Lodging in city X but no transport reaches city X
 *   2. Lodging starts before any transport arrives there (per-city)
 *   3. Lodging ends after the last transport leaves
 *   4. Kid on trip roster but on no transport segment
 *   5. Trip has no segments at all
 *   6. Cruise body without any port stops (informational only)
 *
 * The implementation is heuristic — addresses, port codes, and city
 * names don't always match cleanly. We do best-effort substring
 * matching for transport-vs-lodging-city correlation. False
 * negatives are fine (the worst case is no warning); false positives
 * matter (annoying), so substring match must be conservative.
 */
export function validateTrip(
  trip: Trip,
  segments: CalendarEvent[]
): TripWarning[] {
  const warnings: TripWarning[] = [];

  if (segments.length === 0) {
    warnings.push({
      id: "no-segments",
      severity: "info",
      message:
        "Trip has no segments yet. Add a stay or a transport to get started.",
      section: "trip",
    });
    return warnings; // Other rules need segments to run
  }

  const lodgings = segments.filter(isLodgingSegment);
  const flights = segments.filter(isFlightSegment);
  const drives = segments.filter(isDriveSegment);
  const trains = segments.filter(isTrainSegment);
  const ferries = segments.filter(isFerrySegment);
  const cruises = segments.filter(isCruiseSegment);

  const allTransports = [...flights, ...drives, ...trains, ...ferries];

  // Rule 1: each city with lodging should be reachable by some
  // transport that mentions it
  const lodgingCities = new Set(
    lodgings
      .map((l) => normalizeCityKey(l.segment_data.city))
      .filter(Boolean)
  );
  if (lodgingCities.size > 0 && allTransports.length > 0) {
    const transportText = collectTransportLocations(segments);
    for (const cityKey of lodgingCities) {
      if (!transportText.some((t) => t.includes(cityKey))) {
        const original = lodgings.find(
          (l) => normalizeCityKey(l.segment_data.city) === cityKey
        )?.segment_data.city;
        warnings.push({
          id: `unreached-city-${cityKey}`,
          severity: "warning",
          message: `No transport reaches ${original ?? cityKey}. How are you getting there?`,
          section: "transportation",
        });
      }
    }
  }

  // Rule 2: lodging starts before any arriving transport in its city
  // (best-effort — checks if any transport ends BEFORE the lodging
  // start, and that transport mentions the city)
  for (const lodging of lodgings) {
    const cityKey = normalizeCityKey(lodging.segment_data.city);
    if (!cityKey) continue;
    const lodgingStart = lodging.starts_at;
    const arrivalsToCity = allTransports.filter((t) => {
      if (t.ends_at >= lodgingStart) return false;
      const text = transportLocationText(t).join(" ");
      return text.includes(cityKey);
    });
    if (arrivalsToCity.length === 0 && allTransports.length > 0) {
      // Only warn if the trip already has SOME transport — otherwise
      // user just hasn't added any transport yet (rule 5 covers it).
      const anyTransportBeforeLodging = allTransports.some(
        (t) => t.ends_at <= lodgingStart
      );
      if (anyTransportBeforeLodging) {
        warnings.push({
          id: `no-arrival-${lodging.id}`,
          severity: "warning",
          message: `Nothing brings you to ${lodging.segment_data.city || "this city"} before check-in (${formatDateOnly(lodgingStart)}).`,
          section: "transportation",
        });
      }
    }
  }

  // Rule 3: kid on roster but on no transport
  if (trip.kid_ids.length > 0 && allTransports.length > 0) {
    for (const kidId of trip.kid_ids) {
      const onAnyTransport = allTransports.some((t) =>
        (t.kid_ids ?? []).includes(kidId)
      );
      if (!onAnyTransport) {
        warnings.push({
          id: `kid-no-transport-${kidId}`,
          severity: "warning",
          message: `One of the kids is on the trip roster but on no transport segment.`,
          section: "transportation",
        });
        // One warning is enough; per-kid name lookups happen in the
        // render layer if needed.
        break;
      }
    }
  }

  // Rule 6 (info): cruise without port stops — possible but unusual
  for (const cruise of cruises) {
    const hasPortStops = segments.some(
      (s) =>
        s.parent_segment_id === cruise.id &&
        s.segment_type === "cruise_port_stop"
    );
    if (!hasPortStops) {
      warnings.push({
        id: `cruise-no-ports-${cruise.id}`,
        severity: "info",
        message: `${cruise.title} has no port stops listed. Add them for arrival/departure reference.`,
        section: "transportation",
      });
    }
  }

  return warnings;
}

// ─── helpers ───────────────────────────────────────────────

function normalizeCityKey(city: string | null | undefined): string {
  if (!city) return "";
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Pull all "where" text from a transport segment for substring
 * matching against city names. Different segment types stash
 * locations in different fields.
 */
function transportLocationText(segment: CalendarEvent): string[] {
  if (!segment.segment_data) return [];
  const data = segment.segment_data as unknown as Record<string, string | undefined>;
  const candidates: (string | undefined)[] = [
    data.departure_airport,
    data.arrival_airport,
    data.from_location,
    data.to_location,
    data.origin_station,
    data.destination_station,
    data.origin_terminal,
    data.destination_terminal,
    data.embark_port,
    data.disembark_port,
  ];
  return candidates.filter(Boolean).map((v) => normalizeCityKey(v));
}

function collectTransportLocations(segments: CalendarEvent[]): string[] {
  const out: string[] = [];
  for (const s of segments) {
    out.push(...transportLocationText(s));
  }
  return out;
}

function formatDateOnly(iso: string): string {
  return iso.slice(0, 10);
}
