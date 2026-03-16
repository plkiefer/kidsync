// ============================================================
// Holiday Computation for KidSync
// Federal holidays, Virginia state holidays, and observances
// ============================================================

export type HolidayTier = "federal" | "state" | "observance";

export interface Holiday {
  name: string;
  date: Date;
  tier: HolidayTier;
}

// ── Date helpers ────────────────────────────────────────────

/** Get the Nth occurrence of a weekday in a month (1-indexed). weekday: 0=Sun..6=Sat */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  let day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

/** Get the last occurrence of a weekday in a month */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0); // last day of month
  const lastWeekday = last.getDay();
  const diff = (lastWeekday - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - diff);
}

/**
 * Compute Easter Sunday using the Meeus/Jones/Butcher algorithm.
 * Valid for Gregorian calendar years (1583+).
 */
function computeEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** Election Day: first Tuesday after the first Monday of November */
function electionDay(year: number): Date {
  const firstMonday = nthWeekdayOfMonth(year, 10, 1, 1); // 1st Monday of Nov
  const tuesday = new Date(firstMonday);
  tuesday.setDate(tuesday.getDate() + 1);
  return tuesday;
}

// ── Holiday generation ──────────────────────────────────────

export function getHolidaysForYear(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  // ── US Federal Holidays (11) ──────────────────────────────

  holidays.push(
    { name: "New Year's Day", date: new Date(year, 0, 1), tier: "federal" },
    { name: "Martin Luther King Jr. Day", date: nthWeekdayOfMonth(year, 0, 1, 3), tier: "federal" },
    { name: "Presidents' Day", date: nthWeekdayOfMonth(year, 1, 1, 3), tier: "federal" },
    { name: "Memorial Day", date: lastWeekdayOfMonth(year, 4, 1), tier: "federal" },
    { name: "Juneteenth", date: new Date(year, 5, 19), tier: "federal" },
    { name: "Independence Day", date: new Date(year, 6, 4), tier: "federal" },
    { name: "Labor Day", date: nthWeekdayOfMonth(year, 8, 1, 1), tier: "federal" },
    { name: "Columbus Day", date: nthWeekdayOfMonth(year, 9, 1, 2), tier: "federal" },
    { name: "Veterans Day", date: new Date(year, 10, 11), tier: "federal" },
    { name: "Thanksgiving", date: nthWeekdayOfMonth(year, 10, 4, 4), tier: "federal" },
    { name: "Christmas Day", date: new Date(year, 11, 25), tier: "federal" },
  );

  // ── Virginia State Holidays ───────────────────────────────

  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  const dayAfterThanksgiving = new Date(thanksgiving);
  dayAfterThanksgiving.setDate(dayAfterThanksgiving.getDate() + 1);

  holidays.push(
    { name: "Day After Thanksgiving", date: dayAfterThanksgiving, tier: "state" },
    { name: "Election Day", date: electionDay(year), tier: "state" },
  );

  // ── Observance Days ───────────────────────────────────────

  const easter = computeEaster(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);

  const laborDay = nthWeekdayOfMonth(year, 8, 1, 1);
  const grandparentsDay = new Date(laborDay);
  grandparentsDay.setDate(laborDay.getDate() + 6); // Sunday after Labor Day

  holidays.push(
    { name: "Valentine's Day", date: new Date(year, 1, 14), tier: "observance" },
    { name: "St. Patrick's Day", date: new Date(year, 2, 17), tier: "observance" },
    { name: "Good Friday", date: goodFriday, tier: "observance" },
    { name: "Easter Sunday", date: easter, tier: "observance" },
    { name: "Mother's Day", date: nthWeekdayOfMonth(year, 4, 0, 2), tier: "observance" },
    { name: "Father's Day", date: nthWeekdayOfMonth(year, 5, 0, 3), tier: "observance" },
    { name: "Grandparents' Day", date: grandparentsDay, tier: "observance" },
    { name: "Halloween", date: new Date(year, 9, 31), tier: "observance" },
    { name: "Christmas Eve", date: new Date(year, 11, 24), tier: "observance" },
    { name: "New Year's Eve", date: new Date(year, 11, 31), tier: "observance" },
  );

  return holidays.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Get the icon for a holiday */
export function getHolidayIcon(name: string): string {
  const icons: [RegExp, string][] = [
    [/new year/i, "🎆"],
    [/mlk|martin luther king/i, "✊"],
    [/president/i, "🏛️"],
    [/memorial/i, "🇺🇸"],
    [/juneteenth/i, "✊"],
    [/independence|july 4/i, "🎇"],
    [/labor day/i, "⚒️"],
    [/columbus/i, "🗺️"],
    [/veteran/i, "🎖️"],
    [/thanksgiving/i, "🦃"],
    [/christmas eve/i, "🌟"],
    [/christmas/i, "🎄"],
    [/valentine/i, "💝"],
    [/st\. patrick/i, "☘️"],
    [/good friday/i, "✝️"],
    [/easter/i, "🐣"],
    [/mother/i, "💐"],
    [/father/i, "👔"],
    [/grandparent/i, "👴"],
    [/halloween/i, "🎃"],
    [/election/i, "🗳️"],
    [/new year.*eve/i, "🥂"],
  ];
  for (const [pattern, emoji] of icons) {
    if (pattern.test(name)) return emoji;
  }
  return "📅";
}

/** Get the tier color */
export function getHolidayColor(tier: HolidayTier): string {
  switch (tier) {
    case "federal": return "#DC2626";
    case "state": return "#7C3AED";
    case "observance": return "#EC4899";
  }
}
