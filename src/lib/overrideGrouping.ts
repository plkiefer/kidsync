import { CustodyOverride } from "./types";

// ── Override request grouping ─────────────────────────────────
// `moveTurnover` (and friends) can emit MULTIPLE override rows for
// one logical change request — e.g. a "move pickup from Thu to Fri
// at 9am" produces a gap row (Thu = Danielle) AND a time row (Fri
// Patrick @ 9am) because they have different parents and can't be
// merged into a single row. Multi-kid requests further multiply by
// kid count.
//
// All rows in one logical request share:
//   - the same `note` (auto-generated descriptive text), AND
//   - effectively the same `created_at` (they're inserted in the
//     same supabase batch, so DEFAULT NOW() resolves identically)
//
// The 1-second created_at window is a safety margin for clock skew /
// transaction commit time. Separate user actions are always seconds
// apart in practice.

const SAME_REQUEST_MS = 1000;

function isSameRequest(a: CustodyOverride, b: CustodyOverride): boolean {
  if (a.id === b.id) return true;
  if (a.note !== b.note) return false;
  if (!a.created_at || !b.created_at) return false;
  const dt = Math.abs(
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return dt < SAME_REQUEST_MS;
}

/**
 * Given one override and a pool of others, return every override in
 * the pool that belongs to the SAME logical request (the input
 * override itself is always included if present in the pool).
 */
export function expandToRequestGroup(
  target: CustodyOverride,
  pool: CustodyOverride[]
): CustodyOverride[] {
  return pool.filter((o) => isSameRequest(target, o));
}

/**
 * Given a list of overrides, expand each one to its full request
 * group (using `pool` as the source), then dedupe by id. Used by
 * the calendar pending-pill click handler so the popover sees the
 * whole request, not just the rows that happen to cover the clicked
 * day.
 */
export function expandAllToRequestGroups(
  targets: CustodyOverride[],
  pool: CustodyOverride[]
): CustodyOverride[] {
  const out = new Map<string, CustodyOverride>();
  for (const t of targets) {
    for (const o of expandToRequestGroup(t, pool)) {
      out.set(o.id, o);
    }
  }
  return Array.from(out.values());
}

/**
 * Partition a list of overrides into logical request groups. Each
 * group is a non-empty array of overrides that share the same
 * request (same note + same created_at window). Order within a
 * group follows the input order; order across groups follows the
 * first override of each group.
 */
export function partitionByRequest(
  overrides: CustodyOverride[]
): CustodyOverride[][] {
  const groups: CustodyOverride[][] = [];
  const seen = new Set<string>();
  for (const o of overrides) {
    if (seen.has(o.id)) continue;
    const group = overrides.filter(
      (other) => !seen.has(other.id) && isSameRequest(o, other)
    );
    group.forEach((g) => seen.add(g.id));
    groups.push(group);
  }
  return groups;
}
