"use client";

import { useState } from "react";
import {
  X,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Kid,
  Profile,
  CustodyOverride,
  CustodyAgreement,
  CustodySchedule,
  OverrideStatus,
  ComplianceStatus,
} from "@/lib/types";
import { PendingDiffContent } from "@/components/PendingDiffPopover";
import { partitionByRequest } from "@/lib/overrideGrouping";

interface CustodyOverridesProps {
  familyId: string;
  kids: Kid[];
  members: Profile[];
  overrides: CustodyOverride[];
  agreements: CustodyAgreement[];
  /** Needed by PendingDiffContent to compute the "Currently" column. */
  schedules: CustodySchedule[];
  currentUserId: string;
  onRespondToOverrides: (overrideIds: string[], status: OverrideStatus, note: string, userId: string) => Promise<boolean>;
  onNotifyCustodyChange: (params: {
    action: "requested" | "approved" | "disputed" | "withdrawn";
    override: { start_date: string; end_date: string; parent_id: string; reason?: string | null; response_note?: string | null; note?: string | null };
    kidIds: string[];
    familyId: string;
    changedBy: string;
  }) => void;
  onClose: () => void;
}

const STATUS_CONFIG: Record<
  OverrideStatus,
  { label: string; color: string; bg: string; icon: typeof Clock }
> = {
  pending: {
    label: "Pending",
    color: "text-[var(--accent-amber)]",
    bg: "bg-[var(--accent-amber-tint)] border-[var(--accent-amber)]/30",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    color: "text-[#3D7A4F]",
    bg: "bg-[#8ea18a]/15 border-[#8ea18a]/50",
    icon: CheckCircle,
  },
  disputed: {
    label: "Disputed",
    color: "text-[var(--accent-red)]",
    bg: "bg-[var(--accent-red-tint)] border-[var(--accent-red)]/30",
    icon: XCircle,
  },
  withdrawn: {
    label: "Withdrawn",
    color: "text-[var(--text-muted)]",
    bg: "bg-[var(--bg-sunken)] border-[var(--border)]",
    icon: XCircle,
  },
  // `superseded` rows are filtered out of the modal at the data
  // layer, but the type system requires every status be enumerated.
  // Same visual as withdrawn in case a row ever slips through.
  superseded: {
    label: "Superseded",
    color: "text-[var(--text-muted)]",
    bg: "bg-[var(--bg-sunken)] border-[var(--border)]",
    icon: XCircle,
  },
};

const COMPLIANCE_CONFIG: Record<
  ComplianceStatus,
  { label: string; color: string; icon: typeof Shield }
> = {
  unchecked: { label: "Not Checked", color: "text-[var(--text-muted)]", icon: Shield },
  compliant: {
    label: "Compliant",
    color: "text-[#3D7A4F]",
    icon: CheckCircle,
  },
  flagged: { label: "Flagged", color: "text-[var(--accent-red)]", icon: AlertTriangle },
};

