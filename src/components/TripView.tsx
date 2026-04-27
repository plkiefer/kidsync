"use client";

import { useState, useMemo } from "react";
import {
  X,
  MapPin,
  Plane as PlaneIcon,
  Scale,
  Paperclip,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  CalendarEvent,
  CustodyOverride,
  EventAttachment,
  Kid,
  Profile,
  Trip,
  TripGuest,
  TripType,
  isLodgingSegment,
} from "@/lib/types";
import {
  formatShortDate,
  parseTimestamp,
} from "@/lib/dates";
import {
  TripCustodyConflict,
  tripExceedsOverrideWindow,
} from "@/lib/tripCustody";
import { validateTrip, TripWarning } from "@/lib/tripValidation";
import { kidColorCss } from "@/lib/palette";
import LodgingPopover from "@/components/LodgingPopover";
import TransportPopover from "@/components/TransportPopover";

interface TripViewProps {
  trip: Trip;
  /** All segments belonging to this trip. Filtered upstream. */
  segments: CalendarEvent[];
  kids: Kid[];
  members: Profile[];
  /** Custody-conflict detection result. null = no conflict (button
   *  grayed). Computed upstream so TripView doesn't need useCustody. */
  custodyConflict?: TripCustodyConflict | null;
  /** Custody overrides created from this trip (linked via
   *  created_from_trip_id). Used to render status + detect 15d
   *  out-of-window conflicts. */
  linkedOverrides?: CustodyOverride[];
  onClose: () => void;
  onUpdateTrip: (patch: Partial<Trip>) => Promise<void>;
  onDeleteTrip: () => Promise<void>;
  /** Add lodging — opens lodging form (built in chunk 2). */
  onAddLodging?: () => void;
  /** Add transport segment — built in Phase 2. */
  onAddTransport?: (kind: "flight" | "drive" | "train" | "ferry" | "cruise") => void;
  /** Open existing segment for editing. */
  onEditSegment?: (segment: CalendarEvent) => void;
  /** Delete a segment from the trip. */
  onDeleteSegment?: (segmentId: string) => Promise<void>;
  /** Open the override-proposal modal. Disabled when no conflict. */
  onProposeOverride?: () => void;
  /** Trip-level file attachments callbacks. Each segment carries
   *  its own attachments via calendar_events.attachments — these are
   *  for trip-WIDE files (passport scans, custody letter, etc.). */
  onUploadTripFile?: (file: File) => Promise<void>;
  onRemoveTripFile?: (attachment: EventAttachment) => Promise<void>;
  onOpenAttachment?: (path: string) => Promise<void>;
  /** Per-segment file callbacks — calendar_events already supports
   *  attachments; these wrap the existing useEvents helpers. */
  onUploadSegmentFile?: (segmentId: string, file: File) => Promise<void>;
  onRemoveSegmentFile?: (
    segmentId: string,
    attachment: EventAttachment
  ) => Promise<void>;
}

const TRIP_TYPE_LABELS: Record<TripType, string> = {
  vacation: "Vacation",
  custody_time: "Custody time",
  visit_family: "Visit family",
  business: "Business",
  other: "Other",
};

/**
 * Trip View modal — main editing surface for a trip.
 *
 * Sections (plan §5.1):
 *   1. Header (title, type, roster, dates, status)
 *   2. Stays   — lodging-by-city ribbons (built out in chunk 2)
 *   3. Transportation — flights/drives/trains/ferries/cruises (Phase 2)
 *   4. Custody implications (Phase 2)
 *   5. Files (Phase 5)
 *
 * This is the SHELL — sections render with empty states + CTAs.
 * Subsequent chunks fill in the section editors.
 */
