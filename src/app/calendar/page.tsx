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
  Link2,
  Check,
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
    createOverrides,
    respondToOverrides,
    withdrawOverlapping,
    moveTurnover,
    notifyCustodyChange,
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
          <div className="relative">
            <button
              onClick={() => setShowICalMenu(!showICalMenu)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/30 text-[var(--color-text-muted)] text-xs font-semibold hover:bg-[var(--color-surface-alt)] transition-colors"
            >
              <Download size={13} />
              iCal
            </button>
            {showICalMenu && (
              <div className="absolute right-0 top-10 z-30 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-lg py-1.5 min-w-[280px] animate-scale-in">
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
            disabled={currentDate <= MIN_DATE}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="font-display text-lg min-w-[180px] text-center">
            {formatMonthYear(currentDate)}
          </h2>
          <button
            onClick={goForward}
            disabled={currentDate >= MAX_DATE}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
          onRespondToOverrides={respondToOverrides}
          onNotifyCustodyChange={notifyCustodyChange}
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
