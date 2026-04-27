// ============================================================
// KidSync — Timezones
// ------------------------------------------------------------
// Curated picker list (~35 entries, one per "common" timezone)
// plus helpers for converting between a local clock-time string
// and a UTC instant in any IANA zone.
//
// Why curated, not the full IANA database? The full set has 400+
// names with lots of historical/edge zones (America/Detroit,
// US/Eastern, America/Indiana/Indianapolis are all "Eastern" and
// shouldn't appear separately). One representative city per
// observed zone keeps the picker readable.
//
// Add to TIMEZONES if a real user case needs another zone.
// ============================================================

export interface TimezoneOption {
  /** Canonical IANA name — what gets persisted. */
  iana: string;
  /** Display name like "Eastern Time" or "Central European Time". */
  label: string;
  /** Representative city like "New York" or "Berlin". */
  city: string;
  /** Group used by the picker for optgroup labels. */
  group: TimezoneGroup;
}

export type TimezoneGroup =
  | "United States"
  | "Canada"
  | "Latin America"
  | "Europe"
  | "Africa"
  | "Middle East"
  | "Asia"
  | "Pacific"
  | "Other";

export const TIMEZONES: TimezoneOption[] = [
  // ─── United States ──────────────────────────────────────
  { iana: "America/New_York",    label: "Eastern Time",   city: "New York",    group: "United States" },
  { iana: "America/Chicago",     label: "Central Time",   city: "Chicago",     group: "United States" },
  { iana: "America/Denver",      label: "Mountain Time",  city: "Denver",      group: "United States" },
  { iana: "America/Phoenix",     label: "Mountain (no DST)", city: "Phoenix",  group: "United States" },
  { iana: "America/Los_Angeles", label: "Pacific Time",   city: "Los Angeles", group: "United States" },
  { iana: "America/Anchorage",   label: "Alaska Time",    city: "Anchorage",   group: "United States" },
  { iana: "Pacific/Honolulu",    label: "Hawaii Time",    city: "Honolulu",    group: "United States" },

  // ─── Canada ─────────────────────────────────────────────
  { iana: "America/Halifax",     label: "Atlantic Time",  city: "Halifax",     group: "Canada" },
  { iana: "America/St_Johns",    label: "Newfoundland Time", city: "St. John's", group: "Canada" },
  { iana: "America/Toronto",     label: "Eastern Time",   city: "Toronto",     group: "Canada" },
  { iana: "America/Winnipeg",    label: "Central Time",   city: "Winnipeg",    group: "Canada" },
  { iana: "America/Edmonton",    label: "Mountain Time",  city: "Edmonton",    group: "Canada" },
  { iana: "America/Vancouver",   label: "Pacific Time",   city: "Vancouver",   group: "Canada" },

  // ─── Latin America ──────────────────────────────────────
  { iana: "America/Mexico_City", label: "Central Time",   city: "Mexico City", group: "Latin America" },
  { iana: "America/Bogota",      label: "Colombia",       city: "Bogotá",      group: "Latin America" },
  { iana: "America/Sao_Paulo",   label: "Brasília",       city: "São Paulo",   group: "Latin America" },
  { iana: "America/Argentina/Buenos_Aires", label: "Argentina", city: "Buenos Aires", group: "Latin America" },

  // ─── Europe ─────────────────────────────────────────────
  { iana: "Europe/London",       label: "Greenwich Mean Time", city: "London", group: "Europe" },
  { iana: "Europe/Paris",        label: "Central European Time", city: "Paris", group: "Europe" },
  { iana: "Europe/Berlin",       label: "Central European Time", city: "Berlin", group: "Europe" },
  { iana: "Europe/Athens",       label: "Eastern European Time", city: "Athens", group: "Europe" },
  { iana: "Europe/Moscow",       label: "Moscow Time",    city: "Moscow",      group: "Europe" },

  // ─── Africa ─────────────────────────────────────────────
  { iana: "Africa/Lagos",        label: "West Africa",    city: "Lagos",       group: "Africa" },
  { iana: "Africa/Johannesburg", label: "South Africa",   city: "Johannesburg", group: "Africa" },
  { iana: "Africa/Cairo",        label: "Egypt",          city: "Cairo",       group: "Africa" },

  // ─── Middle East ────────────────────────────────────────
  { iana: "Asia/Dubai",          label: "Gulf Time",      city: "Dubai",       group: "Middle East" },
  { iana: "Asia/Jerusalem",      label: "Israel",         city: "Jerusalem",   group: "Middle East" },

  // ─── Asia ───────────────────────────────────────────────
  { iana: "Asia/Kolkata",        label: "India",          city: "Mumbai",      group: "Asia" },
  { iana: "Asia/Bangkok",        label: "Indochina",      city: "Bangkok",     group: "Asia" },
  { iana: "Asia/Singapore",      label: "Singapore",      city: "Singapore",   group: "Asia" },
  { iana: "Asia/Hong_Kong",      label: "Hong Kong",      city: "Hong Kong",   group: "Asia" },
  { iana: "Asia/Shanghai",       label: "China",          city: "Shanghai",    group: "Asia" },
  { iana: "Asia/Tokyo",          label: "Japan",          city: "Tokyo",       group: "Asia" },
  { iana: "Asia/Seoul",          label: "Korea",          city: "Seoul",       group: "Asia" },

  // ─── Pacific ────────────────────────────────────────────
  { iana: "Australia/Perth",     label: "Western Australia", city: "Perth",   group: "Pacific" },
  { iana: "Australia/Sydney",    label: "Eastern Australia", city: "Sydney",  group: "Pacific" },
  { iana: "Pacific/Auckland",    label: "New Zealand",    city: "Auckland",    group: "Pacific" },

  // ─── Other ──────────────────────────────────────────────
  { iana: "UTC",                 label: "UTC",            city: "UTC",         group: "Other" },
];

