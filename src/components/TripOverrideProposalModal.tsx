"use client";

import { useState } from "react";
import { X, Scale, Minus, Plus } from "lucide-react";
import { Kid, Trip } from "@/lib/types";
import { kidColorCss } from "@/lib/palette";

interface TripOverrideProposalModalProps {
  trip: Trip;
  /** Kids that have a custody conflict — pre-selected, but the user
   *  can narrow if they want to propose for fewer than detected. */
  conflictKidIds: string[];
  /** Display name of the trip's parent (the one taking the kids).
   *  The actual parent_id is filled in by the parent component when
   *  it builds the override payload — this prop is for the UI copy
   *  only ("Patrick wants custody during this trip"). */
  proposingParentName: string;
  kids: Kid[];
  onClose: () => void;
  /** Called with the user-finalised override params; parent is
   *  responsible for the actual createOverrides + linking via
   *  created_from_trip_id. */
  onSubmit: (params: {
    kidIds: string[];
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    note: string;
    reason: string;
  }) => Promise<void>;
}

const inputCls =
  "w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors";
const labelCls =
  "block text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em] mb-1.5";

/**
 * Override-proposal modal triggered by TripView's "Propose override"
 * button. Plan §15b:
 *   - Dates default to trip dates, editable (the canonical user case
 *     is "shift start back a day because pickup is the day before").
 *   - Kids = all kids on trip whose default custody differs from the
 *     trip's parent. Pre-selected but the user can narrow.
 *   - Parent = the trip's parent (auto, not editable here — trip
 *     roster determines this).
 *   - Reason auto-prefilled from trip title.
 *
 * Shifts the dates ±1 day with quick buttons since "the day before
 * the flight" is the most common adjustment.
 */
export default function TripOverrideProposalModal({
  trip,
  conflictKidIds,
  proposingParentName,
  kids,
  onClose,
  onSubmit,
}: TripOverrideProposalModalProps) {
  const tripStart = trip.starts_at?.slice(0, 10) ?? "";
  const tripEnd = trip.ends_at?.slice(0, 10) ?? "";

  const [selectedKidIds, setSelectedKidIds] = useState<string[]>(conflictKidIds);
  const [startDate, setStartDate] = useState<string>(tripStart);
  const [endDate, setEndDate] = useState<string>(tripEnd);
  const [reason, setReason] = useState<string>(
    `Trip: ${trip.title}`
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adjustDate = (which: "start" | "end", days: number) => {
    const setter = which === "start" ? setStartDate : setEndDate;
    const current = which === "start" ? startDate : endDate;
    if (!current) return;
    const d = new Date(current + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    setter(d.toISOString().slice(0, 10));
  };

  const conflictKids = kids.filter((k) => conflictKidIds.includes(k.id));

  const handleSubmit = async () => {
    setError(null);
    if (!startDate || !endDate) {
      setError("Start and end dates are required.");
      return;
    }
    if (startDate > endDate) {
      setError("End date must be on or after start date.");
      return;
    }
    if (selectedKidIds.length === 0) {
      setError("At least one kid must be selected.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        kidIds: selectedKidIds,
        startDate,
        endDate,
        note: reason,
        reason,
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleKid = (id: string) =>
    setSelectedKidIds((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-md sm:max-h-[90vh] max-h-[90vh] flex flex-col border-t sm:border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-[var(--border-strong)]">
          <Scale className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="font-display text-base font-semibold text-[var(--ink)] flex-1">
            Propose custody override
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
            <strong className="text-[var(--ink)]">{proposingParentName}</strong>{" "}
            wants custody during this trip. Co-parent will be notified to
            approve or dispute.
          </p>

          {/* Dates */}
          <div>
            <label className={labelCls}>Start date</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => adjustDate("start", -1)}
                className="p-1.5 border border-[var(--border)] rounded-sm hover:bg-[var(--bg-sunken)] text-[var(--text-muted)]"
                title="Day earlier — common for 'pickup the day before flight'"
              >
                <Minus size={12} />
              </button>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => adjustDate("start", 1)}
                className="p-1.5 border border-[var(--border)] rounded-sm hover:bg-[var(--bg-sunken)] text-[var(--text-muted)]"
              >
                <Plus size={12} />
              </button>
            </div>
            <p className="text-[10.5px] text-[var(--text-faint)] mt-1">
              Trip starts {tripStart || "TBD"} — adjust if pickup is earlier.
            </p>
          </div>

          <div>
            <label className={labelCls}>End date</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => adjustDate("end", -1)}
                className="p-1.5 border border-[var(--border)] rounded-sm hover:bg-[var(--bg-sunken)] text-[var(--text-muted)]"
              >
                <Minus size={12} />
              </button>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => adjustDate("end", 1)}
                className="p-1.5 border border-[var(--border)] rounded-sm hover:bg-[var(--bg-sunken)] text-[var(--text-muted)]"
                title="Day later — common for 'drop off the morning after return'"
              >
                <Plus size={12} />
              </button>
            </div>
            <p className="text-[10.5px] text-[var(--text-faint)] mt-1">
              Trip ends {tripEnd || "TBD"} — adjust if drop-off is later.
            </p>
          </div>

          {/* Kids */}
          <div>
            <label className={labelCls}>Kids covered by this override</label>
            <p className="text-[11px] text-[var(--text-faint)] mb-2">
              Pre-selected based on which kids' default custody during these
              dates differs from {proposingParentName}.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {conflictKids.map((kid) => {
                const sel = selectedKidIds.includes(kid.id);
                return (
                  <button
                    key={kid.id}
                    type="button"
                    onClick={() => toggleKid(kid.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border"
                    style={{
                      backgroundColor: sel ? kidColorCss(kid.color) : "var(--bg)",
                      borderColor: sel ? kidColorCss(kid.color) : "var(--border)",
                      color: sel ? "#ffffff" : "var(--text-muted)",
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: sel ? "#ffffff" : kidColorCss(kid.color) }}
                    />
                    {kid.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reason / note */}
          <div>
            <label className={labelCls}>Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={inputCls + " resize-none"}
              placeholder="Reason for the override"
            />
          </div>

          {error && (
            <div
              className="text-xs rounded-sm p-2.5 border"
              style={{
                color: "var(--accent-red)",
                background: "var(--accent-red-tint)",
                borderColor:
                  "color-mix(in srgb, var(--accent-red) 30%, transparent)",
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-strong)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--ink)] text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || selectedKidIds.length === 0}
            className="px-5 py-2 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit for approval"}
          </button>
        </div>
      </div>
    </div>
  );
}