export default function TripView({
  trip,
  segments,
  kids,
  members,
  custodyConflict,
  linkedOverrides = [],
  onClose,
  onUpdateTrip,
  onDeleteTrip,
  onAddLodging,
  onAddTransport,
  onEditSegment,
  onDeleteSegment,
  onProposeOverride,
  onUploadTripFile,
  onRemoveTripFile,
  onOpenAttachment,
  onUploadSegmentFile,
  onRemoveSegmentFile,
}: TripViewProps) {
  // Editable header state — autosave on blur
  const [title, setTitle] = useState(trip.title);
  const [tripType, setTripType] = useState<TripType>(trip.trip_type);

  // Read-only details popover for a single lodging. Plan §10c-style
  // pattern: row click → view; pencil → edit. Keeps the row compact
  // while giving a single tap to "show me everything you have."
  const [viewingLodgingId, setViewingLodgingId] = useState<string | null>(null);
  const viewingLodging =
    viewingLodgingId
      ? segments.find((s) => s.id === viewingLodgingId) ?? null
      : null;

  // Same pattern for transport segments. Cruise body still routes
  // straight to edit because it has cabins/port stops too rich for
  // a popover; flight/drive/train/ferry get the popover.
  const [viewingTransportId, setViewingTransportId] = useState<string | null>(
    null
  );
  const viewingTransport =
    viewingTransportId
      ? segments.find((s) => s.id === viewingTransportId) ?? null
      : null;

  // Group segments by type for section rendering
  const lodgings = useMemo(
    () => segments.filter((s) => s.segment_type === "lodging"),
    [segments]
  );
  const transports = useMemo(
    () =>
      segments
        .filter((s) =>
          // cruise_port_stop excluded — those are sub-items of the
          // cruise body (linked via parent_segment_id) and surface
          // via the cruise editor + on the calendar's bottom ribbon.
          // Listing them in Transportation would double-count and
          // clutter the row stack.
          [
            "flight",
            "drive",
            "train",
            "ferry",
            "cruise",
            "other_transport",
          ].includes(s.segment_type ?? "")
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [segments]
  );

  const rosterKids = kids.filter((k) => trip.kid_ids.includes(k.id));
  const rosterMembers = members.filter((m) => trip.member_ids.includes(m.id));

  // City-grouped stays (display only — same logic that drives the
  // calendar ribbon labels). Group lodgings by (city, contiguous date
  // range); each group is one "stay."
  const stayGroups = useMemo(
    () => groupLodgingsByCity(lodgings),
    [lodgings]
  );

  // Advisory warnings — non-blocking. Plan §5.3.
  const warnings = useMemo(
    () => validateTrip(trip, segments),
    [trip, segments]
  );

  const dateRange =
    trip.starts_at && trip.ends_at
      ? `${formatShortDate(trip.starts_at)} – ${formatShortDate(trip.ends_at)}`
      : "Dates TBD";

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-2xl max-h-[92vh] sm:max-h-[92vh] max-h-[90vh] flex flex-col border-t sm:border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-4 border-b border-[var(--border-strong)]">
          <PlaneIcon className="w-5 h-5 text-[var(--text-muted)] mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title !== trip.title) {
                  onUpdateTrip({ title: title.trim() });
                }
              }}
              className="w-full text-xl font-display text-[var(--ink)] bg-transparent border-0 focus:outline-none focus:border-b focus:border-[var(--action)] pb-0.5"
              placeholder="Untitled trip"
            />
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                {TRIP_TYPE_LABELS[tripType]}
              </span>
              <span className="text-[var(--text-faint)]">·</span>
              <span className="text-[12px] text-[var(--text-muted)]">
                {dateRange}
              </span>
              {trip.status === "draft" && (
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 bg-[var(--accent-amber-tint)] text-[var(--accent-amber)] rounded-sm">
                  draft
                </span>
              )}
              {trip.status === "canceled" && (
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 bg-[var(--accent-red-tint)] text-[var(--accent-red)] rounded-sm">
                  canceled
                </span>
              )}
            </div>
            <RosterRow
              kids={rosterKids}
              members={rosterMembers}
              guests={trip.guests}
            />
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Validation warnings (non-blocking, advisory). */}
          {warnings.length > 0 && (
            <WarningsBanner warnings={warnings} />
          )}

          {/* ─── Stays ───────────────────────── */}
          <Section
            icon={<MapPin size={14} />}
            title="Stays"
            actionLabel="+ Add stay"
            onAction={onAddLodging}
          >
            {stayGroups.length === 0 ? (
              <EmptyState
                primary="No stays yet"
                secondary="Add a city you'll be staying in. Lodging details (name, address, confirmation) can be filled in later."
                ctaLabel="Add your first stay"
                onCta={onAddLodging}
              />
            ) : (
              <div className="space-y-3">
                {stayGroups.map((group) => (
                  <StayGroupRow
                    key={group.id}
                    group={group}
                    onEdit={onEditSegment}
                    onDelete={onDeleteSegment}
                    onView={(seg) => setViewingLodgingId(seg.id)}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* ─── Transportation ──────────────── */}
          <Section
            icon={<PlaneIcon size={14} />}
            title="Transportation"
            actionLabel="+ Add"
            actionMenu={[
              { label: "Flight", onClick: () => onAddTransport?.("flight") },
              { label: "Drive", onClick: () => onAddTransport?.("drive") },
              { label: "Train", onClick: () => onAddTransport?.("train") },
              { label: "Ferry", onClick: () => onAddTransport?.("ferry") },
              { label: "Cruise", onClick: () => onAddTransport?.("cruise") },
            ]}
          >
            {transports.length === 0 ? (
              <p className="text-[12px] text-[var(--text-faint)] py-2">
                No transport yet. Add flights, drives, trains, ferries, or
                a cruise via the menu above.
              </p>
            ) : (
              <div className="space-y-1.5">
                {transports.map((t) => (
                  <TransportRow
                    key={t.id}
                    segment={t}
                    onEdit={onEditSegment}
                    onDelete={onDeleteSegment}
                    onView={(seg) => {
                      // Cruise body still routes straight to its own
                      // editor (CruiseForm) — its cabins + port stops
                      // are too rich for the popover.
                      if (seg.segment_type === "cruise") {
                        onEditSegment?.(seg);
                        return;
                      }
                      setViewingTransportId(seg.id);
                    }}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* ─── Custody implications ────────── */}
          <Section icon={<Scale size={14} />} title="Custody">
            <CustodySection
              trip={trip}
              kids={kids}
              members={members}
              custodyConflict={custodyConflict ?? null}
              linkedOverrides={linkedOverrides}
              onProposeOverride={onProposeOverride}
            />
          </Section>

          {/* ─── Files ───────────────────────── */}
          <Section icon={<Paperclip size={14} />} title="Files">
            <FilesSection
              trip={trip}
              segments={segments}
              onUploadTripFile={onUploadTripFile}
              onRemoveTripFile={onRemoveTripFile}
              onOpenAttachment={onOpenAttachment}
              onUploadSegmentFile={onUploadSegmentFile}
              onRemoveSegmentFile={onRemoveSegmentFile}
            />
          </Section>

          {/* ─── Footer (delete) ─────────────── */}
          <div className="px-6 py-4 border-t border-[var(--border)]">
            <button
              onClick={() => {
                // Plan §15e: prompt only when overrides are trip-linked
                // (already covered by the linkedOverrides filter passed
                // in by the parent). The page-level handler decides
                // what to do with the linked overrides — this confirm
                // surfaces the situation; the parent honors it.
                const activeLinked = linkedOverrides.filter(
                  (o) => o.status !== "withdrawn"
                );
                if (activeLinked.length > 0) {
                  if (
                    !confirm(
                      `This trip has ${activeLinked.length} linked custody override${
                        activeLinked.length === 1 ? "" : "s"
                      }. The next prompt will ask whether to withdraw them too. Continue?`
                    )
                  )
                    return;
                } else if (
                  !confirm("Delete this trip and all its segments?")
                ) {
                  return;
                }
                onDeleteTrip();
              }}
              className="text-[var(--accent-red)] hover:text-[var(--accent-red)] text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Trash2 size={12} /> Delete trip
            </button>
          </div>
        </div>
      </div>

      {/* Lodging details popover (read-only) — opens when user clicks
          a lodging row body. Pencil icon still goes straight to edit. */}
      {viewingLodging && (
        <LodgingPopover
          lodging={viewingLodging}
          kids={kids}
          members={members}
          guests={trip.guests}
          onClose={() => setViewingLodgingId(null)}
          onEdit={() => {
            const seg = viewingLodging;
            setViewingLodgingId(null);
            onEditSegment?.(seg);
          }}
          onDelete={async () => {
            const seg = viewingLodging;
            setViewingLodgingId(null);
            await onDeleteSegment?.(seg.id);
          }}
        />
      )}

      {/* Transport details popover (read-only) — same pattern for
          flight/drive/train/ferry rows. Cruise body skips this and
          goes straight to its own form (handled in onView wiring). */}
      {viewingTransport && (
        <TransportPopover
          segment={viewingTransport}
          kids={kids}
          members={members}
          guests={trip.guests}
          onClose={() => setViewingTransportId(null)}
          onEdit={() => {
            const seg = viewingTransport;
            setViewingTransportId(null);
            onEditSegment?.(seg);
          }}
          onDelete={async () => {
            const seg = viewingTransport;
            setViewingTransportId(null);
            await onDeleteSegment?.(seg.id);
          }}
        />
      )}
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
  actionLabel,
  onAction,
  actionMenu,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionMenu?: { label: string; onClick?: () => void }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="px-6 py-5 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-sm bg-[var(--bg-sunken)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
          {icon}
        </div>
        <h3 className="text-[11px] font-bold tracking-[0.14em] uppercase text-[var(--text-faint)] flex-1">
          {title}
        </h3>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="text-[11px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] transition-colors"
          >
            {actionLabel}
          </button>
        )}
        {actionMenu && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-[11px] font-semibold text-[var(--action)] hover:text-[var(--action-hover)] transition-colors"
            >
              + Add
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--bg)] border border-[var(--border-strong)] shadow-[var(--shadow-md)] rounded-sm py-1 min-w-[120px]">
                  {actionMenu.map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        m.onClick?.();
                      }}
                      className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-[var(--bg-sunken)] transition-colors"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyState({
  primary,
  secondary,
  ctaLabel,
  onCta,
}: {
  primary: string;
  secondary?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="text-center py-6 px-3">
      <p className="text-[13px] font-semibold text-[var(--ink)] mb-1">
        {primary}
      </p>
      {secondary && (
        <p className="text-[11px] text-[var(--text-muted)] mb-3 leading-relaxed max-w-md mx-auto">
          {secondary}
        </p>
      )}
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          className="px-4 py-2 bg-[var(--ink)] text-[var(--accent-ink)] text-[12px] font-semibold rounded-sm hover:bg-[var(--accent-hover)] transition-colors"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

function RosterRow({
  kids,
  members,
  guests,
}: {
  kids: Kid[];
  members: Profile[];
  guests: TripGuest[];
}) {
  const total = kids.length + members.length + guests.length;
  if (total === 0) {
    return (
      <p className="text-[11px] text-[var(--text-faint)] mt-1">
        No travelers yet
      </p>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
      {members.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center px-2 py-0.5 rounded-sm bg-[var(--bg-sunken)] text-[10.5px] font-medium text-[var(--ink)]"
        >
          {m.full_name?.split(" ")[0] || m.email}
        </span>
      ))}
      {kids.map((k) => (
        <span
          key={k.id}
          className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10.5px] font-bold text-white"
          style={{ backgroundColor: kidColorCss(k.color) }}
        >
          {k.name}
        </span>
      ))}
      {guests.map((g) => (
        <span
          key={g.id}
          className="inline-flex items-center px-2 py-0.5 rounded-sm border border-[var(--border)] text-[10.5px] font-medium text-[var(--text-muted)]"
          title={`${g.relationship}${g.phone ? ` · ${g.phone}` : ""}`}
        >
          {g.name}
        </span>
      ))}
    </div>
  );
}

interface StayGroup {
  id: string;
  city: string;
  state: string;
  country: string;
  starts_at: string;
  ends_at: string;
  lodgings: CalendarEvent[];
}

/**
 * Group lodgings by city and contiguous date range so the UI mirrors
 * how the calendar will render them (one ribbon per city-stay).
 *
 * v1 grouping: same (city, state, country) AND any date overlap or
 * touching ranges → single group. Sequential same-city stays without
 * a gap collapse into one group.
 */
function groupLodgingsByCity(lodgings: CalendarEvent[]): StayGroup[] {
  if (lodgings.length === 0) return [];
  const sorted = [...lodgings].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at)
  );
  const groups: StayGroup[] = [];
  for (const lodging of sorted) {
    if (!isLodgingSegment(lodging)) continue;
    const data = lodging.segment_data;
    const city = data.city || "";
    const state = data.state || "";
    const country = data.country || "";
    const last = groups[groups.length - 1];
    const sameCity =
      last && last.city === city && last.state === state && last.country === country;
    const datesTouch =
      last &&
      // current starts before or right after last ends
      lodging.starts_at <= last.ends_at;
    if (sameCity && datesTouch) {
      last.ends_at =
        lodging.ends_at > last.ends_at ? lodging.ends_at : last.ends_at;
      last.lodgings.push(lodging);
    } else {
      groups.push({
        id: lodging.id,
        city,
        state,
        country,
        starts_at: lodging.starts_at,
        ends_at: lodging.ends_at,
        lodgings: [lodging],
      });
    }
  }
  return groups;
}

