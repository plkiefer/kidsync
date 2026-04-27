"use client";

import { useState, useMemo } from "react";
import { X, Plane, Car, Train, Ship } from "lucide-react";
import {
  CalendarEvent,
  Kid,
  Profile,
  Trip,
  SegmentType,
  FlightSegmentData,
  DriveSegmentData,
  TrainSegmentData,
  FerrySegmentData,
  isFlightSegment,
  isDriveSegment,
  isTrainSegment,
  isFerrySegment,
} from "@/lib/types";
import {
  getBrowserTimezone,
  localTimeToUtc,
  utcToLocalTimeString,
} from "@/lib/timezones";
import { toDateTimeLocal } from "@/lib/dates";
import TimezonePicker from "@/components/TimezonePicker";
import type { NewSegmentInput } from "@/hooks/useEvents";

export type TransportKind = "flight" | "drive" | "train" | "ferry";

interface TransportFormProps {
  trip: Trip;
  type: TransportKind;
  /** Existing segment being edited; null = creating. */
  segment?: CalendarEvent | null;
  kids: Kid[];
  members: Profile[];
  /** Pre-fill values for "+ next day's drive" shortcut. */
  prefill?: {
    from_location?: string;
    from_timezone?: string;
    starts_at?: string; // datetime-local string in from_timezone
  };
  onClose: () => void;
  onSave: (input: NewSegmentInput) => Promise<void>;
  /** Drive-only chain shortcut. When set + drive type, an extra
   *  "Save & next leg" button appears that saves AND signals the
   *  parent to immediately open another drive form pre-filled
   *  with this drive's arrival info. Plan §6c (β). */
  onSaveAndChainDrive?: (justSavedInput: NewSegmentInput) => Promise<void>;
}

const inputCls =
  "w-full px-3 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors";
const labelCls =
  "block text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-[0.12em] mb-1.5";

const TYPE_META: Record<
  TransportKind,
  { icon: React.ReactNode; titleNew: string; titleEdit: string }
> = {
  flight: { icon: <Plane size={16} />, titleNew: "Add flight", titleEdit: "Edit flight" },
  drive: { icon: <Car size={16} />, titleNew: "Add drive", titleEdit: "Edit drive" },
  train: { icon: <Train size={16} />, titleNew: "Add train", titleEdit: "Edit train" },
  ferry: { icon: <Ship size={16} />, titleNew: "Add ferry", titleEdit: "Edit ferry" },
};

/**
 * Single form for all four common transport segment types. Shared
 * sections (origin/destination, dates+tz, roster, notes) plus a
 * type-specific Details block.
 *
 * Each transport row already has its own departure / arrival timezone
 * — see plan §6d, mirrors the existing per-leg-tz infrastructure on
 * FlightLeg in event_travel_details.
 */
