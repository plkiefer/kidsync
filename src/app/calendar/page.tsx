"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamily";
import { useEvents } from "@/hooks/useEvents";
import { useActivityLog } from "@/hooks/useActivityLog";
import { CalendarEvent, EventFormData, TravelFormData } from "@/lib/types";
import {
  formatMonthYear,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
} from "@/lib/dates";
import { downloadICal } from "@/lib/ical";
import MonthView from "@/components/MonthView";
import WeekView from "@/components/WeekView";
import ListView from "@/components/ListView";
import EventModal from "@/components/EventModal";
import TravelModal from "@/components/TravelModal";
import KidFilter from "@/components/KidFilter";
import ActivityFeed from "@/components/ActivityFeed";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Download,
  LogOut,
} from "lucide-react";

type ViewMode = "month" | "week" | "list";

export default function CalendarPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const { kids, members, loading: familyLoading } = useFamily();
  const {
    events,
    loading: eventsLoading,
    createEvent,
    updateEvent,
    deleteEvent,
    saveTravelDetails,
    getTravelDetails,
  } = useEvents();
  const { logs, loading: logsLoading } = useActivityLog();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewMode>("month");
  const [filterKid, setFilterKid] = useState("all");

  // Modal state
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [initialDate, setInitialDate] = useState<Date | undefined>(undefined);
  const [showTravelModal, setShowTravelModal] = useState(false);
  const [travelEventId, setTravelEventId] = useState<string | null>(null);
  const [existingTravel, setExistingTravel] = useState<any>(null);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Filter events
  const filteredEvents =
    filterKid === "all"
      ? events
      : events.filter((e) => e.kid_id === filterKid);

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
    setShowEventModal(true);
  };

  const handleSaveEvent = async (data: EventFormData) => {
    if (editingEvent) {
      await updateEvent(editingEvent.id, data);
    } else {
      await createEvent(data);
    }
    setShowEventModal(false);
    setEditingEvent(null);
  };

  const handleDeleteEvent = async (id: string) => {
    await deleteEvent(id);
    setShowEventModal(false);
    setEditingEvent(null);
  };

  const handleOpenTravel = async (eventId: string) => {
    setShowEventModal(false);
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

  const handleExportICal = () => {
    downloadICal(filteredEvents, kids);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  // Loading state
  if (authLoading || familyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <span className="text-4xl mb-3 block animate-pulse">📅</span>
          <p className="text-[var(--color-text-faint)] text-sm">Loading KidSync...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) return null;

  return (
    <div className="min-h-screen">
      {/* ── HEADER ── */}
      <header className="px-6 py-4 border-b border-[var(--color-divider)] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📅</span>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">
              KidSync
            </h1>
            <p className="text-[11px] text-[var(--color-text-faint)]">
              Logged in as {profile.full_name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
      <div className="px-6 pb-6 flex gap-5">
        {/* Calendar area */}
        <div className="flex-1 min-w-0">
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
                />
              )}
              {view === "week" && (
                <WeekView
                  currentDate={currentDate}
                  events={filteredEvents}
                  kids={kids}
                  onEventClick={handleEventClick}
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
          currentUserId={user.id}
          icalToken={profile.ical_token}
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
    </div>
  );
}
