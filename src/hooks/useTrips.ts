"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { Trip, TripGuest, TripType, TripStatus, CalendarEvent } from "@/lib/types";

interface UseTripsState {
  trips: Trip[];
  loading: boolean;
  error: string | null;
  createTrip: (input: NewTripInput) => Promise<Trip | null>;
  updateTrip: (id: string, patch: Partial<Trip>) => Promise<Trip | null>;
  deleteTrip: (id: string) => Promise<boolean>;
  /** Recompute trip.starts_at/ends_at from its segment events. Called
   *  whenever segments are added/edited/removed. */
  recomputeTripDates: (tripId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

export interface NewTripInput {
  title: string;
  trip_type: TripType;
  kid_ids: string[];
  member_ids: string[];
  guests: TripGuest[];
  notes?: string;
}

/**
 * Trip CRUD + segment-derived date sync. Mirrors useEvents in shape
 * (auth context optional, family scope via RLS). Trip metadata only —
 * segment editing happens through useEvents (segments ARE calendar
 * events with trip_id).
 */
export function useTrips(
  ready = true,
  authUserId?: string,
  authFamilyId?: string
): UseTripsState {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabase();

  const fetchTrips = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchErr } = await supabase
        .from("trips")
        .select("*")
        .order("created_at", { ascending: false });
      if (fetchErr) throw fetchErr;
      setTrips((data || []) as Trip[]);
    } catch (err) {
      console.error("Error fetching trips:", err);
      setError(err instanceof Error ? err.message : "Failed to load trips");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (ready) {
      fetchTrips();
    } else {
      setLoading(false);
    }
  }, [fetchTrips, ready]);

  // ─── Realtime: keep trip list in sync across clients ────────
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel("trips-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips" },
        () => {
          // Debounce-friendly: just re-fetch the lot. Trips list is
          // small (tens of rows max) so this is cheap.
          fetchTrips();
        }
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [ready, supabase, fetchTrips]);

  const createTrip = useCallback(
    async (input: NewTripInput): Promise<Trip | null> => {
      try {
        // Resolve user/family — prefer auth context props (avoids
        // getSession() deadlock seen in useEvents).
        let userId = authUserId;
        let familyId = authFamilyId;
        if (!userId || !familyId) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session?.user) throw new Error("Not authenticated");
          userId = session.user.id;
          if (!familyId) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("family_id")
              .eq("id", userId)
              .single();
            if (!profile) throw new Error("Profile not found");
            familyId = profile.family_id;
          }
        }

        const { data: newTrip, error: createErr } = await supabase
          .from("trips")
          .insert({
            family_id: familyId,
            title: input.title,
            trip_type: input.trip_type,
            kid_ids: input.kid_ids,
            member_ids: input.member_ids,
            guests: input.guests,
            notes: input.notes ?? null,
            status: "draft",
            created_by: userId,
          })
          .select("*")
          .single();

        if (createErr) throw createErr;
        return newTrip as Trip;
      } catch (err) {
        console.error("Error creating trip:", err);
        setError(err instanceof Error ? err.message : "Failed to create trip");
        return null;
      }
    },
    [supabase, authUserId, authFamilyId]
  );

  const updateTrip = useCallback(
    async (id: string, patch: Partial<Trip>): Promise<Trip | null> => {
      try {
        let userId = authUserId;
        if (!userId) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (!session?.user) throw new Error("Not authenticated");
          userId = session.user.id;
        }

        const { id: _id, created_at: _ca, created_by: _cb, ...rest } = patch;
        void _id;
        void _ca;
        void _cb;

        const { data: updated, error: updateErr } = await supabase
          .from("trips")
          .update({ ...rest, updated_by: userId })
          .eq("id", id)
          .select("*")
          .single();
        if (updateErr) throw updateErr;
        return updated as Trip;
      } catch (err) {
        console.error("Error updating trip:", err);
        setError(err instanceof Error ? err.message : "Failed to update trip");
        return null;
      }
    },
    [supabase, authUserId]
  );

  const deleteTrip = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        // ON DELETE CASCADE on calendar_events.trip_id will remove
        // associated segments. Custody overrides drop their link
        // (ON DELETE SET NULL) but stay in place — the user might
        // have used the override to bake other arrangements.
        const { error: deleteErr } = await supabase
          .from("trips")
          .delete()
          .eq("id", id);
        if (deleteErr) throw deleteErr;
        return true;
      } catch (err) {
        console.error("Error deleting trip:", err);
        setError(err instanceof Error ? err.message : "Failed to delete trip");
        return false;
      }
    },
    [supabase]
  );

  const recomputeTripDates = useCallback(
    async (tripId: string): Promise<void> => {
      try {
        const { data: segments, error: segErr } = await supabase
          .from("calendar_events")
          .select("starts_at, ends_at")
          .eq("trip_id", tripId);
        if (segErr) throw segErr;

        const list = (segments || []) as Pick<
          CalendarEvent,
          "starts_at" | "ends_at"
        >[];

        if (list.length === 0) {
          // No segments — clear the cached dates.
          await supabase
            .from("trips")
            .update({ starts_at: null, ends_at: null })
            .eq("id", tripId);
          return;
        }

        const minStart = list.reduce<string>(
          (acc, s) => (acc === "" || s.starts_at < acc ? s.starts_at : acc),
          ""
        );
        const maxEnd = list.reduce<string>(
          (acc, s) => (acc === "" || s.ends_at > acc ? s.ends_at : acc),
          ""
        );

        await supabase
          .from("trips")
          .update({ starts_at: minStart, ends_at: maxEnd })
          .eq("id", tripId);
      } catch (err) {
        console.error("Error recomputing trip dates:", err);
      }
    },
    [supabase]
  );

  return {
    trips,
    loading,
    error,
    createTrip,
    updateTrip,
    deleteTrip,
    recomputeTripDates,
    refetch: fetchTrips,
  };
}
