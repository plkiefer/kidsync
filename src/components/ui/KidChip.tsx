"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type KidId = "ethan" | "harrison" | "all";

interface KidChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kid: KidId;
  label?: ReactNode;   // override display text (default: capitalized kid id)
  active?: boolean;
  size?: "sm" | "md";
  dotOnly?: boolean;   // render just the colored dot (for inline rails)
}

const dotColorClass: Record<KidId, string> = {
  ethan:    "bg-kid-ethan",
  harrison: "bg-kid-harrison",
  all:      "bg-[var(--ink)]",
};

const defaultLabel: Record<KidId, string> = {
  ethan: "Ethan",
  harrison: "Harrison",
  all: "All",
};

export function KidDot({
  kid,
  size = 8,
  className = "",
}: {
  kid: KidId;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full ${dotColorClass[kid]} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function KidChip({
  kid,
  label,
  active = false,
  size = "md",
  dotOnly = false,
  className = "",
  ...rest
}: KidChipProps) {
  if (dotOnly) {
    return <KidDot kid={kid} size={size === "sm" ? 6 : 8} className={className} />;
  }

  const base =
    "inline-flex items-center gap-[7px] font-medium transition-colors";
  const sizing =
    size === "sm"
      ? "text-[11.5px] px-2 py-[3px]"
      : "text-[12.5px] px-2.5 py-[5px]";
  const state = active
    ? "text-[var(--ink)] bg-[var(--bg-sunken)]"
    : "text-[var(--text-muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)]";

  return (
    <button
      type="button"
      className={[base, sizing, state, className].filter(Boolean).join(" ")}
      aria-pressed={active}
      {...rest}
    >
      <KidDot kid={kid} size={size === "sm" ? 6 : 8} />
      {label ?? defaultLabel[kid]}
    </button>
  );
}
