"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Plane,
  Plus,
  Loader2,
  Search,
  X as XIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamily";
import { useEvents } from "@/hooks/useEvents";
import { useCustody } from "@/hooks/useCustody";
import { useTrips, NewTripInput } from "@/hooks/useTrips";
import { Trip, TripStatus, OverrideStatus } from "@/lib/types";
import { formatShortDate } from "@/lib/dates";
import TripCreationModal from "@/components/TripCreationModal";
import TripView from "@/components/TripView";
import LodgingForm, { NewLodgingInput } from "@/components/LodgingForm";
import TransportForm, { TransportKind } from "@/components/TransportForm";
import CruiseForm, { CruiseSaveInput } from "@/components/CruiseForm";
import TripOverrideProposalModal from "@/components/TripOverrideProposalModal";
import {
  detectTripCustodyConflict,
  getTripLinkedOverrides,
} from "@/lib/tripCustody";
import { localTimeToUtc } from "@/lib/timezones";

type FilterTab = "all" | "upcoming" | "past" | "draft";

export default function TripsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const dataReady = !authLoading && !!user;

  const { kids, members, loading: familyLoading } = useFamily(dataReady);
  const {
    events,
    createSegment,
    updateSegment,
    deleteEvent,
    uploadAttachment,
    removeAttachment,
    refetch,
  } = useEvents(dataReady, user?.id, profile?.family_id);
  const {
    trips,
    loading: tripsLoading,
    createTrip,
    updateTrip,
    deleteTrip,
    recomputeTripDates,
    uploadTripAttachment,
    removeTripAttachment,
    getTripAttachmentUrl,
  } = useTrips(dataReady, user?.id, profile?.family_id);
  const {
    getCustodyForDate,
    overrides,
    createOverrides,
    respondToOverrides,
    notifyCustodyChange,
    refetchCustody,
  } = useCustody(dataReady);

  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [lodgingForm, setLodgingForm] = useState<{
    tripId: string;
    editing: import("@/lib/types").CalendarEvent | null;
  } | null>(null);
  const [transportForm, setTransportForm] = useState<{
    tripId: string;
    type: TransportKind;
    editing: import("@/lib/types").CalendarEvent | null;
    prefill?: {
      from_location?: string;
      from_timezone?: string;
      starts_at?: string;
    };
  } | null>(null);
  const [overrideProposalTripId, setOverrideProposalTripId] = useState<
    string | null
  >(null);
  const [cruiseForm, setCruiseForm] = useState<{
    tripId: string;
    editing: import("@/lib/types").CalendarEvent | null;
  } | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Filter + sort. Trips with no dates yet (just-created drafts)
  // float to the top of the "upcoming" view as "Dates TBD."
  const filteredTrips = useMemo(() => {
    const now = new Date().toISOString();
    let list = trips;
    if (filter === "upcoming") {
      list = trips.filter(
        (t) =>
          t.status !== "canceled" &&
          (t.ends_at == null || t.ends_at >= now)
      );
    } else if (filter === "past") {
      list = trips.filter(
        (t) =>
          t.status !== "canceled" &&
          t.ends_at != null &&
          t.ends_at < now
      );
    } else if (filter === "draft") {
      list = trips.filter((t) => t.status === "draft");
    }
    // Search by title + guest names + trip type. Substring match,
    // case-insensitive. Empty search = pass everything through.
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        if (t.title.toLowerCase().includes(q)) return true;
        if (t.trip_type.toLowerCase().includes(q.replace(/\s/g, "_")))
          return true;
        if (t.notes && t.notes.toLowerCase().includes(q)) return true;
        for (const g of t.guests) {
          if (g.name.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    // Upcoming sorted ascending (next first); past descending; default
    // by created_at descending.
    return [...list].sort((a, b) => {
      if (filter === "upcoming") {
        if (!a.starts_at) return -1;
        if (!b.starts_at) return 1;
        return a.starts_at.localeCompare(b.starts_at);
      }
      if (filter === "past" && a.ends_at && b.ends_at) {
        return b.ends_at.localeCompare(a.ends_at);
      }
      return b.created_at.localeCompare(a.created_at);
    });
  }, [trips, filter, search]);

  const sectioned = useMemo(() => {
    const now = new Date().toISOString();
    const upcoming: Trip[] = [];
    const past: Trip[] = [];
    for (const t of filteredTrips) {
      if (t.ends_at == null || t.ends_at >= now) upcoming.push(t);
      else past.push(t);
    }
    return { upcoming, past };
  }, [filteredTrips]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
      </div>
    );
  }

  const showSections = filter === "all";

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/calendar"
          className="p-2 -ml-2 rounded-sm text-[var(--text-muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold text-[var(--ink)] tracking-tight flex-1">
          Trips
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-action text-action-fg text-sm font-semibold rounded-sm hover:bg-action-hover transition-colors"
        >
          <Plus size={14} /> New trip
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)] pointer-events-none"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search trips by title, type, guest, notes…"
          className="w-full pl-10 pr-9 py-2 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--ink)] transition-colors"
            aria-label="Clear search"
          >
            <XIcon size={14} />
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-[var(--border-strong)]">
        {(["all", "upcoming", "past", "draft"] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`
              px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors border-b-2 -mb-px
              ${
                filter === tab
                  ? "text-[var(--ink)] border-[var(--ink)]"
                  : "text-[var(--text-faint)] border-transparent hover:text-[var(--ink)]"
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {tripsLoading || familyLoading ? (
        <div className="py-12 text-center text-[var(--text-faint)]">
          <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
          Loading trips…
        </div>
      ) : filteredTrips.length === 0 ? (
        <div className="py-16 text-center">
          <Plane className="w-10 h-10 text-[var(--text-faint)] mx-auto mb-3" />
          <p className="text-[14px] font-semibold text-[var(--ink)] mb-1">
            {search.trim()
              ? `No trips match "${search.trim()}"`
              : filter === "all"
              ? "No trips yet"
              : `No ${filter} trips`}
          </p>
          <p className="text-[12px] text-[var(--text-muted)] mb-4">
            {search.trim()
              ? "Try a different search or clear it to see all trips."
              : "Create one to plan flights, lodging, and custody coordination."}
          </p>
          <button
            onClick={() => (search.trim() ? setSearch("") : setShowCreate(true))}
            className="px-5 py-2 bg-[var(--ink)] text-[var(--accent-ink)] text-[12px] font-semibold rounded-sm hover:bg-[var(--accent-hover)] transition-colors"
          >
            {search.trim() ? "Clear search" : "New trip"}
          </button>
        </div>
      ) : showSections ? (
        <div className="space-y-8">
          {sectioned.upcoming.length > 0 && (
            <TripSection
              title="Upcoming"
              trips={sectioned.upcoming}
              onClick={(t) => setOpenTripId(t.id)}
              kids={kids}
              members={members}
            />
          )}
          {sectioned.past.length > 0 && (
            <TripSection
              title="Past"
              trips={sectioned.past}
              onClick={(t) => setOpenTripId(t.id)}
              kids={kids}
              members={members}
            />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTrips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              kids={kids}
              members={members}
              onClick={() => setOpenTripId(trip.id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <TripCreationModal
          kids={kids}
          members={members}
          currentUserId={user.id}
          onClose={() => setShowCreate(false)}
          onCreate={async (input: NewTripInput) => createTrip(input)}
          onCreated={(trip: Trip) => {
            setShowCreate(false);
            setOpenTripId(trip.id);
          }}
        />
      )}

      {openTripId &&
        (() => {
          const trip = trips.find((t) => t.id === openTripId);
          if (!trip) return null;
          const segments = events.filter((e) => e.trip_id === trip.id);
          const conflict = detectTripCustodyConflict(
            trip,
            getCustodyForDate,
            overrides
          );
          const linked = getTripLinkedOverrides(trip.id, overrides);
          return (
            <TripView
              trip={trip}
              segments={segments}
              kids={kids}
              members={members}
              custodyConflict={conflict}
              linkedOverrides={linked}
              onClose={() => setOpenTripId(null)}
              onUpdateTrip={async (patch) => {
                await updateTrip(trip.id, patch);
              }}
              onDeleteTrip={async () => {
                const activeLinked = linked.filter(
                  (o) => o.status !== "withdrawn"
                );
                if (activeLinked.length > 0 && profile?.family_id) {
                  const withdraw = confirm(
                    `Also withdraw the ${activeLinked.length} linked custody override${
                      activeLinked.length === 1 ? "" : "s"
                    }? Click OK to withdraw, Cancel to keep them in place.`
                  );
                  if (withdraw && user) {
                    await respondToOverrides(
                      activeLinked.map((o) => o.id),
                      "withdrawn",
                      `Withdrew with trip cancellation: ${trip.title}`,
                      user.id
                    );
                  }
                }
                await deleteTrip(trip.id);
                setOpenTripId(null);
                await refetch();
                await refetchCustody();
              }}
              onProposeOverride={() => {
                setOverrideProposalTripId(trip.id);
              }}
              onUploadTripFile={async (file) => {
                await uploadTripAttachment(trip.id, file);
              }}
              onRemoveTripFile={async (a) => {
                await removeTripAttachment(trip.id, a);
              }}
              onOpenAttachment={async (path) => {
                const url = await getTripAttachmentUrl(path);
                if (url && typeof window !== "undefined") {
                  window.open(url, "_blank", "noopener,noreferrer");
                }
              }}
              onUploadSegmentFile={async (segId, file) => {
                await uploadAttachment(segId, file);
                await refetch();
              }}
              onRemoveSegmentFile={async (segId, a) => {
                await removeAttachment(segId, a);
                await refetch();
              }}
              onAddLodging={() =>
                setLodgingForm({ tripId: trip.id, editing: null })
              }
              onAddTransport={(kind) => {
                if (kind === "cruise") {
                  setCruiseForm({ tripId: trip.id, editing: null });
                  return;
                }
                setTransportForm({
                  tripId: trip.id,
                  type: kind as TransportKind,
                  editing: null,
                });
              }}
              onEditSegment={(seg) => {
                if (seg.segment_type === "lodging") {
                  setLodgingForm({ tripId: trip.id, editing: seg });
                  return;
                }
                if (seg.segment_type === "cruise") {
                  setCruiseForm({ tripId: trip.id, editing: seg });
                  return;
                }
                if (
                  seg.segment_type === "flight" ||
                  seg.segment_type === "drive" ||
                  seg.segment_type === "train" ||
                  seg.segment_type === "ferry"
                ) {
                  setTransportForm({
                    tripId: trip.id,
                    type: seg.segment_type,
                    editing: seg,
                  });
                }
              }}
              onDeleteSegment={async (segId) => {
                await deleteEvent(segId);
                await recomputeTripDates(trip.id);
              }}
            />
          );
        })()}

      {lodgingForm &&
        (() => {
          const trip = trips.find((t) => t.id === lodgingForm.tripId);
          if (!trip) return null;
          return (
            <LodgingForm
              trip={trip}
              lodging={lodgingForm.editing}
              kids={kids}
              members={members}
              onClose={() => setLodgingForm(null)}
              onSave={async (input: NewLodgingInput) => {
                if (lodgingForm.editing) {
                  await updateSegment(lodgingForm.editing.id, {
                    title: input.title,
                    starts_at: input.starts_at,
                    ends_at: input.ends_at,
                    time_zone: input.time_zone,
                    segment_data: input.segment_data,
                    member_ids: input.member_ids,
                    kid_ids: input.kid_ids,
                    guest_ids: input.guest_ids,
                  });
                } else {
                  await createSegment({
                    trip_id: trip.id,
                    segment_type: "lodging",
                    segment_data: input.segment_data,
                    title: input.title,
                    starts_at: input.starts_at,
                    ends_at: input.ends_at,
                    time_zone: input.time_zone,
                    all_day: false,
                    kid_ids: input.kid_ids,
                    member_ids: input.member_ids,
                    guest_ids: input.guest_ids,
                  });
                }
                await recomputeTripDates(trip.id);
                setLodgingForm(null);
                await refetch();
                if (trip.status === "draft") {
                  await updateTrip(trip.id, { status: "planned" });
                }
              }}
            />
          );
        })()}

      {transportForm &&
        (() => {
          const trip = trips.find((t) => t.id === transportForm.tripId);
          if (!trip) return null;
          const formKey = `${transportForm.tripId}-${transportForm.editing?.id ?? "new"}-${transportForm.prefill?.from_location ?? ""}-${transportForm.prefill?.starts_at ?? ""}`;
          return (
            <TransportForm
              key={formKey}
              trip={trip}
              type={transportForm.type}
              segment={transportForm.editing}
              kids={kids}
              members={members}
              prefill={transportForm.prefill}
              onClose={() => setTransportForm(null)}
              onSave={async (input) => {
                if (transportForm.editing) {
                  await updateSegment(transportForm.editing.id, input);
                } else {
                  await createSegment(input);
                }
                await recomputeTripDates(trip.id);
                setTransportForm(null);
                await refetch();
                if (trip.status === "draft") {
                  await updateTrip(trip.id, { status: "planned" });
                }
              }}
              onSaveAndChainDrive={async (input) => {
                await createSegment(input);
                await recomputeTripDates(trip.id);
                if (trip.status === "draft") {
                  await updateTrip(trip.id, { status: "planned" });
                }
                await refetch();
                const drive = input.segment_data as {
                  to_location?: string;
                  to_timezone?: string;
                };
                const nextDay = new Date(input.ends_at);
                nextDay.setDate(nextDay.getDate() + 1);
                nextDay.setHours(9, 0, 0, 0);
                const tz = drive.to_timezone || input.time_zone || "UTC";
                const { utcToLocalTimeString } = await import(
                  "@/lib/timezones"
                );
                const startsAtLocal = utcToLocalTimeString(nextDay, tz);
                setTransportForm({
                  tripId: trip.id,
                  type: "drive",
                  editing: null,
                  prefill: {
                    from_location: drive.to_location,
                    from_timezone: drive.to_timezone,
                    starts_at: startsAtLocal,
                  },
                });
              }}
            />
          );
        })()}

      {cruiseForm &&
        (() => {
          const trip = trips.find((t) => t.id === cruiseForm.tripId);
          if (!trip) return null;
          const allTripSegs = events.filter((e) => e.trip_id === trip.id);
          return (
            <CruiseForm
              trip={trip}
              cruise={cruiseForm.editing}
              allSegments={allTripSegs}
              kids={kids}
              members={members}
              onClose={() => setCruiseForm(null)}
              onSave={async (input: CruiseSaveInput) => {
                let cruiseId: string | null = cruiseForm.editing?.id ?? null;
                if (cruiseForm.editing) {
                  await updateSegment(cruiseForm.editing.id, input.body);
                } else {
                  const created = await createSegment(input.body);
                  cruiseId = created?.id ?? null;
                }
                if (!cruiseId) return;

                for (const removedId of input.removedPortStopIds) {
                  await deleteEvent(removedId);
                }
                for (const stop of input.portStops) {
                  const startsAt = localTimeToUtc(
                    stop.arrival_local,
                    stop.arrival_timezone
                  ).toISOString();
                  const endsAt = localTimeToUtc(
                    stop.departure_local,
                    stop.departure_timezone
                  ).toISOString();
                  const segmentData = {
                    port: stop.port,
                    arrival_timezone: stop.arrival_timezone,
                    departure_timezone: stop.departure_timezone,
                    tender: stop.tender,
                    notes: stop.notes,
                  };
                  const segInput = {
                    trip_id: trip.id,
                    segment_type: "cruise_port_stop" as const,
                    segment_data: segmentData,
                    title: stop.port,
                    starts_at: startsAt,
                    ends_at: endsAt,
                    time_zone: stop.arrival_timezone,
                    all_day: false,
                    kid_ids: input.body.kid_ids,
                    member_ids: input.body.member_ids,
                    guest_ids: input.body.guest_ids,
                    parent_segment_id: cruiseId,
                    notes: stop.notes || null,
                  };
                  if (stop.id) {
                    await updateSegment(stop.id, segInput);
                  } else {
                    await createSegment(segInput);
                  }
                }
                await recomputeTripDates(trip.id);
                setCruiseForm(null);
                await refetch();
                if (trip.status === "draft") {
                  await updateTrip(trip.id, { status: "planned" });
                }
              }}
            />
          );
        })()}

      {overrideProposalTripId &&
        (() => {
          const trip = trips.find((t) => t.id === overrideProposalTripId);
          if (!trip || !profile?.family_id || !user) return null;
          const conflict = detectTripCustodyConflict(
            trip,
            getCustodyForDate,
            overrides
          );
          if (!conflict) {
            setOverrideProposalTripId(null);
            return null;
          }
          const proposingParent = members.find(
            (m) => m.id === conflict.parentId
          );
          return (
            <TripOverrideProposalModal
              trip={trip}
              conflictKidIds={conflict.kidIds}
              proposingParentName={
                proposingParent?.full_name?.split(" ")[0] ||
                proposingParent?.email ||
                "Parent"
              }
              kids={kids}
              onClose={() => setOverrideProposalTripId(null)}
              onSubmit={async ({ kidIds, startDate, endDate, note, reason }) => {
                await createOverrides(
                  kidIds.map((kidId) => ({
                    family_id: profile.family_id,
                    kid_id: kidId,
                    start_date: startDate,
                    end_date: endDate,
                    parent_id: conflict.parentId,
                    note,
                    reason,
                    compliance_status: "unchecked" as const,
                    compliance_issues: null,
                    status: "pending" as OverrideStatus,
                    created_by: user.id,
                    override_time: null,
                    created_from_trip_id: trip.id,
                  }))
                );
                notifyCustodyChange({
                  action: "requested",
                  override: {
                    start_date: startDate,
                    end_date: endDate,
                    parent_id: conflict.parentId,
                    note,
                    reason,
                  },
                  kidIds,
                  familyId: profile.family_id,
                  changedBy: user.id,
                });
                setOverrideProposalTripId(null);
                await refetchCustody();
              }}
            />
          );
        })()}
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────

function TripSection({
  title,
  trips,
  kids,
  members,
  onClick,
}: {
  title: string;
  trips: Trip[];
  kids: ReturnType<typeof useFamily>["kids"];
  members: ReturnType<typeof useFamily>["members"];
  onClick: (trip: Trip) => void;
}) {
  return (
    <div>
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)] mb-3">
        {title}
      </h2>
      <div className="space-y-2">
        {trips.map((trip) => (
          <TripRow
            key={trip.id}
            trip={trip}
            kids={kids}
            members={members}
            onClick={() => onClick(trip)}
          />
        ))}
      </div>
    </div>
  );
}

function TripRow({
  trip,
  kids,
  members,
  onClick,
}: {
  trip: Trip;
  kids: ReturnType<typeof useFamily>["kids"];
  members: ReturnType<typeof useFamily>["members"];
  onClick: () => void;
}) {
  const tripKids = kids.filter((k) => trip.kid_ids.includes(k.id));
  const tripMembers = members.filter((m) => trip.member_ids.includes(m.id));

  const dateLabel =
    trip.starts_at && trip.ends_at
      ? `${formatShortDate(trip.starts_at)} – ${formatShortDate(trip.ends_at)}`
      : "Dates TBD";

  const typeIcon = TRIP_TYPE_ICON[trip.trip_type] || "✈️";

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border border-[var(--border-strong)] rounded-sm bg-[var(--bg)] hover:bg-[var(--bg-sunken)] transition-colors flex items-center gap-3"
    >
      <div className="text-xl shrink-0">{typeIcon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[14px] font-semibold text-[var(--ink)] truncate">
            {trip.title}
          </h3>
          <StatusBadge status={trip.status} />
        </div>
        <div className="text-[11.5px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span>{dateLabel}</span>
          {(tripMembers.length > 0 || tripKids.length > 0) && (
            <>
              <span>·</span>
              {tripMembers.map((m, i) => (
                <span key={m.id}>
                  {m.full_name?.split(" ")[0] || m.email}
                  {i < tripMembers.length - 1 ? "," : ""}
                </span>
              ))}
              {tripKids.map((k) => (
                <span
                  key={k.id}
                  className="inline-flex items-center px-1.5 rounded-sm text-[10px] font-bold text-white"
                  style={{ backgroundColor: k.color }}
                >
                  {k.name}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: TripStatus }) {
  if (status === "planned") return null;
  const map = {
    draft: {
      bg: "var(--accent-amber-tint)",
      fg: "var(--accent-amber)",
      label: "draft",
    },
    canceled: {
      bg: "var(--accent-red-tint)",
      fg: "var(--accent-red)",
      label: "canceled",
    },
  } as const;
  const { bg, fg, label } = map[status as "draft" | "canceled"];
  return (
    <span
      className="text-[9.5px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm shrink-0"
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  );
}

const TRIP_TYPE_ICON: Record<string, string> = {
  vacation: "🌴",
  custody_time: "👨‍👧",
  visit_family: "🏡",
  business: "💼",
  other: "✈️",
};
