"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamily";
import { useEvents } from "@/hooks/useEvents";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useCustody } from "@/hooks/useCustody";
import { useTrips, NewTripInput } from "@/hooks/useTrips";
import {
  CalendarEvent,
  EventFormData,
  TravelFormData,
  EventAttachment,
  getEventKidIds,
  OverrideStatus,
  Trip,
  isTripSegment,
} from "@/lib/types";
import { resolvePalette, DEFAULT_PARENT_A_COLOR, DEFAULT_PARENT_B_COLOR } from "@/lib/palette";
import {
  formatMonthYear,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "@/lib/dates";
import { downloadICal } from "@/lib/ical";
import { formatAllDayTimestamp } from "@/lib/allDay";
import { expandRecurringEvents } from "@/lib/recurrence";
import { generateTurnoverEvents, generateHolidayEvents } from "@/lib/virtualEvents";
import MonthView from "@/components/MonthView";
import WeekView from "@/components/WeekView";
import ListView from "@/components/ListView";
import EventModal from "@/components/EventModal";
import EventDetailModal from "@/components/EventDetailModal";
import TravelModal from "@/components/TravelModal";
import TripCreationModal from "@/components/TripCreationModal";
import TripView from "@/components/TripView";
import LodgingForm, { NewLodgingInput } from "@/components/LodgingForm";
import TransportForm, { TransportKind } from "@/components/TransportForm";
import CruiseForm, { CruiseSaveInput } from "@/components/CruiseForm";
import PortStopPopover from "@/components/PortStopPopover";
import TripOverrideProposalModal from "@/components/TripOverrideProposalModal";
import {
  detectTripCustodyConflict,
  getTripLinkedOverrides,
} from "@/lib/tripCustody";
import { localTimeToUtc } from "@/lib/timezones";
import QuickCustodyChange from "@/components/QuickCustodyChange";
import KidFilter from "@/components/KidFilter";
import ActivityFeed from "@/components/ActivityFeed";
import CustodySettings from "@/components/CustodySettings";
import CustodyOverrides from "@/components/CustodyOverrides";
import ScheduleImportModal from "@/components/ScheduleImportModal";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Download,
  LogOut,
  Shield,
  AlertCircle,
  Link2,
  Check,
  Settings,
  Upload,
  Plane as PlaneIcon,
} from "lucide-react";

type ViewMode = "month" | "week" | "list";

