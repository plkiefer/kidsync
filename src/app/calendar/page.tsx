"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamily";
import { useEvents } from "@/hooks/useEvents";
import { useActivityLog } from "@/hooks/useActivityLog";
import { useCustody } from "@/hooks/useCustody";
import { CalendarEvent, EventFormData, TravelFormData, EventAttachment, getEventKidIds, OverrideStatus } from "@/lib/types";
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
import { expandRecurringEvents } from "@/lib/recurrence";
import { generateTurnoverEvents, generateHolidayEvents } from "@/lib/virtualEvents";
import MonthView from "@/components/MonthView";
import WeekView from "@/components/WeekView";
import ListView from "@/components/ListView";
import EventModal from "@/components/EventModal";
import EventDetailModal from "@/components/EventDetailModal";
import TravelModal from "@/components/TravelModal";
import QuickCustodyChange from "@/components/QuickCustodyChange";
import KidFilter from "@/components/KidFilter";
import ActivityFeed from "@/components/ActivityFeed";
import CustodySettings from "@/components/CustodySettings";
import CustodyOverrides from "@/components/CustodyOverrides";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Download,
  LogOut,
  Shield,
  AlertCircle,
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
    updateEvent,
    deleteEvent,
    saveTravelDetails,
    getTravelDetails,
    uploadAttachment,
    removeAttachment,
    getAttachmentUrl,
    refetch,
  } = useEvents(dataReady);
  const { logs, loading: logsLoading } = useActivityLog(20, dataReady);
  const {
    schedules,
    getCustodyForDate,
    overrides,
    agreements,
    createOverride,
    respondToOverride,
    refetchCustody,
  } = useCustody(dataReady);

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
  const [quickChangeEvent, setQuickChangeEvent] = useState<CalendarEvent | null>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

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
          starts_at: `${dateStr}T12:00:00`,
          ends_at: `${dateStr}T12:00:00`,
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

  // Navigation
  const goBack = () => {
    if (view === "month") setCurrentDate((d) => subMonths(d, 1));
    else setCurrentDate((d) => subWeeks(d, 1));
  };

  const goForward = () => {
    if (view === "month") setCurrentDate((d) => addMonths(d, 1));
    else setCurrentDate((d) => addWeeks(d, 1));
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
      // Non-standard: withdraw the overrides that created it
      if (!window.confirm("Revert this exchange to the standard schedule?")) return;
      for (const o of relatedOvr) {
        await respondToOverride(o.id, "withdrawn", "Reverted to standard schedule", user.id);
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

      for (const kidId of eventKidIds) {
        await createOverride({
          family_id: profile.family_id,
          kid_id: kidId,
          start_date: rangeStart,
          end_date: rangeEnd,
          parent_id: otherParent?.id || "",
          note: `Weekend cancelled for ${kidNames} (${rangeStart} to ${rangeEnd})`,
          reason: "Exchange cancelled",
          compliance_status: "unchecked",
          compliance_issues: null,
          status: "pending" as OverrideStatus,
          created_by: user.id,
        });
      }
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

  // Count pending overrides that need current user's response
  const pendingOverrideCount = overrides.filter(
    (o) => o.status === "pending" && o.created_by !== user?.id
  ).length;

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ── HEADER ── */}
      <header className="px-6 py-4 border-b border-[var(--color-divider)] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📅</span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">
              KidSync
            </h1>
            <p className="text-[11px] text-[var(--color-text-faint)]">
              Logged in as {profile?.full_name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCustodyOverrides(true)}
            className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
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
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-semibold hover:bg-indigo-500/20 transition-colors"
          >
            <Shield size={13} />
            Custody
          </button>
          <button
            onClick={handleExportICal}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/30 text-[var(--color-text-muted)] text-xs font-semibold hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <Download size={13} />
            Export iCal
          </button>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/30 text-[var(--color-text-muted)] text-xs font-semibold hover:bg-[var(--color-surface-alt)] transition-colors"
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
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="font-display text-lg min-w-[180px] text-center">
            {formatMonthYear(currentDate)}
          </h2>
          <button
            onClick={goForward}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 text-[var(--color-accent)] text-[11px] font-semibold hover:bg-blue-500/20 transition-colors"
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
            <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] p-12 text-center">
              <div className="animate-pulse text-[var(--color-text-faint)] text-sm">
                Loading events...
              </div>
            </div>
          ) : (
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
                />
              )}
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

      {/* ── FAB ── */}
      <button
        onClick={() => {
          const d = new Date();
          d.setHours(9, 0, 0, 0);
          setInitialDate(d);
          setEditingEvent(null);
          setShowEventModal(true);
        }}
        className="fixed bottom-7 left-7 w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white text-2xl flex items-center justify-center shadow-xl shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-105 transition-all"
      >
        <Plus size={24} />
      </button>

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
          onClose={() => {
            setShowEventModal(false);
            setEditingEvent(null);
          }}
          onOpenTravel={handleOpenTravel}
        />
      )}

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
          onCreateOverride={createOverride}
          onRespondToOverride={respondToOverride}
          onClose={async () => {
            setShowCustodyOverrides(false);
            await refetchCustody();
          }}
        />
      )}

      {quickChangeEvent && profile?.family_id && (
        <QuickCustodyChange
          turnoverEvent={quickChangeEvent}
          kids={kids}
          members={members}
          familyId={profile.family_id}
          currentUserId={user?.id ?? ""}
          onSubmit={createOverride}
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