export default function CustodyOverrides({
  familyId,
  kids,
  members,
  overrides,
  agreements,
  schedules,
  currentUserId,
  onRespondToOverrides,
  onNotifyCustodyChange,
  onClose,
}: CustodyOverridesProps) {
  const [expandedOverride, setExpandedOverride] = useState<string | null>(null);

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.full_name || "Unknown";

  const getKidName = (id: string) =>
    kids.find((k) => k.id === id)?.name || "Unknown";

  // Derived once for PendingDiffContent (it computes the "Currently"
  // column from approved overrides only).
  const approvedOverrides = overrides.filter((o) => o.status === "approved");

  // PendingDiffContent calls this with the same signature as the
  // calendar-side popover. Wraps onRespondToOverrides + the notify
  // call so the modal-side approve/dispute/withdraw matches the
  // popover-side behavior exactly.
  const handleRespond = async (
    overrideIds: string[],
    status: OverrideStatus,
    note: string,
    userId: string
  ): Promise<boolean> => {
    const ok = await onRespondToOverrides(overrideIds, status, note, userId);
    if (!ok) return false;
    const firstOverride = overrides.find((o) => o.id === overrideIds[0]);
    if (firstOverride) {
      const kidIds = overrideIds
        .map((id) => overrides.find((o) => o.id === id)?.kid_id)
        .filter(Boolean) as string[];
      onNotifyCustodyChange({
        action: status as "approved" | "disputed" | "withdrawn",
        override: {
          start_date: firstOverride.start_date,
          end_date: firstOverride.end_date,
          parent_id: firstOverride.parent_id,
          reason: firstOverride.reason,
          response_note: note,
          note: firstOverride.note,
        },
        kidIds,
        familyId,
        changedBy: userId,
      });
    }
    return true;
  };

  // Filter out old approved overrides (>14 days past end_date) and old disputed (>30 days)
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const visibleOverrides = overrides.filter((o) => {
    if (o.status === "approved" && o.end_date < fourteenDaysAgo) return false;
    if (o.status === "disputed" && o.end_date < thirtyDaysAgo) return false;
    return true;
  });

  // Group overrides into logical request groups using the
  // shared note + created_at heuristic. This collapses BOTH:
  //   - Multi-kid quick changes (one row per kid, same note + same
  //     batch insert)
  //   - Multi-row date+time moves (gap row + time row for shrinking
  //     pickup/drop-off moves, where the two rows have different
  //     start_date/end_date/parent_id but share note + created_at)
  // Status must also match — pending and approved versions of the
  // same request shouldn't merge.
  interface OverrideGroup {
    primary: CustodyOverride;
    all: CustodyOverride[];
    kidIds: string[];
  }
  const groupedOverrides: OverrideGroup[] = [];
  const byStatus = new Map<string, CustodyOverride[]>();
  for (const o of visibleOverrides) {
    const list = byStatus.get(o.status);
    if (list) list.push(o);
    else byStatus.set(o.status, [o]);
  }
  for (const list of byStatus.values()) {
    for (const reqGroup of partitionByRequest(list)) {
      const kidIds = Array.from(new Set(reqGroup.map((m) => m.kid_id)));
      groupedOverrides.push({
        primary: reqGroup[0],
        all: reqGroup,
        kidIds,
      });
    }
  }

  // Sort: pending first, then by date
  const sortedOverrides = [...groupedOverrides].sort((a, b) => {
    const statusOrder: Record<OverrideStatus, number> = {
      pending: 0,
      disputed: 1,
      approved: 2,
      withdrawn: 3,
      superseded: 4,
    };
    const sDiff = statusOrder[a.primary.status] - statusOrder[b.primary.status];
    if (sDiff !== 0) return sDiff;
    return a.primary.start_date.localeCompare(b.primary.start_date);
  });

  const pendingCount = overrides.filter(
    (o) => o.status === "pending" && o.created_by !== currentUserId
  ).length;

  // Split into Pending (rich diff cards) vs Resolved (compact rows).
  // The pending side reuses PendingDiffContent so the modal feels
  // identical to clicking the day-cell pending pill on the calendar.
  const pendingGroups = sortedOverrides.filter(
    (g) => g.primary.status === "pending"
  );
  const resolvedGroups = sortedOverrides.filter(
    (g) => g.primary.status !== "pending"
  );

  // Auto-expand when there's exactly one pending — saves a click in
  // the common "one thing to deal with" case. Multiple pending stay
  // collapsed so the user can see the full list at a glance.
  const initialExpanded =
    pendingGroups.length === 1 ? pendingGroups[0].primary.id : null;
  const effectiveExpanded =
    expandedOverride === null && pendingGroups.length === 1
      ? initialExpanded
      : expandedOverride;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-2xl border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-divider)] shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-bold">
              Custody Change Requests
            </h2>
            {pendingCount > 0 && (
              <span className="px-1.5 py-[1px] rounded-sm border border-[var(--accent-amber)]/40 bg-[var(--accent-amber-tint)] text-[var(--accent-amber)] text-[10px] font-semibold uppercase tracking-[0.08em]">
                {pendingCount} needs response
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-sm border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {sortedOverrides.length === 0 && (
            <div className="text-center py-8 text-xs text-[var(--color-text-faint)]">
              No custody change requests. To request a change, tap a
              pickup or drop-off event on the calendar.
            </div>
          )}

          {/* ── PENDING SECTION ──
              Each pending request renders as a rich card. Header row
              is the summary (kids · dates · requester); clicking
              expands to the same PendingDiffContent the calendar
              pending-pill opens, so both surfaces feel identical.
              Single-pending case auto-expands. */}
          {pendingGroups.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--color-text-faint)]">
                Awaiting response · {pendingGroups.length}
              </div>
              {pendingGroups.map((group) => {
                const override = group.primary;
                const isExpanded = effectiveExpanded === override.id;
                const isMyRequest = override.created_by === currentUserId;
                const requesterName = override.created_by
                  ? getMemberName(override.created_by)
                  : "Unknown";
                const kidNamesStr = group.kidIds.map(getKidName).join(" & ");
                const shortDate = (d: string) => {
                  const dt = new Date(d + "T12:00:00");
                  return dt.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  });
                };
                const dateRange =
                  override.start_date === override.end_date
                    ? shortDate(override.start_date)
                    : `${shortDate(override.start_date)} – ${shortDate(
                        override.end_date
                      )}`;
                return (
                  <div
                    key={override.id}
                    className="rounded-sm border border-[var(--accent-amber)]/40 bg-[var(--accent-amber-tint)]"
                  >
                    <button
                      onClick={() =>
                        setExpandedOverride(isExpanded ? null : override.id)
                      }
                      className="w-full flex items-center gap-3 p-3 text-left"
                    >
                      <Clock
                        size={15}
                        className="shrink-0"
                        style={{ color: "var(--accent-amber)" }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                          {kidNamesStr} · {dateRange}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-faint)]">
                          {isMyRequest
                            ? "Your request"
                            : `Requested by ${requesterName}`}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp
                          size={14}
                          className="text-[var(--color-text-faint)] shrink-0"
                        />
                      ) : (
                        <ChevronDown
                          size={14}
                          className="text-[var(--color-text-faint)] shrink-0"
                        />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-[var(--accent-amber)]/30 bg-[var(--bg)]">
                        <PendingDiffContent
                          overrides={group.all}
                          kids={kids}
                          members={members}
                          schedules={schedules}
                          approvedOverrides={approvedOverrides}
                          agreements={agreements}
                          currentUserId={currentUserId}
                          onRespond={handleRespond}
                          onResolved={() => setExpandedOverride(null)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── RESOLVED SECTION ──
              Approved / disputed / withdrawn rows. Compact format
              since these aren't actionable — just historical context. */}
          {resolvedGroups.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[var(--color-text-faint)]">
                Recent decisions · {resolvedGroups.length}
              </div>
              {resolvedGroups.map((group) => {
                const override = group.primary;
                const allIds = group.all.map((o) => o.id);
                void allIds;
                const kidNamesStr = group.kidIds.map(getKidName).join(" & ");
                const statusCfg = STATUS_CONFIG[override.status];
                const StatusIcon = statusCfg.icon;
                const isExpanded = effectiveExpanded === override.id;
                const requesterName = override.created_by
                  ? getMemberName(override.created_by)
                  : "Unknown";
                const shortDate = (d: string) => {
                  const dt = new Date(d + "T12:00:00");
                  return dt.toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  });
                };
                const dateRange =
                  override.start_date === override.end_date
                    ? shortDate(override.start_date)
                    : `${shortDate(override.start_date)} – ${shortDate(
                        override.end_date
                      )}`;
                return (
                  <div
                    key={override.id}
                    className="rounded-sm border border-[var(--border)] bg-[var(--bg-sunken)]"
                  >
                    <button
                      onClick={() =>
                        setExpandedOverride(isExpanded ? null : override.id)
                      }
                      className="w-full flex items-center gap-3 p-3 text-left"
                    >
                      <StatusIcon size={15} className={statusCfg.color} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                          {kidNamesStr} · {dateRange}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-faint)]">
                          {requesterName} →{" "}
                          {getMemberName(override.parent_id)}
                        </div>
                      </div>
                      <span
                        className={`px-1.5 py-[1px] rounded-sm border text-[10px] font-semibold uppercase tracking-[0.08em] ${statusCfg.bg} ${statusCfg.color}`}
                      >
                        {statusCfg.label}
                      </span>
                      {isExpanded ? (
                        <ChevronUp
                          size={14}
                          className="text-[var(--color-text-faint)]"
                        />
                      ) : (
                        <ChevronDown
                          size={14}
                          className="text-[var(--color-text-faint)]"
                        />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2 border-t border-[var(--color-divider)]">
                        {override.reason && (
                          <div className="pt-2 text-xs text-[var(--color-text)]">
                            {override.reason}
                          </div>
                        )}
                        {override.responded_by && (
                          <div className="text-[11px] text-[var(--color-text-faint)]">
                            {override.status === "approved"
                              ? "Approved"
                              : "Disputed"}{" "}
                            by {getMemberName(override.responded_by)}
                            {override.response_note &&
                              ` — "${override.response_note}"`}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
