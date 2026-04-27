"use client";

import { useState, useMemo } from "react";
import { X, Ship, Plus, Trash2, MapPin } from "lucide-react";
import {
  CalendarEvent,
  Kid,
  Profile,
  Trip,
  CruiseCabin,
  CruiseSegmentData,
  CruisePortStopSegmentData,
  isCruiseSegment,
  isCruisePortStopSegment,
} from "@/lib/types";
import {
  getBrowserTimezone,
  localTimeToUtc,
  utcToLocalTimeString,
} from "@/lib/timezones";
import { toDateTimeLocal } from "@/lib/dates";
import TimezonePicker from "@/components/TimezonePicker";
import type { NewSegmentInput } from "@/hooks/useEvents";
import { kidColorCss } from "@/lib/palette";

interface CruiseFormProps {
  trip: Trip;
  /** The cruise body segment if editing. Null = creating. */
  cruise?: CalendarEvent | null;
  /** All trip segments — used to load this cruise's existing port
   *  stops by parent_segment_id. Pass via parent. */
  allSegments: CalendarEvent[];
  kids: Kid[];
  members: Profile[];
  onClose: () => void;
  /** Save callback. Parent does the actual create+linkage:
   *  1. Create/update cruise body, get back its id.
   *  2. Diff port stops against existing — create new, update edited,
   *     delete removed (linking via parent_segment_id).
   *  3. Recompute trip dates. */
  onSave: (input: CruiseSaveInput) => Promise<void>;
}

export interface CruisePortStopDraft {
  /** Existing event id when editing; undefined for newly-added stops. */
  id?: string;
  port: string;
  arrival_local: string; // datetime-local string
  arrival_timezone: string;
  departure_local: string;
  departure_timezone: string;
  tender: boolean;
  notes: string;
}

export interface CruiseSaveInput {
  body: NewSegmentInput; // segment_type='cruise'
  /** Port stops in their final form. Parent diffs against the
   *  existing set in `cruise`'s scope. */
  portStops: CruisePortStopDraft[];
  /** Existing port-stop ids that the user removed — parent should
   *  delete these from calendar_events. */
  removedPortStopIds: string[];
}

const inputCls =
  "w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors";
const labelCls =
  "block text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em] mb-1.5";

function genCabinId(): string {
  return `cabin_${Math.random().toString(36).slice(2, 10)}`;
}

interface CabinDraft extends CruiseCabin {
  /** Local-only id so React can key the cabin row even before
   *  it's persisted; not stored in the DB. */
  _localId: string;
}

