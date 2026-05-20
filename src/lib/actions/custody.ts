"use server";

// Custody mutation server actions. All custody writes go through
// here so we get:
//   - One auth deadlock surface (the server cookie read) instead of
//     N hanging browser supabase calls
//   - Auto-supersede + insert happen in the same execution, no
//     cross-call timeout coordination needed
//   - Mutations get verified user.id stamped server-side rather
//     than trusting whatever the client passed
//
// Returns ActionResult<T>. Callers branch on .ok.

import { addDays } from "date-fns";
import {
  actionError,
  getServerSupabase,
  requireUser,
  type ActionResult,
} from "@/lib/serverSupabase";
import {
  computeCustodyForDate,
  findStandardTurnoverDates,
  formatDateStr,
  parseLocalDate,
} from "@/lib/custody";
import type {
  CompactReport,
  CustodyOverride,
  CustodyOverrideInput,
  CustodySchedule,
  OverrideStatus,
} from "@/lib/types";

// ── createOverrides ────────────────────────────────────────────

/** Insert one or more overrides. For pending inputs, auto-supersedes
 *  any prior pending from the same requester that overlaps on the
 *  same kid+date-range. Stamps `created_by` from the authenticated
 *  user (client value is ignored — don't trust input). */
export async function createOverridesAction(
  inputs: CustodyOverrideInput[]
): Promise<ActionResult<CustodyOverride[]>> {
  if (inputs.length === 0) return { ok: true, data: [] };
  try {
    const supabase = getServerSupabase();
    const user = await requireUser(supabase);

    // Server stamps created_by. Whatever the client sent is overridden.
    const safeInputs = inputs.map((i) => ({ ...i, created_by: user.id }));

    await autoSupersedePending(supabase, safeInputs, user.id);

    const { data, error } = await supabase
      .from("custody_overrides")
      .insert(safeInputs)
      .select();

    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data as CustodyOverride[]) || [] };
  } catch (err) {
    return actionError(err);
  }
}

// ── respondToOverrides ────────────────────────────────────────

/** Flip status (+ stamp responded_by / responded_at / response_note)
 *  on a batch of overrides. When approving, also auto-supersedes
 *  any OTHER pending on the same kid+date-range — they're moot
 *  once this one is active. */
export async function respondToOverridesAction(
  overrideIds: string[],
  status: OverrideStatus,
  note: string
): Promise<ActionResult<true>> {
  if (overrideIds.length === 0) return { ok: true, data: true };
  try {
    const supabase = getServerSupabase();
    const user = await requireUser(supabase);

    // Snapshot the target rows BEFORE the update so we can compute
    // which OTHER pending to supersede after the status flip.
    let targetSpans:
      | { kidId: string; start: string; end: string }[]
      | null = null;
    if (status === "approved") {
      const { data: targetRows } = await supabase
        .from("custody_overrides")
        .select("kid_id, start_date, end_date")
        .in("id", overrideIds);
      if (targetRows && targetRows.length > 0) {
        targetSpans = (
          targetRows as Array<{
            kid_id: string;
            start_date: string;
            end_date: string;
          }>
        ).map((r) => ({
          kidId: r.kid_id,
          start: r.start_date,
          end: r.end_date,
        }));
      }
    }

    const { error } = await supabase
      .from("custody_overrides")
      .update({
        status,
        response_note: note || null,
        responded_by: user.id,
        responded_at: new Date().toISOString(),
      })
      .in("id", overrideIds);

    if (error) return { ok: false, error: error.message };

    if (targetSpans && targetSpans.length > 0) {
      for (const s of targetSpans) {
        await supabase
          .from("custody_overrides")
          .update({ status: "superseded" })
          .eq("status", "pending")
          .eq("kid_id", s.kidId)
          .lte("start_date", s.end)
          .gte("end_date", s.start)
          .not("id", "in", `(${overrideIds.join(",")})`);
      }
    }

    return { ok: true, data: true };
  } catch (err) {
    return actionError(err);
  }
}

// ── moveTurnover ──────────────────────────────────────────────

interface MoveTurnoverParams {
  isPickup: boolean;
  currentDate: string;
  newDate: string;
  newTime?: string;
  kidIds: string[];
  familyId: string;
  note: string;
  reason: string;
}

/** Move a pickup/drop-off chip from currentDate to newDate, optionally
 *  with a new time. Server-side because the orchestration needs:
 *    - effective turnover lookup (considering approved overrides)
 *    - gap-range computation
 *    - optional time-row creation alongside the gap row
 *    - auto-supersede + insert in one transaction-ish flow
 *  Each of these used to be a separate browser→Supabase round-trip
 *  with its own deadlock surface. */
