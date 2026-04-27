"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { Trip, TripGuest, TripType, TripStatus, CalendarEvent } from "@/lib/types";

/**
 * Fire-and-forget notification to the existing notify-parent edge
 * function for trip-level changes. Plan §13a: structural changes
 * (create / status / dates / roster) notify; cosmetic changes
 * (title-only) don't. This helper just fires; callers decide
 * whether the change is structural enough to warrant a call.
 *
 * Mirrors fireCalendarNotification in useEvents — same edge fn
 * shape so the email composer can detect "kind" and format
 * appropriately. The action field is the same union; for trips we
 * also pass an `entity_kind: "trip"` flag in the body so the
 * function can branch.
 */
function fireTripNotification(
  supabase: ReturnType<typeof getSupabase>,
  action: "created" | "updated" | "deleted",
  trip: Record<string, unknown>,
  family_id: string,
  changed_by: string
): void {
  supabase.functions
    .invoke("notify-parent", {
      body: {
        action,
        entity_kind: "trip",
        event: trip,
        family_id,
        changed_by,
      },
    })
    .catch((err) => {
      console.warn("[trips] notification failed:", err);
    });
}

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
        // After the auth-resolution block both must be defined; the
        // narrow assertion below makes TS see that for the rest of
        // the function (for the notification call later).
        if (!userId || !familyId) {
          throw new Error("Auth context unresolved");
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
        if (newTrip && userId) {
          fireTripNotification(
            supabase,
            "created",
            newTrip as unknown as Record<string, unknown>,
            familyId,
            userId
          );
        }
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

        // Plan §13a: notify on structural changes only. Title +
        // notes are cosmetic; status / dates / roster are
        // structural and warrant a notification.
        const structuralKeys: (keyof Trip)[] = [
          "status",
          "starts_at",
          "ends_at",
          "kid_ids",
          "member_ids",
          "trip_type",
        ];
        const isStructural = structuralKeys.some((k) => k in patch);
        if (isStructural && updated) {
          fireTripNotification(
            supabase,
            "updated",
            updated as unknown as Record<string, unknown>,
            (updated as Trip).family_id,
            userId
          );
        }
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
        // Snapshot the trip BEFORE deletion so we can include its
        // title etc. in the notification email. After deletion the
        // row is gone (CASCADE removes segments too).
        const { data: snapshot } = await supabase
          .from("trips")
          .select("*")
          .eq("id", id)
          .single();

        // ON DELETE CASCADE on calendar_events.trip_id will remove
        // associated segments. Custody overrides drop their link
        // (ON DELETE SET NULL) but stay in place — the user might
        // have used the override to bake other arrangements.
        const { error: deleteErr } = await supabase
          .from("trips")
          .delete()
          .eq("id", id);
        if (deleteErr) throw deleteErr;

        if (snapshot) {
          let userId = authUserId;
          if (!userId) {
            const {
              data: { session },
            } = await supabase.auth.getSession();
            userId = session?.user?.id;
          }
          if (userId) {
            fireTripNotification(
              supabase,
              "deleted",
              snapshot as unknown as Record<string, unknown>,
              (snapshot as Trip).family_id,
              userId
            );
          }
        }
        return true;
      } catch (err) {
        console.error("Error deleting trip:", err);
        setError(err instanceof Error ? err.message : "Failed to delete trip");
        return false;
      }
    },
    [supabase, authUserId]
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
