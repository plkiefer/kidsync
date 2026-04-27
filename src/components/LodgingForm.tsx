"use client";

import { useState, useEffect } from "react";
import { X, MapPin } from "lucide-react";
import {
  CalendarEvent,
  Kid,
  Profile,
  Trip,
  TripGuest,
  LodgingSegmentData,
  isLodgingSegment,
} from "@/lib/types";
import {
  getBrowserTimezone,
  localTimeToUtc,
  utcToLocalTimeString,
} from "@/lib/timezones";
import { toDateTimeLocal } from "@/lib/dates";
import TimezonePicker from "@/components/TimezonePicker";
import { kidColorCss } from "@/lib/palette";

interface LodgingFormProps {
  trip: Trip;
  /** Existing lodging being edited; null = creating a new one. */
  lodging?: CalendarEvent | null;
  kids: Kid[];
  members: Profile[];
  /** Pre-fill city/state when adding a second lodging within an
   *  existing stay (e.g. "+ Add another lodging in this city"). */
  prefillCity?: { city: string; state: string; country: string };
  onClose: () => void;
  onSave: (data: NewLodgingInput) => Promise<void>;
}

export interface NewLodgingInput {
  /** Display title for the calendar event. Defaults to lodging name. */
  title: string;
  city: string;
  state: string;
  country: string;
  starts_at: string; // UTC ISO (check-in)
  ends_at: string; // UTC ISO (check-out)
  time_zone: string;
  segment_data: LodgingSegmentData;
  member_ids: string[];
  kid_ids: string[];
  guest_ids: string[];
  notes?: string;
}

const inputCls =
  "w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors";

const labelCls =
  "block text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em] mb-1.5";

/**
 * Lodging editor — city-first per plan §9e.
 *
 * Required to save: city + check-in date + check-out date.
 * Everything else (lodging name, address, phone, confirmation) can
 * be filled in later — supports the incremental-build principle.
 *
 * "Who's staying here" defaults to the trip's full roster but can
 * be narrowed (Hilton + Marriott split-lodging case from plan §5).
 */
