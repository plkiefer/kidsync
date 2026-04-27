"use client";

import { Globe } from "lucide-react";
import {
  TIMEZONES,
  groupedTimezones,
  findTimezoneOption,
  currentOffsetString,
} from "@/lib/timezones";

interface TimezonePickerProps {
  value: string;
  onChange: (iana: string) => void;
  /** Compact (smaller, used inline next to date/time inputs) */
  compact?: boolean;
  /** Optional label rendered above the picker */
  label?: string;
  disabled?: boolean;
}

/**
 * Native <select> + <optgroup> grouped by region. Native is the
 * right call here:
 *  - Mobile gets the system picker (faster than scrolling a custom dropdown).
 *  - Accessibility comes for free.
 *  - Search-by-typing works in most browsers.
 *
 * Falls back gracefully when the saved value is outside the
 * curated set: appends an extra "Saved" option so the picker can
 * still display it.
 */
export default function TimezonePicker({
  value,
  onChange,
  compact = false,
  label,
  disabled = false,
}: TimezonePickerProps) {
  const groups = groupedTimezones();
  const inCuratedList = TIMEZONES.some((t) => t.iana === value);
  const fallback = inCuratedList ? null : findTimezoneOption(value);

  const offset = currentOffsetString(value);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--text-faint)]">
          {label}
        </label>
      )}
      <div className="relative">
        <Globe
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)] pointer-events-none"
          aria-hidden
        />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`
            w-full ${compact ? "pl-7 pr-7 py-1.5 text-[12px]" : "pl-8 pr-8 py-2 text-[13px]"}
            bg-[var(--bg-sunken)] border border-[var(--border)]
            rounded-sm text-[var(--ink)]
            focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)]
            transition-colors
            appearance-none cursor-pointer
            disabled:opacity-60 disabled:cursor-not-allowed
          `}
          title={`${findTimezoneOption(value).label} — ${findTimezoneOption(value).city} (${offset})`}
        >
          {fallback && (
            <optgroup label="Saved">
              <option value={fallback.iana}>
                {fallback.label === fallback.city
                  ? fallback.city
                  : `${fallback.label} — ${fallback.city}`}
              </option>
            </optgroup>
          )}
          {groups.map(({ group, options }) => (
            <optgroup key={group} label={group}>
              {options.map((opt) => (
                <option key={opt.iana} value={opt.iana}>
                  {opt.label === opt.city ? opt.city : `${opt.label} — ${opt.city}`}
                  {" "}({currentOffsetString(opt.iana)})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {/* Caret */}
        <svg
          className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-faint)] pointer-events-none"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
