"use client";

import { X, MapPin, Phone, Hash, Clock, Pencil, Trash2 } from "lucide-react";
import {
  CalendarEvent,
  Kid,
  Profile,
  TripGuest,
  isLodgingSegment,
} from "@/lib/types";
import { formatTimeInZone, getBrowserTimezone } from "@/lib/timezones";
import { formatShortDate } from "@/lib/dates";
import { kidColorCss } from "@/lib/palette";

interface LodgingPopoverProps {
  /** The lodging segment to display. */
  lodging: CalendarEvent;
  /** Trip context — pulled from the lodging's parent trip — for
   *  resolving roster names from kid_ids / member_ids / guest_ids. */
  kids: Kid[];
  members: Profile[];
  guests: TripGuest[];
  onClose: () => void;
  /** Open the lodging editor for this segment. Closes the popover
   *  before handing control to the edit modal. */
  onEdit: () => void;
  /** Delete this lodging. Closes the popover after delete. */
  onDelete: () => void;
}

/**
 * Read-only details view for a lodging segment.
 *
 * The TripView lodging row is intentionally compact, so this popover
 * is the "show me everything you have" surface. Click row body in
 * TripView → this popover; pencil icon still opens the edit form
 * directly for power users.
 *
 * Mirrors PortStopPopover's centered-modal pattern (no click-position
 * anchoring) since the content size is small enough that fixed
 * placement is fine.
 */
export default function LodgingPopover({
  lodging,
  kids,
  members,
  guests,
  onClose,
  onEdit,
  onDelete,
}: LodgingPopoverProps) {
  if (!isLodgingSegment(lodging)) return null;
  const d = lodging.segment_data;

  const tz = lodging.time_zone || getBrowserTimezone();
  const checkInDate = new Date(lodging.starts_at);
  const checkOutDate = new Date(lodging.ends_at);
  const inDate = formatShortDate(lodging.starts_at);
  const outDate = formatShortDate(lodging.ends_at);
  const inTime = formatTimeInZone(checkInDate, tz);
  const outTime = formatTimeInZone(checkOutDate, tz);

  // Compose the full address line, omitting any empty pieces. Plan
  // §2.3 splits address (street) / city / state / postal_code, so we
  // join them here for a "natural" mailing-style line.
  const cityState = [d.city, d.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, d.postal_code].filter(Boolean).join(" ");
  const fullAddress = [d.address, cityStateZip].filter(Boolean).join(", ");
  const country = d.country && d.country.toLowerCase() !== "usa" ? d.country : "";

  // Roster — resolve ids back to display names
  const onMembers = members.filter((m) =>
    (lodging.member_ids ?? []).includes(m.id)
  );
  const onKids = kids.filter((k) => (lodging.kid_ids ?? []).includes(k.id));
  const onGuests = guests.filter((g) =>
    (lodging.guest_ids ?? []).includes(g.id)
  );

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
          <MapPin className="w-4 h-4 text-[var(--text-muted)]" />
          <h3 className="text-[14px] font-semibold text-[var(--ink)] flex-1 truncate">
            {d.name || cityState || "Stay"}
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
        <div className="px-4 py-3 space-y-3 text-[12px]">
          {/* Address block */}
          {(fullAddress || country) && (
            <div className="space-y-0.5">
              {fullAddress && (
                <div className="text-[var(--ink)] leading-snug">
                  {fullAddress}
                </div>
              )}
              {country && (
                <div className="text-[11px] text-[var(--text-muted)]">
                  {country}
                </div>
              )}
            </div>
          )}

          {/* Phone — tappable on mobile */}
          {d.phone && (
            <div className="flex items-center gap-1.5">
              <Phone size={12} className="text-[var(--text-muted)] shrink-0" />
              <a
                href={`tel:${d.phone.replace(/[^0-9+]/g, "")}`}
                className="text-[var(--action)] hover:text-[var(--action-hover)] tabular-nums"
              >
                {d.phone}
              </a>
            </div>
          )}

          {/* Confirmation # */}
          {d.confirmation && (
            <div className="flex items-center gap-1.5">
              <Hash size={12} className="text-[var(--text-muted)] shrink-0" />
              <span className="text-[var(--ink)] tabular-nums">
                {d.confirmation}
              </span>
            </div>
          )}

          {/* Check-in / check-out */}
          <div className="border-t border-[var(--border)] pt-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-[var(--text-muted)] shrink-0" />
              <span className="text-[var(--ink)] tabular-nums">
                {inDate} {inTime} → {outDate} {outTime}
              </span>
            </div>
            <div className="text-[10.5px] text-[var(--text-faint)] pl-[18px]">
              {tz}
            </div>
          </div>

          {/* Who's staying */}
          {(onMembers.length > 0 ||
            onKids.length > 0 ||
            onGuests.length > 0) && (
            <div className="border-t border-[var(--border)] pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] mb-1.5">
                Who's staying
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
        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
          <button
            onClick={() => {
              if (confirm("Remove this lodging?")) {
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
  );
}
