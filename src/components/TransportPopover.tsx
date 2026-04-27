"use client";

import {
  X,
  Plane,
  Car,
  Train,
  Ship,
  Clock,
  Hash,
  Pencil,
  Trash2,
  ArrowRight,
} from "lucide-react";
import {
  CalendarEvent,
  Kid,
  Profile,
  TripGuest,
  isFlightSegment,
  isDriveSegment,
  isTrainSegment,
  isFerrySegment,
} from "@/lib/types";
import { formatTimeInZone, getBrowserTimezone } from "@/lib/timezones";
import { formatShortDate } from "@/lib/dates";
import { kidColorCss } from "@/lib/palette";

interface TransportPopoverProps {
  /** The transport segment to display. Must be flight / drive /
   *  train / ferry — cruise body still routes to the full Trip View
   *  since it has cabins + port stops that don't fit a popover. */
  segment: CalendarEvent;
  kids: Kid[];
  members: Profile[];
  /** Trip guests so we can resolve guest_ids to names. */
  guests: TripGuest[];
  onClose: () => void;
  /** Open the editor for this segment. Closes the popover first. */
  onEdit: () => void;
  /** Delete this segment. Closes popover after delete. */
  onDelete: () => void;
  /** Optional "View trip" action — only wired from the calendar
   *  click router so the user can jump from a flight chip to the
   *  full TripView when they want it. Hidden in TripView itself
   *  (we're already there). */
  onViewTrip?: () => void;
}

/**
 * Read-only details view for a transport segment.
 *
 * Mirrors LodgingPopover and PortStopPopover. The TripView transport
 * row + the calendar's flight chip both intentionally show only the
 * minimum (route + time). Click → this popover, which surfaces
 * confirmation #, seats, terminals, who's on, etc — everything
 * useful at the airport without dropping the user into the full
 * editing UI.
 */