export async function moveTurnoverAction(
  params: MoveTurnoverParams
): Promise<ActionResult<true>> {
  try {
    const supabase = getServerSupabase();
    const user = await requireUser(supabase);

    // Fresh schedules + approved overrides from the source of truth.
    const [{ data: schedRows }, { data: overrideRows }] = await Promise.all([
      supabase.from("custody_schedules").select("*"),
      supabase.from("custody_overrides").select("*").eq("status", "approved"),
    ]);
    const schedules = (schedRows as CustodySchedule[]) || [];
    const approvedOverrides = (overrideRows as CustodyOverride[]) || [];

    const schedule = schedules.find((s) => s.kid_id === params.kidIds[0]);
    if (!schedule) {
      return { ok: false, error: "No schedule found for the selected kid" };
    }

    const refDate = parseLocalDate(params.currentDate);
    const targetDate = parseLocalDate(params.newDate);

    // Effective-aware lookup: returns where the chip the user clicked
    // is ACTUALLY anchored on the calendar, not where the base
    // schedule says it'd live. See findStandardTurnoverDates for
    // the wide-scan / partial-result rationale.
    const standard = findStandardTurnoverDates(
      refDate,
      schedule,
      approvedOverrides
    );
    if (!standard) {
      return {
        ok: false,
        error: "No turnover transitions in scan window",
      };
    }
    if (params.isPickup && !standard.pickupDate) {
      return { ok: false, error: "No pickup transition near reference date" };
    }
    if (!params.isPickup && !standard.dropoffDate) {
      return { ok: false, error: "No dropoff transition near reference date" };
    }
    const pickupAnchor = standard.pickupDate!;
    const dropoffAnchor = standard.dropoffDate!;

    let rangeStart: string;
    let rangeEnd: string;
    let overrideParent: string;

    if (params.isPickup) {
      if (targetDate < pickupAnchor) {
        // Extending: pickup earlier than standard → give parent_a the gap days
        rangeStart = params.newDate;
        rangeEnd = formatDateStr(addDays(pickupAnchor, -1));
        overrideParent = schedule.parent_a_id;
      } else {
        // Shrinking: pickup later than standard → give parent_b the gap days
        rangeStart = formatDateStr(pickupAnchor);
        rangeEnd = formatDateStr(addDays(targetDate, -1));
        overrideParent = schedule.parent_b_id;
      }
    } else {
      if (targetDate > dropoffAnchor) {
        // Extending: dropoff later than standard → give parent_a the gap days
        rangeStart = formatDateStr(addDays(dropoffAnchor, 1));
        rangeEnd = params.newDate;
        overrideParent = schedule.parent_a_id;
      } else {
        // Shrinking: dropoff earlier than standard → give parent_b the gap days
        rangeStart = formatDateStr(addDays(targetDate, 1));
        rangeEnd = formatDateStr(dropoffAnchor);
        overrideParent = schedule.parent_b_id;
      }
    }

    const dateChanged = rangeStart <= rangeEnd;
    const timeChanged = !!params.newTime;
    const inputs: CustodyOverrideInput[] = [];

    if (dateChanged) {
      const isExtending = overrideParent === schedule.parent_a_id;

      if (isExtending && timeChanged && params.newTime) {
        // Single merged override: gap range carries the time, since
        // its days end up with the same parent (parent_a) and the new
        // turnover is on the boundary of the range.
        for (const kidId of params.kidIds) {
          inputs.push({
            family_id: params.familyId,
            kid_id: kidId,
            start_date: rangeStart,
            end_date: rangeEnd,
            parent_id: overrideParent,
            note: params.note,
            reason: params.reason,
            compliance_status: "unchecked",
            compliance_issues: null,
            status: "pending",
            created_by: user.id,
            override_time: params.newTime,
          });
        }
      } else {
        // Gap row (other parent, no time)
        for (const kidId of params.kidIds) {
          inputs.push({
            family_id: params.familyId,
            kid_id: kidId,
            start_date: rangeStart,
            end_date: rangeEnd,
            parent_id: overrideParent,
            note: params.note,
            reason: params.reason,
            compliance_status: "unchecked",
            compliance_issues: null,
            status: "pending",
            created_by: user.id,
            override_time: null,
          });
        }
        // Same-day time row at the new turnover date (parent_a does
        // the handoff) — only when the user actually moved the time.
        if (timeChanged && params.newTime) {
          for (const kidId of params.kidIds) {
            inputs.push({
              family_id: params.familyId,
              kid_id: kidId,
              start_date: params.newDate,
              end_date: params.newDate,
              parent_id: schedule.parent_a_id,
              note: params.note,
              reason: params.reason,
              compliance_status: "unchecked",
              compliance_issues: null,
              status: "pending",
              created_by: user.id,
              override_time: params.newTime,
            });
          }
        }
      }
    } else if (timeChanged && params.newTime) {
      // Time-only — single same-day override at the new time.
      const standardCustody = computeCustodyForDate(
        targetDate,
        [schedule],
        []
      );
      const sameParent =
        standardCustody[params.kidIds[0]]?.parentId || schedule.parent_a_id;
      for (const kidId of params.kidIds) {
        inputs.push({
          family_id: params.familyId,
          kid_id: kidId,
          start_date: params.newDate,
          end_date: params.newDate,
          parent_id: sameParent,
          note: params.note,
          reason: params.reason,
          compliance_status: "unchecked",
          compliance_issues: null,
          status: "pending",
          created_by: user.id,
          override_time: params.newTime,
        });
      }
    } else {
      // No-op (date and time both unchanged) — nothing to do.
      return { ok: true, data: true };
    }

    await autoSupersedePending(supabase, inputs, user.id);

    const { error } = await supabase
      .from("custody_overrides")
      .insert(inputs);

    if (error) return { ok: false, error: error.message };
    return { ok: true, data: true };
  } catch (err) {
    return actionError(err);
  }
}