export default function LodgingForm({
  trip,
  lodging,
  kids,
  members,
  prefillCity,
  onClose,
  onSave,
}: LodgingFormProps) {
  const isEdit = !!lodging;
  const tz = lodging?.time_zone || getBrowserTimezone();

  const existing = lodging && isLodgingSegment(lodging) ? lodging.segment_data : null;

  // Required-ish (but city is the only one without a sensible
  // default; everything else accepts blank).
  const [city, setCity] = useState(existing?.city || prefillCity?.city || "");
  const [state, setState] = useState(existing?.state || prefillCity?.state || "");
  const [country, setCountry] = useState(
    existing?.country || prefillCity?.country || ""
  );

  // Detail fields — all optional
  const [name, setName] = useState(existing?.name || "");
  const [address, setAddress] = useState(existing?.address || "");
  const [postalCode, setPostalCode] = useState(existing?.postal_code || "");
  const [phone, setPhone] = useState(existing?.phone || "");
  const [confirmation, setConfirmation] = useState(existing?.confirmation || "");

  // Dates + tz
  const defaultIn = new Date();
  defaultIn.setHours(15, 0, 0, 0); // 3pm typical hotel check-in
  const defaultOut = new Date(defaultIn.getTime() + 24 * 3600 * 1000);
  defaultOut.setHours(11, 0, 0, 0); // 11am typical check-out

  const [checkIn, setCheckIn] = useState<string>(() => {
    if (lodging?.starts_at) {
      return utcToLocalTimeString(new Date(lodging.starts_at), tz);
    }
    return toDateTimeLocal(defaultIn);
  });
  const [checkOut, setCheckOut] = useState<string>(() => {
    if (lodging?.ends_at) {
      return utcToLocalTimeString(new Date(lodging.ends_at), tz);
    }
    return toDateTimeLocal(defaultOut);
  });
  const [timeZone, setTimeZone] = useState<string>(tz);

  // Roster — defaults to trip roster (everyone is here unless
  // user narrows). Editing existing lodging picks up its specifics.
  const [memberIds, setMemberIds] = useState<string[]>(
    lodging?.member_ids ?? trip.member_ids
  );
  const [kidIds, setKidIds] = useState<string[]>(
    lodging?.kid_ids ?? trip.kid_ids
  );
  const [guestIds, setGuestIds] = useState<string[]>(
    lodging?.guest_ids ?? trip.guests.map((g) => g.id)
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-anchor times when timezone picker changes — user usually
  // wants the wall-clock to follow the destination zone.
  useEffect(() => {
    // No-op for now: keep the entered wall-clock as-is when the
    // user picks a different zone. They'll be re-interpreting the
    // existing hh:mm in the new zone on save. If we re-anchored
    // here, swapping zones would shift the visible time, which is
    // disorienting.
  }, [timeZone]);

  const toggleId = (
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string
  ) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleSave = async () => {
    setError(null);
    if (!city.trim()) {
      setError("City is required.");
      return;
    }
    if (!checkIn || !checkOut) {
      setError("Check-in and check-out dates are required.");
      return;
    }
    if (checkIn >= checkOut) {
      setError("Check-out must be after check-in.");
      return;
    }
    setSaving(true);
    try {
      const startsAt = localTimeToUtc(checkIn, timeZone).toISOString();
      const endsAt = localTimeToUtc(checkOut, timeZone).toISOString();
      await onSave({
        title: name.trim() || `${city.trim()} stay`,
        city: city.trim(),
        state: state.trim(),
        country: country.trim(),
        starts_at: startsAt,
        ends_at: endsAt,
        time_zone: timeZone,
        segment_data: {
          name: name.trim(),
          address: address.trim(),
          phone: phone.trim(),
          confirmation: confirmation.trim(),
          city: city.trim(),
          state: state.trim(),
          postal_code: postalCode.trim() || undefined,
          country: country.trim(),
        },
        member_ids: memberIds,
        kid_ids: kidIds,
        guest_ids: guestIds,
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Pull the trip's available roster (kids/parents/guests)
  const tripKids = kids.filter((k) => trip.kid_ids.includes(k.id));
  const tripMembers = members.filter((m) => trip.member_ids.includes(m.id));
  const tripGuests: TripGuest[] = trip.guests;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-md sm:max-h-[92vh] max-h-[90vh] flex flex-col border-t sm:border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-[var(--border-strong)]">
          <MapPin className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="font-display text-base font-semibold text-[var(--ink)] flex-1">
            {isEdit ? "Edit lodging" : "Add stay"}
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
          {/* City — first per plan §9e */}
          <div>
            <label className={labelCls}>City *</label>
            <div className="grid grid-cols-3 gap-2">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Honolulu"
                autoFocus
                className={inputCls + " col-span-2"}
              />
              <input
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="HI"
                className={inputCls}
              />
            </div>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Country (only needed for international)"
              className={inputCls + " mt-2"}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Check-in</label>
              <input
                type="datetime-local"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Check-out</label>
              <input
                type="datetime-local"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <TimezonePicker
            value={timeZone}
            onChange={setTimeZone}
            label="Time zone"
            compact
          />

          {/* Lodging details — all optional */}
          <div className="border-t border-[var(--border)] pt-5 space-y-3">
            <div className="text-[11px] text-[var(--text-faint)] -mb-1">
              Lodging details (can be filled in later)
            </div>
            <div>
              <label className={labelCls}>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hilton Hawaiian Village"
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className={labelCls}>Address</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="2005 Kalia Rd"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>ZIP</label>
                <input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="96815"
                  className={inputCls}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 808-949-4321"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Confirmation #</label>
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="ABC123"
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Who's staying here */}
          <div className="border-t border-[var(--border)] pt-5">
            <label className={labelCls}>Who's staying here</label>
            <p className="text-[11px] text-[var(--text-faint)] mb-2">
              Defaults to the full trip roster. Narrow to record split
              lodgings (e.g. parents at one hotel, grandparents at another).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {tripMembers.map((m) => {
                const sel = memberIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleId(memberIds, setMemberIds, m.id)}
                    className={`
                      inline-flex items-center px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border
                      ${
                        sel
                          ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                          : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)]"
                      }
                    `}
                  >
                    {m.full_name?.split(" ")[0] || m.email}
                  </button>
                );
              })}
              {tripKids.map((k) => {
                const sel = kidIds.includes(k.id);
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => toggleId(kidIds, setKidIds, k.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border"
                    style={{
                      backgroundColor: sel ? kidColorCss(k.color) : "var(--bg)",
                      borderColor: sel ? kidColorCss(k.color) : "var(--border)",
                      color: sel ? "#ffffff" : "var(--text-muted)",
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: sel ? "#ffffff" : kidColorCss(k.color) }}
                    />
                    {k.name}
                  </button>
                );
              })}
              {tripGuests.map((g) => {
                const sel = guestIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleId(guestIds, setGuestIds, g.id)}
                    className={`
                      inline-flex items-center px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border
                      ${
                        sel
                          ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                          : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)]"
                      }
                    `}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
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
            onClick={handleSave}
            disabled={saving || !city.trim()}
            className="px-5 py-2 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : isEdit ? "Save" : "Add stay"}
          </button>
        </div>
      </div>
    </div>
  );
}
