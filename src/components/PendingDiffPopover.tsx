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
  CustodyAgreement,
  Kid,
  ParsedCustodyTerms,
  Profile,
  CustodySchedule,
  OverrideStatus,
} from "@/lib/types";
import { computeCustodyForDate } from "@/lib/custody";
import { eachDayOfInterval } from "date-fns";

// Diff popover that opens from the day-cell pending pill OR a dashed
// event chip. Shows the current (approved) state side-by-side with
// what the request proposes, then lets the responder approve/dispute
// or the requester withdraw.

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
  /** Latest agreement(s) — used to read the standard pickup/drop-off
   *  times for the "Currently" column. */
  agreements?: CustodyAgreement[];
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

// ── Note normalization ────────────────────────────────────────
// The DB stores auto-generated descriptions in the `note` field
// (QuickCustodyChange's "Pickup for X moved from Y to Z at HH:MM",
// custom-custody's "Custom custody: ... ", cancel-exchange's
// "Cancellation of...", etc). Those duplicate what's already shown
// in the diff columns — strip them so the popover only displays a
// note when there's a real user-supplied reason.
function extractUserNote(rawNote: string | null | undefined): string | null {
  if (!rawNote) return null;
  // QuickCustodyChange template — "<Action> for <kids> moved from
  // YYYY-MM-DD to YYYY-MM-DD at HH:MM[ — user note]"
  const moveMatch = rawNote.match(
    /^(?:Pickup|Drop-off) for .+? moved from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} at \d{1,2}:\d{2}(?:\s+—\s+(.+))?$/
  );
  if (moveMatch) {
    return moveMatch[1]?.trim() || null;
  }
  // Custom-custody template
  const customMatch = rawNote.match(
    /^Custom custody: .+? with .+? — Pickup .+? at .+?, Drop-off .+? at .+?(?:\s+—\s+(.+))?$/
  );
  if (customMatch) {
    return customMatch[1]?.trim() || null;
  }
  // Cancellation templates have no user-text portion
  if (
    /^(Cancellation of custom exchange|Weekend cancelled) for /.test(rawNote)
  ) {
    return null;
  }
  // Otherwise treat as user-supplied free text
  return rawNote;
}

function readDefaultTurnoverTimes(
  agreements: CustodyAgreement[] | undefined
): { pickup: string; dropoff: string } {
  const latest = agreements && agreements.length > 0 ? agreements[0] : null;
  const terms = latest?.parsed_terms as ParsedCustodyTerms | null;
  return {
    pickup: terms?.alternating_weekends?.pickup_time || "3:00 PM",
    dropoff: terms?.alternating_weekends?.dropoff_time || "5:00 PM",
  };
}

/** "09:00" → "9:00 AM", "21:30" → "9:30 PM", passthrough for AM/PM input. */
function prettyTime(t: string): string {
  if (/[ap]m$/i.test(t.trim())) return t;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  const h = parseInt(m[1], 10);
  const min = m[2];
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${period}`;
}

export default function PendingDiffPopover({
  overrides,
  kids,
  members,
  schedules,
  approvedOverrides,
  agreements,
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

          {/* Current → Proposed diff. Both columns carry the same
              fields (Custody / Pickup / Drop-off) so the eye can
              compare row-by-row instead of hunting for what's
              different. */}
          {(() => {
            const stdTimes = readDefaultTurnoverTimes(agreements);
            const proposedPickup = primary.override_time
              ? prettyTime(primary.override_time)
              : prettyTime(stdTimes.pickup);
            const currentPickup = prettyTime(stdTimes.pickup);
            const currentDropoff = prettyTime(stdTimes.dropoff);
            const proposedDropoff = currentDropoff; // dropoff time isn't editable today

            return (
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-[var(--border)] bg-[var(--bg-sunken)] p-3 space-y-2">
                  <div className="text-[10px] text-[var(--color-text-faint)] uppercase tracking-[0.08em] font-semibold">
                    Currently
                  </div>
                  <DiffField label="Custody">
                    {currentByKid.map(({ kidId, kidName, parentName }) => (
                      <div
                        key={kidId}
                        className="text-xs text-[var(--color-text)]"
                      >
                        <span className="text-[var(--color-text-muted)]">
                          {kidName}:
                        </span>{" "}
                        {parentName}
                      </div>
                    ))}
                  </DiffField>
                  <DiffField label="Pickup">
                    <span className="text-xs text-[var(--color-text)]">
                      {currentPickup}
                    </span>
                  </DiffField>
                  <DiffField label="Drop-off">
                    <span className="text-xs text-[var(--color-text)]">
                      {currentDropoff}
                    </span>
                  </DiffField>
                </div>

                <div
                  className="border border-dashed p-3 space-y-2"
                  style={{
                    borderColor:
                      "color-mix(in srgb, var(--accent-amber) 50%, transparent)",
                    background: "var(--accent-amber-tint)",
                  }}
                >
                  <div
                    className="text-[10px] uppercase tracking-[0.08em] font-semibold flex items-center gap-1"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    <ArrowRight size={10} />
                    Proposed
                  </div>
                  <DiffField label="Custody">
                    {overrides.map((o) => (
                      <div
                        key={o.id}
                        className="text-xs text-[var(--color-text)]"
                      >
                        <span className="text-[var(--color-text-muted)]">
                          {kids.find((k) => k.id === o.kid_id)?.name || "Kid"}:
                        </span>{" "}
                        {proposedName}
                      </div>
                    ))}
                  </DiffField>
                  <DiffField label="Pickup">
                    <span
                      className="text-xs"
                      style={{
                        color:
                          proposedPickup !== currentPickup
                            ? "var(--accent-amber)"
                            : "var(--color-text)",
                        fontWeight:
                          proposedPickup !== currentPickup ? 700 : 400,
                      }}
                    >
                      {proposedPickup}
                    </span>
                  </DiffField>
                  <DiffField label="Drop-off">
                    <span className="text-xs text-[var(--color-text)]">
                      {proposedDropoff}
                    </span>
                  </DiffField>
                </div>
              </div>
            );
          })()}

          {(() => {
            const userNote = extractUserNote(primary.note);
            if (!userNote) return null;
            return (
              <div className="text-xs text-[var(--color-text)] bg-[var(--bg-sunken)] p-3 border border-[var(--border)]">
                <span className="text-[var(--color-text-faint)]">Note: </span>
                {userNote}
              </div>
            );
          })()}
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

// Tiny labeled-row primitive used by both diff columns. Keeps both
// sides aligned vertically — Custody / Pickup / Drop-off rows stack
// in the same order in each column so the eye reads top-to-bottom.
function DiffField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.06em] font-semibold text-[var(--color-text-faint)] mb-0.5">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
