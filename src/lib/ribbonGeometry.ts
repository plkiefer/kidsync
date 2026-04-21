/**
 * Per-week custody ribbon geometry.
 *
 * Converts per-day custody data into SVG polygon points for a
 * continuous outline per parent, with transitions at mid-day
 * of the last day of each outgoing block.
 *
 * Supports three cases per week:
 *  - Single parent for the whole week   → 1 full-height rect per parent
 *  - Simple alternation (2+ unified parts) → N full-height rects, alternating
 *  - Kid-split window (kids diverge for 1+ days) → L-shape polygons,
 *    one per parent, with half-height lanes during the split span.
 */

import type { Kid } from "./types";

export type RibbonParent = "you" | "them";

/** A single per-day state for the week-ribbon algorithm. */
interface DayState {
  /** "unified" = all kids with same parent. "split" = kids diverge. */
  type: "unified" | "split";
  /** For unified days: which parent has everyone. */
  parent?: RibbonParent;
  /** For split days: parent holding the "top-lane" kid. */
  topParent?: RibbonParent;
  /** For split days: parent holding the "bottom-lane" kid. */
  bottomParent?: RibbonParent;
}

/** Output polygon/rect for one parent's territory in a week. */
export interface ParentShape {
  parent: RibbonParent;
  /** SVG `<polygon>` points attribute, in the viewBox (see Y_* constants). */
  points: string;
}

/** Italic-serif kid-name label for a split lane. */
export interface SplitLaneLabel {
  /** Left edge of the label band, percent of track width. */
  leftPct: number;
  /** Width of the label band, percent of track width. */
  widthPct: number;
  /** Which lane this label sits on. */
  lane: "top" | "bottom";
  /** Kid name shown in italic serif. */
  kidName: string;
}

/** Parent-name anchor (YOU / DANIELLE) pinned to outer edge of its segment. */
export interface ParentNameLabel {
  parent: RibbonParent;
  /** Horizontal position in %. `leftPct` is the outer edge of the segment. */
  leftPct: number;
  widthPct: number;
  /** Which side of the segment the label hugs. */
  anchor: "left" | "right";
}

export interface WeekRibbonData {
  /** SVG viewBox height. 22 when no kid-split, 44 when split lanes present. */
  trackHeight: number;
  /** One continuous outline per parent (skipped if that parent has no segment). */
  shapes: ParentShape[];
  /** Italic kid-name labels to render on split lanes. */
  splitLabels: SplitLaneLabel[];
  /** Uppercase parent-name labels (YOU / DANIELLE etc.) on outer edges. */
  nameLabels: ParentNameLabel[];
}

/** viewBox constants — keep in sync with WeekRibbon styling. */
const NORMAL_HEIGHT = 22;
const TALL_HEIGHT = 44;
// Inset from the ribbon-track edges (Y).
const RIBBON_PAD_Y = 3;
// Inset from each transition boundary (in viewBox X units, = percent of width).
// Creates the small visible gap between different-parent territories.
const GAP_PCT = 0.4;

/** Percent-of-week for the mid-point of day `i` (0..6). */
const midDayPct = (i: number) => ((i + 0.5) / 7) * 100;

/** Build the day-by-day state array for a week. */
function computeDayStates(
  week: Date[],
  getCustodyForDate: (d: Date) => Record<string, { parentId: string; isParentA: boolean }>,
  currentUserId: string,
  kids: Kid[],
): DayState[] {
  const you = (pid: string): RibbonParent => (pid === currentUserId ? "you" : "them");
  return week.map((day) => {
    const custody = getCustodyForDate(day);
    const kidIds = Object.keys(custody);
    if (kidIds.length === 0) {
      return { type: "unified", parent: "them" };
    }
    const firstParent = custody[kidIds[0]].parentId;
    const allSame = kidIds.every((k) => custody[k].parentId === firstParent);
    if (allSame) {
      return { type: "unified", parent: you(firstParent) };
    }
    // Split: assign by kids-array ordering so lane→kid is stable across days.
    const orderedKidIds = kids.map((k) => k.id).filter((id) => custody[id]);
    const topKidId = orderedKidIds[0];
    const bottomKidId = orderedKidIds[1];
    return {
      type: "split",
      topParent: topKidId ? you(custody[topKidId].parentId) : "you",
      bottomParent: bottomKidId ? you(custody[bottomKidId].parentId) : "them",
    };
  });
}

/** Two states are equivalent if both unified→same parent, or both split→same config. */
function sameState(a: DayState, b: DayState): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "unified") return a.parent === b.parent;
  return a.topParent === b.topParent && a.bottomParent === b.bottomParent;
}

/** Contiguous runs of identical state, with start/end day indices (inclusive). */
interface StateRun {
  state: DayState;
  startDay: number; // 0..6
  endDay: number;   // 0..6 inclusive
}

