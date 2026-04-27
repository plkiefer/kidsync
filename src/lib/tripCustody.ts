// ============================================================
// Trip ↔ custody bridge utilities
// ------------------------------------------------------------
// Plan §15: trips can auto-propose custody overrides. These
// helpers do the detection so TripView can render the right
// state (gray button vs. enabled, conflict warning, etc.) and
// pre-fill the override-proposal modal.
// ============================================================

import { Trip, CustodyOverride } from "./types";

export interface TripCustodyConflict {
  kidIds: string[];
  parentId: string;
}

/**
 * Detect which kids on the trip need a custody override during
 * the trip dates. Returns null when no override is needed.
 *
 * Per plan §15a:
 *   - Auto-detection runs only when exactly one parent is on the trip.
 *     Multi-parent (both parents going) or zero-parent (UM) trips
 *     return null — those aren't standard custody-transfer cases.
 *   - Kids already covered by an existing pending/approved trip-linked
 *     override are skipped; the override already addresses them.
 */
export function detectTripCustodyConflict(
  trip: Trip,
  custodyResolver: (date: Date) => Record<string, { parentId: string }>,
  existingOverrides: CustodyOverride[]
): TripCustodyConflict | null {
  if (trip.member_ids.length !== 1) return null;
  const tripParent = trip.member_ids[0];
  if (!trip.starts_at || !trip.ends_at) return null;
  if (trip.kid_ids.length === 0) return null;

  // Date math in UTC midnight to dodge DST surprises while iterating
  // day-by-day. We only need calendar-day granularity for custody.
  const startDate = new Date(trip.starts_at.slice(0, 10) + "T00:00:00Z");
  const endDate = new Date(trip.ends_at.slice(0, 10) + "T00:00:00Z");

  const coveredKids = new Set<string>();
  for (const override of existingOverrides) {
    if (override.created_from_trip_id !== trip.id) continue;
    if (override.status !== "pending" && override.status !== "approved") continue;
    coveredKids.add(override.kid_id);
  }

  const conflictKids: string[] = [];
  // Walk each calendar day; flag a kid if any day's default custody
  // doesn't match the trip's parent.
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const custody = custodyResolver(new Date(cursor));
    for (const kidId of trip.kid_ids) {
      if (coveredKids.has(kidId)) continue;
      if (conflictKids.includes(kidId)) continue;
      const defaultParent = custody[kidId]?.parentId;
      if (defaultParent && defaultParent !== tripParent) {
        conflictKids.push(kidId);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  if (conflictKids.length === 0) return null;
  return { kidIds: conflictKids, parentId: tripParent };
}

/**
 * Plan §15d: check whether trip dates fall outside the approved
 * override window. When true, the user has shifted trip dates
 * after approval and needs to re-propose to re-cover.
 *
 * Silent (returns false) when:
 *   - Trip dates ⊆ approved window (shrinking, or staying inside)
 *   - Override isn't approved yet (still pending)
 */
export function tripExceedsOverrideWindow(
  trip: Trip,
  override: CustodyOverride
): boolean {
  if (!trip.starts_at || !trip.ends_at) return false;
  if (override.status !== "approved") return false;
  const tripStart = trip.starts_at.slice(0, 10);
  const tripEnd = trip.ends_at.slice(0, 10);
  return tripStart < override.start_date || tripEnd > override.end_date;
}

/** Filter overrides to those created from this specific trip. */
export function getTripLinkedOverrides(
  tripId: string,
  overrides: CustodyOverride[]
): CustodyOverride[] {
  return overrides.filter((o) => o.created_from_trip_id === tripId);
}
