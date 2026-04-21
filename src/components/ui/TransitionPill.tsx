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
        "inline-flex items-center gap-1",
        "pl-0.5 pr-1.5 py-0",
        "text-[10.5px] font-semibold leading-tight",
        "border border-action bg-[var(--bg)] text-action",
        "transition-colors hover:bg-[var(--action-bg)]",
        "focus:outline-none focus-visible:shadow-[0_0_0_3px_var(--action-ring)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <span
        className="px-1 py-[1px] font-bold tabular-nums text-[10.5px] bg-action text-action-fg"
      >
        {time}
      </span>
      {kid && kid !== "all" && (
        <span
          className={[
            "px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider",
            kidChipBg[kid],
          ].join(" ")}
        >
          {kid === "ethan" ? "E" : "H"}
        </span>
      )}
      <span className="inline-flex items-center text-action">
        <IconArrow direction={direction} />
      </span>
      <span className="font-semibold text-[10px]">{displayLabel}</span>
    </button>
  );
}
