"use client";

import { useState } from "react";
import {
  X,
  Clock,
  CheckCircle,
  XCircle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import {
  CustodyOverride,
  Kid,
  Profile,
  CustodySchedule,
  OverrideStatus,
} from "@/lib/types";
import { computeCustodyForDate } from "@/lib/custody";
import { eachDayOfInterval } from "date-fns";

// Diff popover that opens from any pending visual on the calendar
// (dashed event chip OR dashed cell stripe). Shows the current
// (approved) custody side-by-side with what the request proposes,
// then lets the responder approve/dispute or the requester withdraw.

interface PendingDiffPopoverProps {
  /** All overrides that make up ONE logical request. Multi-kid
   *  requests come in as N rows here (one per kid) sharing the same
   *  date range, parent, and note. */
  overrides: CustodyOverride[];
  kids: Kid[];
  members: Profile[];
  schedules: CustodySchedule[];
  /** Approved overrides — used to compute the "Currently" column so
   *  it reflects the real schedule, not the projected one. */
  approvedOverrides: CustodyOverride[];
  currentUserId: string;
  onRespond: (
    overrideIds: string[],
    status: OverrideStatus,
    note: string,
    userId: string
  ) => Promise<boolean>;
  onViewAllRequests: () => void;
  onClose: () => void;
}

export default function PendingDiffPopover({
  overrides,
  kids,
  members,
  schedules,
  approvedOverrides,
  currentUserId,
  onRespond,
  onViewAllRequests,
  onClose,
}: PendingDiffPopoverProps) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (overrides.length === 0) return null;

  const primary = overrides[0];
  const requesterId = primary.created_by || "";
  const isMyRequest = requesterId === currentUserId;
  const requester = members.find((m) => m.id === requesterId);
  const proposedParent = members.find((m) => m.id === primary.parent_id);
  const proposedName =
    proposedParent?.full_name?.split(" ")[0] || "Co-parent";

  const kidNames = overrides
    .map((o) => kids.find((k) => k.id === o.kid_id)?.name)
    .filter(Boolean)
    .join(" & ");

  const dateRange =
    primary.start_date === primary.end_date
      ? formatDate(primary.start_date)
      : `${formatDate(primary.start_date)} – ${formatDate(primary.end_date)}`;

  // Walk the date range and capture which approved parent(s) currently
  // own each kid. If custody splits across the range (e.g. a normal
  // turnover sits inside the proposed window), join the names with "/".
  const days = eachDayOfInterval({
    start: new Date(primary.start_date + "T12:00:00"),
    end: new Date(primary.end_date + "T12:00:00"),
  });
  const currentByKid = overrides.map((o) => {
    const parentIds = new Set<string>();
    for (const day of days) {
      const c = computeCustodyForDate(day, schedules, approvedOverrides);
      const pid = c[o.kid_id]?.parentId;
      if (pid) parentIds.add(pid);
    }
    const names = Array.from(parentIds).map(
      (pid) =>
        members.find((m) => m.id === pid)?.full_name?.split(" ")[0] ||
        "Co-parent"
    );
    return {
      kidId: o.kid_id,
      kidName: kids.find((k) => k.id === o.kid_id)?.name || "Kid",
      parentName: names.join(" / ") || "—",
    };
  });

  const overrideIds = overrides.map((o) => o.id);

  const handleRespond = async (status: OverrideStatus) => {
    setBusy(true);
    const ok = await onRespond(overrideIds, status, comment, currentUserId);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-lg border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-divider)] shrink-0">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-[var(--accent-amber)]" />
            <h2 className="font-display text-base font-bold">
              Pending Custody Change
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-sm border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Requester + summary line */}
          <div>
            <div className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-[0.08em] font-semibold">
              {isMyRequest
                ? "Your request"
                : `Requested by ${
                    requester?.full_name?.split(" ")[0] || "Co-parent"
                  }`}
            </div>
            <div className="text-sm font-semibold text-[var(--color-text)] mt-0.5">
              {kidNames} · {dateRange}
            </div>
          </div>

          {/* Current → Proposed diff */}
          <div className="grid grid-cols-2 gap-2">
            <div className="border border-[var(--border)] bg-[var(--bg-sunken)] p-3">
              <div className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-[0.08em] font-semibold mb-2">
                Currently
              </div>
              {currentByKid.map(({ kidId, kidName, parentName }) => (
                <div
                  key={kidId}
                  className="text-xs text-[var(--color-text)] py-0.5"
                >
                  <span className="text-[var(--color-text-muted)]">
                    {kidName}:
                  </span>{" "}
                  {parentName}
                </div>
              ))}
            </div>

            <div
              className="border border-dashed p-3"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--accent-amber) 50%, transparent)",
                background: "var(--accent-amber-tint)",
              }}
            >
              <div
                className="text-[10px] uppercase tracking-[0.08em] font-semibold mb-2 flex items-center gap-1"
                style={{ color: "var(--accent-amber)" }}
              >
                <ArrowRight size={10} />
                Proposed
              </div>
              {overrides.map((o) => (
                <div
                  key={o.id}
                  className="text-xs text-[var(--color-text)] py-0.5"
                >
                  <span className="text-[var(--color-text-muted)]">
                    {kids.find((k) => k.id === o.kid_id)?.name || "Kid"}:
                  </span>{" "}
                  {proposedName}
                </div>
              ))}
              {primary.override_time && (
                <div
                  className="text-[11px] text-[var(--color-text-muted)] mt-2 pt-2 border-t"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--accent-amber) 30%, transparent)",
                  }}
                >
                  Pickup time: {primary.override_time}
                </div>
              )}
            </div>
          </div>

          {primary.note && (
            <div className="text-xs text-[var(--color-text)] bg-[var(--bg-sunken)] p-3 border border-[var(--border)]">
              <span className="text-[var(--color-text-faint)]">Note: </span>
              {primary.note}
            </div>
          )}
        </div>

        {/* Footer — actions vary by requester vs responder */}
        <div className="border-t border-[var(--color-divider)] p-4 space-y-3 shrink-0">
          {!isMyRequest && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment (required to dispute)..."
                rows={1}
                className="w-full px-3 py-1.5 rounded-sm bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--ink)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleRespond("disputed")}
                  disabled={busy || !comment.trim()}
                  className="flex-1 px-3 py-2 rounded-sm bg-[var(--accent-red)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <XCircle size={12} />
                  )}
                  Dispute
                </button>
                <button
                  onClick={() => handleRespond("approved")}
                  disabled={busy}
                  className="flex-1 px-3 py-2 rounded-sm bg-[#3D7A4F] text-white text-xs font-semibold hover:bg-[#336942] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {busy ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <CheckCircle size={12} />
                  )}
                  Approve
                </button>
              </div>
            </>
          )}

          {isMyRequest && (
            <button
              onClick={() => handleRespond("withdrawn")}
              disabled={busy}
              className="w-full px-3 py-2 rounded-sm border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-semibold hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <XCircle size={12} />
              )}
              Withdraw Request
            </button>
          )}

          <button
            onClick={onViewAllRequests}
            className="w-full text-center text-[11px] text-[var(--color-text-muted)] hover:text-[var(--ink)] transition-colors"
          >
            View all change requests →
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
