"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabase } from "@/lib/supabase";
import { CustodySchedule, CustodyOverride, CustodyAgreement, OverrideStatus } from "@/lib/types";
import { computeCustodyForDate, DayCustodyInfo, findStandardTurnoverDates, parseLocalDate, formatDateStr } from "@/lib/custody";
import { addDays } from "date-fns";

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
  /** Insert one or more overrides in a single DB call, refetch once */
  createOverrides: (overrides: OverrideInput[]) => Promise<CustodyOverride[]>;
  /** Update status on one or more overrides in a single DB call, refetch once */
  respondToOverrides: (overrideIds: string[], status: OverrideStatus, note: string, userId: string) => Promise<boolean>;
  /** Withdraw overlapping overrides for given kids/date ranges, refetch once */
  withdrawOverlapping: (kidIds: string[], dateRanges: { start: string; end: string }[]) => Promise<void>;
  /** Move a pickup/dropoff: computes range relative to standard schedule, withdraws conflicts, creates override */
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
  /** Sweep redundant overrides into the `superseded` graveyard. Safe
   *  to run repeatedly. Returns counts so the UI can show what it did. */
  compactOverrides: (familyId: string) => Promise<CompactReport>;
}

export interface CompactReport {
  redundantApproved: number;
  noopApproved: number;
  stalePending: number;
}

// ── Date helper ───────────────────────────────────────────────

/** "2026-05-22" → "2026-05-23". Used by the compact pass to walk
 *  contiguous coverage spans without going through Date objects. */
