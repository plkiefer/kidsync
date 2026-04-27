"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  CalendarEvent,
  EventFormData,
  EventTravelDetails,
  TravelFormData,
  EventAttachment,
} from "@/lib/types";

interface EventsState {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  createEvent: (data: EventFormData) => Promise<CalendarEvent | null>;
  createEventsBatch: (
    rows: EventFormData[]
  ) => Promise<{ inserted: number; failed: number; error?: string }>;
  updateEventsBatch: (
    updates: Array<{ id: string; patch: Partial<EventFormData> }>
  ) => Promise<{ updated: number; failed: number; error?: string }>;
  updateEvent: (
    id: string,
    data: Partial<EventFormData>
  ) => Promise<CalendarEvent | null>;
  deleteEvent: (id: string) => Promise<boolean>;
  getEvent: (id: string) => Promise<CalendarEvent | null>;
  saveTravelDetails: (
    eventId: string,
    data: TravelFormData
  ) => Promise<EventTravelDetails | null>;
  getTravelDetails: (eventId: string) => Promise<EventTravelDetails | null>;
  uploadAttachment: (
    eventId: string,
    file: File
  ) => Promise<EventAttachment | null>;
  removeAttachment: (
    eventId: string,
    attachment: EventAttachment
  ) => Promise<boolean>;
  getAttachmentUrl: (path: string) => Promise<string | null>;
  refetch: () => Promise<void>;
}

/** Separate travel inline fields from the main event data */
function extractTravelFields(data: EventFormData) {
  const {
    travel_departure_airport,
    travel_arrival_airport,
    travel_departure_time,
    travel_arrival_time,
    travel_departure_timezone,
    travel_arrival_timezone,
    travel_lodging_name,
    travel_lodging_address,
    travel_lodging_phone,
    travel_lodging_confirmation,
    ...eventData
  } = data;
  return {
    eventData,
    travelFields: {
      travel_departure_airport,
      travel_arrival_airport,
      travel_departure_time,
      travel_arrival_time,
      travel_departure_timezone,
      travel_arrival_timezone,
      travel_lodging_name,
      travel_lodging_address,
      travel_lodging_phone,
      travel_lodging_confirmation,
    },
  };
}

/** Check if any inline travel fields have values */
function hasTravelData(fields: Record<string, string | undefined>): boolean {
  return Object.values(fields).some((v) => v && v.trim());
}

/**
 * Fire-and-forget email notification to the other parent. Used by single-
 * event create/update/delete paths (NOT by bulk createEventsBatch /
 * updateEventsBatch — bulk imports intentionally stay silent so we don't
 * email someone 30 times for one school-calendar import).
 *
 * Mirrors the pattern in useCustody.notifyCustodyChange — the calendar
 * event trigger USED to fire this server-side via pg_net.http_post, but
 * that blocked the INSERT response per row and made bulk imports time
 * out. The notification is a side effect, not part of the write, so it
 * belongs out here on the client.
 */
type CalendarNotifyAction = "created" | "updated" | "deleted";
function fireCalendarNotification(
  supabase: ReturnType<typeof getSupabase>,
  action: CalendarNotifyAction,
  event: Record<string, unknown>,
  family_id: string,
  changed_by: string
): void {
  supabase.functions
    .invoke("notify-parent", {
      body: { action, event, family_id, changed_by },
    })
    .catch((err) => {
      console.warn("[events] notification failed:", err);
    });
}

