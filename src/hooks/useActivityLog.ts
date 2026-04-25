"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabase } from "@/lib/supabase";
import { EventChangeLog } from "@/lib/types";

interface ActivityState {
  logs: EventChangeLog[];
  loading: boolean;
}

export function useActivityLog(limit = 20, ready = true): ActivityState {
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

  // Debounce burst inserts (e.g. a bulk import that triggers N change-log
  // rows via DB trigger) into one fetch. Without this, an 18-row import
  // fanned out into 18 sequential fetchLogs() calls, compounding the same
  // realtime cascade that hangs useEvents.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready) {
      setLoading(false);
      return;
    }

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
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            fetchLogs();
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
  }, [supabase, fetchLogs, ready]);

  return { logs, loading };
}
