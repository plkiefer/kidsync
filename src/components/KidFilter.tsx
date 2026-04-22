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

/** Map a kid by position to the token-backed solid color class. */
function kidSolidClass(kid: Kid, kids: Kid[]): string {
  const idx = kids.findIndex((k) => k.id === kid.id);
  if (idx === 0) return "bg-kid-ethan text-white";
  if (idx === 1) return "bg-kid-harrison text-white";
  return "bg-[var(--ink)] text-[var(--accent-ink)]";
}

/** Shared base class for all filter buttons (editorial outline). */
const outlineBase =
  "px-3 py-1.5 text-xs font-medium border border-[var(--border)] " +
  "bg-[var(--bg)] text-[var(--text-muted)] " +
  "hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] " +
  "transition-colors";

export default function KidFilter({
  kids,
  activeKid,
  onKidChange,
  view,
  onViewChange,
}: KidFilterProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Kid filter — active kid uses solid kid color, matching the chip style */}
      <button
        onClick={() => onKidChange("all")}
        aria-pressed={activeKid === "all"}
        className={
          activeKid === "all"
            ? "px-3 py-1.5 text-xs font-semibold border border-[var(--ink)] bg-[var(--ink)] text-[var(--accent-ink)]"
            : outlineBase
        }
      >
        All
      </button>

      {kids.map((kid) => {
        const active = activeKid === kid.id;
        return (
          <button
            key={kid.id}
            onClick={() => onKidChange(kid.id)}
            aria-pressed={active}
            className={
              active
                ? `px-3 py-1.5 text-xs font-semibold border border-transparent ${kidSolidClass(kid, kids)}`
                : outlineBase
            }
          >
            {kid.name}
          </button>
        );
      })}

      {/* Divider */}
      <div className="w-px h-5 bg-[var(--border)] mx-1" />

      {/* View toggle — active view uses cerulean action */}
      {(["month", "week", "list"] as const).map((v) => {
        const active = view === v;
        return (
          <button
            key={v}
            onClick={() => onViewChange(v)}
            aria-pressed={active}
            className={
              active
                ? "px-2.5 py-1.5 text-[11px] font-semibold capitalize border border-action bg-action text-action-fg"
                : "px-2.5 py-1.5 text-[11px] font-medium capitalize border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
            }
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
