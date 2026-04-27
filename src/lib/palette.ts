// ============================================================
// KidSync — Color Palette
// ------------------------------------------------------------
// 12-entry palette modeled after Google Calendar's color set,
// but with the saturation pulled down so the `bg` tints work as
// full-cell calendar backgrounds on the Ink & Paper off-white
// shell. Per-user (parent) and per-kid colors are stored as the
// string KEY (e.g. "mist", "sage") so the visual mapping can be
// retuned later without a data migration.
//
// Each entry has:
//   - key:    stable identifier persisted to the DB
//   - name:   human label for the picker
//   - swatch: saturated chip color (used in the picker, kid chips,
//             and event-type indicators)
//   - bg:     desaturated tint for full-cell day backgrounds —
//             calibrated to read alongside ink type without
//             pulling focus
//   - text:   high-contrast on-tint text (for chips that put
//             type ON the swatch — most of the calendar uses
//             ink-on-bg directly, but kid chips and event pills
//             need a guaranteed-contrast text color)
//
// The first two entries — `mist` and `cream` — preserve the exact
// existing --you-bg / --them-bg values so legacy renderings stay
// identical for users who haven't customized.
// ============================================================

export interface PaletteEntry {
  key: string;
  name: string;
  swatch: string;
  bg: string;
  text: string;
}

export const PALETTE: PaletteEntry[] = [
  { key: "mist",       name: "Mist",       swatch: "#5B7184", bg: "#E6ECF2", text: "#374A5D" },
  { key: "cream",      name: "Cream",      swatch: "#A1853C", bg: "#FAEFD1", text: "#6B5A2C" },
  { key: "tomato",     name: "Tomato",     swatch: "#D14545", bg: "#FBE6E6", text: "#7A1F1F" },
  { key: "tangerine",  name: "Tangerine",  swatch: "#E27A3F", bg: "#FBE7D7", text: "#7A3D14" },
  { key: "banana",     name: "Banana",     swatch: "#C9A227", bg: "#F7EBC8", text: "#6B5610" },
  { key: "sage",       name: "Sage",       swatch: "#6BA886", bg: "#E2EFE7", text: "#2F5A40" },
  { key: "basil",      name: "Basil",      swatch: "#2F7E58", bg: "#D9E9DF", text: "#1A4630" },
  { key: "peacock",    name: "Peacock",    swatch: "#2C8FB8", bg: "#DAEDF4", text: "#14506E" },
  { key: "blueberry",  name: "Blueberry",  swatch: "#4F6FBF", bg: "#DEE4F2", text: "#25366B" },
  { key: "lavender",   name: "Lavender",   swatch: "#8C82C9", bg: "#E5E2F1", text: "#443C7E" },
  { key: "grape",      name: "Grape",      swatch: "#8E5BAB", bg: "#E8DCEF", text: "#4F2A6B" },
  { key: "graphite",   name: "Graphite",   swatch: "#6B6B6B", bg: "#E5E5E5", text: "#2F2F2F" },
];

const PALETTE_BY_KEY: Record<string, PaletteEntry> = Object.fromEntries(
  PALETTE.map((p) => [p.key, p])
);

/** Default for parent_a (alternating-weekend / "visiting" parent). */
export const DEFAULT_PARENT_A_COLOR = "mist";
/** Default for parent_b (primary custodian). */
export const DEFAULT_PARENT_B_COLOR = "cream";
/** Defaults for kids by birth-order index. */
export const DEFAULT_KID_COLORS = ["banana", "peacock", "sage", "lavender", "tomato", "grape"];

/**
 * Resolve a stored color value to a PaletteEntry.
 *
 * Backward-compat: legacy `kid.color` values were raw hex strings
 * like "#8a6a1f". If the value isn't a known palette key, we fall
 * back to graphite. (Hex-to-palette migration could happen later;
 * for now newly-saved kids will use palette keys via the picker.)
 */
export function resolvePalette(
  value: string | null | undefined,
  fallback = "graphite"
): PaletteEntry {
  if (value && PALETTE_BY_KEY[value]) return PALETTE_BY_KEY[value];
  return PALETTE_BY_KEY[fallback] ?? PALETTE[11];
}

/** Convenience — get just the bg tint, for full-cell day shading. */
export function paletteBg(value: string | null | undefined, fallback?: string): string {
  return resolvePalette(value, fallback).bg;
}

/** Convenience — get just the saturated swatch hex. */
export function paletteSwatch(value: string | null | undefined, fallback?: string): string {
  return resolvePalette(value, fallback).swatch;
}
