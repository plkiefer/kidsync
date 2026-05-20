"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import {
  CustodySchedule,
  CustodyOverride,
  CustodyAgreement,
  CompactReport,
  CustodyOverrideInput,
  OverrideStatus,
} from "@/lib/types";
import {
  computeCustodyForDate,
  DayCustodyInfo,
  formatDateStr,
} from "@/lib/custody";
import {
  createOverridesAction,
  respondToOverridesAction,
  moveTurnoverAction,
  compactOverridesAction,
} from "@/lib/actions/custody";

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

interface CustodyState {
  schedules: CustodySchedule[];
  overrides: CustodyOverride[];
  /** Subset of `overrides` with status === 'pending'. Drives the
   *  pending diff visuals on the calendar (dashed event chips +
   *  cell stripes). Excluded from `getCustodyForDate` so the
   *  approved truth still drives day colors. */
  pendingOverrides: CustodyOverride[];
  agreements: CustodyAgreement[];
  loading: boolean;
  /** Custody using ONLY approved overrides — the source of truth
   *  for day-cell colors and standard turnover events. */
  getCustodyForDate: (date: Date) => DayCustodyInfo;
  /** What custody WOULD be on this day if every pending override
   *  were approved. Used by the diff popover to show "proposed". */
  getProjectedCustodyForDate: (date: Date) => DayCustodyInfo;
  /** Pending overrides that cover the given date (any kid). */
  getPendingForDate: (date: Date) => CustodyOverride[];
  /** Insert one or more overrides via the server action. The server
   *  handles auto-supersede + insert atomically and stamps `created_by`
   *  from the authenticated user (client value is ignored). */
  createOverrides: (
    overrides: CustodyOverrideInput[]
  ) => Promise<CustodyOverride[]>;
  /** Approve/dispute/withdraw a batch of overrides. `userId` arg
   *  retained for backward compat with callers — server ignores it
   *  and uses the authenticated user. */
  respondToOverrides: (
    overrideIds: string[],
    status: OverrideStatus,
    note: string,
    userId: string
  ) => Promise<boolean>;
  /** Move a pickup/drop-off. Full orchestration (effective-aware
   *  lookup, gap+time row creation, auto-supersede) runs server-side
   *  in one execution — no more cascading hang surface. */
  moveTurnover: (params: {
    isPickup: boolean;
    currentDate: string;
    newDate: string;
    newTime?: string;
    kidIds: string[];
    familyId: string;
    userId: string;
    note: string;
    reason: string;
  }) => Promise<boolean>;
  notifyCustodyChange: (params: NotifyCustodyParams) => void;
  refetchCustody: () => Promise<void>;
  /** Sweep redundant overrides into the `superseded` graveyard. Runs
   *  server-side. Returns counts for the UI toast. */
  compactOverrides: (familyId: string) => Promise<CompactReport>;
}

// ── Hook ──────────────────────────────────────────────────────

