"use client";

import { useState, useEffect, useRef } from "react";
import { Repeat, ChevronDown } from "lucide-react";

interface RecurrencePickerProps {
  value: string; // RRULE string or ""
  startDate: string; // datetime-local string to derive day name
  onChange: (rrule: string) => void;
}

const DAYS = [
  { key: "SU", label: "S" },
  { key: "MO", label: "M" },
  { key: "TU", label: "T" },
  { key: "WE", label: "W" },
  { key: "TH", label: "T" },
  { key: "FR", label: "F" },
  { key: "SA", label: "S" },
];

const DAY_NAMES: Record<string, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

const FREQ_OPTIONS = [
  { value: "DAILY", label: "day" },
  { value: "WEEKLY", label: "week" },
  { value: "MONTHLY", label: "month" },
  { value: "YEARLY", label: "year" },
];

function getDayKey(dateStr: string): string {
  if (!dateStr) return "MO";
  const d = new Date(dateStr);
  return DAYS[d.getDay()].key;
}

// Parse an RRULE string into component state
function parseRRule(rrule: string) {
  const parts: Record<string, string> = {};
  rrule.split(";").forEach((p) => {
    const [k, v] = p.split("=");
    if (k && v) parts[k] = v;
  });
  return {
    freq: parts.FREQ || "WEEKLY",
    interval: parseInt(parts.INTERVAL || "1", 10),
    byDay: parts.BYDAY ? parts.BYDAY.split(",") : [],
    count: parts.COUNT ? parseInt(parts.COUNT, 10) : 0,
    until: parts.UNTIL || "",
    endMode: parts.COUNT ? "count" : parts.UNTIL ? "until" : "never",
  };
}

// Build an RRULE string from component state
function buildRRule(
  freq: string,
  interval: number,
  byDay: string[],
  endMode: string,
  count: number,
  until: string
): string {
  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (freq === "WEEKLY" && byDay.length > 0) {
    parts.push(`BYDAY=${byDay.join(",")}`);
  }
  if (endMode === "count" && count > 0) parts.push(`COUNT=${count}`);
  if (endMode === "until" && until) {
    const d = new Date(until);
    const pad = (n: number) => String(n).padStart(2, "0");
    parts.push(
      `UNTIL=${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T235959Z`
    );
  }
  return parts.join(";");
}

