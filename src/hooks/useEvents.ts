"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  CalendarEvent,
  EventFormData,
  EventTravelDetails,
  TravelFormData,
} from "@/lib/types";

interface EventsState {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  createEvent: (data: EventFormData) => Promise<CalendarEvent | null>;
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
  refetch: () => Promise<void>;
}

export function useEvents(): EventsState {
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

      // Normalize travel from array to single object
      const normalized = (data || []).map((evt: any) => ({
        ...evt,
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

  // Initial fetch
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Realtime subscription — live updates when the other parent makes changes
  useEffect(() => {
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
          // Refetch all events on any change (simpler than patching)
          fetchEvents();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchEvents]);

  // Create event
  const createEvent = useCallback(
    async (data: EventFormData): Promise<CalendarEvent | null> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Get family_id from profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("family_id")
          .eq("id", user.id)
          .single();

        if (!profile) throw new Error("Profile not found");

        const { data: newEvent, error: createErr } = await supabase
          .from("calendar_events")
          .insert({
            family_id: profile.family_id,
            kid_id: data.kid_id,
            title: data.title,
            event_type: data.event_type,
            starts_at: data.starts_at,
            ends_at: data.ends_at,
            all_day: data.all_day,
            location: data.location || null,
            notes: data.notes || null,
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

        const { data: updated, error: updateErr } = await supabase
          .from("calendar_events")
          .update({
            ...data,
            updated_by: user.id,
          })
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

        // Set updated_by before delete so the trigger knows who did it
        await supabase
          .from("calendar_events")
          .update({ updated_by: user.id })
          .eq("id", id);

        const { error: deleteErr } = await supabase
          .from("calendar_events")
          .delete()
          .eq("id", id);

        if (deleteErr) throw deleteErr;

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
        // Check if travel details already exist
        const { data: existing } = await supabase
          .from("event_travel_details")
          .select("id")
          .eq("event_id", eventId)
          .single();

        let result;

        if (existing) {
          // Update
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
          // Insert
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
          if (fetchErr.code === "PGRST116") return null; // No rows
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

  return {
    events,
    loading,
    error,
    createEvent,
    updateEvent,
    deleteEvent,
    getEvent,
    saveTravelDetails,
    getTravelDetails,
    refetch: fetchEvents,
  };
}
