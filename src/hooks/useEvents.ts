"use client";

import { useEffect, useState, useCallback } from "react";
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

export function useEvents(ready = true): EventsState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabase();

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

  // Realtime subscription — only after auth is ready
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
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
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

        const payload = rows.map((data) => ({
          family_id: profile.family_id,
          kid_id: data.kid_ids[0],
          kid_ids: data.kid_ids,
          title: data.title,
          event_type: data.event_type,
          starts_at: data.starts_at,
          ends_at: data.ends_at,
          all_day: data.all_day,
          location: data.location || null,
          notes: data.notes || null,
          recurring_rule: data.recurring_rule || null,
          created_by: user.id,
        }));

        const { data: inserted, error: insertErr } = await supabase
          .from("calendar_events")
          .insert(payload)
          .select("id");

        if (insertErr) throw insertErr;

        const insertedCount = inserted?.length ?? 0;
        return {
          inserted: insertedCount,
          failed: rows.length - insertedCount,
        };
      } catch (err) {
        console.error("Error batch-creating events:", err);
        return {
          inserted: 0,
          failed: rows.length,
          error: err instanceof Error ? err.message : "Batch insert failed",
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
        // for DELETE actions, so we must set it before deleting.
        await supabase
          .from("calendar_events")
          .update({ updated_by: user.id })
          .eq("id", id);

        const { error: deleteErr, status, statusText } = await supabase
          .from("calendar_events")
          .delete()
          .eq("id", id);

        if (deleteErr) {
          console.error("Delete error details:", { deleteErr, status, statusText, eventId: id, userId: user.id });
          throw deleteErr;
        }

        setEvents((prev) => prev.filter((e) => e.id !== id));
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