function nextDayStr(dateStr: string): string {
  return formatDateStr(addDays(parseLocalDate(dateStr), 1));
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
        // Exclude both terminal "soft-deleted" statuses from the active
        // result set. `superseded` rows stay in the DB for audit but
        // are invisible to every rendering path.
        supabase
          .from("custody_overrides")
          .select("*")
          .not("status", "in", "(withdrawn,superseded)")
          .order("start_date"),
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

  // What custody would be if every pending override were approved.
  // Used by the diff popover to show the "proposed" column.
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

  // Pending overrides that cover the given date (any kid). Sorted
  // by created_at desc so the popover shows the freshest request first.
  const getPendingForDate = useCallback(
    (date: Date): CustodyOverride[] => {
      if (pendingOverrides.length === 0) return [];
      const dStr = formatDateStr(date);
      return pendingOverrides
        .filter((o) => o.start_date <= dStr && dStr <= o.end_date)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    },
    [pendingOverrides]
  );

  // ── Batch create ──────────────────────────────────────────

  const createOverrides = useCallback(
    async (inputs: OverrideInput[]): Promise<CustodyOverride[]> => {
      if (inputs.length === 0) return [];

      try {
        // Auto-supersede any prior PENDING overrides from the same
        // requester that overlap on the same kid+date-range. Stops
        // pending stacks ("overrides on overrides") at the request
        // layer. Cross-user pending requests are deliberately left
        // alone — different parties' wishes shouldn't auto-resolve.
        const pendingInputs = inputs.filter(
          (i) => i.status === "pending"
        );
        if (pendingInputs.length > 0) {
          // Group by created_by + kid_id, compute the union date span
          // per group, and mark older pending rows in that span as
          // superseded.
          type Span = {
            createdBy: string;
            kidId: string;
            start: string;
            end: string;
          };
          const spans: Span[] = [];
          for (const inp of pendingInputs) {
            if (!inp.created_by) continue;
            const existing = spans.find(
              (s) => s.createdBy === inp.created_by && s.kidId === inp.kid_id
            );
            if (existing) {
              if (inp.start_date < existing.start) existing.start = inp.start_date;
              if (inp.end_date > existing.end) existing.end = inp.end_date;
            } else {
              spans.push({
                createdBy: inp.created_by,
                kidId: inp.kid_id,
                start: inp.start_date,
                end: inp.end_date,
              });
            }
          }
          await Promise.all(
            spans.map((s) =>
              supabase
                .from("custody_overrides")
                .update({ status: "superseded" })
                .eq("status", "pending")
                .eq("kid_id", s.kidId)
                .eq("created_by", s.createdBy)
                .lte("start_date", s.end)
                .gte("end_date", s.start)
            )
          );
        }

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
        // When approving, also pull in the rows being approved so we
        // can find OTHER pending overrides on the same kid+date-range
        // and supersede them — they're moot once this one is active.
        let toSupersedeSpans:
          | { kidId: string; start: string; end: string }[]
          | null = null;
        if (status === "approved") {
          const { data: targetRows } = await supabase
            .from("custody_overrides")
            .select("kid_id, start_date, end_date")
            .in("id", overrideIds);
          if (targetRows && targetRows.length > 0) {
            toSupersedeSpans = (targetRows as Array<{
              kid_id: string;
              start_date: string;
              end_date: string;
            }>).map((r) => ({
              kidId: r.kid_id,
              start: r.start_date,
              end: r.end_date,
            }));
          }
        }

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

        if (toSupersedeSpans && toSupersedeSpans.length > 0) {
          await Promise.all(
            toSupersedeSpans.map((s) =>
              supabase
                .from("custody_overrides")
                .update({ status: "superseded" })
                .eq("status", "pending")
                .eq("kid_id", s.kidId)
                .lte("start_date", s.end)
                .gte("end_date", s.start)
                .not("id", "in", `(${overrideIds.join(",")})`)
            )
          );
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

  // ── Move turnover ──────────────────────────────────────────

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
      const refDate = parseLocalDate(params.currentDate);
      const targetDate = parseLocalDate(params.newDate);

      // Find the standard turnover dates using the base schedule (no overrides)
      const schedule = schedules.find((s) => s.kid_id === params.kidIds[0]);
      if (!schedule) {
        console.error("[custody] no schedule found for kid", params.kidIds[0]);
        return false;
      }

      // Pass approvedOverrides so the function returns the EFFECTIVE
      // turnover positions (what the chip the user clicked is actually
      // anchored to). Without this, moveTurnover compares newDate
      // against a base-schedule date that may differ from the calendar
      // and silently treats a real date move as a same-date time-only
      // change.
      const standard = findStandardTurnoverDates(
        refDate,
        schedule,
        approvedOverrides
      );
      if (!standard) {
        console.error("[custody] no turnover transitions in scan window");
        return false;
      }
      // Pickup and dropoff are returned independently — for long
      // custody blocks (multi-week extensions) one side may be
      // outside the scan window. Only the side the user is editing
      // is actually required.
      if (params.isPickup && !standard.pickupDate) {
        console.error("[custody] no pickup transition found near refDate");
        return false;
      }
      if (!params.isPickup && !standard.dropoffDate) {
        console.error("[custody] no dropoff transition found near refDate");
        return false;
      }
      const pickupAnchor = standard.pickupDate!;
      const dropoffAnchor = standard.dropoffDate!;

      let rangeStart: string;
      let rangeEnd: string;
      let overrideParent: string;

      if (params.isPickup) {
        if (targetDate < pickupAnchor) {
          // Extending: pickup earlier than standard → give parent_a these gap days
          rangeStart = params.newDate;
          rangeEnd = formatDateStr(addDays(pickupAnchor, -1));
          overrideParent = schedule.parent_a_id;
        } else {
          // Shrinking: pickup later than standard → give parent_b these gap days
          rangeStart = formatDateStr(pickupAnchor);
          rangeEnd = formatDateStr(addDays(targetDate, -1));
          overrideParent = schedule.parent_b_id;
        }
      } else {
        if (targetDate > dropoffAnchor) {
          // Extending: dropoff later than standard → give parent_a these gap days
          rangeStart = formatDateStr(addDays(dropoffAnchor, 1));
          rangeEnd = params.newDate;
          overrideParent = schedule.parent_a_id;
        } else {
          // Shrinking: dropoff earlier than standard → give parent_b these gap days
          rangeStart = formatDateStr(addDays(targetDate, 1));
          rangeEnd = formatDateStr(dropoffAnchor);
          overrideParent = schedule.parent_b_id;
        }
      }

      const dateChanged = rangeStart <= rangeEnd;
      const timeChanged = !!params.newTime;

      // Always withdraw overrides that cover the current turnover date (so old
      // overrides that created the current non-standard position get cleared),
      // plus the standard custody block range when we know both ends of it.
      const withdrawalRanges = [
        { start: params.currentDate, end: params.currentDate },
      ];
      if (standard.pickupDate && standard.dropoffDate) {
        withdrawalRanges.push({
          start: formatDateStr(standard.pickupDate),
          end: formatDateStr(standard.dropoffDate),
        });
      }

      if (dateChanged) {
        withdrawalRanges.push({ start: rangeStart, end: rangeEnd });
      }

      // Also withdraw overrides on the target date (for time-only changes)
      if (params.newDate !== params.currentDate) {
        withdrawalRanges.push({ start: params.newDate, end: params.newDate });
      }

      await withdrawOverlapping(params.kidIds, withdrawalRanges);

      if (dateChanged) {
        // Three sub-cases when the date changed. The merging logic
        // matters because issuing two overlapping pending overrides
        // in separate createOverrides calls would trigger the
        // auto-supersede inside createOverrides — the second insert
        // would mark the first as superseded.
        //
        //   EXTENDING (gap parent === parent_a, the receiving parent):
        //     Pickup earlier OR drop-off later. Gap range and the
        //     new turnover day are both with parent_a, so the time
        //     deviation can ride on the gap row itself. ONE override.
        //
        //   SHRINKING (gap parent === parent_b, the other parent):
        //     Pickup later OR drop-off earlier. Gap range goes to
        //     parent_b; the new pickup/drop-off still happens with
        //     parent_a on newDate. Need TWO overrides — emit them in
        //     one batch insert so they both survive auto-supersede.
        //
        //   No time change: just the gap override.
        const isExtending = overrideParent === schedule.parent_a_id;
        const inputs: OverrideInput[] = [];

        if (isExtending && timeChanged && params.newTime) {
          // Merged: gap range carries the time. The new turnover
          // day is the boundary of this range so override_time on
          // any day in [rangeStart, rangeEnd] is found by
          // detectTransitions when it looks up `start_date === dateStr`.
          inputs.push(
            ...params.kidIds.map((kidId) => ({
              family_id: params.familyId,
              kid_id: kidId,
              start_date: rangeStart,
              end_date: rangeEnd,
              parent_id: overrideParent,
              note: params.note,
              reason: params.reason,
              compliance_status: "unchecked" as const,
              compliance_issues: null,
              status: "pending" as OverrideStatus,
              created_by: params.userId,
              override_time: params.newTime,
            }))
          );
        } else {
          // Gap override carries no time — its days are owned by the
          // other parent and have no turnover for the time to attach
          // to.
          inputs.push(
            ...params.kidIds.map((kidId) => ({
              family_id: params.familyId,
              kid_id: kidId,
              start_date: rangeStart,
              end_date: rangeEnd,
              parent_id: overrideParent,
              note: params.note,
              reason: params.reason,
              compliance_status: "unchecked" as const,
              compliance_issues: null,
              status: "pending" as OverrideStatus,
              created_by: params.userId,
              override_time: null,
            }))
          );
          if (timeChanged && params.newTime) {
            // Same-day time override at the new turnover date,
            // owned by the parent who's doing the handoff (parent_a).
            inputs.push(
              ...params.kidIds.map((kidId) => ({
                family_id: params.familyId,
                kid_id: kidId,
                start_date: params.newDate,
                end_date: params.newDate,
                parent_id: schedule.parent_a_id,
                note: params.note,
                reason: params.reason,
                compliance_status: "unchecked" as const,
                compliance_issues: null,
                status: "pending" as OverrideStatus,
                created_by: params.userId,
                override_time: params.newTime,
              }))
            );
          }
        }

        await createOverrides(inputs);
      } else if (timeChanged) {
        // Time-only change (date matches standard) — create a same-day override
        // on the turnover date to carry the new time.
        const turnoverDate = params.newDate;
        const standardCustody = computeCustodyForDate(targetDate, [schedule], []);
        const sameParent = standardCustody[params.kidIds[0]]?.parentId || schedule.parent_a_id;

        await createOverrides(params.kidIds.map((kidId) => ({
          family_id: params.familyId,
          kid_id: kidId,
          start_date: turnoverDate,
          end_date: turnoverDate,
          parent_id: sameParent,
          note: params.note,
          reason: params.reason,
          compliance_status: "unchecked" as const,
          compliance_issues: null,
          status: "pending" as OverrideStatus,
          created_by: params.userId,
          override_time: params.newTime,
        })));
      }

      return true;
    },
    [schedules, approvedOverrides, withdrawOverlapping, createOverrides]
  );

  // ── Compact (manual sweep — invoked from Custody Settings) ────

  /**
   * Sweep redundant overrides into `superseded`. Three passes, all
   * non-destructive (audit rows preserved):
   *
   *   1. Stale pending  — rows older than 30 days with no response.
   *      Marked `withdrawn` so they're indistinguishable from a user
   *      cancel; if you ever want a separate auto-expired status,
   *      that's a one-line change here.
   *
   *   2. Redundant approved  — for each (kid, day), keep only the
   *      most recently approved row that covers it. Older approved
   *      rows whose entire date range is covered by newer approved
   *      rows on the same kid get marked superseded. (Single-day
   *      overrides on a day already covered by a multi-day override
   *      are also superseded.)
   *
   *   3. No-op approved  — rows where parent_id matches the standard
   *      schedule for every day in the range AND there's no
   *      override_time deviation. These overrides have zero effect on
   *      computed custody; they're pure clutter.
   *
   * Pulls fresh data from the DB (don't trust the local cache for an
   * audit pass).
   */
  const compactOverrides = useCallback(
    async (familyId: string): Promise<CompactReport> => {
      const report: CompactReport = {
        redundantApproved: 0,
        noopApproved: 0,
        stalePending: 0,
      };

      // Fresh full read — including superseded so we don't try to mark
      // a row twice if the function is run repeatedly.
      const { data: allRows, error: readErr } = await supabase
        .from("custody_overrides")
        .select("*")
        .eq("family_id", familyId);
      if (readErr || !allRows) {
        console.error("[compact] read failed:", readErr);
        return report;
      }
      const rows = allRows as CustodyOverride[];

      // ── Pass 1: stale pending ─────────────────────────────
      const staleCutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const staleIds = rows
        .filter(
          (r) =>
            r.status === "pending" &&
            r.created_at &&
            new Date(r.created_at).getTime() < staleCutoffMs
        )
        .map((r) => r.id);
      if (staleIds.length > 0) {
        await supabase
          .from("custody_overrides")
          .update({ status: "withdrawn" })
          .in("id", staleIds);
        report.stalePending = staleIds.length;
      }

      // ── Pass 2: redundant approved ────────────────────────
      // Per kid: sort approved rows by created_at desc. Walk; for
      // each row, if every day in its range is already covered by an
      // EARLIER-WALKED (i.e. newer) row on the same kid, mark it
      // superseded.
      const approvedByKid = new Map<string, CustodyOverride[]>();
      for (const r of rows) {
        if (r.status !== "approved") continue;
        const list = approvedByKid.get(r.kid_id);
        if (list) list.push(r);
        else approvedByKid.set(r.kid_id, [r]);
      }
      const redundantIds: string[] = [];
      for (const list of approvedByKid.values()) {
        list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
        const covered: { start: string; end: string }[] = [];
        for (const r of list) {
          // Is r.start_date..r.end_date fully covered by the union of
          // earlier-walked rows? Day-string compare is safe (YYYY-MM-DD).
          let cursor = r.start_date;
          let isCovered = true;
          while (cursor <= r.end_date) {
            const seg = covered.find((s) => s.start <= cursor && cursor <= s.end);
            if (!seg) {
              isCovered = false;
              break;
            }
            cursor = nextDayStr(seg.end);
          }
          if (isCovered) {
            redundantIds.push(r.id);
          } else {
            covered.push({ start: r.start_date, end: r.end_date });
          }
        }
      }
      if (redundantIds.length > 0) {
        await supabase
          .from("custody_overrides")
          .update({ status: "superseded" })
          .in("id", redundantIds);
        report.redundantApproved = redundantIds.length;
      }

      // ── Pass 3: no-op approved ────────────────────────────
      // For each remaining approved row, walk its date range and
      // check if base-schedule custody (no overrides) already gives
      // those days to the override's parent_id. If yes for every day
      // AND there's no override_time, the row has zero effect.
      const noopIds: string[] = [];
      const remainingApproved = rows.filter(
        (r) => r.status === "approved" && !redundantIds.includes(r.id)
      );
      for (const r of remainingApproved) {
        if (r.override_time) continue; // time deviation = real effect
        const sched = schedules.find((s) => s.kid_id === r.kid_id);
        if (!sched) continue;
        let cursor = parseLocalDate(r.start_date);
        const end = parseLocalDate(r.end_date);
        let isNoop = true;
        while (cursor <= end) {
          const base = computeCustodyForDate(cursor, [sched], []);
          if (base[r.kid_id]?.parentId !== r.parent_id) {
            isNoop = false;
            break;
          }
          cursor = addDays(cursor, 1);
        }
        if (isNoop) noopIds.push(r.id);
      }
      if (noopIds.length > 0) {
        await supabase
          .from("custody_overrides")
          .update({ status: "superseded" })
          .in("id", noopIds);
        report.noopApproved = noopIds.length;
      }

      await fetchCustody();
      return report;
    },
    [supabase, schedules, fetchCustody]
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
    pendingOverrides,
    agreements,
    loading,
    getCustodyForDate,
    getProjectedCustodyForDate,
    getPendingForDate,
    createOverrides,
    respondToOverrides,
    withdrawOverlapping,
    moveTurnover,
    notifyCustodyChange,
    compactOverrides,
    refetchCustody: fetchCustody,
  };
}
