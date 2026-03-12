"use client";

import { Kid } from "@/lib/types";

type ViewMode = "month" | "week" | "list";

interface KidFilterProps {
  kids: Kid[];
  activeKid: string; // "all" or kid id
  onKidChange: (kidId: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export default function KidFilter({
  kids,
  activeKid,
  onKidChange,
  view,
  onViewChange,
}: KidFilterProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Kid filter */}
      <button
        onClick={() => onKidChange("all")}
        className={`
          px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
          ${
            activeKid === "all"
              ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
              : "bg-transparent border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
          }
        `}
        style={{
          border: `1.5px solid ${
            activeKid === "all" ? "#3B82F6" : "var(--color-border)"
          }`,
        }}
      >
        All
      </button>

      {kids.map((kid) => (
        <button
          key={kid.id}
          onClick={() => onKidChange(kid.id)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={{
            border: `1.5px solid ${
              activeKid === kid.id ? kid.color : "var(--color-border)"
            }`,
            backgroundColor:
              activeKid === kid.id ? `${kid.color}22` : "transparent",
            color: activeKid === kid.id ? kid.color : "var(--color-kid-2)",
          }}
        >
          {kid.name}
        </button>
      ))}

      {/* Divider */}
      <div className="w-px h-5 bg-[var(--color-input)] mx-1" />

      {/* View toggle */}
      {(["month", "week", "list"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onViewChange(v)}
          className={`
            px-2.5 py-1.5 rounded-lg text-[11px] font-semibold capitalize transition-all
            ${
              view === v
                ? "bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-accent)]"
                : "bg-transparent border-[var(--color-border)] text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
            }
          `}
          style={{
            border: `1.5px solid ${
              view === v ? "#3B82F6" : "var(--color-border)"
            }`,
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
