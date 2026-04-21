"use client";

import { useMemo } from "react";
import type { Kid } from "@/lib/types";
import {
  computeWeekRibbon,
  type RibbonParent,
} from "@/lib/ribbonGeometry";

interface WeekRibbonProps {
  week: Date[];
  getCustodyForDate?: (d: Date) => Record<string, { parentId: string; isParentA: boolean }>;
  currentUserId?: string;
  kids: Kid[];
  /** Optional display-name overrides for the parent labels.
   *  Defaults: "YOU" for you, "DANIELLE" or co-parent's first name for them. */
  themLabel?: string;
}

const parentStroke = (p: RibbonParent) =>
  p === "you" ? "var(--you-line)" : "var(--them-line)";
const parentFill = (p: RibbonParent) =>
  p === "you" ? "var(--you-bg)" : "var(--them-bg)";
const parentText = (p: RibbonParent) =>
  p === "you" ? "var(--you-text)" : "var(--them-text)";

export function WeekRibbon({
  week,
  getCustodyForDate,
  currentUserId,
  kids,
  themLabel,
}: WeekRibbonProps) {
  const data = useMemo(() => {
    if (!getCustodyForDate || !currentUserId) return null;
    return computeWeekRibbon(week, getCustodyForDate, currentUserId, kids);
  }, [week, getCustodyForDate, currentUserId, kids]);

  if (!data) return null;

  const { trackHeight, shapes, splitLabels, nameLabels } = data;
  const laneHeight = trackHeight === 22 ? 22 : 44;

  const labelFor = (p: RibbonParent) => (p === "you" ? "YOU" : (themLabel ?? "DANIELLE").toUpperCase());

  return (
    <div
      className="relative w-full bg-[var(--bg-sunken)] border-b border-[var(--stone-150)]"
      style={{ height: laneHeight }}
      aria-hidden="true"
    >
      {/* Filled rectangles per parent (behind outline) */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 100 ${trackHeight}`}
        preserveAspectRatio="none"
      >
        {/* Fills */}
        {shapes.map((s, i) => (
          <polygon
            key={`fill-${i}`}
            points={s.points}
            fill={parentFill(s.parent)}
            stroke="none"
          />
        ))}
        {/* Outlines — stroked on top of fills with non-scaling stroke */}
        {shapes.map((s, i) => (
          <polygon
            key={`stroke-${i}`}
            points={s.points}
            fill="none"
            stroke={parentStroke(s.parent)}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="miter"
          />
        ))}
      </svg>

      {/* Parent name labels — pinned to outer edge of first/last segment */}
      {nameLabels.map((nl, i) => (
        <div
          key={`name-${i}`}
          className="absolute top-0 bottom-0 flex items-center px-2.5"
          style={{
            left: `${nl.leftPct}%`,
            width: `${nl.widthPct}%`,
            justifyContent: nl.anchor === "left" ? "flex-start" : "flex-end",
            color: parentText(nl.parent),
          }}
        >
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase">
            {labelFor(nl.parent)}
          </span>
        </div>
      ))}

      {/* Italic serif kid-name labels in split lanes */}
      {splitLabels.map((sl, i) => {
        // top lane sits in upper half, bottom in lower half when trackHeight == 44.
        const laneTop = sl.lane === "top" ? 0 : 50;
        return (
          <div
            key={`split-${i}`}
            className="absolute flex items-center justify-center"
            style={{
              left: `${sl.leftPct}%`,
              width: `${sl.widthPct}%`,
              top: `${laneTop}%`,
              height: "50%",
              color:
                sl.lane === "top"
                  ? "var(--you-text)"
                  : "var(--them-text)",
            }}
          >
            <span
              className="italic text-[12px] leading-none"
              style={{ fontFamily: "var(--font-dm-serif), Georgia, serif" }}
            >
              {sl.kidName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
