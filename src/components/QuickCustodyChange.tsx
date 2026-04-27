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
import { CalendarEvent, Kid, Profile } from "@/lib/types";
import { kidColorCss } from "@/lib/palette";
import { formatShortDate, formatTime } from "@/lib/dates";

interface QuickCustodyChangeProps {
  /** The turnover event being modified */
  turnoverEvent: CalendarEvent;
  kids: Kid[];
  members: Profile[];
  familyId: string;
  currentUserId: string;
  onMoveTurnover: (params: {
    isPickup: boolean;
    currentDate: string;
    newDate: string;
    newTime?: string;
    kidIds: string[];
    familyId: string;
    userId: string;
    note: string;
    reason: string;
  }) => Promise<boolean>;
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
  onMoveTurnover,
  onNotifyCustodyChange,
  onClose,
}: QuickCustodyChangeProps) {
  // Derive context from the turnover event
  const isPickup = turnoverEvent.id.includes("pickup");
  const currentDate = turnoverEvent.starts_at.split("T")[0];
  const currentTime = turnoverEvent.starts_at.split("T")[1]?.slice(0, 5) || "15:00";
  const eventKidIds = turnoverEvent.kid_ids || [turnoverEvent.kid_id];

  const otherParent = members.find((m) => m.id !== currentUserId);

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
    const reason = note || `Schedule change for ${isPickup ? "pickup" : "drop-off"}`;

    try {
      // moveTurnover handles all custody logic: finds standard schedule dates,
      // computes the correct override range, withdraws conflicts, creates override
      const success = await onMoveTurnover({
        isPickup,
        currentDate,
        newDate,
        // Always pass newTime, even if it matches currentTime. Earlier
        // version only forwarded it when changed, which silently dropped
        // the time to null when the user re-edited an already-moved
        // turnover (currentTime was the previous override time, not the
        // schedule default). The downstream override_time column then
        // came back null, and the pill rendered at the schedule default.
        newTime,
        kidIds: selectedKids,
        familyId,
        userId: currentUserId,
        note: description,
        reason,
      });

      if (!success) {
        setError("Failed to submit change — could not compute schedule");
        return;
      }

      onNotifyCustodyChange({
        action: "requested",
        override: { start_date: newDate, end_date: newDate, parent_id: currentUserId, note: description, reason },
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
        className="bg-[var(--bg)] w-full max-w-sm border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Action identity bar */}
        <div className="h-1.5 bg-action" />

        {submitted ? (
          <div className="p-6 text-center">
            <CheckCircle size={32} className="mx-auto mb-3" style={{ color: "#3D7A4F" }} />
            <h3 className="font-display text-base font-semibold mb-1">
              Change Requested
            </h3>
            <p className="text-xs text-[var(--text-faint)] mb-5">
              {otherParent?.full_name?.split(" ")[0] || "The other parent"} will
              be notified and can approve or dispute this change.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-sm bg-action text-action-fg text-sm font-semibold hover:bg-action-hover transition-colors"
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
                className="w-7 h-7 rounded-sm border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
                aria-label="Close"
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
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold transition-colors border"
                          style={{
                            backgroundColor: selected ? kidColorCss(kid.color) : "var(--bg)",
                            color: selected ? "#ffffff" : "var(--text-muted)",
                            borderColor: selected ? kidColorCss(kid.color) : "var(--border)",
                          }}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{
                              backgroundColor: selected ? "#ffffff" : kidColorCss(kid.color),
                              opacity: selected ? 0.8 : 1,
                            }}
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
                    className="w-full mt-1 px-3 py-2 rounded-sm bg-[var(--bg-sunken)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
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
                    className="w-full mt-1 px-3 py-2 rounded-sm bg-[var(--bg-sunken)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
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
                  className="w-full mt-1 px-3 py-2 rounded-sm bg-[var(--bg-sunken)] border border-[var(--border)] text-sm text-[var(--ink)] placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
                />
              </div>

              {/* Compliance warning if date changed */}
              {hasChanges && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-sm border border-[var(--accent-amber)]/30 bg-[var(--accent-amber-tint)]">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "var(--accent-amber)" }} />
                  <p className="text-[10.5px] leading-relaxed" style={{ color: "var(--accent-amber)" }}>
                    This change differs from the custody agreement.{" "}
                    {otherParent?.full_name?.split(" ")[0]} will be notified and
                    can approve or dispute.
                  </p>
                </div>
              )}

              {error && (
                <div className="text-xs rounded-sm px-3 py-2 border border-[var(--accent-red)]/30 bg-[var(--accent-red-tint)]" style={{ color: "var(--accent-red)" }}>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={submitting || (!hasChanges && !note)}
                className="w-full px-4 py-2 rounded-sm bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
