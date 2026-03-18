"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { CustodySchedule, CustodyOverride, CustodyAgreement, OverrideStatus } from "@/lib/types";
import { computeCustodyForDate, DayCustodyInfo } from "@/lib/custody";

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

interface CustodyState {
  schedules: CustodySchedule[];
  overrides: CustodyOverride[];
  agreements: CustodyAgreement[];
  loading: boolean;
  getCustodyForDate: (date: Date) => DayCustodyInfo;
  createOverride: (override: Omit<CustodyOverride, "id" | "created_at" | "compliance_checked_at" | "responded_by" | "responded_at" | "response_note">) => Promise<CustodyOverride | null>;
  respondToOverride: (overrideId: string, status: OverrideStatus, note: string, userId: string) => Promise<boolean>;
  notifyCustodyChange: (params: NotifyCustodyParams) => void;
  refetchCustody: () => Promise<void>;
}

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

      if (schedRes.error) {
        console.warn("[custody] schedules fetch:", schedRes.error.message);
      } else {
        setSchedules(schedRes.data as CustodySchedule[]);
      }

      if (overRes.error) {
        console.warn("[custody] overrides fetch:", overRes.error.message);
      } else {
        setOverrides(overRes.data as CustodyOverride[]);
      }

      if (agreeRes.error) {
        console.warn("[custody] agreements fetch:", agreeRes.error.message);
      } else {
        setAgreements(agreeRes.data as CustodyAgreement[]);
      }
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
      // Only use approved overrides for the calendar underlay
      const approvedOverrides = overrides.filter(
        (o) => o.status === "approved" || o.status === "pending"
      );
      return computeCustodyForDate(date, schedules, approvedOverrides);
    },
    [schedules, overrides]
  );

  const createOverride = useCallback(
    async (
      override: Omit<CustodyOverride, "id" | "created_at" | "compliance_checked_at" | "responded_by" | "responded_at" | "response_note">
    ): Promise<CustodyOverride | null> => {
      const { data, error } = await supabase
        .from("custody_overrides")
        .insert(override)
        .select()
        .single();

      if (error) {
        console.error("[custody] create override error:", error);
        return null;
      }

      await fetchCustody();
      return data as CustodyOverride;
    },
    [supabase, fetchCustody]
  );

  const notifyCustodyChange = useCallback(
    (params: NotifyCustodyParams) => {
      // Fire and forget — never block the UI waiting for email delivery
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

  const respondToOverride = useCallback(
    async (overrideId: string, status: OverrideStatus, note: string, userId: string): Promise<boolean> => {
      console.log("[custody] responding to override:", overrideId, status);
      const { error } = await supabase
        .from("custody_overrides")
        .update({
          status,
          response_note: note || null,
          responded_by: userId,
          responded_at: new Date().toISOString(),
        })
        .eq("id", overrideId);

      if (error) {
        console.error("[custody] respond error:", error);
        return false;
      }
      console.log("[custody] update succeeded, refetching...");

      await fetchCustody();
      console.log("[custody] refetch done");
      return true;
    },
    [supabase, fetchCustody]
  );

  return {
    schedules,
    overrides,
    agreements,
    loading,
    getCustodyForDate,
    createOverride,
    respondToOverride,
    notifyCustodyChange,
    refetchCustody: fetchCustody,
  };
}
