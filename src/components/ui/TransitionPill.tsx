"use client";

import type { ButtonHTMLAttributes } from "react";
import type { KidId } from "./KidChip";

type Direction = "handoff" | "dropoff";
// "handoff" = kids coming INTO my care   (← from other parent)
// "dropoff" = kids leaving MY care       (→ to other parent)

interface TransitionPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  time: string;            // e.g. "3:00p" or "6:00p"
  direction: Direction;
  kid?: KidId;             // omit for whole-household transitions
  label?: string;          // override default label ("Handoff" / "Drop-off")
}

const kidChipBg: Record<"ethan" | "harrison", string> = {
  ethan:    "bg-kid-ethan-bg text-kid-ethan-fg",
  harrison: "bg-kid-harrison-bg text-kid-harrison-fg",
};

const IconArrow = ({ direction }: { direction: Direction }) =>
  direction === "handoff" ? (
    // ← incoming
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 12H5M11 19l-7-7 7-7" />
    </svg>
  ) : (
    // → outgoing
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );

export function TransitionPill({
  time,
  direction,
  kid,
  label,
  className = "",
  ...rest
}: TransitionPillProps) {
  const defaultLabel = direction === "handoff" ? "Handoff" : "Drop-off";
  const displayLabel = label ?? defaultLabel;
  const ariaLabel =
    `${displayLabel}${kid && kid !== "all" ? ` · ${kid}` : ""} at ${time}`;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={[
        "inline-flex items-center gap-1 w-full",
        "px-1.5 py-[3px]",
        "text-[11px] font-medium leading-tight text-[var(--ink)]",
        // Match event-chip shape: white bg + 3px cerulean left border + hairline ring.
        "bg-white border-l-[3px] border-action",
        "shadow-[0_0_0_1px_var(--border)]",
        "cursor-pointer hover:translate-x-[1px] transition-transform",
        "focus:outline-none focus-visible:shadow-[0_0_0_3px_var(--action-ring)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span className="text-[10px] tabular-nums font-semibold text-action shrink-0">
        {time}
      </span>
      {kid && kid !== "all" && (
        <span
          className={[
            "inline-flex items-center justify-center shrink-0",
            "w-[14px] h-[14px] rounded-sm",
            "text-[8px] font-bold text-white",
            kid === "ethan" ? "bg-kid-ethan" : "bg-kid-harrison",
          ].join(" ")}
        >
          {kid === "ethan" ? "E" : "H"}
        </span>
      )}
      <span className="inline-flex items-center text-action shrink-0">
        <IconArrow direction={direction} />
      </span>
      <span className="truncate text-[10.5px] font-medium text-action">
        {displayLabel}
      </span>
    </button>
  );
}
