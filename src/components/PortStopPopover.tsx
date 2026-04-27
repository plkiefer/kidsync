"use client";

import { X, MapPin, Clock, Ship } from "lucide-react";
import { CalendarEvent, CruisePortStopSegmentData } from "@/lib/types";
import { formatTimeInZone, getBrowserTimezone } from "@/lib/timezones";
import { formatShortDate } from "@/lib/dates";

interface PortStopPopoverProps {
  /** The cruise_port_stop segment to display. */
  portStop: CalendarEvent;
  /** The cruise body — used for the "Cruise: X" subtitle. */
  cruise?: CalendarEvent;
  onClose: () => void;
  /** Open the parent trip in TripView for full editing. */
  onViewTrip: () => void;
}

/**
 * Lightweight popover for cruise port stops (plan §10c option ii).
 * Click a port-stop ribbon → tiny modal with arrival/departure + a
 * "View trip" link. Avoids dragging the user into the full Trip View
 * for what's usually just "where am I today" reference.
 *
 * Centered modal (not anchored to click position) — simpler than
 * positioning logic and the small content size makes anchoring
 * unnecessary in practice.
 */
export default function PortStopPopover({
  portStop,
  cruise,
  onClose,
  onViewTrip,
}: PortStopPopoverProps) {
  const data = portStop.segment_data as CruisePortStopSegmentData | null;
  const port = data?.port || portStop.title || "Port";
  const tz = data?.arrival_timezone || getBrowserTimezone();
  const arrivalDate = new Date(portStop.starts_at);
  const departureDate = new Date(portStop.ends_at);
  const date = formatShortDate(portStop.starts_at);
  const arrivalTime = formatTimeInZone(arrivalDate, tz);
  const departureTime = formatTimeInZone(
    departureDate,
    data?.departure_timezone || tz
  );

  const cruiseLabel =
    cruise && typeof cruise.segment_data === "object" && cruise.segment_data
      ? (() => {
          const d = cruise.segment_data as { ship_name?: string; cruise_line?: string };
          return d.ship_name || d.cruise_line || cruise.title || "Cruise";
        })()
      : cruise?.title || "Cruise";

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-xs flex flex-col border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <MapPin className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="text-[14px] font-semibold text-[var(--ink)] flex-1 truncate">
            {port}
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--ink)]"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-2 text-[12px]">
          <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <Ship size={12} className="shrink-0" />
            <span className="truncate">{cruiseLabel}</span>
          </div>
          <div className="text-[var(--text-faint)] tabular-nums">{date}</div>
          <div className="flex items-center gap-1.5 pt-1">
            <Clock size={12} className="text-[var(--text-muted)] shrink-0" />
            <span className="text-[var(--ink)] tabular-nums">
              {arrivalTime} – {departureTime}
            </span>
          </div>
          {data?.tender && (
            <div className="text-[10.5px] text-[var(--text-faint)]">
              Tender boat to shore
            </div>
          )}
          {data?.notes && (
            <div className="text-[11px] text-[var(--text-muted)] mt-2 leading-relaxed">
              {data.notes}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-end">
          <button
            onClick={onViewTrip}
            className="text-[12px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] transition-colors"
          >
            View trip →
          </button>
        </div>
      </div>
    </div>
  );
}