const BY_IANA: Record<string, TimezoneOption> = Object.fromEntries(
  TIMEZONES.map((t) => [t.iana, t])
);

/**
 * Detect the user's browser-reported IANA timezone.
 * Falls back to America/New_York if Intl is unavailable.
 */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

/**
 * Find the picker option for an IANA name. Returns a synthesized
 * placeholder option for zones not in the curated list (so the
 * picker can still display a saved value even if we don't list it).
 */
export function findTimezoneOption(iana: string): TimezoneOption {
  if (BY_IANA[iana]) return BY_IANA[iana];
  // Synthesize a label from the IANA name like "Asia/Kuala_Lumpur" → "Kuala Lumpur"
  const cityFromIana =
    iana.split("/").slice(-1)[0]?.replace(/_/g, " ") || iana;
  return {
    iana,
    label: cityFromIana,
    city: cityFromIana,
    group: "Other",
  };
}

/** "Eastern Time — New York" — used as the picker's selected text. */
export function formatTimezoneLabel(iana: string): string {
  const opt = findTimezoneOption(iana);
  return opt.label === opt.city ? opt.city : `${opt.label} — ${opt.city}`;
}

/**
 * Group the curated list by region for use in `<optgroup>`s.
 * Insertion order in TIMEZONES drives the group order.
 */
export function groupedTimezones(): Array<{
  group: TimezoneGroup;
  options: TimezoneOption[];
}> {
  const seen: TimezoneGroup[] = [];
  const map = new Map<TimezoneGroup, TimezoneOption[]>();
  for (const tz of TIMEZONES) {
    if (!map.has(tz.group)) {
      seen.push(tz.group);
      map.set(tz.group, []);
    }
    map.get(tz.group)!.push(tz);
  }
  return seen.map((g) => ({ group: g, options: map.get(g)! }));
}

// ============================================================
// Local ↔ UTC conversions
// ------------------------------------------------------------
// JavaScript's Date object is fundamentally a UTC instant; its
// "local time" methods refer to the runtime's timezone (browser
// local OR server local). To anchor a time to a SPECIFIC IANA
// zone we round-trip through Intl.DateTimeFormat.
// ============================================================

/**
 * Given an IANA zone and a UTC instant, compute the offset (in
 * minutes) that the zone has at that instant. Positive for zones
 * east of UTC, negative for west. Handles DST automatically.
 *
 * Example: getZoneOffsetMinutes("America/New_York", new Date("2026-07-01T00:00:00Z"))
 * → -240 (EDT in July).
 */
export function getZoneOffsetMinutes(iana: string, instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  // Reconstruct the wall-clock the formatter showed us, but as if
  // it were UTC. The diff between that and the original UTC
  // instant is the zone's offset at that moment.
  const wallAsUtcMs = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parts.hour === "24" ? 0 : parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10)
  );
  return Math.round((wallAsUtcMs - instant.getTime()) / 60000);
}

/**
 * Convert a local clock-time string in a given zone to the UTC
 * instant it represents.
 *
 * @param localStr  e.g. "2026-04-22T15:00" — a `<input type="datetime-local">` value.
 *                  No timezone info; interpreted as local clock-time in `iana`.
 * @param iana      target IANA zone, e.g. "America/New_York"
 *
 * Example: localTimeToUtc("2026-07-01T15:00", "America/New_York")
 * → Date for 2026-07-01T19:00:00.000Z (3pm EDT == 19:00 UTC).
 */
export function localTimeToUtc(localStr: string, iana: string): Date {
  const m = localStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return new Date(localStr); // best-effort fallback
  const [, y, mo, d, h, mi, s] = m;
  // Treat the components as if they were UTC — gives us a candidate
  // instant whose offset in the target zone we can then resolve.
  const naiveUtcMs = Date.UTC(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10),
    parseInt(mi, 10),
    s ? parseInt(s, 10) : 0
  );
  const offsetMin = getZoneOffsetMinutes(iana, new Date(naiveUtcMs));
  return new Date(naiveUtcMs - offsetMin * 60000);
}

/**
 * Convert a UTC instant to a clock-time string suitable for
 * `<input type="datetime-local">` in a given zone.
 *
 * Example: utcToLocalTimeString(new Date("2026-07-01T19:00:00Z"), "America/New_York")
 * → "2026-07-01T15:00".
 */
export function utcToLocalTimeString(instant: Date, iana: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: iana,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/**
 * Render a current-offset string like "GMT-4" or "GMT+5:30" for
 * use in the picker (helps when two cities share a label but
 * differ in DST behavior). Computed at the given instant, defaulting
 * to "now" — so the picker reflects the zone's CURRENT offset.
 */
export function currentOffsetString(iana: string, instant = new Date()): string {
  const min = getZoneOffsetMinutes(iana, instant);
  const sign = min >= 0 ? "+" : "−";
  const abs = Math.abs(min);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return mm === 0 ? `GMT${sign}${hh}` : `GMT${sign}${hh}:${String(mm).padStart(2, "0")}`;
}