export default function CruiseForm({
  trip,
  cruise,
  allSegments,
  kids,
  members,
  onClose,
  onSave,
}: CruiseFormProps) {
  const isEdit = !!cruise;
  const browserTz = getBrowserTimezone();

  const initial = cruise && isCruiseSegment(cruise) ? cruise.segment_data : null;

  // Existing port stops linked to this cruise body
  const existingPortStops = useMemo(() => {
    if (!cruise) return [];
    return allSegments.filter(
      (s) =>
        s.parent_segment_id === cruise.id &&
        isCruisePortStopSegment(s)
    );
  }, [cruise, allSegments]);

  // ── Cruise body state
  const [cruiseLine, setCruiseLine] = useState(initial?.cruise_line ?? "");
  const [shipName, setShipName] = useState(initial?.ship_name ?? "");
  const [confirmation, setConfirmation] = useState(initial?.confirmation ?? "");

  const [embarkPort, setEmbarkPort] = useState(initial?.embark_port ?? "");
  const [disembarkPort, setDisembarkPort] = useState(
    initial?.disembark_port ?? ""
  );
  const [embarkTimezone, setEmbarkTimezone] = useState(
    initial?.embark_timezone ?? browserTz
  );
  const [disembarkTimezone, setDisembarkTimezone] = useState(
    initial?.disembark_timezone ?? browserTz
  );

  // Default times: typical cruise embarks early afternoon, disembarks
  // morning of the last day.
  const defaultEmbark = new Date();
  defaultEmbark.setHours(15, 0, 0, 0);
  const defaultDisembark = new Date(
    defaultEmbark.getTime() + 7 * 24 * 3600 * 1000
  );
  defaultDisembark.setHours(8, 0, 0, 0);

  const [embarkTime, setEmbarkTime] = useState(() => {
    if (cruise?.starts_at) {
      return utcToLocalTimeString(
        new Date(cruise.starts_at),
        initial?.embark_timezone ?? browserTz
      );
    }
    return toDateTimeLocal(defaultEmbark);
  });
  const [disembarkTime, setDisembarkTime] = useState(() => {
    if (cruise?.ends_at) {
      return utcToLocalTimeString(
        new Date(cruise.ends_at),
        initial?.disembark_timezone ?? browserTz
      );
    }
    return toDateTimeLocal(defaultDisembark);
  });

  // ── Cabins
  const [cabins, setCabins] = useState<CabinDraft[]>(() => {
    if (initial?.cabins && initial.cabins.length > 0) {
      return initial.cabins.map((c) => ({ ...c, _localId: genCabinId() }));
    }
    return [];
  });

  // ── Port stops
  const [portStops, setPortStops] = useState<CruisePortStopDraft[]>(() =>
    existingPortStops.map((s) => {
      const data = (s.segment_data as CruisePortStopSegmentData) || {
        port: "",
      };
      return {
        id: s.id,
        port: data.port || "",
        arrival_local: utcToLocalTimeString(
          new Date(s.starts_at),
          data.arrival_timezone || browserTz
        ),
        arrival_timezone: data.arrival_timezone || browserTz,
        departure_local: utcToLocalTimeString(
          new Date(s.ends_at),
          data.departure_timezone || browserTz
        ),
        departure_timezone: data.departure_timezone || browserTz,
        tender: data.tender ?? false,
        notes: data.notes ?? "",
      };
    })
  );
  const [removedPortStopIds, setRemovedPortStopIds] = useState<string[]>([]);

  // ── Roster (defaults to trip roster)
  const [memberIds, setMemberIds] = useState<string[]>(
    cruise?.member_ids ?? trip.member_ids
  );
  const [kidIds, setKidIds] = useState<string[]>(
    cruise?.kid_ids ?? trip.kid_ids
  );
  const [guestIds, setGuestIds] = useState<string[]>(
    cruise?.guest_ids ?? trip.guests.map((g) => g.id)
  );

  const [notes, setNotes] = useState<string>(cruise?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleId = (
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string
  ) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  // ── Cabin helpers
  const addCabin = () =>
    setCabins((prev) => [
      ...prev,
      {
        _localId: genCabinId(),
        number: "",
        occupants_kid_ids: [],
        occupants_member_ids: [],
        occupants_guest_ids: [],
      },
    ]);
  const updateCabin = (idx: number, patch: Partial<CabinDraft>) =>
    setCabins((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    );
  const removeCabin = (idx: number) =>
    setCabins((prev) => prev.filter((_, i) => i !== idx));
  const toggleCabinOccupant = (
    idx: number,
    field: "occupants_kid_ids" | "occupants_member_ids" | "occupants_guest_ids",
    id: string
  ) =>
    setCabins((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const list = c[field];
        return {
          ...c,
          [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
        };
      })
    );

  // ── Port stop helpers
  const addPortStop = () =>
    setPortStops((prev) => [
      ...prev,
      {
        port: "",
        arrival_local: toDateTimeLocal(new Date()),
        arrival_timezone: embarkTimezone,
        departure_local: toDateTimeLocal(
          new Date(Date.now() + 8 * 3600 * 1000)
        ),
        departure_timezone: embarkTimezone,
        tender: false,
        notes: "",
      },
    ]);
  const updatePortStop = (idx: number, patch: Partial<CruisePortStopDraft>) =>
    setPortStops((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  const removePortStop = (idx: number) => {
    const stop = portStops[idx];
    if (stop.id) {
      setRemovedPortStopIds((prev) => [...prev, stop.id!]);
    }
    setPortStops((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    setError(null);
    if (!shipName.trim() && !cruiseLine.trim()) {
      setError("Cruise line or ship name is required.");
      return;
    }
    if (!embarkTime || !disembarkTime) {
      setError("Embark and disembark times are required.");
      return;
    }
    setSaving(true);
    try {
      const startsAt = localTimeToUtc(embarkTime, embarkTimezone).toISOString();
      const endsAt = localTimeToUtc(
        disembarkTime,
        disembarkTimezone
      ).toISOString();
      if (endsAt <= startsAt) {
        setError("Disembark must be after embark.");
        setSaving(false);
        return;
      }

      // Strip _localId from cabins before persisting
      const cabinsForSave: CruiseCabin[] = cabins
        .filter((c) => c.number.trim().length > 0 || c.occupants_kid_ids.length > 0 || c.occupants_member_ids.length > 0 || c.occupants_guest_ids.length > 0)
        .map(({ _localId, ...rest }) => {
          void _localId;
          return rest;
        });

      const segmentData: CruiseSegmentData = {
        cruise_line: cruiseLine.trim(),
        ship_name: shipName.trim(),
        confirmation: confirmation.trim() || undefined,
        embark_port: embarkPort.trim(),
        embark_timezone: embarkTimezone,
        disembark_port: disembarkPort.trim() || embarkPort.trim(),
        disembark_timezone: disembarkTimezone,
        cabins: cabinsForSave,
      };

      const title =
        [shipName.trim(), cruiseLine.trim()].filter(Boolean).join(" · ") ||
        "Cruise";

      const body: NewSegmentInput = {
        trip_id: trip.id,
        segment_type: "cruise",
        segment_data: segmentData,
        title,
        starts_at: startsAt,
        ends_at: endsAt,
        time_zone: embarkTimezone,
        all_day: false,
        kid_ids: kidIds,
        member_ids: memberIds,
        guest_ids: guestIds,
        notes: notes.trim() || null,
      };

      // Drop port stops with empty port name — they're empty rows the
      // user added but didn't fill out.
      const cleanPortStops = portStops.filter((s) => s.port.trim());

      await onSave({
        body,
        portStops: cleanPortStops,
        removedPortStopIds,
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const tripKids = kids.filter((k) => trip.kid_ids.includes(k.id));
  const tripMembers = members.filter((m) => trip.member_ids.includes(m.id));
  const tripGuests = trip.guests;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-lg sm:max-h-[92vh] max-h-[90vh] flex flex-col border-t sm:border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-[var(--border-strong)]">
          <Ship className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="font-display text-base font-semibold text-[var(--ink)] flex-1">
            {isEdit ? "Edit cruise" : "Add cruise"}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Cruise basics */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Cruise line</label>
                <input
                  value={cruiseLine}
                  onChange={(e) => setCruiseLine(e.target.value)}
                  placeholder="Royal Caribbean"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Ship</label>
                <input
                  value={shipName}
                  onChange={(e) => setShipName(e.target.value)}
                  placeholder="Allure of the Seas"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Confirmation</label>
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="ABC123"
                className={inputCls}
              />
            </div>
          </div>

          {/* Embark */}
          <div className="border-t border-[var(--border)] pt-4 space-y-2">
            <label className={labelCls}>Embark port</label>
            <input
              value={embarkPort}
              onChange={(e) => setEmbarkPort(e.target.value)}
              placeholder="Miami, FL"
              className={inputCls}
            />
            <input
              type="datetime-local"
              value={embarkTime}
              onChange={(e) => setEmbarkTime(e.target.value)}
              className={inputCls}
            />
            <TimezonePicker
              value={embarkTimezone}
              onChange={setEmbarkTimezone}
              compact
            />
          </div>

          {/* Disembark */}
          <div className="border-t border-[var(--border)] pt-4 space-y-2">
            <label className={labelCls}>Disembark port</label>
            <input
              value={disembarkPort}
              onChange={(e) => setDisembarkPort(e.target.value)}
              placeholder="Miami, FL (or different for one-way cruises)"
              className={inputCls}
            />
            <input
              type="datetime-local"
              value={disembarkTime}
              onChange={(e) => setDisembarkTime(e.target.value)}
              className={inputCls}
            />
            <TimezonePicker
              value={disembarkTimezone}
              onChange={setDisembarkTimezone}
              compact
            />
          </div>

          {/* Cabins */}
          <div className="border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + " mb-0"}>Cabins</label>
              <button
                type="button"
                onClick={addCabin}
                className="text-[11px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] inline-flex items-center gap-1"
              >
                <Plus size={12} /> Add cabin
              </button>
            </div>
            {cabins.length === 0 ? (
              <p className="text-[11px] text-[var(--text-faint)]">
                Optional. Track who's sleeping in which cabin (parents +
                kids in one, grandparents in another) for safety reference.
              </p>
            ) : (
              <div className="space-y-3">
                {cabins.map((cabin, i) => (
                  <div
                    key={cabin._localId}
                    className="border border-[var(--border)] rounded-sm p-2.5 bg-[var(--bg-sunken)] space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={cabin.number}
                        onChange={(e) =>
                          updateCabin(i, { number: e.target.value })
                        }
                        placeholder="Cabin number"
                        className={inputCls + " flex-1"}
                      />
                      <button
                        type="button"
                        onClick={() => removeCabin(i)}
                        className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
                        aria-label="Remove cabin"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tripMembers.map((m) => {
                        const sel = cabin.occupants_member_ids.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() =>
                              toggleCabinOccupant(
                                i,
                                "occupants_member_ids",
                                m.id
                              )
                            }
                            className={`
                              inline-flex items-center px-2 py-1 rounded-sm text-[10.5px] font-semibold transition-colors border
                              ${
                                sel
                                  ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                                  : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"
                              }
                            `}
                          >
                            {m.full_name?.split(" ")[0] || m.email}
                          </button>
                        );
                      })}
                      {tripKids.map((k) => {
                        const sel = cabin.occupants_kid_ids.includes(k.id);
                        return (
                          <button
                            key={k.id}
                            type="button"
                            onClick={() =>
                              toggleCabinOccupant(
                                i,
                                "occupants_kid_ids",
                                k.id
                              )
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[10.5px] font-semibold transition-colors border"
                            style={{
                              backgroundColor: sel ? kidColorCss(k.color) : "var(--bg)",
                              borderColor: sel ? kidColorCss(k.color) : "var(--border)",
                              color: sel ? "#ffffff" : "var(--text-muted)",
                            }}
                          >
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full"
                              style={{
                                backgroundColor: sel ? "#ffffff" : kidColorCss(k.color),
                              }}
                            />
                            {k.name}
                          </button>
                        );
                      })}
                      {tripGuests.map((g) => {
                        const sel = cabin.occupants_guest_ids.includes(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() =>
                              toggleCabinOccupant(
                                i,
                                "occupants_guest_ids",
                                g.id
                              )
                            }
                            className={`
                              inline-flex items-center px-2 py-1 rounded-sm text-[10.5px] font-semibold transition-colors border
                              ${
                                sel
                                  ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                                  : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"
                              }
                            `}
                          >
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Port stops */}
          <div className="border-t border-[var(--border)] pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + " mb-0 flex items-center gap-1"}>
                <MapPin size={12} /> Port stops
              </label>
              <button
                type="button"
                onClick={addPortStop}
                className="text-[11px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] inline-flex items-center gap-1"
              >
                <Plus size={12} /> Add port
              </button>
            </div>
            {portStops.length === 0 ? (
              <p className="text-[11px] text-[var(--text-faint)]">
                Each stop renders as a sub-ribbon under the cruise on its
                day. Useful for "where's the ship today" reference and
                showing arrival/departure times.
              </p>
            ) : (
              <div className="space-y-3">
                {portStops.map((stop, i) => (
                  <div
                    key={stop.id ?? `new-${i}`}
                    className="border border-[var(--border)] rounded-sm p-2.5 bg-[var(--bg-sunken)] space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={stop.port}
                        onChange={(e) =>
                          updatePortStop(i, { port: e.target.value })
                        }
                        placeholder="Port (e.g. Cozumel, MX)"
                        className={inputCls + " flex-1"}
                      />
                      <button
                        type="button"
                        onClick={() => removePortStop(i)}
                        className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
                        aria-label="Remove port stop"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[9.5px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.1em] mb-1">
                          Arrives
                        </label>
                        <input
                          type="datetime-local"
                          value={stop.arrival_local}
                          onChange={(e) =>
                            updatePortStop(i, { arrival_local: e.target.value })
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-[9.5px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.1em] mb-1">
                          Departs
                        </label>
                        <input
                          type="datetime-local"
                          value={stop.departure_local}
                          onChange={(e) =>
                            updatePortStop(i, {
                              departure_local: e.target.value,
                            })
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <TimezonePicker
                      value={stop.arrival_timezone}
                      onChange={(tz) =>
                        updatePortStop(i, {
                          arrival_timezone: tz,
                          departure_timezone: tz,
                        })
                      }
                      compact
                      label="Port timezone"
                    />
                    <label className="flex items-center gap-2 text-[11px] text-[var(--text)]">
                      <input
                        type="checkbox"
                        checked={stop.tender}
                        onChange={(e) =>
                          updatePortStop(i, { tender: e.target.checked })
                        }
                      />
                      Tender boat to shore (vs. docked)
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Roster */}
          <div className="border-t border-[var(--border)] pt-4">
            <label className={labelCls}>Who's on the cruise</label>
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
                          : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"
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
                      style={{
                        backgroundColor: sel ? "#ffffff" : kidColorCss(k.color),
                      }}
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
                          : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)]"
                      }
                    `}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls + " resize-none"}
              placeholder="Optional"
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

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-strong)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--ink)] text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : isEdit ? "Save" : "Add cruise"}
          </button>
        </div>
      </div>
    </div>
  );
}
