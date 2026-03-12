"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { EventChangeLog } from "@/lib/types";

interface ActivityState {
  logs: EventChangeLog[];
  loading: boolean;
}

export function useActivityLog(limit = 20): ActivityState {
  const [logs, setLogs] = useState<EventChangeLog[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabase();

  const fetchLogs = useCallback(async () => {
    try {
      // changed_by references auth.users, not profiles directly.
      // Fetch logs first, then resolve names from profiles by matching IDs.
      const { data, error } = await supabase
        .from("event_change_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      setLogs(data as EventChangeLog[]);
    } catch (err) {
      console.error("Error fetching activity log:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase, limit]);

  useEffect(() => {
    fetchLogs();

    // Subscribe to new log entries
    const channel = supabase
      .channel("activity_log_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "event_change_log",
        },
        () => {
          fetchLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchLogs]);

  return { logs, loading };
}