function runsFromStates(states: DayState[]): StateRun[] {
  const runs: StateRun[] = [];
  if (states.length === 0) return runs;
  let currentStart = 0;
  for (let i = 1; i < states.length; i++) {
    if (!sameState(states[i - 1], states[i])) {
      runs.push({ state: states[i - 1], startDay: currentStart, endDay: i - 1 });
      currentStart = i;
    }
  }
  runs.push({ state: states[states.length - 1], startDay: currentStart, endDay: states.length - 1 });
  return runs;
}

/**
 * Convert a run to its [startPct, endPct] span. A run owns the mid-day→mid-day
 * slice of its range, except the first run starts at 0 and the last ends at 100.
 *
 *   day idx :  0     1     2     3     4     5     6
 *   pct     :  0 | 7.14 | 21.43 | 35.71 | 50 | 64.29 | 78.57 | 92.86 | 100
 *   midday  :     7.14   21.43   35.71  50  64.29   78.57   92.86
 *
 * A run spanning days [2,4] starts at midDayPct(1)=21.43 (if not first) and
 * ends at midDayPct(4)=64.29 (if not last). If first, starts at 0. If last,
 * ends at 100.
 */
function runSpanPct(run: StateRun, isFirst: boolean, isLast: boolean): [number, number] {
  const startPct = isFirst ? 0 : midDayPct(run.startDay - 1);
  const endPct = isLast ? 100 : midDayPct(run.endDay);
  return [startPct, endPct];
}