function StayGroupRow({
  group,
  onEdit,
  onDelete,
  onView,
}: {
  group: StayGroup;
  onEdit?: (s: CalendarEvent) => void;
  onDelete?: (id: string) => Promise<void>;
  /** Open the read-only lodging details popover. Pencil icon still
   *  opens the edit form directly — view is the row-body click. */
  onView?: (s: CalendarEvent) => void;
}) {
  const cityLabel = formatCityLabel(group.city, group.state, group.country);
  return (
    <div className="border border-[var(--border)] rounded-sm overflow-hidden">
      <div className="px-3 py-2 bg-[var(--bg-sunken)] flex items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--ink)] flex-1">
          📍 {cityLabel || "Untitled location"}
        </span>
        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
          {formatShortDate(group.starts_at)} – {formatShortDate(group.ends_at)}
        </span>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {group.lodgings.map((l) => {
          if (!isLodgingSegment(l)) return null;
          const d = l.segment_data;
          // Compose a single mailing-style address line, omitting any
          // empty pieces. Renders as e.g. "3249 31st Ave W, Seattle, WA 98199".
          const cityState = [d.city, d.state].filter(Boolean).join(", ");
          const cityStateZip = [cityState, d.postal_code]
            .filter(Boolean)
            .join(" ");
          const addressLine = [d.address, cityStateZip]
            .filter(Boolean)
            .join(", ");
          // Phone + confirmation share a meta line — keeps the row
          // tight while still surfacing both pieces.
          const metaPieces = [
            d.phone,
            d.confirmation && `# ${d.confirmation}`,
          ].filter(Boolean);
          return (
            <div
              key={l.id}
              role={onView ? "button" : undefined}
              tabIndex={onView ? 0 : undefined}
              onClick={() => onView?.(l)}
              onKeyDown={(e) => {
                if (onView && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onView(l);
                }
              }}
              className={`px-3 py-2 flex items-center gap-2 transition-colors ${
                onView
                  ? "hover:bg-[var(--bg-sunken)] cursor-pointer"
                  : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-[var(--ink)] truncate">
                  {d.name || "Untitled lodging"}
                </div>
                {addressLine && (
                  <div className="text-[10.5px] text-[var(--text-muted)] truncate">
                    {addressLine}
                  </div>
                )}
                {metaPieces.length > 0 && (
                  <div className="text-[10.5px] text-[var(--text-faint)] truncate tabular-nums">
                    {metaPieces.join(" · ")}
                  </div>
                )}
              </div>
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(l);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors p-1"
                  aria-label="Edit lodging"
                >
                  <Pencil size={12} />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Remove this lodging?")) onDelete(l.id);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors p-1"
                  aria-label="Delete lodging"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TransportRow({
  segment,
  onEdit,
  onDelete,
  onView,
}: {
  segment: CalendarEvent;
  onEdit?: (s: CalendarEvent) => void;
  onDelete?: (id: string) => Promise<void>;
  /** Open the read-only details popover. Pencil icon still goes
   *  straight to edit; trash still deletes. Click on row body =
   *  view, matching the lodging row pattern. */
  onView?: (s: CalendarEvent) => void;
}) {
  const date = formatShortDate(segment.starts_at);
  const time = parseTimestamp(segment.starts_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      onClick={() => onView?.(segment)}
      onKeyDown={(e) => {
        if (onView && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onView(segment);
        }
      }}
      className={`border border-[var(--border)] rounded-sm px-3 py-2 flex items-center gap-2 transition-colors ${
        onView ? "hover:bg-[var(--bg-sunken)] cursor-pointer" : ""
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] shrink-0 w-14">
        {segment.segment_type}
      </span>
      <span className="text-[12px] text-[var(--ink)] flex-1 truncate">
        {segment.title}
      </span>
      <span className="text-[10.5px] text-[var(--text-muted)] tabular-nums shrink-0">
        {date} {time}
      </span>
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(segment);
          }}
          className="text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors p-1"
          aria-label="Edit segment"
        >
          <Pencil size={12} />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Remove this segment?")) onDelete(segment.id);
          }}
          className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors p-1"
          aria-label="Delete segment"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

function formatCityLabel(city: string, state: string, country: string): string {
  if (!city) return "";
  if (state) return `${city}, ${state}`;
  if (country && country !== "USA" && country !== "United States") {
    return `${city}, ${country}`;
  }
  return city;
}

// ─── CustodySection ──────────────────────────────────────────
// Renders the trip's custody state (plan §15c):
//   - No conflict + no overrides → "No conflict — default custody
//     applies." Propose button grayed.
//   - Conflict detected, no override yet → enabled Propose button.
//   - Linked overrides exist → list them with status, plus
//     re-propose button if 15d window is exceeded.
//   - Override denied → red warning + non-blocking "Default custody
//     applies" notice.

interface CustodySectionProps {
  trip: Trip;
  kids: Kid[];
  members: Profile[];
  custodyConflict: TripCustodyConflict | null;
  linkedOverrides: CustodyOverride[];
  onProposeOverride?: () => void;
}

function CustodySection({
  trip,
  kids,
  members,
  custodyConflict,
  linkedOverrides,
  onProposeOverride,
}: CustodySectionProps) {
  // Filter out withdrawn — those are gone.
  const activeOverrides = linkedOverrides.filter(
    (o) => o.status !== "withdrawn"
  );

  // 15d: check if trip dates extend past any approved override
  const windowConflicts = activeOverrides.filter(
    (o) => o.status === "approved" && tripExceedsOverrideWindow(trip, o)
  );

  const hasConflict = custodyConflict != null;
  const hasActiveOverrides = activeOverrides.length > 0;
  const canPropose = hasConflict && trip.starts_at && trip.ends_at;

  const tripParentId = trip.member_ids[0];
  const tripParent = members.find((m) => m.id === tripParentId);
  const tripParentName =
    tripParent?.full_name?.split(" ")[0] || tripParent?.email || "this parent";

  return (
    <div className="space-y-3">
      {/* No conflict, no overrides — friendly default state */}
      {!hasConflict && !hasActiveOverrides && (
        <p className="text-[12px] text-[var(--text-muted)]">
          No conflict — default custody schedule already covers this trip.
        </p>
      )}

      {/* Conflict detected (and no covering override yet) */}
      {hasConflict && !hasActiveOverrides && (
        <div
          className="text-[12px] rounded-sm p-2.5 border"
          style={{
            color: "var(--accent-amber)",
            background: "var(--accent-amber-tint)",
            borderColor:
              "color-mix(in srgb, var(--accent-amber) 30%, transparent)",
          }}
        >
          {custodyConflict!.kidIds
            .map((id) => kids.find((k) => k.id === id)?.name)
            .filter(Boolean)
            .join(" & ")}{" "}
          will need a custody override for {tripParentName} during this trip.
        </div>
      )}

      {/* Linked overrides list */}
      {activeOverrides.map((o) => {
        const kid = kids.find((k) => k.id === o.kid_id);
        const parentName =
          members.find((m) => m.id === o.parent_id)?.full_name?.split(" ")[0] ||
          "Parent";
        const windowConflict = windowConflicts.includes(o);
        const statusBadge = getOverrideStatusBadge(o.status);
        return (
          <div
            key={o.id}
            className="text-[12px] border border-[var(--border)] rounded-sm p-2.5 bg-[var(--bg-sunken)]"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-[var(--ink)]">
                {kid?.name || "Kid"}
              </span>
              <span className="text-[var(--text-muted)]">
                {o.start_date} → {o.end_date}
              </span>
              <span className="text-[var(--text-muted)]">→</span>
              <span className="font-medium text-[var(--ink)]">
                {parentName}
              </span>
              <span
                className="ml-auto text-[10px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm"
                style={{
                  color: statusBadge.color,
                  background: statusBadge.bg,
                }}
              >
                {statusBadge.label}
              </span>
            </div>
            {windowConflict && (
              <div
                className="mt-2 text-[11px] rounded-sm p-2 border"
                style={{
                  color: "var(--accent-red)",
                  background: "var(--accent-red-tint)",
                  borderColor:
                    "color-mix(in srgb, var(--accent-red) 30%, transparent)",
                }}
              >
                ⚠ Trip now extends past this approved window. Re-propose to
                adjust.
              </div>
            )}
          </div>
        );
      })}

      {/* Propose button — gray when no conflict, active otherwise */}
      <button
        type="button"
        onClick={onProposeOverride}
        disabled={!canPropose}
        className={`
          inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[11px] font-semibold transition-colors
          ${
            canPropose
              ? "bg-[var(--ink)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)]"
              : "bg-[var(--bg-sunken)] text-[var(--text-faint)] cursor-not-allowed"
          }
        `}
        title={
          canPropose
            ? "Propose a custody override for the trip dates"
            : !trip.starts_at
            ? "Add segments to determine trip dates first"
            : !hasConflict
            ? "No conflict — default custody covers this trip"
            : ""
        }
      >
        Propose override
      </button>
    </div>
  );
}

// ─── FilesSection ────────────────────────────────────────────
// Trip-level files (passport scans, custody letter) at the top,
// then per-segment attachments grouped by segment underneath.
// Each row has open + remove. Upload buttons inline.

interface FilesSectionProps {
  trip: Trip;
  segments: CalendarEvent[];
  onUploadTripFile?: (file: File) => Promise<void>;
  onRemoveTripFile?: (attachment: EventAttachment) => Promise<void>;
  onOpenAttachment?: (path: string) => Promise<void>;
  onUploadSegmentFile?: (segmentId: string, file: File) => Promise<void>;
  onRemoveSegmentFile?: (
    segmentId: string,
    attachment: EventAttachment
  ) => Promise<void>;
}

function FilesSection({
  trip,
  segments,
  onUploadTripFile,
  onRemoveTripFile,
  onOpenAttachment,
  onUploadSegmentFile,
  onRemoveSegmentFile,
}: FilesSectionProps) {
  const tripFiles = trip.attachments ?? [];
  const segmentsWithFiles = segments.filter(
    (s) => (s.attachments ?? []).length > 0
  );

  return (
    <div className="space-y-4">
      {/* Trip-level */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10.5px] font-semibold tracking-[0.12em] uppercase text-[var(--text-faint)]">
            Trip-wide
          </span>
          {onUploadTripFile && (
            <UploadButton
              label="Attach file"
              onPick={async (file) => {
                await onUploadTripFile(file);
              }}
            />
          )}
        </div>
        {tripFiles.length === 0 ? (
          <p className="text-[11px] text-[var(--text-faint)]">
            Passport scans, custody letter, court orders. Visible to both
            parents.
          </p>
        ) : (
          <div className="space-y-1">
            {tripFiles.map((a) => (
              <FileRow
                key={a.path}
                attachment={a}
                onOpen={onOpenAttachment}
                onRemove={
                  onRemoveTripFile
                    ? () => onRemoveTripFile(a)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Per-segment */}
      {segmentsWithFiles.map((seg) => (
        <div key={seg.id}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10.5px] font-semibold tracking-[0.12em] uppercase text-[var(--text-faint)] truncate">
              {seg.title || seg.segment_type || "Segment"}
            </span>
            {onUploadSegmentFile && (
              <UploadButton
                label="Attach file"
                onPick={async (file) => {
                  await onUploadSegmentFile(seg.id, file);
                }}
              />
            )}
          </div>
          <div className="space-y-1">
            {(seg.attachments ?? []).map((a) => (
              <FileRow
                key={a.path}
                attachment={a}
                onOpen={onOpenAttachment}
                onRemove={
                  onRemoveSegmentFile
                    ? () => onRemoveSegmentFile(seg.id, a)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ))}

      {/* Per-segment upload entry — let user attach to any segment
          even when it has no files yet, via a small picker. Skipped
          when no segments exist (the trip-wide upload above is enough
          for that case). */}
      {segments.length > 0 && onUploadSegmentFile && (
        <SegmentUploadPicker
          segments={segments}
          onUpload={onUploadSegmentFile}
        />
      )}
    </div>
  );
}

function FileRow({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: EventAttachment;
  onOpen?: (path: string) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border border-[var(--border)] rounded-sm bg-[var(--bg-sunken)]">
      <Paperclip
        size={11}
        className="text-[var(--text-faint)] shrink-0"
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onOpen?.(attachment.path)}
        className="flex-1 min-w-0 text-left text-[12px] text-[var(--ink)] hover:text-[var(--action)] truncate"
      >
        {attachment.name}
      </button>
      <span className="text-[10px] text-[var(--text-faint)] shrink-0 tabular-nums">
        {formatFileSize(attachment.size)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={() => {
            if (confirm(`Remove ${attachment.name}?`)) onRemove();
          }}
          className="text-[var(--text-muted)] hover:text-[var(--accent-red)] transition-colors p-1 shrink-0"
          aria-label="Remove file"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

function UploadButton({
  label,
  onPick,
}: {
  label: string;
  onPick: (file: File) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label
      className={`text-[11px] font-semibold transition-colors cursor-pointer ${
        busy
          ? "text-[var(--text-faint)] cursor-wait"
          : "text-[var(--action)] hover:text-[var(--action-hover)]"
      }`}
    >
      {busy ? "Uploading…" : `+ ${label}`}
      <input
        type="file"
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            await onPick(file);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </label>
  );
}

function SegmentUploadPicker({
  segments,
  onUpload,
}: {
  segments: CalendarEvent[];
  onUpload: (segmentId: string, file: File) => Promise<void>;
}) {
  const [pickedSeg, setPickedSeg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <div className="text-[10.5px] font-semibold tracking-[0.12em] uppercase text-[var(--text-faint)] mb-2">
        Attach to a segment
      </div>
      <div className="flex items-center gap-2">
        <select
          value={pickedSeg}
          onChange={(e) => setPickedSeg(e.target.value)}
          className="flex-1 px-2 py-1.5 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[12px] text-[var(--ink)]"
        >
          <option value="">Pick a segment…</option>
          {segments.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || s.segment_type || "Segment"}
            </option>
          ))}
        </select>
        <label
          className={`text-[11px] font-semibold cursor-pointer ${
            busy || !pickedSeg
              ? "text-[var(--text-faint)] cursor-not-allowed"
              : "text-[var(--action)] hover:text-[var(--action-hover)]"
          }`}
        >
          {busy ? "Uploading…" : "+ Attach"}
          <input
            type="file"
            className="hidden"
            disabled={busy || !pickedSeg}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !pickedSeg) return;
              setBusy(true);
              try {
                await onUpload(pickedSeg, file);
              } finally {
                setBusy(false);
                e.target.value = "";
                setPickedSeg("");
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── WarningsBanner ──────────────────────────────────────────
// Renders the validateTrip() output as a list of advisory banners
// at the top of TripView. Never blocking — just nudges. Plan §5.3.

function WarningsBanner({ warnings }: { warnings: TripWarning[] }) {
  return (
    <div className="px-6 py-3 border-b border-[var(--border)] space-y-1.5">
      {warnings.map((w) => {
        const isWarning = w.severity === "warning";
        return (
          <div
            key={w.id}
            className="text-[12px] rounded-sm px-2.5 py-1.5 border flex items-start gap-2"
            style={{
              color: isWarning ? "var(--accent-amber)" : "var(--text-muted)",
              background: isWarning
                ? "var(--accent-amber-tint)"
                : "var(--bg-sunken)",
              borderColor: isWarning
                ? "color-mix(in srgb, var(--accent-amber) 30%, transparent)"
                : "var(--border)",
            }}
          >
            <span aria-hidden className="shrink-0 mt-px">
              {isWarning ? "⚠" : "ℹ"}
            </span>
            <span className="leading-relaxed">{w.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function getOverrideStatusBadge(
  status: CustodyOverride["status"]
): { label: string; color: string; bg: string } {
  switch (status) {
    case "pending":
      return {
        label: "pending",
        color: "var(--accent-amber)",
        bg: "var(--accent-amber-tint)",
      };
    case "approved":
      return {
        label: "approved",
        color: "#3D7A4F",
        bg: "rgba(142, 161, 138, 0.15)",
      };
    case "disputed":
      return {
        label: "disputed",
        color: "var(--accent-red)",
        bg: "var(--accent-red-tint)",
      };
    case "withdrawn":
      return {
        label: "withdrawn",
        color: "var(--text-faint)",
        bg: "var(--bg-sunken)",
      };
  }
}
