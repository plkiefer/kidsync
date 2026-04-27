"use client";

import { useState } from "react";
import { Plane, X, Plus, Trash2 } from "lucide-react";
import {
  Kid,
  Profile,
  Trip,
  TripGuest,
  TripType,
} from "@/lib/types";
import type { NewTripInput } from "@/hooks/useTrips";
import { kidColorCss } from "@/lib/palette";

interface TripCreationModalProps {
  kids: Kid[];
  members: Profile[];
  /** UUID of the current user — pre-selected on the parent roster. */
  currentUserId?: string;
  initialTitle?: string;
  /** Closes the modal without creating. */
  onClose: () => void;
  /** Creates the trip; returns the new trip so parent can navigate
   *  into Trip View immediately. */
  onCreate: (input: NewTripInput) => Promise<Trip | null>;
  /** Called after successful create with the new trip. */
  onCreated?: (trip: Trip) => void;
}

const TRIP_TYPES: { value: TripType; label: string; icon: string }[] = [
  { value: "vacation", label: "Vacation", icon: "🌴" },
  { value: "custody_time", label: "Custody Time", icon: "👨‍👧" },
  { value: "visit_family", label: "Visit Family", icon: "🏡" },
  { value: "business", label: "Business", icon: "💼" },
  { value: "other", label: "Other", icon: "✈️" },
];

const inputCls =
  "w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors";

const labelCls =
  "block text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em] mb-1.5";

/**
 * Minimal trip-creation modal per plan §4.2. Captures only:
 *   - title
 *   - trip type
 *   - roster (kids + parents)
 *   - guests (optional, with relationship + contact for POC)
 *
 * Dates auto-derive from segments later, so they're not collected
 * here. Saving creates a draft trip; the parent should drop the
 * user into Trip View afterward to start adding segments.
 */
export default function TripCreationModal({
  kids,
  members,
  currentUserId,
  initialTitle = "",
  onClose,
  onCreate,
  onCreated,
}: TripCreationModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [tripType, setTripType] = useState<TripType>("vacation");
  const [kidIds, setKidIds] = useState<string[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>(
    currentUserId ? [currentUserId] : []
  );
  const [guests, setGuests] = useState<TripGuest[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleKid = (id: string) =>
    setKidIds((prev) =>
      prev.includes(id) ? prev.filter((k) => k !== id) : [...prev, id]
    );
  const toggleMember = (id: string) =>
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );

  const addGuest = () =>
    setGuests((prev) => [
      ...prev,
      {
        id: `guest_${Math.random().toString(36).slice(2, 10)}`,
        name: "",
        relationship: "",
        phone: "",
        email: "",
      },
    ]);
  const updateGuest = (idx: number, patch: Partial<TripGuest>) =>
    setGuests((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, ...patch } : g))
    );
  const removeGuest = (idx: number) =>
    setGuests((prev) => prev.filter((_, i) => i !== idx));

  const handleCreate = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    const trip = await onCreate({
      title: title.trim(),
      trip_type: tripType,
      kid_ids: kidIds,
      member_ids: memberIds,
      // Strip guests with empty names — they're an artifact of
      // clicking "Add guest" without filling anything in.
      guests: guests.filter((g) => g.name.trim()),
    });
    setSaving(false);
    if (!trip) {
      setError("Failed to create trip.");
      return;
    }
    onCreated?.(trip);
  };

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
          <Plane className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="font-display text-base font-semibold text-[var(--ink)] flex-1">
            New trip
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Title */}
          <div>
            <label className={labelCls}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Yellowstone 2026"
              autoFocus
              className={inputCls}
            />
          </div>

          {/* Type */}
          <div>
            <label className={labelCls}>Type</label>
            <div className="flex flex-wrap gap-1.5">
              {TRIP_TYPES.map(({ value, label, icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTripType(value)}
                  className={`
                    inline-flex items-center gap-1 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border
                    ${
                      tripType === value
                        ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                        : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
                    }
                  `}
                >
                  <span aria-hidden>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Roster — kids */}
          {kids.length > 0 && (
            <div>
              <label className={labelCls}>Kids on the trip</label>
              <div className="flex flex-wrap gap-1.5">
                {kids.map((kid) => {
                  const selected = kidIds.includes(kid.id);
                  return (
                    <button
                      key={kid.id}
                      type="button"
                      onClick={() => toggleKid(kid.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border"
                      style={{
                        backgroundColor: selected ? kidColorCss(kid.color) : "var(--bg)",
                        borderColor: selected ? kidColorCss(kid.color) : "var(--border)",
                        color: selected ? "#ffffff" : "var(--text-muted)",
                      }}
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: selected ? "#ffffff" : kidColorCss(kid.color),
                        }}
                      />
                      {kid.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Roster — parents */}
          {members.length > 0 && (
            <div>
              <label className={labelCls}>Parents on the trip</label>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => {
                  const selected = memberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMember(m.id)}
                      className={`
                        inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border
                        ${
                          selected
                            ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                            : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)]"
                        }
                      `}
                    >
                      {m.full_name || m.email}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Guests */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className={labelCls + " mb-0"}>Guests (optional)</label>
              <button
                type="button"
                onClick={addGuest}
                className="text-[11px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] inline-flex items-center gap-1"
              >
                <Plus size={12} /> Add guest
              </button>
            </div>
            {guests.length === 0 ? (
              <p className="text-[11px] text-[var(--text-faint)]">
                Non-family travelers (grandparents, friends). Useful as
                point-of-contact info while you're on the trip.
              </p>
            ) : (
              <div className="space-y-2.5">
                {guests.map((g, i) => (
                  <div
                    key={g.id}
                    className="border border-[var(--border)] rounded-sm p-2.5 bg-[var(--bg-sunken)] space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={g.name}
                        onChange={(e) =>
                          updateGuest(i, { name: e.target.value })
                        }
                        placeholder="Name"
                        className={inputCls + " flex-1"}
                      />
                      <button
                        type="button"
                        onClick={() => removeGuest(i)}
                        className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
                        aria-label="Remove guest"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={g.relationship}
                        onChange={(e) =>
                          updateGuest(i, { relationship: e.target.value })
                        }
                        placeholder="Relationship (e.g. grandmother)"
                        className={inputCls}
                      />
                      <input
                        value={g.phone || ""}
                        onChange={(e) =>
                          updateGuest(i, { phone: e.target.value })
                        }
                        placeholder="Phone"
                        className={inputCls}
                      />
                    </div>
                    <input
                      value={g.email || ""}
                      onChange={(e) =>
                        updateGuest(i, { email: e.target.value })
                      }
                      placeholder="Email (optional)"
                      className={inputCls}
                    />
                  </div>
                ))}
              </div>
            )}
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
            onClick={handleCreate}
            disabled={saving || !title.trim()}
            className="px-5 py-2 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Creating…" : "Create trip"}
          </button>
        </div>
      </div>
    </div>
  );
}