export default function TransportPopover({
  segment,
  kids,
  members,
  guests,
  onClose,
  onEdit,
  onDelete,
  onViewTrip,
}: TransportPopoverProps) {
  const meta = pickMeta(segment);
  if (!meta) return null;

  const { typeLabel, Icon, headline, subhead } = meta;

  // Departure / arrival times use each leg's stored timezone where
  // available (per-leg TZ feature) and fall back to the browser zone.
  const depTz = pickDepartureTz(segment);
  const arrTz = pickArrivalTz(segment);
  const depDate = new Date(segment.starts_at);
  const arrDate = new Date(segment.ends_at);
  const depDateLabel = formatShortDate(segment.starts_at);
  const arrDateLabel = formatShortDate(segment.ends_at);
  const depTime = formatTimeInZone(depDate, depTz);
  const arrTime = formatTimeInZone(arrDate, arrTz);
  const sameDay = depDateLabel === arrDateLabel;

  // Roster lookup
  const onMembers = members.filter((m) =>
    (segment.member_ids ?? []).includes(m.id)
  );
  const onKids = kids.filter((k) => (segment.kid_ids ?? []).includes(k.id));
  const onGuests = guests.filter((g) =>
    (segment.guest_ids ?? []).includes(g.id)
  );

  // Type-specific detail rows
  const detailRows = renderDetailRows(segment);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full sm:max-w-sm flex flex-col border-t sm:border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <Icon className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {typeLabel}
            </div>
            <h3 className="text-[14px] font-semibold text-[var(--ink)] truncate">
              {headline}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--ink)]"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3 text-[12px]">
          {/* Route */}
          {subhead && (
            <div className="text-[var(--ink)] font-medium">{subhead}</div>
          )}

          {/* Times — show date once if both ends are the same day,
              otherwise show full date on each side. */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-[var(--text-muted)] shrink-0" />
              {sameDay ? (
                <span className="text-[var(--ink)] tabular-nums">
                  {depDateLabel} {depTime} → {arrTime}
                </span>
              ) : (
                <span className="text-[var(--ink)] tabular-nums">
                  {depDateLabel} {depTime} → {arrDateLabel} {arrTime}
                </span>
              )}
            </div>
            {(depTz !== arrTz) && (
              <div className="text-[10.5px] text-[var(--text-faint)] pl-[18px]">
                {depTz} → {arrTz}
              </div>
            )}
          </div>

          {/* Type-specific detail rows */}
          {detailRows.length > 0 && (
            <div className="border-t border-[var(--border)] pt-3 space-y-1.5">
              {detailRows.map((row, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  {row.icon && (
                    <span className="text-[var(--text-muted)] shrink-0 mt-0.5">
                      {row.icon}
                    </span>
                  )}
                  <div className="flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                      {row.label}
                    </div>
                    <div className="text-[var(--ink)] tabular-nums">
                      {row.value}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Roster */}
          {(onMembers.length > 0 ||
            onKids.length > 0 ||
            onGuests.length > 0) && (
            <div className="border-t border-[var(--border)] pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] mb-1.5">
                Who's on
              </div>
              <div className="flex flex-wrap gap-1">
                {onMembers.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[var(--bg-sunken)] text-[10.5px] font-medium text-[var(--ink)]"
                  >
                    {m.full_name?.split(" ")[0] || m.email}
                  </span>
                ))}
                {onKids.map((k) => (
                  <span
                    key={k.id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10.5px] font-bold text-white"
                    style={{ backgroundColor: kidColorCss(k.color) }}
                  >
                    {k.name}
                  </span>
                ))}
                {onGuests.map((g) => (
                  <span
                    key={g.id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[var(--bg-sunken)] text-[10.5px] text-[var(--text-muted)]"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2">
          {onViewTrip && (
            <button
              onClick={onViewTrip}
              className="text-[12px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] transition-colors mr-auto"
            >
              View trip →
            </button>
          )}
          <div className={`flex items-center gap-2 ${onViewTrip ? "" : "ml-auto"}`}>
            <button
              onClick={() => {
                if (confirm("Remove this segment?")) {
                  onDelete();
                }
              }}
              className="px-2.5 py-1.5 inline-flex items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors"
            >
              <Trash2 size={12} />
              Delete
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold bg-[var(--ink)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] transition-colors"
            >
              <Pencil size={12} />
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────

interface PopoverMeta {
  typeLabel: string;
  Icon: typeof Plane;
  /** Big bold line under the type label — carrier + flight number,
   *  vehicle details, etc. Falls back to segment.title. */
  headline: string;
  /** Smaller medium line — usually the route. */
  subhead: string;
}

function pickMeta(segment: CalendarEvent): PopoverMeta | null {
  if (isFlightSegment(segment)) {
    const d = segment.segment_data;
    const carrierLine = [d.carrier, d.flight_number].filter(Boolean).join(" ");
    return {
      typeLabel: "Flight",
      Icon: Plane,
      headline: carrierLine || segment.title || "Flight",
      subhead: [d.departure_airport, d.arrival_airport]
        .filter(Boolean)
        .join(" → "),
    };
  }
  if (isDriveSegment(segment)) {
    const d = segment.segment_data;
    return {
      typeLabel: "Drive",
      Icon: Car,
      headline:
        d.vehicle_details ||
        labelFromVehicleType(d.vehicle_type) ||
        segment.title ||
        "Drive",
      subhead: [d.from_location, d.to_location].filter(Boolean).join(" → "),
    };
  }
  if (isTrainSegment(segment)) {
    const d = segment.segment_data;
    const carrierLine = [d.carrier, d.train_number].filter(Boolean).join(" ");
    return {
      typeLabel: "Train",
      Icon: Train,
      headline: carrierLine || segment.title || "Train",
      subhead: [d.origin_station, d.destination_station]
        .filter(Boolean)
        .join(" → "),
    };
  }
  if (isFerrySegment(segment)) {
    const d = segment.segment_data;
    const carrierLine = [d.carrier, d.vessel_name].filter(Boolean).join(" · ");
    return {
      typeLabel: "Ferry",
      Icon: Ship,
      headline: carrierLine || segment.title || "Ferry",
      subhead: [d.origin_terminal, d.destination_terminal]
        .filter(Boolean)
        .join(" → "),
    };
  }
  // Cruise body intentionally not handled here — it has cabins +
  // port stops that need the full Trip View. cruise_port_stop has
  // its own PortStopPopover.
  return null;
}

interface DetailRow {
  label: string;
  value: string;
  icon?: React.ReactNode;
}

function renderDetailRows(segment: CalendarEvent): DetailRow[] {
  const rows: DetailRow[] = [];
  const data = segment.segment_data as
    | undefined
    | Record<string, string | string[] | boolean | undefined>;
  if (!data) return rows;

  if (isFlightSegment(segment)) {
    const d = segment.segment_data;
    if (d.confirmation) {
      rows.push({
        label: "Confirmation",
        value: d.confirmation,
        icon: <Hash size={12} />,
      });
    }
    if (d.seats && d.seats.length > 0) {
      rows.push({ label: "Seats", value: d.seats.join(", ") });
    }
    if (d.departure_terminal || d.arrival_terminal) {
      const dep = d.departure_terminal ? `Dep T${d.departure_terminal}` : "";
      const arr = d.arrival_terminal ? `Arr T${d.arrival_terminal}` : "";
      rows.push({
        label: "Terminals",
        value: [dep, arr].filter(Boolean).join(" · "),
      });
    }
  } else if (isDriveSegment(segment)) {
    const d = segment.segment_data;
    rows.push({
      label: "Vehicle",
      value: labelFromVehicleType(d.vehicle_type) || "—",
    });
    if (d.rental_confirmation) {
      rows.push({
        label: "Rental confirmation",
        value: d.rental_confirmation,
        icon: <Hash size={12} />,
      });
    }
  } else if (isTrainSegment(segment)) {
    const d = segment.segment_data;
    if (d.confirmation) {
      rows.push({
        label: "Confirmation",
        value: d.confirmation,
        icon: <Hash size={12} />,
      });
    }
    if (d.seats && d.seats.length > 0) {
      rows.push({ label: "Seats", value: d.seats.join(", ") });
    }
  } else if (isFerrySegment(segment)) {
    const d = segment.segment_data;
    if (d.confirmation) {
      rows.push({
        label: "Confirmation",
        value: d.confirmation,
        icon: <Hash size={12} />,
      });
    }
    if (d.vehicle_aboard) {
      rows.push({ label: "Vehicle aboard", value: "Yes" });
    }
  }

  if (segment.notes) {
    rows.push({ label: "Notes", value: segment.notes });
  }

  return rows;
}

function labelFromVehicleType(t: string | undefined): string {
  switch (t) {
    case "personal":
      return "Personal vehicle";
    case "rental_car":
      return "Rental car";
    case "rideshare":
      return "Rideshare";
    case "other":
      return "Other";
    default:
      return "";
  }
}

function pickDepartureTz(segment: CalendarEvent): string {
  const d = segment.segment_data as
    | undefined
    | Record<string, string | undefined>;
  return (
    d?.departure_timezone ||
    d?.from_timezone ||
    d?.origin_timezone ||
    segment.time_zone ||
    getBrowserTimezone()
  );
}

function pickArrivalTz(segment: CalendarEvent): string {
  const d = segment.segment_data as
    | undefined
    | Record<string, string | undefined>;
  return (
    d?.arrival_timezone ||
    d?.to_timezone ||
    d?.destination_timezone ||
    segment.time_zone ||
    getBrowserTimezone()
  );
}

// Suppress unused-import warning for ArrowRight; we may use it later.
void ArrowRight;
