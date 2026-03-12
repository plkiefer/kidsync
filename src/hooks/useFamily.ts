"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { Kid, Profile } from "@/lib/types";

interface FamilyState {
  kids: Kid[];
  members: Profile[];
  loading: boolean;
  error: string | null;
}

export function useFamily(ready = true): FamilyState {
  const [kids, setKids] = useState<Kid[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabase();

  const fetchFamily = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch kids (RLS scopes to family automatically)
      const { data: kidsData, error: kidsErr } = await supabase
        .from("kids")
        .select("*")
        .order("name");

      if (kidsErr) throw kidsErr;
      setKids(kidsData as Kid[]);

      // Fetch family members
      const { data: membersData, error: membersErr } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");

      if (membersErr) throw membersErr;
      setMembers(membersData as Profile[]);
    } catch (err) {
      console.error("Error fetching family:", err);
      setError(err instanceof Error ? err.message : "Failed to load family");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (ready) {
      fetchFamily();
    } else {
      setLoading(false);
    }
  }, [fetchFamily, ready]);

  return { kids, members, loading, error };
}