export default function TransportForm({
  trip,
  type,
  segment,
  kids,
  members,
  prefill,
  onClose,
  onSave,
  onSaveAndChainDrive,
}: TransportFormProps) {
  const isEdit = !!segment;

  // ── Type-specific defaults
  const browserTz = getBrowserTimezone();

  // Generic shared fields, narrowed where possible
  const initial = useMemo(() => {
    if (!segment) {
      return null;
    }
    if (type === "flight" && isFlightSegment(segment)) return segment.segment_data;
    if (type === "drive" && isDriveSegment(segment)) return segment.segment_data;
    if (type === "train" && isTrainSegment(segment)) return segment.segment_data;
    if (type === "ferry" && isFerrySegment(segment)) return segment.segment_data;
    return null;
  }, [segment, type]);

  // ─── Flight-specific
  const [carrier, setCarrier] = useState<string>(
    (initial as Partial<FlightSegmentData | TrainSegmentData | FerrySegmentData>)?.carrier ?? ""
  );
  const [flightNumber, setFlightNumber] = useState<string>(
    (initial as Partial<FlightSegmentData>)?.flight_number ?? ""
  );
  const [seats, setSeats] = useState<string>(
    ((initial as Partial<FlightSegmentData | TrainSegmentData>)?.seats || []).join(", ")
  );
  const [confirmation, setConfirmation] = useState<string>(
    (initial as Partial<FlightSegmentData | TrainSegmentData | FerrySegmentData>)?.confirmation ?? ""
  );

  // Flight terminals / gates (optional)
  const [departureTerminal, setDepartureTerminal] = useState<string>(
    (initial as Partial<FlightSegmentData>)?.departure_terminal ?? ""
  );
  const [arrivalTerminal, setArrivalTerminal] = useState<string>(
    (initial as Partial<FlightSegmentData>)?.arrival_terminal ?? ""
  );

  // ─── Drive-specific
  const [vehicleType, setVehicleType] = useState<DriveSegmentData["vehicle_type"]>(
    (initial as Partial<DriveSegmentData>)?.vehicle_type ?? "personal"
  );
  const [vehicleDetails, setVehicleDetails] = useState<string>(
    (initial as Partial<DriveSegmentData>)?.vehicle_details ?? ""
  );
  const [rentalConfirmation, setRentalConfirmation] = useState<string>(
    (initial as Partial<DriveSegmentData>)?.rental_confirmation ?? ""
  );

  // ─── Train-specific
  const [trainNumber, setTrainNumber] = useState<string>(
    (initial as Partial<TrainSegmentData>)?.train_number ?? ""
  );

  // ─── Ferry-specific
  const [vesselName, setVesselName] = useState<string>(
    (initial as Partial<FerrySegmentData>)?.vessel_name ?? ""
  );
  const [vehicleAboard, setVehicleAboard] = useState<boolean>(
    (initial as Partial<FerrySegmentData>)?.vehicle_aboard ?? false
  );

  // ─── Origin / destination
  // Pull from segment_data; fall back to prefill (for drive shortcut)
  // and finally to empty.
  const initialFrom =
    (initial as Partial<FlightSegmentData>)?.departure_airport ??
    (initial as Partial<DriveSegmentData>)?.from_location ??
    (initial as Partial<TrainSegmentData>)?.origin_station ??
    (initial as Partial<FerrySegmentData>)?.origin_terminal ??
    prefill?.from_location ??
    "";
  const initialTo =
    (initial as Partial<FlightSegmentData>)?.arrival_airport ??
    (initial as Partial<DriveSegmentData>)?.to_location ??
    (initial as Partial<TrainSegmentData>)?.destination_station ??
    (initial as Partial<FerrySegmentData>)?.destination_terminal ??
    "";

  const [fromLocation, setFromLocation] = useState<string>(initialFrom);
  const [toLocation, setToLocation] = useState<string>(initialTo);

  // ─── Timezones
  const initialFromTz =
    (initial as Partial<FlightSegmentData>)?.departure_timezone ??
    (initial as Partial<DriveSegmentData>)?.from_timezone ??
    (initial as Partial<TrainSegmentData>)?.origin_timezone ??
    (initial as Partial<FerrySegmentData>)?.origin_timezone ??
    prefill?.from_timezone ??
    browserTz;
  const initialToTz =
    (initial as Partial<FlightSegmentData>)?.arrival_timezone ??
    (initial as Partial<DriveSegmentData>)?.to_timezone ??
    (initial as Partial<TrainSegmentData>)?.destination_timezone ??
    (initial as Partial<FerrySegmentData>)?.destination_timezone ??
    browserTz;

  const [fromTimezone, setFromTimezone] = useState<string>(initialFromTz);
  const [toTimezone, setToTimezone] = useState<string>(initialToTz);

  // ─── Dates
  const defaultStart = new Date();
  defaultStart.setHours(9, 0, 0, 0);
  const defaultEnd = new Date(defaultStart.getTime() + 3 * 3600 * 1000);

  const [departureTime, setDepartureTime] = useState<string>(() => {
    if (segment?.starts_at) {
      return utcToLocalTimeString(new Date(segment.starts_at), initialFromTz);
    }
    if (prefill?.starts_at) return prefill.starts_at;
    return toDateTimeLocal(defaultStart);
  });
  const [arrivalTime, setArrivalTime] = useState<string>(() => {
    if (segment?.ends_at) {
      return utcToLocalTimeString(new Date(segment.ends_at), initialToTz);
    }
    return toDateTimeLocal(defaultEnd);
  });

  // ─── Roster
  const [memberIds, setMemberIds] = useState<string[]>(
    segment?.member_ids ?? trip.member_ids
  );
  const [kidIds, setKidIds] = useState<string[]>(
    segment?.kid_ids ?? trip.kid_ids
  );
  const [guestIds, setGuestIds] = useState<string[]>(
    segment?.guest_ids ?? trip.guests.map((g) => g.id)
  );

  // ─── Misc
  const [notes, setNotes] = useState<string>(segment?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleId = (
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    id: string
  ) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const buildTitle = (): string => {
    if (segment?.title) return segment.title;
    const from = fromLocation.trim();
    const to = toLocation.trim();
    if (type === "flight") {
      const carrierStr = [carrier, flightNumber].filter(Boolean).join(" ").trim();
      const route = [from, to].filter(Boolean).join(" → ");
      return [carrierStr, route].filter(Boolean).join(" · ") || "Flight";
    }
    if (type === "drive") {
      const route = [from, to].filter(Boolean).join(" → ");
      return route ? `Drive: ${route}` : "Drive";
    }
    if (type === "train") {
      const route = [from, to].filter(Boolean).join(" → ");
      const carrierStr = [carrier, trainNumber].filter(Boolean).join(" ").trim();
      return [carrierStr, route].filter(Boolean).join(" · ") || "Train";
    }
    if (type === "ferry") {
      const route = [from, to].filter(Boolean).join(" → ");
      return [carrier, vesselName, route].filter(Boolean).join(" · ") || "Ferry";
    }
    return "Transport";
  };

  const buildSegmentData = (): NewSegmentInput["segment_data"] => {
    if (type === "flight") {
      const data: FlightSegmentData = {
        carrier: carrier.trim(),
        flight_number: flightNumber.trim(),
        departure_airport: fromLocation.trim(),
        arrival_airport: toLocation.trim(),
        departure_timezone: fromTimezone,
        arrival_timezone: toTimezone,
        confirmation: confirmation.trim() || undefined,
        seats: seats
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        departure_terminal: departureTerminal.trim() || undefined,
        arrival_terminal: arrivalTerminal.trim() || undefined,
      };
      return data;
    }
    if (type === "drive") {
      const data: DriveSegmentData = {
        vehicle_type: vehicleType,
        vehicle_details: vehicleDetails.trim() || undefined,
        rental_confirmation: rentalConfirmation.trim() || undefined,
        from_location: fromLocation.trim(),
        to_location: toLocation.trim(),
        from_timezone: fromTimezone,
        to_timezone: toTimezone,
      };
      return data;
    }
    if (type === "train") {
      const data: TrainSegmentData = {
        carrier: carrier.trim(),
        train_number: trainNumber.trim() || undefined,
        origin_station: fromLocation.trim(),
        destination_station: toLocation.trim(),
        origin_timezone: fromTimezone,
        destination_timezone: toTimezone,
        confirmation: confirmation.trim() || undefined,
        seats: seats
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
      return data;
    }
    // ferry
    const data: FerrySegmentData = {
      carrier: carrier.trim(),
      vessel_name: vesselName.trim() || undefined,
      origin_terminal: fromLocation.trim(),
      destination_terminal: toLocation.trim(),
      origin_timezone: fromTimezone,
      destination_timezone: toTimezone,
      confirmation: confirmation.trim() || undefined,
      vehicle_aboard: vehicleAboard,
    };
    return data;
  };

  const handleSave = async (chain = false) => {
    setError(null);
    if (!fromLocation.trim() && !toLocation.trim()) {
      setError("From or To location is required.");
      return;
    }
    if (!departureTime || !arrivalTime) {
      setError("Departure and arrival times are required.");
      return;
    }
    setSaving(true);
    try {
      const startsAt = localTimeToUtc(departureTime, fromTimezone).toISOString();
      const endsAt = localTimeToUtc(arrivalTime, toTimezone).toISOString();
      if (endsAt <= startsAt) {
        setError("Arrival must be after departure.");
        setSaving(false);
        return;
      }
      const segType: SegmentType =
        type === "flight"
          ? "flight"
          : type === "drive"
          ? "drive"
          : type === "train"
          ? "train"
          : "ferry";
      const input: NewSegmentInput = {
        trip_id: trip.id,
        segment_type: segType,
        segment_data: buildSegmentData(),
        title: buildTitle(),
        starts_at: startsAt,
        ends_at: endsAt,
        // The event's "main" time_zone anchors departure (the user's
        // primary frame for the event); arrival has its own tz inside
        // segment_data.
        time_zone: fromTimezone,
        all_day: false,
        kid_ids: kidIds,
        member_ids: memberIds,
        guest_ids: guestIds,
        notes: notes.trim() || null,
      };
      if (chain && onSaveAndChainDrive) {
        await onSaveAndChainDrive(input);
      } else {
        await onSave(input);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Roster context — what's available comes from trip
  const tripKids = kids.filter((k) => trip.kid_ids.includes(k.id));
  const tripMembers = members.filter((m) => trip.member_ids.includes(m.id));
  const tripGuests = trip.guests;

  const meta = TYPE_META[type];

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-md max-h-[92vh] flex flex-col border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-6 py-4 border-b border-[var(--border-strong)]">
          <span className="text-[var(--text-muted)]">{meta.icon}</span>
          <h2 className="font-display text-base font-semibold text-[var(--ink)] flex-1">
            {isEdit ? meta.titleEdit : meta.titleNew}
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
          {/* Type-specific details block */}
          {type === "flight" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Carrier</label>
                  <input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="AA"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Flight #</label>
                  <input
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    placeholder="123"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Confirmation</label>
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="ABC123"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Seats</label>
                  <input
                    value={seats}
                    onChange={(e) => setSeats(e.target.value)}
                    placeholder="12A, 12B"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          )}

          {type === "drive" && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Vehicle</label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["personal", "Personal"],
                      ["rental_car", "Rental"],
                      ["rideshare", "Rideshare"],
                      ["other", "Other"],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setVehicleType(val)}
                      className={`
                        inline-flex items-center px-2.5 py-1.5 rounded-sm text-[11px] font-semibold transition-colors border
                        ${
                          vehicleType === val
                            ? "bg-[var(--ink)] text-[var(--accent-ink)] border-[var(--ink)]"
                            : "bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--ink)]"
                        }
                      `}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Vehicle details</label>
                <input
                  value={vehicleDetails}
                  onChange={(e) => setVehicleDetails(e.target.value)}
                  placeholder="Hertz Toyota Camry"
                  className={inputCls}
                />
              </div>
              {vehicleType === "rental_car" && (
                <div>
                  <label className={labelCls}>Rental confirmation</label>
                  <input
                    value={rentalConfirmation}
                    onChange={(e) => setRentalConfirmation(e.target.value)}
                    placeholder="GH789"
                    className={inputCls}
                  />
                </div>
              )}
            </div>
          )}

          {type === "train" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Carrier</label>
                  <input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="Amtrak"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Train #</label>
                  <input
                    value={trainNumber}
                    onChange={(e) => setTrainNumber(e.target.value)}
                    placeholder="Acela 2123"
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Confirmation</label>
                  <input
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="JK012"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Seats</label>
                  <input
                    value={seats}
                    onChange={(e) => setSeats(e.target.value)}
                    placeholder="Car 5, seat 23"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          )}

          {type === "ferry" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Carrier</label>
                  <input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="WSF"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Vessel</label>
                  <input
                    value={vesselName}
                    onChange={(e) => setVesselName(e.target.value)}
                    placeholder="Cathlamet"
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Confirmation</label>
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder="..."
                  className={inputCls}
                />
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text)]">
                <input
                  type="checkbox"
                  checked={vehicleAboard}
                  onChange={(e) => setVehicleAboard(e.target.checked)}
                />
                Vehicle aboard
              </label>
            </div>
          )}

          {/* From / Departure */}
          <div className="border-t border-[var(--border)] pt-4 space-y-2">
            <label className={labelCls}>
              {type === "flight"
                ? "Departure airport"
                : type === "drive"
                ? "From"
                : type === "train"
                ? "Origin station"
                : "Origin terminal"}
            </label>
            <div className={type === "flight" ? "grid grid-cols-3 gap-2" : ""}>
              <input
                value={fromLocation}
                onChange={(e) => setFromLocation(e.target.value)}
                placeholder={
                  type === "flight"
                    ? "JFK"
                    : type === "drive"
                    ? "Bozeman, MT"
                    : type === "train"
                    ? "Washington Union Station"
                    : "Seattle (Colman Dock)"
                }
                className={inputCls + (type === "flight" ? " col-span-2" : "")}
              />
              {type === "flight" && (
                <input
                  value={departureTerminal}
                  onChange={(e) => setDepartureTerminal(e.target.value)}
                  placeholder="Terminal"
                  className={inputCls}
                />
              )}
            </div>
            <input
              type="datetime-local"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              className={inputCls}
            />
            <TimezonePicker
              value={fromTimezone}
              onChange={setFromTimezone}
              compact
            />
          </div>

          {/* To / Arrival */}
          <div className="border-t border-[var(--border)] pt-4 space-y-2">
            <label className={labelCls}>
              {type === "flight"
                ? "Arrival airport"
                : type === "drive"
                ? "To"
                : type === "train"
                ? "Destination station"
                : "Destination terminal"}
            </label>
            <div className={type === "flight" ? "grid grid-cols-3 gap-2" : ""}>
              <input
                value={toLocation}
                onChange={(e) => setToLocation(e.target.value)}
                placeholder={
                  type === "flight"
                    ? "HNL"
                    : type === "drive"
                    ? "Yellowstone"
                    : type === "train"
                    ? "New York Penn Station"
                    : "Bainbridge Island"
                }
                className={inputCls + (type === "flight" ? " col-span-2" : "")}
              />
              {type === "flight" && (
                <input
                  value={arrivalTerminal}
                  onChange={(e) => setArrivalTerminal(e.target.value)}
                  placeholder="Terminal"
                  className={inputCls}
                />
              )}
            </div>
            <input
              type="datetime-local"
              value={arrivalTime}
              onChange={(e) => setArrivalTime(e.target.value)}
              className={inputCls}
            />
            <TimezonePicker
              value={toTimezone}
              onChange={setToTimezone}
              compact
            />
          </div>

          {/* Roster — who's on this leg */}
          <div className="border-t border-[var(--border)] pt-4">
            <label className={labelCls}>Who's on this leg</label>
            <p className="text-[11px] text-[var(--text-faint)] mb-2">
              Defaults to the trip roster. Override for unaccompanied minors,
              grandparent escorts, or splitting up across legs.
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
                      backgroundColor: sel ? k.color : "var(--bg)",
                      borderColor: sel ? k.color : "var(--border)",
                      color: sel ? "#ffffff" : "var(--text-muted)",
                    }}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: sel ? "#ffffff" : k.color }}
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

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes (optional)"
              rows={2}
              className={inputCls + " resize-none"}
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
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-strong)] flex-wrap">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--text-muted)] hover:text-[var(--ink)] text-sm font-medium transition-colors"
          >
            Cancel
          </button>
          {type === "drive" && !isEdit && onSaveAndChainDrive && (
            <button
              onClick={() => handleSave(true)}
              disabled={saving}
              className="px-4 py-2 border border-[var(--border-strong)] text-[var(--ink)] text-sm font-medium hover:bg-[var(--bg-sunken)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Save and start a new drive form pre-filled from this drive's arrival"
            >
              Save & next leg
            </button>
          )}
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-5 py-2 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : isEdit ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