// Human-readable summary
function describeRRule(rrule: string, startDate: string): string {
  if (!rrule) return "Does not repeat";
  const { freq, interval, byDay, count, until, endMode } = parseRRule(rrule);

  let desc = "Every ";
  if (interval > 1) desc += `${interval} `;

  switch (freq) {
    case "DAILY":
      desc += interval > 1 ? "days" : "day";
      break;
    case "WEEKLY":
      desc += interval > 1 ? "weeks" : "week";
      if (byDay.length > 0 && byDay.length < 7) {
        // Check for weekdays shorthand
        const weekdays = ["MO", "TU", "WE", "TH", "FR"];
        if (
          byDay.length === 5 &&
          weekdays.every((d) => byDay.includes(d))
        ) {
          desc = "Every weekday";
        } else {
          desc += " on " + byDay.map((d) => DAY_NAMES[d]?.slice(0, 3) || d).join(", ");
        }
      }
      break;
    case "MONTHLY":
      desc += interval > 1 ? "months" : "month";
      break;
    case "YEARLY":
      desc += interval > 1 ? "years" : "year";
      break;
  }

  if (endMode === "count" && count) desc += `, ${count} times`;
  if (endMode === "until" && until) {
    const uDate = new Date(until.replace(/(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3"));
    desc += `, until ${uDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }

  return desc;
}

export default function RecurrencePicker({
  value,
  startDate,
  onChange,
}: RecurrencePickerProps) {
  const [showPresets, setShowPresets] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);

  const currentDayKey = getDayKey(startDate);

  // Custom state
  const parsed = value ? parseRRule(value) : null;
  const [freq, setFreq] = useState(parsed?.freq || "WEEKLY");
  const [interval, setInterval] = useState(parsed?.interval || 1);
  const [byDay, setByDay] = useState<string[]>(
    parsed?.byDay.length ? parsed.byDay : [currentDayKey]
  );
  const [endMode, setEndMode] = useState(parsed?.endMode || "never");
  const [count, setCount] = useState(parsed?.count || 10);
  const [until, setUntil] = useState(parsed?.until ? parsed.until.replace(/(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3") : "");

  // Close presets on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setShowPresets(false);
      }
    };
    if (showPresets) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPresets]);

  const presets = [
    { label: "Does not repeat", rrule: "" },
    { label: "Every day", rrule: "FREQ=DAILY" },
    {
      label: `Every week on ${DAY_NAMES[currentDayKey]}`,
      rrule: `FREQ=WEEKLY;BYDAY=${currentDayKey}`,
    },
    { label: "Every month", rrule: "FREQ=MONTHLY" },
    { label: "Every year", rrule: "FREQ=YEARLY" },
    {
      label: "Every weekday (Mon–Fri)",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    },
  ];

  const handlePresetSelect = (rrule: string) => {
    onChange(rrule);
    setShowPresets(false);
    setShowCustom(false);
  };

  const handleOpenCustom = () => {
    // Initialize custom state from current value
    if (value) {
      const p = parseRRule(value);
      setFreq(p.freq);
      setInterval(p.interval);
      setByDay(p.byDay.length ? p.byDay : [currentDayKey]);
      setEndMode(p.endMode);
      setCount(p.count || 10);
      setUntil(p.until ? p.until.replace(/(\d{4})(\d{2})(\d{2}).*/, "$1-$2-$3") : "");
    } else {
      setFreq("WEEKLY");
      setInterval(1);
      setByDay([currentDayKey]);
      setEndMode("never");
      setCount(10);
      setUntil("");
    }
    setShowPresets(false);
    setShowCustom(true);
  };

  const handleCustomDone = () => {
    const rrule = buildRRule(freq, interval, byDay, endMode, count, until);
    onChange(rrule);
    setShowCustom(false);
  };

  const toggleDay = (day: string) => {
    setByDay((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const summary = describeRRule(value, startDate);

  return (
    <div className="relative">
      {/* Main trigger */}
      <button
        type="button"
        onClick={() => setShowPresets(!showPresets)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <div className="w-7 h-7 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
          <Repeat size={14} />
        </div>
        <span className={`text-sm flex-1 ${value ? "text-[var(--ink)]" : "text-[var(--text-faint)]"}`}>
          {summary}
        </span>
        <ChevronDown
          size={14}
          className="text-[var(--text-faint)] group-hover:text-[var(--text-muted)] transition-colors"
        />
      </button>

      {/* Presets dropdown */}
      {showPresets && (
        <div
          ref={presetsRef}
          className="absolute left-9 top-9 z-10 bg-[var(--bg)] border border-[var(--border-strong)] shadow-[var(--shadow-md)] py-1 min-w-[240px] animate-scale-in"
        >
          {presets.map((p) => (
            <button
              key={p.rrule + p.label}
              type="button"
              onClick={() => handlePresetSelect(p.rrule)}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-sunken)] transition-colors ${
                value === p.rrule
                  ? "text-action font-semibold"
                  : "text-[var(--ink)]"
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="border-t border-[var(--border)] mt-1 pt-1">
            <button
              type="button"
              onClick={handleOpenCustom}
              className="w-full text-left px-4 py-2 text-sm text-action font-semibold hover:bg-[var(--bg-sunken)] transition-colors"
            >
              Custom…
            </button>
          </div>
        </div>
      )}

      {/* Custom recurrence dialog */}
      {showCustom && (
        <div className="mt-3 ml-9 p-4 bg-[var(--bg-sunken)] border border-[var(--border-strong)] rounded-sm space-y-4 animate-scale-in">
          {/* Repeat every N freq */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--color-text-muted)] font-medium">
              Repeat every
            </span>
            <input
              type="number"
              min={1}
              max={99}
              value={interval}
              onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-14 px-2 py-1.5 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm text-center focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)]"
            />
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
              className="px-3 py-1.5 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)]"
            >
              {FREQ_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {interval > 1 ? f.label + "s" : f.label}
                </option>
              ))}
            </select>
          </div>

          {/* Day picker for weekly */}
          {freq === "WEEKLY" && (
            <div>
              <span className="text-xs text-[var(--color-text-muted)] font-medium block mb-2">
                Repeat on
              </span>
              <div className="flex gap-1.5">
                {DAYS.map((day) => (
                  <button
                    key={day.key}
                    type="button"
                    onClick={() => toggleDay(day.key)}
                    className={`w-8 h-8 rounded-sm text-xs font-bold transition-colors border ${
                      byDay.includes(day.key)
                        ? "bg-action text-action-fg border-action"
                        : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ends */}
          <div>
            <span className="text-xs text-[var(--color-text-muted)] font-medium block mb-2">
              Ends
            </span>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recurrence-end"
                  checked={endMode === "never"}
                  onChange={() => setEndMode("never")}
                  className="accent-[var(--action)]"
                />
                <span className="text-sm text-[var(--color-text)]">Never</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recurrence-end"
                  checked={endMode === "until"}
                  onChange={() => setEndMode("until")}
                  className="accent-[var(--action)]"
                />
                <span className="text-sm text-[var(--color-text)]">On</span>
                {endMode === "until" && (
                  <input
                    type="date"
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    className="px-2 py-1 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)]"
                  />
                )}
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recurrence-end"
                  checked={endMode === "count"}
                  onChange={() => setEndMode("count")}
                  className="accent-[var(--action)]"
                />
                <span className="text-sm text-[var(--color-text)]">After</span>
                {endMode === "count" && (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={count}
                      onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 px-2 py-1 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm text-center focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)]"
                    />
                    <span className="text-sm text-[var(--color-text-muted)]">
                      occurrences
                    </span>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Done button */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => setShowCustom(false)}
              className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors mr-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCustomDone}
              className="px-4 py-1.5 rounded-sm bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