export function computeWeekRibbon(
  week: Date[],
  getCustodyForDate: (d: Date) => Record<string, { parentId: string; isParentA: boolean }>,
  currentUserId: string,
  kids: Kid[],
): WeekRibbonData {
  const states = computeDayStates(week, getCustodyForDate, currentUserId, kids);
  const runs = runsFromStates(states);
  const hasSplit = runs.some((r) => r.state.type === "split");
  const trackHeight = hasSplit ? TALL_HEIGHT : NORMAL_HEIGHT;

  const topY = RIBBON_PAD_Y;
  const bottomY = trackHeight - RIBBON_PAD_Y;
  const midY = trackHeight / 2;
  const topLaneBottomY = midY - 3;      // bottom of top half-lane (small gap)
  const bottomLaneTopY = midY + 3;      // top of bottom half-lane

  // Build a flat list of rectangles keyed by parent + lane span.
  type Rect = {
    parent: RibbonParent;
    lane: "full" | "top" | "bottom";
    leftPct: number;
    rightPct: number;
    splitKidName?: string;
  };
  const rects: Rect[] = [];

  // Name-label candidates: first/last run's parent gets a name at the outer edge.
  // (Mid-run parents don't get name labels — the kid-split lanes carry kid names
  // in italic instead.)
  const nameLabels: ParentNameLabel[] = [];
  const splitLabels: SplitLaneLabel[] = [];

  const kidNameByLane = (run: StateRun, lane: "top" | "bottom"): string => {
    // Keep lane→kid assignment stable using `kids` ordering.
    if (lane === "top") return kids[0]?.name ?? "";
    return kids[1]?.name ?? "";
  };

  runs.forEach((run, idx) => {
    const [startPct, endPct] = runSpanPct(run, idx === 0, idx === runs.length - 1);
    if (run.state.type === "unified") {
      rects.push({
        parent: run.state.parent!,
        lane: "full",
        leftPct: startPct,
        rightPct: endPct,
      });
      // Name label at outer edge of first/last run.
      if (idx === 0) {
        nameLabels.push({
          parent: run.state.parent!,
          leftPct: startPct,
          widthPct: endPct - startPct,
          anchor: "left",
        });
      } else if (idx === runs.length - 1) {
        nameLabels.push({
          parent: run.state.parent!,
          leftPct: startPct,
          widthPct: endPct - startPct,
          anchor: "right",
        });
      }
    } else {
      // Split: two half-lanes.
      rects.push({
        parent: run.state.topParent!,
        lane: "top",
        leftPct: startPct,
        rightPct: endPct,
        splitKidName: kidNameByLane(run, "top"),
      });
      rects.push({
        parent: run.state.bottomParent!,
        lane: "bottom",
        leftPct: startPct,
        rightPct: endPct,
        splitKidName: kidNameByLane(run, "bottom"),
      });
      splitLabels.push({
        lane: "top",
        leftPct: startPct,
        widthPct: endPct - startPct,
        kidName: kidNameByLane(run, "top"),
      });
      splitLabels.push({
        lane: "bottom",
        leftPct: startPct,
        widthPct: endPct - startPct,
        kidName: kidNameByLane(run, "bottom"),
      });
    }
  });

  // Apply gap insets at boundaries BETWEEN different-parent rects only.
  // Adjacent same-parent rects stay touching so the outline polygon is
  // continuous (no break within a single parent's territory).
  //
  // We compute per-rect "trimLeft"/"trimRight" inset values by looking at
  // neighboring rects that overlap this rect's horizontal span.
  const trimmed = rects.map((r, i) => {
    // Find the rects that share an edge with this one.
    let leftGap = 0;
    let rightGap = 0;

    // Consider rects that touch our left edge at startPct.
    for (let j = 0; j < rects.length; j++) {
      if (j === i) continue;
      const other = rects[j];
      // Neighbor ends where we start (within epsilon), different parent → gap.
      if (Math.abs(other.rightPct - r.leftPct) < 0.01 && other.parent !== r.parent) {
        leftGap = GAP_PCT;
      }
      if (Math.abs(other.leftPct - r.rightPct) < 0.01 && other.parent !== r.parent) {
        rightGap = GAP_PCT;
      }
    }
    return { ...r, leftPct: r.leftPct + leftGap, rightPct: r.rightPct - rightGap };
  });

  // Build one continuous polygon per parent.
  // For unified (full-height) rects, it's a simple rectangle path.
  // For combos of full + top/bottom-lane rects, we build an L (or T) path
  // by walking the union boundary.
  const buildPath = (parent: RibbonParent): string | null => {
    const mine = trimmed.filter((r) => r.parent === parent);
    if (mine.length === 0) return null;

    // Fast path: single full-height rect.
    if (mine.length === 1 && mine[0].lane === "full") {
      const r = mine[0];
      return `${r.leftPct},${topY} ${r.rightPct},${topY} ${r.rightPct},${bottomY} ${r.leftPct},${bottomY}`;
    }

    // Fast path: multiple disjoint full-height rects (alternating weeks
    // with >1 transitions, same parent rotating back). Render as one path
    // with moves between — not valid for <polygon>. Fall back to individual
    // rects, joined with M/L commands via <path d="...">.
    //
    // Simplification: if all rects are full-height, concatenate their
    // rectangle paths.
    const allFull = mine.every((r) => r.lane === "full");
    if (allFull) {
      return mine
        .map(
          (r) =>
            `${r.leftPct},${topY} ${r.rightPct},${topY} ${r.rightPct},${bottomY} ${r.leftPct},${bottomY}`,
        )
        .join(" "); // multiple polygons rendered as one — caller will split
    }

    // Complex L/T shape path: walk around the combined shape clockwise.
    // Group mine into runs sorted by leftPct, then stitch.
    // For the target cases (kid-split week), we typically have at most:
    //   - 1 full rect on the LEFT   (unified before)
    //   - 1 top/bottom lane         (during split)
    //   - 1 full rect on the RIGHT  (unified after)
    // We only need to emit outline points; SVG polygon can handle one
    // L per parent.
    const sorted = [...mine].sort((a, b) => a.leftPct - b.leftPct);

    // Build outline clockwise. Start at top-left of first piece.
    const pts: Array<[number, number]> = [];

    // Top boundary: walk left→right across the tops of each piece.
    sorted.forEach((r, i) => {
      const t = r.lane === "bottom" ? bottomLaneTopY : topY;
      if (i === 0) {
        pts.push([r.leftPct, t]);
      } else {
        const prev = sorted[i - 1];
        const prevTop = prev.lane === "bottom" ? bottomLaneTopY : topY;
        // If there's a level change, step vertically at the previous right edge.
        if (prevTop !== t) {
          pts.push([prev.rightPct, t]); // walk horizontally at new level
        }
        pts.push([r.leftPct, t]);
      }
      pts.push([r.rightPct, t]);
    });

    // Bottom boundary: walk right→left across the bottoms.
    const reversed = [...sorted].reverse();
    reversed.forEach((r, i) => {
      const b = r.lane === "top" ? topLaneBottomY : bottomY;
      if (i === 0) {
        pts.push([r.rightPct, b]);
      } else {
        const prev = reversed[i - 1];
        const prevBottom = prev.lane === "top" ? topLaneBottomY : bottomY;
        if (prevBottom !== b) {
          pts.push([prev.leftPct, b]);
        }
        pts.push([r.rightPct, b]);
      }
      pts.push([r.leftPct, b]);
    });

    return pts.map(([x, y]) => `${x},${y}`).join(" ");
  };

  const shapes: ParentShape[] = [];
  const youPath = buildPath("you");
  if (youPath) shapes.push({ parent: "you", points: youPath });
  const themPath = buildPath("them");
  if (themPath) shapes.push({ parent: "them", points: themPath });

  return { trackHeight, shapes, splitLabels, nameLabels };
}