export function useEvents(
  ready = true,
  /**
   * Optional pre-resolved auth context from the parent page. When provided,
   * batch write operations skip `supabase.auth.getSession()` and use these
   * values directly. This is critical: in supabase-js v2 the auth client
   * holds an internal lock around session reads, and if the realtime
   * websocket has the lock acquired (e.g., during a Cloudflare-bot-mitigation
   * cookie negotiation we observed in console — '__cf_bm rejected for
   * invalid domain'), getSession() hangs FOREVER without a network call,
   * blocking the entire write path. Threading auth from the page bypasses
   * the lock entirely.
   */
  authUserId?: string,
  authFamilyId?: string
): EventsState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabase();

  // Keep auth context in a ref so the batch ops always read the latest
  // value without re-creating their useCallback closures on every render.
  const authCtxRef = useRef<{ userId?: string; familyId?: string }>({
    userId: authUserId,
    familyId: authFamilyId,
  });
  useEffect(() => {
    authCtxRef.current = { userId: authUserId, familyId: authFamilyId };
  }, [authUserId, authFamilyId]);

  // Fetch all events with kid data
  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from("calendar_events")
        .select(
          `
          *,
          kid:kids(*),
          travel:event_travel_details(*)
        `
        )
        .order("starts_at", { ascending: true });

      if (fetchErr) throw fetchErr;

      // Normalize travel from array to single object + normalize kid_ids
      const normalized = (data || []).map((evt: any) => ({
        ...evt,
        kid_ids:
          evt.kid_ids && evt.kid_ids.length > 0
            ? evt.kid_ids
            : [evt.kid_id],
        travel:
          evt.travel && evt.travel.length > 0 ? evt.travel[0] : null,
      }));

      setEvents(normalized as CalendarEvent[]);
    } catch (err) {
      console.error("Error fetching events:", err);
      setError(err instanceof Error ? err.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Initial fetch — only after auth is ready
  useEffect(() => {
    if (ready) {
      fetchEvents();
    } else {
      setLoading(false);
    }
  }, [fetchEvents, ready]);

  /**
   * Realtime subscription — only after auth is ready.
   *
   * IMPORTANT: every postgres_changes event triggers a FULL table refetch
   * (select * with joins). When createEventsBatch inserts N rows, Supabase
   * fires N separate change events. Without debouncing, that cascades into
   * N parallel fetchEvents() calls, all going through supabase-js's auth-
   * token serialization layer. For N=18 that meant the import sat for 90+
   * seconds even though the rows had landed in the DB on the first round-
   * trip — exactly the read-back deadlock the createEventsBatch insert
   * sidesteps with `no .select()`.
   *
   * The debounce collapses any burst of changes that arrive within 400ms
   * of quiescence into ONE fetch. Single edits feel instantaneous (one
   * change → 400ms wait → one fetch), bulk imports finish in seconds
   * instead of timing out.
   */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready) return;

    const channel = supabase
      .channel("calendar_events_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "calendar_events",
        },
        () => {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            fetchEvents();
            debounceRef.current = null;
          }, 400);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [supabase, fetchEvents, ready]);

  // Create event
  const createEvent = useCallback(
    async (data: EventFormData): Promise<CalendarEvent | null> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const { data: profile } = await supabase
          .from("profiles")
          .select("family_id")
          .eq("id", user.id)
          .single();

        if (!profile) throw new Error("Profile not found");

        const { eventData, travelFields } = extractTravelFields(data);

        const { data: newEvent, error: createErr } = await supabase
          .from("calendar_events")
          .insert({
            family_id: profile.family_id,
            kid_id: eventData.kid_ids[0],
            kid_ids: eventData.kid_ids,
            title: eventData.title,
            event_type: eventData.event_type,
            starts_at: eventData.starts_at,
            ends_at: eventData.ends_at,
            all_day: eventData.all_day,
            time_zone: eventData.time_zone || null,
            location: eventData.location || null,
            notes: eventData.notes || null,
            recurring_rule: eventData.recurring_rule || null,
            created_by: user.id,
          })
          .select(
            `
            *,
            kid:kids(*),
            travel:event_travel_details(*)
          `
          )
          .single();

        if (createErr) throw createErr;

        // If travel type with inline fields, upsert travel details
        if (
          eventData.event_type === "travel" &&
          hasTravelData(travelFields) &&
          newEvent
        ) {
          await supabase.from("event_travel_details").upsert(
            {
              event_id: newEvent.id,
              lodging_name: travelFields.travel_lodging_name || null,
              lodging_address: travelFields.travel_lodging_address || null,
              lodging_phone: travelFields.travel_lodging_phone || null,
              lodging_confirmation:
                travelFields.travel_lodging_confirmation || null,
              flights: travelFields.travel_departure_airport
                ? [
                    {
                      leg: 1,
                      direction: "outbound",
                      carrier: "",
                      flight_number: "",
                      departure_airport:
                        travelFields.travel_departure_airport || "",
                      arrival_airport:
                        travelFields.travel_arrival_airport || "",
                      departure_time:
                        travelFields.travel_departure_time || "",
                      arrival_time: travelFields.travel_arrival_time || "",
                      departure_timezone:
                        travelFields.travel_departure_timezone || null,
                      arrival_timezone:
                        travelFields.travel_arrival_timezone || null,
                      confirmation: "",
                      seat: "",
                      notes: "",
                    },
                  ]
                : [],
            },
            { onConflict: "event_id" }
          );
        }

        // Notify the other parent (fire-and-forget; does not block return).
        if (newEvent) {
          fireCalendarNotification(
            supabase,
            "created",
            newEvent as unknown as Record<string, unknown>,
            profile.family_id,
            user.id
          );
        }

        return newEvent as CalendarEvent;
      } catch (err) {
        console.error("Error creating event:", err);
        setError(
          err instanceof Error ? err.message : "Failed to create event"
        );
        return null;
      }
    },
    [supabase]
  );

  /**
   * Bulk-insert non-travel events in a single Supabase call.
   *
   * Why this exists: the per-row createEvent path re-fetches user + profile
   * each iteration AND the realtime subscription fires fetchEvents on every
   * INSERT. At ~20+ rows that produces cascading token-refresh contention
   * that deadlocks Supabase (see the warning in app/calendar/page.tsx about
   * "Data hooks only query AFTER auth resolves").
   *
   * This helper: auth + profile lookup ONCE, then a single array insert.
   * One INSERT → one realtime event → no cascade. Intended for the Schedule
   * Import flow; general event creation still uses createEvent.
   *
   * Travel events are rejected here — the schedule importer doesn't emit
   * them, and travel needs the sibling event_travel_details upsert which
   * this path skips.
   */
  const createEventsBatch = useCallback(
    async (
      rows: EventFormData[]
    ): Promise<{ inserted: number; failed: number; error?: string }> => {
      if (!rows.length) return { inserted: 0, failed: 0 };
      try {
        // Prefer the page-provided auth context (set via useEvents'
        // authUserId/authFamilyId params). Bypasses supabase.auth's
        // internal lock entirely — see the hook signature comment.
        let userId = authCtxRef.current.userId;
        let familyId = authCtxRef.current.familyId;

        if (!userId || !familyId) {
          // Fallback path for callers that didn't thread auth in.
          // This CAN hang if the auth lock is held — see the diagnosis
          // in commit history. Logged loudly so we notice.
          console.warn(
            "[createEventsBatch] no cached auth context — falling back to getSession (may hang)"
          );
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session?.user) throw new Error("Not authenticated");
          userId = session.user.id;

          const { data: profile } = await supabase
            .from("profiles")
            .select("family_id")
            .eq("id", session.user.id)
            .single();
          if (!profile) throw new Error("Profile not found");
          familyId = profile.family_id;
        }

        const payload = rows.map((data) => ({
          family_id: familyId,
          kid_id: data.kid_ids[0],
          kid_ids: data.kid_ids,
          title: data.title,
          event_type: data.event_type,
          starts_at: data.starts_at,
          ends_at: data.ends_at,
          all_day: data.all_day,
          time_zone: data.time_zone || null,
          location: data.location || null,
          notes: data.notes || null,
          recurring_rule: data.recurring_rule || null,
          created_by: userId,
        }));

        // No .select() — reading the inserted rows back while the realtime
        // subscription is also firing a .select() on the same table causes
        // supabase-js to serialize them, which can deadlock through the
        // auth-refresh path. We don't need the returned rows; the subscription
        // will re-fetch and the UI will see them within a tick.
        const { error: insertErr } = await supabase
          .from("calendar_events")
          .insert(payload);

        if (insertErr) throw insertErr;

        return {
          inserted: rows.length,
          failed: 0,
        };
      } catch (err) {
        console.error("[createEventsBatch] caught error:", err);
        return {
          inserted: 0,
          failed: rows.length,
          error: err instanceof Error ? err.message : "Batch insert failed",
        };
      }
    },
    [supabase]
  );

  /**
   * Batch update — runs N updates in parallel from a single authenticated
   * context. The per-row updateEvent call does its own auth.getUser() and
   * select-back, which when looped sequentially over 5+ rows races with
   * the realtime subscription's auth-token refresh and deadlocks (this is
   * exactly why createEventsBatch exists for inserts). Schedule importer
   * Phase B merge path needs this for non-trivial calendars where the user
   * hits 8+ near-duplicate rows in one shot.
   *
   * Strategy:
   *   1. Single auth call up front.
   *   2. Each update runs as its own .update().eq() call (different patches
   *      can't share one SQL statement) — but in parallel via Promise.all.
   *   3. NO .select() on any update. The realtime subscription delivers the
   *      patched rows without us reading them back, dodging the same
   *      serialize-and-deadlock path createEventsBatch documents.
   */
  const updateEventsBatch = useCallback(
    async (
      updates: Array<{ id: string; patch: Partial<EventFormData> }>
    ): Promise<{ updated: number; failed: number; error?: string }> => {
      if (!updates.length) return { updated: 0, failed: 0 };
      try {
        // Same bypass as createEventsBatch — read auth from the ref the
        // page wired in. getSession is only the fallback for callers that
        // didn't thread auth through.
        let userId = authCtxRef.current.userId;
        if (!userId) {
          console.warn(
            "[updateEventsBatch] no cached auth context — falling back to getSession (may hang)"
          );
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session?.user) throw new Error("Not authenticated");
          userId = session.user.id;
        }

        const buildPayload = (patch: Partial<EventFormData>) => {
          // Strip travel-only fields (the importer doesn't emit them, but the
          // type allows them; keep this defensive in case a caller passes a
          // mixed patch). updated_by always set so the activity log attributes
          // the change to the right user.
          const {
            travel_departure_airport: _a,
            travel_arrival_airport: _b,
            travel_departure_time: _c,
            travel_arrival_time: _d,
            travel_departure_timezone: _ctz,
            travel_arrival_timezone: _dtz,
            travel_lodging_name: _e,
            travel_lodging_address: _f,
            travel_lodging_phone: _g,
            travel_lodging_confirmation: _h,
            kid_ids,
            ...rest
          } = patch as any;
          const payload: any = { ...rest, updated_by: userId };
          if (kid_ids) {
            payload.kid_id = kid_ids[0];
            payload.kid_ids = kid_ids;
          }
          return payload;
        };

        const results = await Promise.all(
          updates.map(async ({ id, patch }) => {
            const { error } = await supabase
              .from("calendar_events")
              .update(buildPayload(patch))
              .eq("id", id);
            return { ok: !error, error };
          })
        );

        const updated = results.filter((r) => r.ok).length;
        const failed = results.length - updated;
        const firstErr = results.find((r) => !r.ok)?.error;
        return {
          updated,
          failed,
          error: firstErr?.message,
        };
      } catch (err) {
        console.error("Error batch-updating events:", err);
        return {
          updated: 0,
          failed: updates.length,
          error: err instanceof Error ? err.message : "Batch update failed",
        };
      }
    },
    [supabase]
  );

  // Update event
  const updateEvent = useCallback(
    async (
      id: string,
      data: Partial<EventFormData>
    ): Promise<CalendarEvent | null> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Separate travel fields if present
        const {
          travel_departure_airport,
          travel_arrival_airport,
          travel_departure_time,
          travel_arrival_time,
          travel_departure_timezone,
          travel_arrival_timezone,
          travel_lodging_name,
          travel_lodging_address,
          travel_lodging_phone,
          travel_lodging_confirmation,
          kid_ids,
          ...rest
        } = data as any;

        const updatePayload: any = {
          ...rest,
          updated_by: user.id,
        };

        if (kid_ids) {
          updatePayload.kid_id = kid_ids[0];
          updatePayload.kid_ids = kid_ids;
        }

        // Remove travel fields from update payload
        delete updatePayload.travel_departure_airport;
        delete updatePayload.travel_arrival_airport;
        delete updatePayload.travel_departure_time;
        delete updatePayload.travel_arrival_time;
        delete updatePayload.travel_departure_timezone;
        delete updatePayload.travel_arrival_timezone;
        delete updatePayload.travel_lodging_name;
        delete updatePayload.travel_lodging_address;
        delete updatePayload.travel_lodging_phone;
        delete updatePayload.travel_lodging_confirmation;

        const { data: updated, error: updateErr } = await supabase
          .from("calendar_events")
          .update(updatePayload)
          .eq("id", id)
          .select(
            `
            *,
            kid:kids(*),
            travel:event_travel_details(*)
          `
          )
          .single();

        if (updateErr) throw updateErr;

        // Upsert travel details if travel type
        const travelFields = {
          travel_departure_airport,
          travel_arrival_airport,
          travel_departure_time,
          travel_arrival_time,
          travel_lodging_name,
          travel_lodging_address,
          travel_lodging_phone,
          travel_lodging_confirmation,
        };

        if (
          rest.event_type === "travel" &&
          hasTravelData(travelFields)
        ) {
          await supabase.from("event_travel_details").upsert(
            {
              event_id: id,
              lodging_name: travel_lodging_name || null,
              lodging_address: travel_lodging_address || null,
              lodging_phone: travel_lodging_phone || null,
              lodging_confirmation: travel_lodging_confirmation || null,
              flights: travel_departure_airport
                ? [
                    {
                      leg: 1,
                      direction: "outbound",
                      carrier: "",
                      flight_number: "",
                      departure_airport: travel_departure_airport || "",
                      arrival_airport: travel_arrival_airport || "",
                      departure_time: travel_departure_time || "",
                      arrival_time: travel_arrival_time || "",
                      departure_timezone: travel_departure_timezone || null,
                      arrival_timezone: travel_arrival_timezone || null,
                      confirmation: "",
                      seat: "",
                      notes: "",
                    },
                  ]
                : [],
            },
            { onConflict: "event_id" }
          );
        }

        // Notify the other parent (fire-and-forget; does not block return).
        if (updated && (updated as any).family_id) {
          fireCalendarNotification(
            supabase,
            "updated",
            updated as unknown as Record<string, unknown>,
            (updated as any).family_id,
            user.id
          );
        }

        return updated as CalendarEvent;
      } catch (err) {
        console.error("Error updating event:", err);
        setError(
          err instanceof Error ? err.message : "Failed to update event"
        );
        return null;
      }
    },
    [supabase]
  );

  // Delete event
  const deleteEvent = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // The DB trigger (handle_event_change) reads updated_by as changed_by
        // for DELETE actions, so we must set it before deleting. We also
        // grab a snapshot of the row here so we can fire the email
        // notification client-side after the delete (the trigger no longer
        // does that — see notify_triggers.sql).
        const { data: snapshot } = await supabase
          .from("calendar_events")
          .update({ updated_by: user.id })
          .eq("id", id)
          .select("*")
          .single();

        const { error: deleteErr, status, statusText } = await supabase
          .from("calendar_events")
          .delete()
          .eq("id", id);

        if (deleteErr) {
          console.error("Delete error details:", { deleteErr, status, statusText, eventId: id, userId: user.id });
          throw deleteErr;
        }

        setEvents((prev) => prev.filter((e) => e.id !== id));

        // Notify the other parent (fire-and-forget; does not block return).
        if (snapshot && (snapshot as any).family_id) {
          fireCalendarNotification(
            supabase,
            "deleted",
            snapshot as unknown as Record<string, unknown>,
            (snapshot as any).family_id,
            user.id
          );
        }

        return true;
      } catch (err) {
        console.error("Error deleting event:", err);
        setError(
          err instanceof Error ? err.message : "Failed to delete event"
        );
        return false;
      }
    },
    [supabase]
  );

  // Get single event with full details
  const getEvent = useCallback(
    async (id: string): Promise<CalendarEvent | null> => {
      try {
        const { data, error: fetchErr } = await supabase
          .from("calendar_events")
          .select(
            `
            *,
            kid:kids(*),
            travel:event_travel_details(*),
            creator:profiles!calendar_events_created_by_fkey(*)
          `
          )
          .eq("id", id)
          .single();

        if (fetchErr) throw fetchErr;

        return {
          ...data,
          travel: data.travel?.[0] || null,
          creator: data.creator || null,
        } as CalendarEvent;
      } catch (err) {
        console.error("Error fetching event:", err);
        return null;
      }
    },
    [supabase]
  );

  // Save travel details (upsert)
  const saveTravelDetails = useCallback(
    async (
      eventId: string,
      data: TravelFormData
    ): Promise<EventTravelDetails | null> => {
      try {
        const { data: existing } = await supabase
          .from("event_travel_details")
          .select("id")
          .eq("event_id", eventId)
          .single();

        let result;

        if (existing) {
          const { data: updated, error: updateErr } = await supabase
            .from("event_travel_details")
            .update({
              ...data,
              flights: data.flights as any,
              ground_transport: data.ground_transport as any,
              documents: data.documents as any,
              packing_checklist: data.packing_checklist as any,
            })
            .eq("event_id", eventId)
            .select()
            .single();

          if (updateErr) throw updateErr;
          result = updated;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("event_travel_details")
            .insert({
              event_id: eventId,
              ...data,
              flights: data.flights as any,
              ground_transport: data.ground_transport as any,
              documents: data.documents as any,
              packing_checklist: data.packing_checklist as any,
            })
            .select()
            .single();

          if (insertErr) throw insertErr;
          result = inserted;
        }

        return result as EventTravelDetails;
      } catch (err) {
        console.error("Error saving travel details:", err);
        setError(
          err instanceof Error ? err.message : "Failed to save travel details"
        );
        return null;
      }
    },
    [supabase]
  );

  // Get travel details for an event
  const getTravelDetails = useCallback(
    async (eventId: string): Promise<EventTravelDetails | null> => {
      try {
        const { data, error: fetchErr } = await supabase
          .from("event_travel_details")
          .select("*")
          .eq("event_id", eventId)
          .single();

        if (fetchErr) {
          if (fetchErr.code === "PGRST116") return null;
          throw fetchErr;
        }

        return data as EventTravelDetails;
      } catch (err) {
        console.error("Error fetching travel details:", err);
        return null;
      }
    },
    [supabase]
  );

  // Upload attachment
  const uploadAttachment = useCallback(
    async (
      eventId: string,
      file: File
    ): Promise<EventAttachment | null> => {
      try {
        const path = `${eventId}/${Date.now()}-${file.name}`;

        const { error: uploadErr } = await supabase.storage
          .from("event-attachments")
          .upload(path, file);

        if (uploadErr) throw uploadErr;

        const attachment: EventAttachment = {
          name: file.name,
          path,
          size: file.size,
          type: file.type,
          uploaded_at: new Date().toISOString(),
        };

        // Get current attachments
        const { data: event } = await supabase
          .from("calendar_events")
          .select("attachments")
          .eq("id", eventId)
          .single();

        const current = (event?.attachments as EventAttachment[]) || [];
        const updated = [...current, attachment];

        const { error: updateErr } = await supabase
          .from("calendar_events")
          .update({ attachments: updated as any })
          .eq("id", eventId);

        if (updateErr) throw updateErr;

        await fetchEvents();
        return attachment;
      } catch (err) {
        console.error("Error uploading attachment:", err);
        setError(
          err instanceof Error ? err.message : "Failed to upload attachment"
        );
        return null;
      }
    },
    [supabase, fetchEvents]
  );

  // Remove attachment
  const removeAttachment = useCallback(
    async (
      eventId: string,
      attachment: EventAttachment
    ): Promise<boolean> => {
      try {
        // Remove from storage
        await supabase.storage
          .from("event-attachments")
          .remove([attachment.path]);

        // Update event
        const { data: event } = await supabase
          .from("calendar_events")
          .select("attachments")
          .eq("id", eventId)
          .single();

        const current = (event?.attachments as EventAttachment[]) || [];
        const updated = current.filter((a) => a.path !== attachment.path);

        await supabase
          .from("calendar_events")
          .update({ attachments: updated as any })
          .eq("id", eventId);

        await fetchEvents();
        return true;
      } catch (err) {
        console.error("Error removing attachment:", err);
        return false;
      }
    },
    [supabase, fetchEvents]
  );

  // Get signed URL for attachment download
  const getAttachmentUrl = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const { data, error } = await supabase.storage
          .from("event-attachments")
          .createSignedUrl(path, 3600);

        if (error) throw error;
        return data.signedUrl;
      } catch (err) {
        console.error("Error getting attachment URL:", err);
        return null;
      }
    },
    [supabase]
  );

  return {
    events,
    loading,
    error,
    createEvent,
    createEventsBatch,
    updateEvent,
    updateEventsBatch,
    deleteEvent,
    getEvent,
    saveTravelDetails,
    getTravelDetails,
    uploadAttachment,
    removeAttachment,
    getAttachmentUrl,
    refetch: fetchEvents,
  };
}