export default function CalendarPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, signOut } = useAuth();

  // Data hooks only query AFTER auth resolves — prevents deadlock
  // where simultaneous Supabase calls all try to refresh the token
  const dataReady = !authLoading && !!user;
  const { kids, members, loading: familyLoading } = useFamily(dataReady);
  const {
    events,
    loading: eventsLoading,
    createEvent,
    createEventsBatch,
    updateEvent,
    updateEventsBatch,
    createSegment,
    updateSegment,
    deleteEvent,
    saveTravelDetails,
    getTravelDetails,
    uploadAttachment,
    removeAttachment,
    getAttachmentUrl,
    refetch,
  } = useEvents(dataReady, user?.id, profile?.family_id);
  const { logs, loading: logsLoading } = useActivityLog(20, dataReady);
  const {
    schedules,
    getCustodyForDate,
    overrides,
    agreements,
    createOverrides,
    respondToOverrides,
    withdrawOverlapping,
    moveTurnover,
    notifyCustodyChange,
    refetchCustody,
  } = useCustody(dataReady);
  const {
    trips,
    createTrip,
    updateTrip,
    deleteTrip,
    recomputeTripDates,
    uploadTripAttachment,
    removeTripAttachment,
    getTripAttachmentUrl,
  } = useTrips(dataReady, user?.id, profile?.family_id);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [filterKid, setFilterKid] = useState("all");

  // Pending files for new events (uploaded after save)
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Modal state
  const [showEventModal, setShowEventModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [initialDate, setInitialDate] = useState<Date | undefined>(undefined);
  const [showTravelModal, setShowTravelModal] = useState(false);
  const [travelEventId, setTravelEventId] = useState<string | null>(null);
  const [existingTravel, setExistingTravel] = useState<any>(null);
  const [showCustodySettings, setShowCustodySettings] = useState(false);
  const [showCustodyOverrides, setShowCustodyOverrides] = useState(false);
  const [showScheduleImport, setShowScheduleImport] = useState(false);
  // Trip flow state
  const [showTripCreation, setShowTripCreation] = useState(false);
  const [tripCreationInitialTitle, setTripCreationInitialTitle] = useState("");
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [lodgingForm, setLodgingForm] = useState<{
    tripId: string;
    editing: CalendarEvent | null;
    prefillCity?: { city: string; state: string; country: string };
  } | null>(null);
  const [transportForm, setTransportForm] = useState<{
    tripId: string;
    type: TransportKind;
    editing: CalendarEvent | null;
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
    editing: CalendarEvent | null;
  } | null>(null);
  const [portStopPopover, setPortStopPopover] = useState<{
    portStopId: string;
  } | null>(null);
  const [showICalMenu, setShowICalMenu] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [quickChangeEvent, setQuickChangeEvent] = useState<CalendarEvent | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Close iCal menu on outside click
  useEffect(() => {
    if (!showICalMenu) return;
    const handler = (e: MouseEvent) => setShowICalMenu(false);
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [showICalMenu]);

  // Generate virtual birthday events for kids with birth_date
  const birthdayEvents: CalendarEvent[] = kids
    .filter((k) => k.birth_date)
    .flatMap((kid) => {
      // Parse date string directly to avoid UTC→local timezone shift
      const [bYear, bMonth, bDay] = kid.birth_date!.split("-").map(Number);
      const thisYear = currentDate.getFullYear();
      // Generate for previous, current, and next year to cover navigation
      return [-1, 0, 1].map((offset): CalendarEvent => {
        const year = thisYear + offset;
        const dateStr = `${year}-${String(bMonth).padStart(2, "0")}-${String(bDay).padStart(2, "0")}`;
        const age = year - bYear;
        return {
          id: `birthday-${kid.id}-${year}`,
          family_id: kid.family_id,
          kid_id: kid.id,
          kid_ids: [kid.id],
          title: `${kid.name}'s Birthday${age > 0 ? ` (${age})` : ""}`,
          event_type: "other",
          starts_at: formatAllDayTimestamp(dateStr),
          ends_at: formatAllDayTimestamp(dateStr, { asEnd: true }),
          all_day: true,
          location: null,
          notes: null,
          recurring_rule: null,
          created_by: "",
          updated_by: null,
          created_at: "",
          updated_at: "",
          _virtual: true,
        };
      });
    });

  const expandedEvents = expandRecurringEvents(events);

  // Compute visible date range for virtual event generation
  const visibleStart = startOfWeek(startOfMonth(currentDate));
  const visibleEnd = endOfWeek(endOfMonth(currentDate));

  // Generate custody turnover events
  const turnoverEvents = generateTurnoverEvents(
    visibleStart,
    visibleEnd,
    schedules,
    overrides,
    agreements,
    kids,
    members
  );

  // Generate holiday events
  const holidayEvents = generateHolidayEvents(
    visibleStart,
    visibleEnd,
    kids,
    profile?.family_id || ""
  );

  const allEvents = [...expandedEvents, ...birthdayEvents, ...turnoverEvents, ...holidayEvents];

  // Filter events — multi-kid aware
  const filteredEvents =
    filterKid === "all"
      ? allEvents
      : allEvents.filter((e) => {
          const kidIds = getEventKidIds(e);
          return kidIds.includes(filterKid);
        });

  // Navigation — clamped to Jan 2026 through Dec 2041
  const MIN_DATE = new Date(2026, 0, 1);
  const MAX_DATE = new Date(2041, 11, 31);
  const clampDate = (d: Date) => {
    if (d < MIN_DATE) return new Date(MIN_DATE);
    if (d > MAX_DATE) return new Date(MAX_DATE);
    return d;
  };

  const goBack = () => {
    if (view === "month") setCurrentDate((d) => clampDate(subMonths(d, 1)));
    else setCurrentDate((d) => clampDate(subWeeks(d, 1)));
  };

  const goForward = () => {
    if (view === "month") setCurrentDate((d) => clampDate(addMonths(d, 1)));
    else setCurrentDate((d) => clampDate(addWeeks(d, 1)));
  };

  const goToday = () => setCurrentDate(new Date());

  // Event handlers
  const handleDayClick = (date: Date) => {
    const d = new Date(date);
    d.setHours(9, 0, 0, 0);
    setInitialDate(d);
    setEditingEvent(null);
    setShowEventModal(true);
  };

  const handleEventClick = (event: CalendarEvent) => {
    // Port-stop synthetic ribbons get a lightweight popover (plan
    // §10c). The MonthView prefixes synthetic event ids with
    // "portstop-<real-id>" so we can distinguish them from real
    // port stops without changing the click signature.
    if (event.id.startsWith("portstop-")) {
      const realId = event.id.slice("portstop-".length);
      setPortStopPopover({ portStopId: realId });
      return;
    }
    // Cruise body synthetic ribbons → strip the "cruise-" prefix
    // before routing to TripView (the trip_id field is preserved
    // on the synthetic event so the routing still works).
    if (event.id.startsWith("cruise-") && event.trip_id) {
      setOpenTripId(event.trip_id);
      return;
    }
    // Trip-linked segments open Trip View instead of the regular
    // event detail modal — the user wants to see all the trip's
    // segments together, not just this one chip.
    if (isTripSegment(event) && event.trip_id) {
      setOpenTripId(event.trip_id);
      return;
    }
    setEditingEvent(event);
    setInitialDate(undefined);
    setShowDetailModal(true);
  };

  const isVirtualEvent = (id: string) =>
    id.startsWith("birthday-") || id.startsWith("turnover-") || id.startsWith("holiday-");

  const handleEditFromDetail = () => {
    // Virtual events (birthdays, turnovers, holidays) can't be edited
    if (editingEvent && isVirtualEvent(editingEvent.id)) return;
    setShowDetailModal(false);
    // For recurrence occurrences, edit the parent (master) event
    if (editingEvent?._recurrence_parent) {
      const parent = events.find(
        (e) => e.id === editingEvent._recurrence_parent
      );
      if (parent) setEditingEvent(parent);
    }
    setShowEventModal(true);
  };

  const handleSaveEvent = async (data: EventFormData, files?: File[]) => {
    let savedEvent: CalendarEvent | null = null;
    if (editingEvent) {
      savedEvent = await updateEvent(editingEvent.id, data);
    } else {
      savedEvent = await createEvent(data);
    }
    // Upload any pending files
    const filesToUpload = files || pendingFiles;
    if (savedEvent && filesToUpload.length > 0) {
      for (const file of filesToUpload) {
        await uploadAttachment(savedEvent.id, file);
      }
      setPendingFiles([]);
    }
    // Immediately refresh events so the calendar reflects the change
    await refetch();
    setShowEventModal(false);
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (id: string) => {
    // Virtual events can't be deleted
    if (id.startsWith("birthday-") || id.startsWith("turnover-") || id.startsWith("holiday-")) return;
    // For recurrence occurrences, delete the entire series (parent)
    const actualId = id.includes("_rec_") ? id.split("_rec_")[0] : id;
    const success = await deleteEvent(actualId);
    if (!success) {
      window.alert("Failed to delete event. Check browser console for details.");
      return;
    }
    await refetch();
    setShowEventModal(false);
    setShowDetailModal(false);
    setEditingEvent(null);
  };

  // Delete a single occurrence of a recurring event (add exception date)
  const handleDeleteOccurrence = async (occurrenceEvent: CalendarEvent) => {
    if (!occurrenceEvent._recurrence_parent) return;
    if (!window.confirm("Delete just this occurrence? The rest of the series will continue.")) return;

    const parentId = occurrenceEvent._recurrence_parent;
    const occDate = occurrenceEvent.starts_at.slice(0, 10);

    // Find the parent event to get current exceptions
    const parentEvent = events.find((e) => e.id === parentId);
    const currentExceptions = parentEvent?.recurrence_exceptions || [];
    const newExceptions = [...currentExceptions, occDate];

    // Update the parent event's recurrence_exceptions
    const supabase = (await import("@/lib/supabase")).getSupabase();
    await supabase
      .from("calendar_events")
      .update({ recurrence_exceptions: newExceptions })
      .eq("id", parentId);

    await refetch();
    setShowDetailModal(false);
    setEditingEvent(null);
  };

  // Edit a single occurrence — exclude it from the series and create a standalone copy
  const handleEditOccurrence = (occurrenceEvent: CalendarEvent) => {
    if (!occurrenceEvent._recurrence_parent) return;

    // We'll add the exception when saving the new standalone event
    // For now, open the event modal with the occurrence's data as a NEW event
    const standaloneEvent: CalendarEvent = {
      ...occurrenceEvent,
      id: "", // new event
      recurring_rule: null, // not recurring
      _virtual: false,
      _recurrence_parent: undefined,
      // Store the parent info so we can add the exception on save
      notes: occurrenceEvent.notes
        ? `${occurrenceEvent.notes}\n[Modified from recurring series]`
        : "[Modified from recurring series]",
    };

    // Add exception to parent first
    const parentId = occurrenceEvent._recurrence_parent;
    const occDate = occurrenceEvent.starts_at.slice(0, 10);
    const parentEvent = events.find((e) => e.id === parentId);
    const currentExceptions = parentEvent?.recurrence_exceptions || [];

    // Update exceptions in background
    import("@/lib/supabase").then(({ getSupabase }) => {
      getSupabase()
        .from("calendar_events")
        .update({ recurrence_exceptions: [...currentExceptions, occDate] })
        .eq("id", parentId)
        .then(() => refetch());
    });

    setEditingEvent(null);
    setInitialDate(new Date(occurrenceEvent.starts_at));
    setShowEventModal(true);
  };

  const handleOpenTravel = async (eventId: string) => {
    setShowEventModal(false);
    setShowDetailModal(false);
    setTravelEventId(eventId);
    const existing = await getTravelDetails(eventId);
    setExistingTravel(existing);
    setShowTravelModal(true);
  };

  const handleSaveTravel = async (data: TravelFormData) => {
    if (travelEventId) {
      await saveTravelDetails(travelEventId, data);
    }
    setShowTravelModal(false);
    setTravelEventId(null);
    setExistingTravel(null);
  };

  const handleDownloadAttachment = async (attachment: EventAttachment) => {
    const url = await getAttachmentUrl(attachment.path);
    if (url) {
      window.open(url, "_blank");
    }
  };

  const handleCancelExchange = async (turnoverEvent: CalendarEvent) => {
    if (!profile?.family_id || !user) return;

    const eventDate = turnoverEvent.starts_at.split("T")[0];
    const isPickup = turnoverEvent.id.includes("pickup");
    const eventKidIds = turnoverEvent.kid_ids || [turnoverEvent.kid_id];
    const otherParent = members.find((m) => m.id !== user.id);
    const supabase = (await import("@/lib/supabase")).getSupabase();

    // Check if this turnover is from an override (non-standard)
    const relatedOvr = overrides.filter((o) =>
      eventDate >= o.start_date && eventDate <= o.end_date &&
      o.status !== "withdrawn" && o.status !== "disputed"
    );

    if (relatedOvr.length > 0) {
      const hasApproved = relatedOvr.some((o) => o.status === "approved");
      if (hasApproved) {
        // Approved changes require the other parent's approval to cancel.
        // Only override the NON-STANDARD days back to the other parent,
        // so standing custody turnovers (e.g., standard Fri-Sun) reappear.
        if (!window.confirm("This change was approved. Cancelling requires the other parent's approval. Proceed?")) return;
        const kidNames = eventKidIds.map((id) => kids.find((k) => k.id === id)?.name).filter(Boolean).join(" & ");

        // Find the original override's date range
        const origStart = relatedOvr[0].start_date;
        const origEnd = relatedOvr[0].end_date;

        // Compute which days are non-standard (differ from the base pattern)
        const { computeCustodyForDate: computeBase } = await import("@/lib/custody");
        const { eachDayOfInterval, format: fmtDate } = await import("date-fns");

        const rangeDays = eachDayOfInterval({
          start: new Date(origStart + "T12:00:00"),
          end: new Date(origEnd + "T12:00:00"),
        });

        // For each kid, find days where the pattern gives a different parent
        const nonStandardDays: string[] = [];
        for (const day of rangeDays) {
          // Compute custody WITHOUT overrides (pattern only)
          const patternCustody = computeBase(day, schedules, []);
          const firstKid = eventKidIds[0];
          const patternParent = patternCustody[firstKid]?.parentId;
          // If pattern gives the OTHER parent (not Father), this is a non-standard day
          if (patternParent && patternParent !== user.id) {
            // This day was changed by the override — need to revert it
          } else {
            // This day matches the standard pattern — skip it
            continue;
          }
          nonStandardDays.push(fmtDate(day, "yyyy-MM-dd"));
        }

        if (nonStandardDays.length > 0) {
          // Split non-standard days into contiguous ranges
          // (e.g., [Wed,Thu] and [Mon,Tue,Wed] if a standard Fri-Sun is in between)
          const ranges: { start: string; end: string }[] = [];
          let rangeStartIdx = 0;
          for (let i = 1; i <= nonStandardDays.length; i++) {
            const isEnd = i === nonStandardDays.length;
            const isGap = !isEnd && (() => {
              const prev = new Date(nonStandardDays[i - 1] + "T12:00:00");
              const curr = new Date(nonStandardDays[i] + "T12:00:00");
              return (curr.getTime() - prev.getTime()) > 86400000 * 1.5; // more than ~1 day
            })();
            if (isEnd || isGap) {
              ranges.push({
                start: nonStandardDays[rangeStartIdx],
                end: nonStandardDays[i - 1],
              });
              rangeStartIdx = i;
            }
          }

          // Create cancellation overrides for all ranges × kids in one batch
          const cancellationInputs = ranges.flatMap((range) =>
            eventKidIds.map((kidId) => ({
              family_id: profile.family_id,
              kid_id: kidId,
              start_date: range.start,
              end_date: range.end,
              parent_id: otherParent?.id || "",
              note: `Cancellation of custom exchange for ${kidNames} (${origStart} to ${origEnd})`,
              reason: "Reverting approved schedule change",
              compliance_status: "unchecked" as const,
              compliance_issues: null,
              status: "pending" as OverrideStatus,
              created_by: user.id,
            }))
          );
          await createOverrides(cancellationInputs);
          notifyCustodyChange({
            action: "requested",
            override: { start_date: ranges[0].start, end_date: ranges[ranges.length - 1].end, parent_id: otherParent?.id || "", reason: "Reverting approved schedule change" },
            kidIds: eventKidIds,
            familyId: profile.family_id,
            changedBy: user.id,
          });
        } else {
          // All days match the standard pattern — just withdraw the original
          await respondToOverrides(relatedOvr.map((o) => o.id), "withdrawn", "Reverted — all days match standard schedule", user.id);
          notifyCustodyChange({
            action: "withdrawn",
            override: { start_date: relatedOvr[0].start_date, end_date: relatedOvr[relatedOvr.length - 1].end_date, parent_id: relatedOvr[0].parent_id, reason: "Reverted — all days match standard schedule" },
            kidIds: eventKidIds,
            familyId: profile.family_id,
            changedBy: user.id,
          });
        }
      } else {
        // Pending only: can withdraw directly
        if (!window.confirm("Withdraw this pending change request?")) return;
        await respondToOverrides(relatedOvr.map((o) => o.id), "withdrawn", "Withdrawn by requester", user.id);
        notifyCustodyChange({
          action: "withdrawn",
          override: { start_date: relatedOvr[0].start_date, end_date: relatedOvr[relatedOvr.length - 1].end_date, parent_id: relatedOvr[0].parent_id, reason: "Withdrawn by requester" },
          kidIds: eventKidIds,
          familyId: profile.family_id,
          changedBy: user.id,
        });
      }
    } else {
      // Standard: skip this pickup/dropoff set by giving other parent custody
      if (!window.confirm("Cancel this exchange? This will give the other parent custody for this period and requires their approval.")) return;

      // Find the matching pickup/dropoff pair for this weekend
      // Pickup is on Friday, dropoff is on Sunday of the same custody block
      const evtDate = new Date(eventDate + "T12:00:00");

      let rangeStart: string;
      let rangeEnd: string;

      if (isPickup) {
        // Pickup on Friday — skip Fri through Sun
        rangeStart = eventDate;
        const sun = new Date(evtDate);
        sun.setDate(sun.getDate() + 2);
        rangeEnd = sun.toISOString().slice(0, 10);
      } else {
        // Dropoff on Sunday — skip Fri through Sun
        const fri = new Date(evtDate);
        fri.setDate(fri.getDate() - 2);
        rangeStart = fri.toISOString().slice(0, 10);
        rangeEnd = eventDate;
      }

      const kidNames = eventKidIds
        .map((id) => kids.find((k) => k.id === id)?.name)
        .filter(Boolean)
        .join(" & ");

      await createOverrides(eventKidIds.map((kidId) => ({
        family_id: profile.family_id,
        kid_id: kidId,
        start_date: rangeStart,
        end_date: rangeEnd,
        parent_id: otherParent?.id || "",
        note: `Weekend cancelled for ${kidNames} (${rangeStart} to ${rangeEnd})`,
        reason: "Exchange cancelled",
        compliance_status: "unchecked" as const,
        compliance_issues: null,
        status: "pending" as OverrideStatus,
        created_by: user.id,
      })));
      notifyCustodyChange({
        action: "requested",
        override: { start_date: rangeStart, end_date: rangeEnd, parent_id: otherParent?.id || "", reason: "Exchange cancelled" },
        kidIds: eventKidIds,
        familyId: profile.family_id,
        changedBy: user.id,
      });
    }

    setShowDetailModal(false);
    setEditingEvent(null);
    await refetchCustody();
  };

  const handleExportICal = () => {
    downloadICal(filteredEvents, kids);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  // Only block on auth loading — let calendar render while data loads
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="text-4xl mb-3 block animate-pulse">📅</span>
          <p className="text-[var(--color-text-faint)] text-sm">Loading KidSync...</p>
        </div>
      </div>
    );
  }

  // Count pending overrides that need current user's response (grouped by note+date)
  const pendingForMe = overrides.filter(
    (o) => o.status === "pending" && o.created_by !== user?.id
  );
  const pendingGrouped = new Set(
    pendingForMe.map((o) => `${o.note}|${o.start_date}|${o.end_date}`)
  );
  const pendingOverrideCount = pendingGrouped.size;

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ── HEADER ── */}
      <header className="px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex items-center justify-center w-7 h-7 bg-[var(--ink)] text-[var(--accent-ink)] font-display text-sm"
          >
            K
          </span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight leading-none mb-0.5">
              KidSync
            </h1>
            <p className="t-label-sm">
              Signed in · {profile?.full_name?.split(" ")[0] ?? ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Primary action — filled cerulean to stand apart from the outline
              config buttons (Import / Changes / Custody / …) that follow.
              Sits first so the primary calendar action is the leftmost,
              visually nearest to the day grid. */}
          <button
            onClick={() => {
              const d = new Date();
              d.setHours(9, 0, 0, 0);
              setInitialDate(d);
              setEditingEvent(null);
              setShowEventModal(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--action)] bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--action-ring)]"
            title="Create a new event"
          >
            <Plus size={13} />
            New event
          </button>
          <button
            onClick={() => setShowScheduleImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
            title="Import a schedule from PDF, DOCX, or TXT"
          >
            <Upload size={13} />
            Import
          </button>
          <button
            onClick={() => setShowCustodyOverrides(true)}
            className="relative flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <AlertCircle size={13} />
            Changes
            {pendingOverrideCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {pendingOverrideCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowCustodySettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <Shield size={13} />
            Custody
          </button>
          <div className="relative">
            <button
              onClick={() => setShowICalMenu(!showICalMenu)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
            >
              <Download size={13} />
              iCal
            </button>
            {showICalMenu && (
              <div className="absolute right-0 top-10 z-30 bg-[var(--bg)] border border-[var(--border-strong)] rounded-sm shadow-[var(--shadow-md)] py-1.5 min-w-[280px] animate-scale-in">
                <button
                  onClick={() => { handleExportICal(); setShowICalMenu(false); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-surface-alt)] transition-colors text-[var(--color-text)] flex items-center gap-2"
                >
                  <Download size={14} className="text-[var(--color-text-faint)]" />
                  Download .ics File
                </button>
                <div className="border-t border-[var(--color-divider)] my-1" />
                <div className="px-4 py-2">
                  <div className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Link2 size={11} />
                    Calendar Feed URL
                  </div>
                  {profile?.ical_token ? (
                    <>
                      <div className="flex gap-1.5">
                        <input
                          readOnly
                          value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/ical?token=${profile.ical_token}`}
                          className="flex-1 px-2.5 py-1.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[10px] text-[var(--color-text)] font-mono select-all focus:outline-none"
                          onFocus={(e) => e.target.select()}
                        />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${window.location.origin}/api/ical?token=${profile.ical_token}`
                            );
                            setFeedCopied(true);
                            setTimeout(() => setFeedCopied(false), 2000);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-[10px] font-semibold hover:opacity-90 transition-opacity flex items-center gap-1"
                        >
                          {feedCopied ? <Check size={11} /> : <Link2 size={11} />}
                          {feedCopied ? "Copied" : "Copy"}
                        </button>
                      </div>
                      <p className="text-[9px] text-[var(--color-text-faint)] mt-2 leading-relaxed">
                        Add this URL in Google Calendar, Apple Calendar, or Outlook
                        to auto-sync events. Keep this URL private.
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-[var(--color-text-faint)]">
                      No feed token set. Ask your admin to generate one.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => router.push("/trips")}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <PlaneIcon size={13} />
            Trips
          </button>
          <button
            onClick={() => router.push("/settings")}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <Settings size={13} />
            Settings
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] text-xs font-medium hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <LogOut size={13} />
            Sign Out
          </button>
        </div>
      </header>

      {/* ── TOOLBAR ── */}
      <div className="px-6 py-3.5 flex items-center justify-between flex-wrap gap-3">
        {/* Month nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={goBack}
            disabled={currentDate <= MIN_DATE}
            className="w-8 h-8 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="font-display text-lg min-w-[180px] text-center">
            {formatMonthYear(currentDate)}
          </h2>
          <button
            onClick={goForward}
            disabled={currentDate >= MAX_DATE}
            className="w-8 h-8 border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 border border-action/40 bg-action-bg text-action text-[11px] font-semibold hover:bg-action hover:text-action-fg transition-colors"
          >
            Today
          </button>
        </div>

        {/* Filters & view toggle */}
        <KidFilter
          kids={kids}
          activeKid={filterKid}
          onKidChange={setFilterKid}
          view={view}
          onViewChange={setView}
        />
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="px-6 pb-4 flex gap-5 flex-1 min-h-0">
        {/* Calendar area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {eventsLoading ? (
            <div className="bg-[var(--bg)] border border-[var(--border-strong)] shadow-[var(--shadow-sm)] p-12 text-center">
              <div className="animate-pulse text-[var(--color-text-faint)] text-sm">
                Loading events...
              </div>
            </div>
          ) : (
            <>
              {(() => {
                // Per-viewer color resolution. Each parent picks colors
                // for both themselves AND the co-parent (stored as
                // profile.color_preference and profile.partner_color_preference
                // respectively). The two parents can disagree — every
                // user sees the calendar through their own choices.
                //
                // For the signed-in user `me`:
                //   - own color  = me.color_preference
                //   - their color = me.partner_color_preference
                //                  ↳ falls back to the co-parent's own
                //                    color_preference if the viewer
                //                    hasn't customized yet.
                // Then we map those onto parentA/parentB by checking
                // which role the signed-in user holds.
                const parentAId = schedules[0]?.parent_a_id;
                const parentBId = schedules[0]?.parent_b_id;
                const me = members.find((m) => m.id === user?.id);
                const coParent = members.find(
                  (m) => m.id === (me?.id === parentAId ? parentBId : parentAId)
                );
                const myEntry = resolvePalette(
                  me?.color_preference,
                  me?.id === parentBId ? DEFAULT_PARENT_B_COLOR : DEFAULT_PARENT_A_COLOR
                );
                const theirEntry = resolvePalette(
                  // First preference: how I want to see the co-parent.
                  // Fallback: their own self-color. Final fallback:
                  // the role default opposite to mine.
                  me?.partner_color_preference ?? coParent?.color_preference,
                  me?.id === parentAId ? DEFAULT_PARENT_B_COLOR : DEFAULT_PARENT_A_COLOR
                );
                const parentABg = me?.id === parentAId ? myEntry.bg : theirEntry.bg;
                const parentBBg = me?.id === parentBId ? myEntry.bg : theirEntry.bg;
                const parentASwatch = me?.id === parentAId ? myEntry.swatch : theirEntry.swatch;
                const parentBSwatch = me?.id === parentBId ? myEntry.swatch : theirEntry.swatch;
                // Map of profile id → display name, for split-day kid pills.
                const memberNames = Object.fromEntries(
                  members.map((m) => [m.id, m.full_name || "Co-parent"])
                );
                return (
                  <>
                    {view === "month" && (
                      <MonthView
                        currentDate={currentDate}
                        events={filteredEvents}
                        kids={kids}
                        onDayClick={handleDayClick}
                        onEventClick={handleEventClick}
                        getCustodyForDate={getCustodyForDate}
                        currentUserId={user?.id}
                        parentAId={schedules[0]?.parent_a_id}
                        parentABg={parentABg}
                        parentBBg={parentBBg}
                        parentASwatch={parentASwatch}
                        parentBSwatch={parentBSwatch}
                        memberNames={memberNames}
                      />
                    )}
                    {view === "week" && (
                      <WeekView
                        currentDate={currentDate}
                        events={filteredEvents}
                        kids={kids}
                        onDayClick={handleDayClick}
                        onEventClick={handleEventClick}
                        getCustodyForDate={getCustodyForDate}
                        currentUserId={user?.id}
                        parentAId={schedules[0]?.parent_a_id}
                        parentABg={parentABg}
                        parentBBg={parentBBg}
                      />
                    )}
                  </>
                );
              })()}
              {view === "list" && (
                <ListView
                  currentDate={currentDate}
                  events={filteredEvents}
                  kids={kids}
                  members={members}
                  onEventClick={handleEventClick}
                />
              )}
            </>
          )}
        </div>

        {/* Activity sidebar */}
        <ActivityFeed
          logs={logs}
          loading={logsLoading}
          currentUserId={user?.id ?? ""}
        />
      </div>

      {/* ── MODALS ── */}
      {showDetailModal && editingEvent && (
        <EventDetailModal
          event={editingEvent}
          kids={kids}
          members={members}
          onEdit={handleEditFromDetail}
          onDelete={handleDeleteEvent}
          onOpenTravel={handleOpenTravel}
          onDownloadAttachment={handleDownloadAttachment}
          onRequestCustodyChange={() => {
            if (editingEvent?.id.startsWith("turnover-")) {
              setQuickChangeEvent(editingEvent);
            } else {
              setShowCustodyOverrides(true);
            }
          }}
          onCancelExchange={handleCancelExchange}
          onDeleteOccurrence={handleDeleteOccurrence}
          onEditOccurrence={handleEditOccurrence}
          relatedOverrides={
            editingEvent.id.startsWith("turnover-")
              ? overrides.filter((o) => {
                  const eventDate = editingEvent.starts_at.split("T")[0];
                  return eventDate >= o.start_date && eventDate <= o.end_date;
                })
              : undefined
          }
          onClose={() => {
            setShowDetailModal(false);
            setEditingEvent(null);
          }}
        />
      )}

      {showEventModal && (
        <EventModal
          event={editingEvent}
          initialDate={initialDate}
          kids={kids}
          onSave={handleSaveEvent}
          onDelete={handleDeleteEvent}
          onCreateCustodyExchange={async (data) => {
            if (!profile?.family_id || !user) return;
            const otherParent = members.find((m) => m.id !== user.id);
            const kidNames = data.kidIds
              .map((id) => kids.find((k) => k.id === id)?.name)
              .filter(Boolean)
              .join(" & ");
            const description = `Custom custody: ${kidNames} with ${profile.full_name?.split(" ")[0] || "Dad"} — Pickup ${data.pickupDate} at ${data.pickupTime}, Drop-off ${data.dropoffDate} at ${data.dropoffTime}${data.notes ? ` — ${data.notes}` : ""}`;

            await createOverrides(data.kidIds.map((kidId) => ({
              family_id: profile.family_id,
              kid_id: kidId,
              start_date: data.pickupDate,
              end_date: data.dropoffDate,
              parent_id: user.id,
              note: description,
              reason: data.notes || "Custom custody exchange",
              compliance_status: "unchecked" as const,
              compliance_issues: null,
              status: "pending" as OverrideStatus,
              created_by: user.id,
              // Carry the form's pickup time into override_time so the
              // turnover-event generator places the pill at the chosen
              // hour. Schema is a single column, so we use the pickup time;
              // the dropoff time is implicit (falls to the schedule's
              // default dropoff, which is 17:00 in our agreement).
              override_time: data.pickupTime || null,
            })));
            notifyCustodyChange({
              action: "requested",
              override: { start_date: data.pickupDate, end_date: data.dropoffDate, parent_id: user.id, note: description, reason: data.notes || "Custom custody exchange" },
              kidIds: data.kidIds,
              familyId: profile.family_id,
              changedBy: user.id,
            });

            setShowEventModal(false);
            setEditingEvent(null);
            await refetchCustody();
          }}
          onClose={() => {
            setShowEventModal(false);
            setEditingEvent(null);
          }}
          onOpenTravel={handleOpenTravel}
          onCreateTripRequested={(initialTitle) => {
            setShowEventModal(false);
            setEditingEvent(null);
            setTripCreationInitialTitle(initialTitle);
            setShowTripCreation(true);
          }}
        />
      )}

      {/* Trip creation modal — opened from the EventModal's Travel
          pill or the calendar's "+ Trip" button. Drops the user into
          Trip View as soon as the trip is created. */}
      {showTripCreation && (
        <TripCreationModal
          kids={kids}
          members={members}
          currentUserId={user?.id}
          initialTitle={tripCreationInitialTitle}
          onClose={() => {
            setShowTripCreation(false);
            setTripCreationInitialTitle("");
          }}
          onCreate={async (input: NewTripInput) => createTrip(input)}
          onCreated={(trip: Trip) => {
            setShowTripCreation(false);
            setTripCreationInitialTitle("");
            setOpenTripId(trip.id);
          }}
        />
      )}

      {/* Trip View modal — opened by clicking a trip ribbon, by
          clicking a trip-linked segment, or right after a trip is
          created. */}
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
                // Plan §15e: when there are linked overrides on a
                // trip being deleted, give the user an explicit
                // choice to also withdraw them. Already-confirmed
                // by TripView's pre-confirm dialog at this point.
                const activeLinked = linked.filter(
                  (o) => o.status !== "withdrawn"
                );
                if (activeLinked.length > 0) {
                  const withdraw = confirm(
                    `Also withdraw the ${activeLinked.length} linked custody override${
                      activeLinked.length === 1 ? "" : "s"
                    }? Click OK to withdraw, Cancel to keep them in place.`
                  );
                  if (withdraw && profile?.family_id && user) {
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
                // Both trip-level and segment paths live in the same
                // bucket — either signed-URL helper works.
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

      {/* Lodging form — opens from TripView's "+ Add stay" or by
          clicking an existing lodging row to edit it. */}
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
              prefillCity={lodgingForm.prefillCity}
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
                // Bump status from draft → planned once the user
                // adds real content.
                if (trip.status === "draft") {
                  await updateTrip(trip.id, { status: "planned" });
                }
              }}
            />
          );
        })()}

      {/* Transport form — opens from TripView's "+ Add" menu under
          Transportation, or by clicking an existing transport row.
          Drive type can chain "Save & next leg" to immediately
          re-open with the previous arrival pre-filled. */}
      {transportForm &&
        (() => {
          const trip = trips.find((t) => t.id === transportForm.tripId);
          if (!trip) return null;
          // Stable key per (trip, editing-id, prefill-from) so the
          // form remounts (and re-initializes form state) when we
          // chain into the next leg with a fresh prefill.
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
                // Re-open the form pre-filled from this drive's
                // arrival. The arrival becomes the next leg's
                // departure; the next day at 9am is a sensible
                // default starting time.
                const drive = input.segment_data as {
                  to_location?: string;
                  to_timezone?: string;
                };
                const nextDay = new Date(input.ends_at);
                nextDay.setDate(nextDay.getDate() + 1);
                nextDay.setHours(9, 0, 0, 0);
                const tz = drive.to_timezone || input.time_zone || "UTC";
                // Format as datetime-local in the destination tz so
                // the next form's input shows "9:00 AM Tue" in that zone.
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

      {/* Override-proposal modal (Plan §15a–b). Opens from the
          Trip View's "Propose override" button. Pre-fills with the
          conflict-detection result and lets the user shift dates
          (e.g. ±1 day for "pickup the day before flight"). */}
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
            // Race: the user clicked while a state update removed
            // the conflict. Just close.
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
                    // The link that lets us prompt for withdrawal on
                    // trip-cancel (15e) and detect 15d window
                    // conflicts when trip dates shift.
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

      {/* Cruise form (Phase 3). The form returns a body + port-stops
          diff; this handler creates/updates the body, then walks the
          port-stops to create new + update existing + delete removed,
          all linked via parent_segment_id. */}
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
                // 1. Create or update the cruise body
                let cruiseId: string | null = cruiseForm.editing?.id ?? null;
                if (cruiseForm.editing) {
                  await updateSegment(cruiseForm.editing.id, input.body);
                } else {
                  const created = await createSegment(input.body);
                  cruiseId = created?.id ?? null;
                }
                if (!cruiseId) {
                  console.error("Cruise body save returned no id");
                  return;
                }

                // 2. Delete removed port stops
                for (const removedId of input.removedPortStopIds) {
                  await deleteEvent(removedId);
                }

                // 3. Create / update each remaining port stop
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

      {/* Port-stop popover (plan §10c). Click a port-stop ribbon
          → tiny modal with arrival/departure times and a "View
          trip" link, instead of dragging the user into TripView. */}
      {portStopPopover &&
        (() => {
          const portStop = events.find((e) => e.id === portStopPopover.portStopId);
          if (!portStop) {
            setPortStopPopover(null);
            return null;
          }
          const cruise = portStop.parent_segment_id
            ? events.find((e) => e.id === portStop.parent_segment_id)
            : undefined;
          return (
            <PortStopPopover
              portStop={portStop}
              cruise={cruise ?? undefined}
              onClose={() => setPortStopPopover(null)}
              onViewTrip={() => {
                if (portStop.trip_id) setOpenTripId(portStop.trip_id);
                setPortStopPopover(null);
              }}
            />
          );
        })()}

      {showTravelModal && (
        <TravelModal
          existing={existingTravel}
          onSave={handleSaveTravel}
          onClose={() => {
            setShowTravelModal(false);
            setTravelEventId(null);
            setExistingTravel(null);
          }}
        />
      )}

      {showCustodySettings && profile?.family_id && (
        <CustodySettings
          familyId={profile.family_id}
          kids={kids}
          members={members}
          currentUserId={user?.id ?? ""}
          agreements={agreements}
          schedules={schedules}
          onClose={() => {
            setShowCustodySettings(false);
            refetchCustody();
          }}
        />
      )}

      {showCustodyOverrides && profile?.family_id && (
        <CustodyOverrides
          familyId={profile.family_id}
          kids={kids}
          members={members}
          overrides={overrides}
          agreements={agreements}
          currentUserId={user?.id ?? ""}
          onRespondToOverrides={respondToOverrides}
          onNotifyCustodyChange={notifyCustodyChange}
          onClose={async () => {
            setShowCustodyOverrides(false);
            await refetchCustody();
          }}
        />
      )}

      {showScheduleImport && (
        <ScheduleImportModal
          kids={kids}
          onCreateEvents={createEventsBatch}
          // Single auth call + parallel updates without read-back. Sequential
          // looping over updateEvent deadlocked on Supabase auth-token
          // refresh contention with the realtime subscription (8 merges =
          // 8× auth.getUser() round-trips), tripping the modal's 30s timeout.
          // See useEvents.updateEventsBatch for the full reasoning.
          onUpdateEvents={updateEventsBatch}
          existingEvents={events}
          onClose={() => setShowScheduleImport(false)}
          onDone={() => { refetch(); }}
        />
      )}

      {quickChangeEvent && profile?.family_id && (
        <QuickCustodyChange
          turnoverEvent={quickChangeEvent}
          kids={kids}
          members={members}
          familyId={profile.family_id}
          currentUserId={user?.id ?? ""}
          onMoveTurnover={moveTurnover}
          onNotifyCustodyChange={notifyCustodyChange}
          onClose={async () => {
            setQuickChangeEvent(null);
            setShowDetailModal(false);
            setEditingEvent(null);
            await refetchCustody();
          }}
        />
      )}
    </div>
  );
}
