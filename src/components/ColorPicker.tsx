"use client";

import { Check } from "lucide-react";
import { PALETTE, PaletteEntry } from "@/lib/palette";

interface ColorPickerProps {
  /** Currently selected palette key. Renders all swatches if undefined. */
  value: string | null | undefined;
  onChange: (key: string) => void;
  /** Tighter spacing for inline use in a row of pickers. */
  compact?: boolean;
  /** Optional aria label for the swatch group. */
  label?: string;
  /** Disable interaction (e.g., while saving). */
  disabled?: boolean;
}

/**
 * 12-swatch grid color picker. Renders the saturated `swatch` value
 * but uses the soft `bg` tint as the selected-ring color so the picker
 * previews how the choice will read as a calendar day cell.
 *
 * Layout: 6 cols × 2 rows on mobile/compact, single row of 12 on
 * wider screens.
 */
export default function ColorPicker({
  value,
  onChange,
  compact = false,
  label,
  disabled = false,
}: ColorPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label ?? "Color"}
      className={`grid grid-cols-6 sm:grid-cols-12 ${compact ? "gap-1.5" : "gap-2"}`}
    >
      {PALETTE.map((p) => (
        <Swatch
          key={p.key}
          entry={p}
          selected={value === p.key}
          onSelect={() => !disabled && onChange(p.key)}
          disabled={disabled}
          compact={compact}
        />
      ))}
    </div>
  );
}

interface SwatchProps {
  entry: PaletteEntry;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  compact: boolean;
}

function Swatch({ entry, selected, onSelect, disabled, compact }: SwatchProps) {
  const size = compact ? "h-7 w-7" : "h-8 w-8";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={entry.name}
      title={entry.name}
      disabled={disabled}
      onClick={onSelect}
      className={`relative ${size} rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--focus-ring)] ${
        disabled ? "cursor-not-allowed opacity-50" : "hover:scale-110 cursor-pointer"
      } ${selected ? "ring-2 ring-offset-2 ring-[var(--ink)]" : ""}`}
      style={{
        backgroundColor: entry.swatch,
      }}
    >
      {selected && (
        <Check
          className="absolute inset-0 m-auto h-3.5 w-3.5"
          style={{ color: "#fff" }}
          strokeWidth={3}
        />
      )}
    </button>
  );
}
