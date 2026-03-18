"use client";

import { useState } from "react";
import {
  X,
  Calendar,
  Clock,
  Shield,
  CheckCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { CalendarEvent, Kid, Profile, CustodyOverride, OverrideStatus } from "@/lib/types";
import { formatShortDate, formatTime } from "@/lib/dates";
import { addDays, format } from "date-fns";

interface QuickCustodyChangeProps {
  /** The turnover event being modified */
  turnoverEvent: CalendarEvent;
  kids: Kid[];
  members: Profile[];
  familyId: string;
  currentUserId: string;
  onCreateOverrides: (overrides: any[]) => Promise<CustodyOverride[]>;
  onWithdrawOverlapping: (kidIds: string[], dateRanges: { start: string; end: string }[]) => Promise<void>;
  onNotifyCustodyChange: (params: {
    action: "requested" | "approved" | "disputed" | "withdrawn";
    override: { start_date: string; end_date: string; parent_id: string; reason?: string | null; note?: string | null };
    kidIds: string[];
    familyId: string;
    changedBy: string;
  }) => void;
  onClose: () => void;
}

export default function QuickCustodyChange({
  turnoverEvent,
  kids,
  members,
  familyId,
  currentUserId,
  onCreateOverrides,
  onWithdrawOverlapping,
  onNotifyCustodyChange,
  onClose,
}: QuickCustodyChangeProps) {
  // Derive context from the turnover event
  const isPickup = turnoverEvent.id.includes("pickup");
  const currentDate = turnoverEvent.starts_at.split("T")[0];
  const currentTime = turnoverEvent.starts_at.split("T")[1]?.slice(0, 5) || "15:00";
  const eventKidIds = turnoverEvent.kid_ids || [turnoverEvent.kid_id];

  // Determine override parent:
  // For PICKUP change: extend/shift when Father picks up → override assigns Father
  // For DROPOFF change: extend/shift when Father drops off → override assigns Father
  //   (extending Father's custody to the new date so the dropoff moves)
  // In both cases for the current user, the override parent is the current user
  const otherParent = members.find((m) => m.id !== currentUserId);
  const overrideParentId = currentUserId; // Father's custody is being modified
  const currentUserName = members.find((m) => m.id === currentUserId)?.full_name?.split(" ")[0];

  // Form state — only the things that can change
  const [newDate, setNewDate] = useState(currentDate);
  const [newTime, setNewTime] = useState(currentTime);
  const [selectedKids, setSelectedKids] = useState<string[]>(eventKidIds);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const hasChanges = newDate !== currentDate || newTime !== currentTime;

  const toggleKid = (kidId: string) => {
    setSelectedKids((prev) => {
      if (prev.includes(kidId)) {
        if (prev.length <= 1) return prev; // must keep at least one
        return prev.filter((id) => id !== kidId);
      }
      return [...prev, kidId];
    });
  };

  const handleSubmit = async () => {
    if (!hasChanges && !note) return;
    setSubmitting(true);
    setError("");

    const kidNames = selectedKids
      .map((id) => kids.find((k) => k.id === id)?.name)
      .filter(Boolean)
      .join(" & ");
    const description = `${isPickup ? "Pickup" : "Drop-off"} for ${kidNames} moved from ${currentDate} to ${newDate} at ${newTime}${note ? ` — ${note}` : ""}`;

    try {
      // Compute the override date range:
      // Moving a turnover to a non-adjacent day requires covering all gap days
      // so custody extends continuously (no phantom pickup+dropoff on isolated days)
      const origDate = new Date(currentDate + "T12:00:00");
      const targetDate = new Date(newDate + "T12:00:00");
      const movingLater = targetDate > origDate;

      let rangeStart: string;
      let rangeEnd: string;
      let overrideParent: string;

      if (isPickup) {
        if (movingLater) {
          rangeStart = currentDate;
          rangeEnd = format(addDays(targetDate, -1), "yyyy-MM-dd");
          overrideParent = otherParent?.id || "";
        } else {
          rangeStart = newDate;
          rangeEnd = format(addDays(origDate, -1), "yyyy-MM-dd");
          overrideParent = overrideParentId;
        }
      } else {
        if (movingLater) {
          rangeStart = format(addDays(origDate, 1), "yyyy-MM-dd");
          rangeEnd = newDate;
          overrideParent = overrideParentId;
        } else {
          rangeStart = format(addDays(targetDate, 1), "yyyy-MM-dd");
          rangeEnd = currentDate;
          overrideParent = otherParent?.id || "";
        }
      }

      // Withdraw overlapping overrides via the hook (keeps state in sync)
      await onWithdrawOverlapping(selectedKids, [
        { start: rangeStart, end: rangeEnd },
        { start: currentDate, end: currentDate },
      ]);

      // Create all kid overrides in one batch DB call
      await onCreateOverrides(selectedKids.map((kidId) => ({
        family_id: familyId,
        kid_id: kidId,
        start_date: rangeStart,
        end_date: rangeEnd,
        parent_id: overrideParent,
        note: description,
        reason: note || `Schedule change for ${isPickup ? "pickup" : "drop-off"}`,
        compliance_status: "unchecked" as const,
        compliance_issues: null,
        status: "pending" as OverrideStatus,
        created_by: currentUserId,
      })));
      onNotifyCustodyChange({
        action: "requested",
        override: { start_date: rangeStart, end_date: rangeEnd, parent_id: overrideParent, note: description, reason: note || `Schedule change for ${isPickup ? "pickup" : "drop-off"}` },
        kidIds: selectedKids,
        familyId,
        changedBy: currentUserId,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || "Failed to submit change request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-sm border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Color bar */}
        <div className="h-1.5 rounded-t-2xl bg-gradient-to-r from-indigo-500 to-amber-500" />

        {submitted ? (
          <div className="p-6 text-center">
            <CheckCircle size={36} className="text-green-500 mx-auto mb-3" />
            <h3 className="font-display text-base font-semibold mb-1">
              Change Requested
            </h3>
            <p className="text-xs text-[var(--color-text-faint)] mb-5">
              {otherParent?.full_name?.split(" ")[0] || "The other parent"} will
              be notified and can approve or dispute this change.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <div>
                <h2 className="font-display text-base font-bold">
                  Change {isPickup ? "Pickup" : "Drop-off"}
                </h2>
                <p className="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                  Currently: {formatShortDate(turnoverEvent.starts_at)} at{" "}
                  {formatTime(turnoverEvent.starts_at)}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg bg-[var(--color-input)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-4">
              {/* Children */}
              {kids.length > 1 && (
                <div>
                  <label className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase tracking-wider">
                    Children
                  </label>
                  <div className="flex gap-2 mt-1.5">
                    {kids.map((kid) => {
                      const selected = selectedKids.includes(kid.id);
                      return (
                        <button
                          key={kid.id}
                          onClick={() => toggleKid(kid.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                          style={{
                            backgroundColor: selected ? `${kid.color}22` : "var(--color-input)",
                            color: selected ? kid.color : "var(--color-text-faint)",
                            border: `1.5px solid ${selected ? kid.color : "transparent"}`,
                          }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: kid.color }}
                          />
                          {kid.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* New date & time — side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase tracking-wider flex items-center gap-1">
                    <Calendar size={10} />
                    New Date
                  </label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase tracking-wider flex items-center gap-1">
                    <Clock size={10} />
                    New Time
                  </label>
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase tracking-wider">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g., Doctor appointment, schedule conflict"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </div>

              {/* Compliance warning if date changed */}
              {hasChanges && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-300 leading-relaxed">
                    This change differs from the custody agreement.{" "}
                    {otherParent?.full_name?.split(" ")[0]} will be notified and
                    can approve or dispute.
                  </p>
                </div>
              )}

              {error && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={submitting || (!hasChanges && !note)}
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Shield size={14} />
                )}
                Submit Change Request
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
