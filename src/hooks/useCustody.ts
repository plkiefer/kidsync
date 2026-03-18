"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { CustodySchedule, CustodyOverride, CustodyAgreement, OverrideStatus } from "@/lib/types";
import { computeCustodyForDate, DayCustodyInfo } from "@/lib/custody";

// ── Types ─────────────────────────────────────────────────────

interface NotifyCustodyParams {
  action: "requested" | "approved" | "disputed" | "withdrawn";
  override: {
    start_date: string;
    end_date: string;
    parent_id: string;
    reason?: string | null;
    response_note?: string | null;
    note?: string | null;
  };
  kidIds: string[];
  familyId: string;
  changedBy: string;
}

type OverrideInput = Omit<CustodyOverride, "id" | "created_at" | "compliance_checked_at" | "responded_by" | "responded_at" | "response_note">;

interface CustodyState {
  schedules: CustodySchedule[];
  overrides: CustodyOverride[];
  agreements: CustodyAgreement[];
  loading: boolean;
  getCustodyForDate: (date: Date) => DayCustodyInfo;
  /** Insert one or more overrides in a single DB call, refetch once */
  createOverrides: (overrides: OverrideInput[]) => Promise<CustodyOverride[]>;
  /** Update status on one or more overrides in a single DB call, refetch once */
  respondToOverrides: (overrideIds: string[], status: OverrideStatus, note: string, userId: string) => Promise<boolean>;
  /** Withdraw overlapping overrides for given kids/date ranges, refetch once */
  withdrawOverlapping: (kidIds: string[], dateRanges: { start: string; end: string }[]) => Promise<void>;
  notifyCustodyChange: (params: NotifyCustodyParams) => void;
  refetchCustody: () => Promise<void>;
}

// ── Timeout helper ────────────────────────────────────────────

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Hook ──────────────────────────────────────────────────────

export function useCustody(ready = true): CustodyState {
  const [schedules, setSchedules] = useState<CustodySchedule[]>([]);
  const [overrides, setOverrides] = useState<CustodyOverride[]>([]);
  const [agreements, setAgreements] = useState<CustodyAgreement[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabase();

  const fetchCustody = useCallback(async () => {
    try {
      const [schedRes, overRes, agreeRes] = await Promise.all([
        supabase.from("custody_schedules").select("*"),
        supabase.from("custody_overrides").select("*").neq("status", "withdrawn").order("start_date"),
        supabase.from("custody_agreements").select("*").order("created_at", { ascending: false }),
      ]);

      if (schedRes.error) console.warn("[custody] schedules fetch:", schedRes.error.message);
      else setSchedules(schedRes.data as CustodySchedule[]);

      if (overRes.error) console.warn("[custody] overrides fetch:", overRes.error.message);
      else setOverrides(overRes.data as CustodyOverride[]);

      if (agreeRes.error) console.warn("[custody] agreements fetch:", agreeRes.error.message);
      else setAgreements(agreeRes.data as CustodyAgreement[]);
    } catch (err) {
      console.warn("[custody] fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    if (!ready) {
      setLoading(false);
      return;
    }
    fetchCustody();
  }, [fetchCustody, ready]);

  const getCustodyForDate = useCallback(
    (date: Date): DayCustodyInfo => {
      if (schedules.length === 0) return {};
      const activeOverrides = overrides.filter(
        (o) => o.status === "approved" || o.status === "pending"
      );
      return computeCustodyForDate(date, schedules, activeOverrides);
    },
    [schedules, overrides]
  );

  // ── Batch create ──────────────────────────────────────────

  const createOverrides = useCallback(
    async (inputs: OverrideInput[]): Promise<CustodyOverride[]> => {
      if (inputs.length === 0) return [];

      try {
        const { data, error } = await withTimeout(
          supabase.from("custody_overrides").insert(inputs).select(),
          15000,
          "createOverrides"
        );

        if (error) {
          console.error("[custody] batch create error:", error);
          return [];
        }

        await withTimeout(fetchCustody(), 10000, "refetch after create");
        return (data as CustodyOverride[]) || [];
      } catch (err) {
        console.error("[custody] create failed:", err);
        // Still try to refetch so UI isn't stale
        fetchCustody().catch(() => {});
        return [];
      }
    },
    [supabase, fetchCustody]
  );

  // ── Batch respond ─────────────────────────────────────────

  const respondToOverrides = useCallback(
    async (overrideIds: string[], status: OverrideStatus, note: string, userId: string): Promise<boolean> => {
      if (overrideIds.length === 0) return true;

      try {
        const { error } = await withTimeout(
          supabase
            .from("custody_overrides")
            .update({
              status,
              response_note: note || null,
              responded_by: userId,
              responded_at: new Date().toISOString(),
            })
            .in("id", overrideIds),
          15000,
          "respondToOverrides"
        );

        if (error) {
          console.error("[custody] batch respond error:", error);
          return false;
        }

        await withTimeout(fetchCustody(), 10000, "refetch after respond");
        return true;
      } catch (err) {
        console.error("[custody] respond failed:", err);
        fetchCustody().catch(() => {});
        return false;
      }
    },
    [supabase, fetchCustody]
  );

  // ── Withdraw overlapping ──────────────────────────────────

  const withdrawOverlapping = useCallback(
    async (kidIds: string[], dateRanges: { start: string; end: string }[]) => {
      if (kidIds.length === 0 || dateRanges.length === 0) return;

      try {
        // Withdraw all overlapping overrides for all kids/ranges in parallel
        const withdrawals = [];
        for (const range of dateRanges) {
          withdrawals.push(
            supabase
              .from("custody_overrides")
              .update({ status: "withdrawn" })
              .in("kid_id", kidIds)
              .lte("start_date", range.end)
              .gte("end_date", range.start)
              .in("status", ["pending", "approved"])
          );
        }
        await withTimeout(Promise.all(withdrawals), 15000, "withdrawOverlapping");

        // Don't refetch here — caller will createOverrides which refetches
      } catch (err) {
        console.error("[custody] withdraw failed:", err);
      }
    },
    [supabase]
  );

  // ── Notify (fire and forget) ──────────────────────────────

  const notifyCustodyChange = useCallback(
    (params: NotifyCustodyParams) => {
      supabase.functions.invoke("notify-parent", {
        body: {
          type: "custody_override",
          action: params.action,
          override: params.override,
          kid_ids: params.kidIds,
          family_id: params.familyId,
          changed_by: params.changedBy,
        },
      }).catch((err) => {
        console.warn("[custody] notification failed:", err);
      });
    },
    [supabase]
  );

  return {
    schedules,
    overrides,
    agreements,
    loading,
    getCustodyForDate,
    createOverrides,
    respondToOverrides,
    withdrawOverlapping,
    notifyCustodyChange,
    refetchCustody: fetchCustody,
  };
}