// ── compactOverrides ──────────────────────────────────────────

/** Sweep redundant overrides into `superseded`. Three passes:
 *   1. Stale pending (>30 days, no response) → withdrawn
 *   2. Redundant approved (covered by a newer approved on same kid)
 *      → superseded
 *   3. No-op approved (parent matches standard schedule, no
 *      override_time) → superseded
 *  Non-destructive — rows stay in the DB, just hidden from active. */
export async function compactOverridesAction(
  familyId: string
): Promise<ActionResult<CompactReport>> {
  const report: CompactReport = {
    redundantApproved: 0,
    noopApproved: 0,
    stalePending: 0,
  };
  try {
    const supabase = getServerSupabase();
    await requireUser(supabase);

    const { data: allRows, error: readErr } = await supabase
      .from("custody_overrides")
      .select("*")
      .eq("family_id", familyId);
    if (readErr) return { ok: false, error: readErr.message };
    const rows = (allRows as CustodyOverride[]) || [];

    // ── Pass 1: stale pending ─────────────────────────────────
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

    // ── Pass 2: redundant approved ────────────────────────────
    const approvedByKid = new Map<string, CustodyOverride[]>();
    for (const r of rows) {
      if (r.status !== "approved") continue;
      const list = approvedByKid.get(r.kid_id);
      if (list) list.push(r);
      else approvedByKid.set(r.kid_id, [r]);
    }
    const redundantIds: string[] = [];
    for (const list of approvedByKid.values()) {
      list.sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "")
      );
      const covered: { start: string; end: string }[] = [];
      for (const r of list) {
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

    // ── Pass 3: no-op approved ────────────────────────────────
    const { data: schedRows } = await supabase
      .from("custody_schedules")
      .select("*");
    const schedules = (schedRows as CustodySchedule[]) || [];

    const noopIds: string[] = [];
    const remainingApproved = rows.filter(
      (r) => r.status === "approved" && !redundantIds.includes(r.id)
    );
    for (const r of remainingApproved) {
      if (r.override_time) continue;
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

    return { ok: true, data: report };
  } catch (err) {
    return actionError(err);
  }
}

// ── helpers ───────────────────────────────────────────────────

/** Mark prior PENDING overrides from the same requester that
 *  overlap any of the new inputs' (kid_id, date-range) spans as
 *  superseded. Same logic that used to live inside the client
 *  createOverrides — now runs server-side in the same execution. */
async function autoSupersedePending(
  supabase: ReturnType<typeof getServerSupabase>,
  inputs: CustodyOverrideInput[],
  createdBy: string
): Promise<void> {
  const pendingInputs = inputs.filter((i) => i.status === "pending");
  if (pendingInputs.length === 0) return;

  type Span = { kidId: string; start: string; end: string };
  const spans: Span[] = [];
  for (const inp of pendingInputs) {
    const existing = spans.find((s) => s.kidId === inp.kid_id);
    if (existing) {
      if (inp.start_date < existing.start) existing.start = inp.start_date;
      if (inp.end_date > existing.end) existing.end = inp.end_date;
    } else {
      spans.push({
        kidId: inp.kid_id,
        start: inp.start_date,
        end: inp.end_date,
      });
    }
  }
  for (const s of spans) {
    await supabase
      .from("custody_overrides")
      .update({ status: "superseded" })
      .eq("status", "pending")
      .eq("kid_id", s.kidId)
      .eq("created_by", createdBy)
      .lte("start_date", s.end)
      .gte("end_date", s.start);
  }
}

/** "2026-05-22" → "2026-05-23" */
function nextDayStr(dateStr: string): string {
  return formatDateStr(addDays(parseLocalDate(dateStr), 1));
}