export function useCustody(ready = true): CustodyState {
  const [schedules, setSchedules] = useState<CustodySchedule[]>([]);
  const [overrides, setOverrides] = useState<CustodyOverride[]>([]);
  const [agreements, setAgreements] = useState<CustodyAgreement[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = getSupabase();

  // Reads stay on the browser client — they're idempotent and don't
  // hit the navigator.locks / refresh-deadlock pattern as
  // aggressively as the mutations did. If reads ever start hanging
  // too, they'd move behind a server action the same way.
  const fetchCustody = useCallback(async () => {
    try {
      const [schedRes, overRes, agreeRes] = await Promise.all([
        supabase.from("custody_schedules").select("*"),
        // Exclude both terminal "soft-deleted" statuses from the active
        // result set. `superseded` rows stay in the DB for audit but
        // are invisible to every rendering path.
        supabase
          .from("custody_overrides")
          .select("*")
          .not("status", "in", "(withdrawn,superseded)")
          .order("start_date"),
        supabase
          .from("custody_agreements")
          .select("*")
          .order("created_at", { ascending: false }),
      ]);

      if (schedRes.error)
        console.warn("[custody] schedules fetch:", schedRes.error.message);
      else setSchedules(schedRes.data as CustodySchedule[]);

      if (overRes.error)
        console.warn("[custody] overrides fetch:", overRes.error.message);
      else setOverrides(overRes.data as CustodyOverride[]);

      if (agreeRes.error)
        console.warn("[custody] agreements fetch:", agreeRes.error.message);
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

  // Approved-only custody — what the schedule actually IS today.
  // Pending overrides are deliberately excluded so requesting a
  // change doesn't pre-flip the calendar before the other parent
  // has approved.
  const approvedOverrides = overrides.filter((o) => o.status === "approved");
  const pendingOverrides = overrides.filter((o) => o.status === "pending");

  const getCustodyForDate = useCallback(
    (date: Date): DayCustodyInfo => {
      if (schedules.length === 0) return {};
      return computeCustodyForDate(date, schedules, approvedOverrides);
    },
    [schedules, approvedOverrides]
  );

  const getProjectedCustodyForDate = useCallback(
    (date: Date): DayCustodyInfo => {
      if (schedules.length === 0) return {};
      return computeCustodyForDate(date, schedules, [
        ...approvedOverrides,
        ...pendingOverrides,
      ]);
    },
    [schedules, approvedOverrides, pendingOverrides]
  );

  const getPendingForDate = useCallback(
    (date: Date): CustodyOverride[] => {
      if (pendingOverrides.length === 0) return [];
      const dStr = formatDateStr(date);
      return pendingOverrides
        .filter((o) => o.start_date <= dStr && dStr <= o.end_date)
        .sort((a, b) =>
          (b.created_at || "").localeCompare(a.created_at || "")
        );
    },
    [pendingOverrides]
  );

  // ── Mutations — thin RPC wrappers around server actions ───────
  //
  // Every mutation that used to hand-roll auto-supersede + insert
  // with timeout wrappers now hits a server action where the same
  // logic runs in one execution context, against the request-cookie
  // session, with no navigator.locks contention surface.

  const createOverrides = useCallback(
    async (inputs: CustodyOverrideInput[]): Promise<CustodyOverride[]> => {
      const result = await createOverridesAction(inputs);
      if (!result.ok) {
        console.error("[custody] createOverrides failed:", result.error);
        return [];
      }
      await fetchCustody();
      return result.data;
    },
    [fetchCustody]
  );

  const respondToOverrides = useCallback(
    async (
      overrideIds: string[],
      status: OverrideStatus,
      note: string,
      // userId retained in the signature for back-compat with existing
      // callers (calendar handlers pass it). The server uses the
      // authenticated user — this argument is ignored end-to-end.
      _userId: string
    ): Promise<boolean> => {
      const result = await respondToOverridesAction(
        overrideIds,
        status,
        note
      );
      if (!result.ok) {
        console.error("[custody] respondToOverrides failed:", result.error);
        return false;
      }
      await fetchCustody();
      return true;
    },
    [fetchCustody]
  );

  const moveTurnover = useCallback(
    async (params: {
      isPickup: boolean;
      currentDate: string;
      newDate: string;
      newTime?: string;
      kidIds: string[];
      familyId: string;
      userId: string;
      note: string;
      reason: string;
    }): Promise<boolean> => {
      // userId stripped — server uses authenticated user.
      const { userId: _userId, ...serverParams } = params;
      void _userId;
      const result = await moveTurnoverAction(serverParams);
      if (!result.ok) {
        console.error("[custody] moveTurnover failed:", result.error);
        return false;
      }
      await fetchCustody();
      return true;
    },
    [fetchCustody]
  );

  const compactOverrides = useCallback(
    async (familyId: string): Promise<CompactReport> => {
      const empty: CompactReport = {
        redundantApproved: 0,
        noopApproved: 0,
        stalePending: 0,
      };
      const result = await compactOverridesAction(familyId);
      if (!result.ok) {
        console.error("[custody] compactOverrides failed:", result.error);
        return empty;
      }
      await fetchCustody();
      return result.data;
    },
    [fetchCustody]
  );

  // Notification still goes through supabase.functions.invoke — that
  // call hasn't shown the same deadlock pattern as table mutations.
  // If it ever starts hanging, it'd move to a server action too.
  const notifyCustodyChange = useCallback(
    (params: NotifyCustodyParams) => {
      supabase.functions
        .invoke("notify-parent", {
          body: {
            type: "custody_override",
            action: params.action,
            override: params.override,
            kid_ids: params.kidIds,
            family_id: params.familyId,
            changed_by: params.changedBy,
          },
        })
        .catch((err) => {
          console.warn("[custody] notification failed:", err);
        });
    },
    [supabase]
  );

  return {
    schedules,
    overrides,
    pendingOverrides,
    agreements,
    loading,
    getCustodyForDate,
    getProjectedCustodyForDate,
    getPendingForDate,
    createOverrides,
    respondToOverrides,
    moveTurnover,
    notifyCustodyChange,
    compactOverrides,
    refetchCustody: fetchCustody,
  };
}
