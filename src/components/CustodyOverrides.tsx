"use client";

import { useState } from "react";
import {
  X,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  Kid,
  Profile,
  CustodyOverride,
  CustodyAgreement,
  OverrideStatus,
  ComplianceStatus,
} from "@/lib/types";

interface CustodyOverridesProps {
  familyId: string;
  kids: Kid[];
  members: Profile[];
  overrides: CustodyOverride[];
  agreements: CustodyAgreement[];
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
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    color: "text-green-400",
    bg: "bg-green-500/10",
    icon: CheckCircle,
  },
  disputed: {
    label: "Disputed",
    color: "text-red-400",
    bg: "bg-red-500/10",
    icon: XCircle,
  },
  withdrawn: {
    label: "Withdrawn",
    color: "text-gray-400",
    bg: "bg-gray-500/10",
    icon: XCircle,
  },
};

const COMPLIANCE_CONFIG: Record<
  ComplianceStatus,
  { label: string; color: string; icon: typeof Shield }
> = {
  unchecked: { label: "Not Checked", color: "text-gray-400", icon: Shield },
  compliant: {
    label: "Compliant",
    color: "text-green-400",
    icon: CheckCircle,
  },
  flagged: { label: "Flagged", color: "text-red-400", icon: AlertTriangle },
};

export default function CustodyOverrides({
  familyId,
  kids,
  members,
  overrides,
  agreements,
  currentUserId,
  onRespondToOverrides,
  onNotifyCustodyChange,
  onClose,
}: CustodyOverridesProps) {
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState("");
  const [respondLoading, setRespondLoading] = useState(false);
  const [expandedOverride, setExpandedOverride] = useState<string | null>(null);

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.full_name || "Unknown";

  const getKidName = (id: string) =>
    kids.find((k) => k.id === id)?.name || "Unknown";


  const handleRespond = async (
    overrideIds: string[],
    status: OverrideStatus
  ) => {
    setRespondLoading(true);
    try {
      await onRespondToOverrides(overrideIds, status, responseNote, currentUserId);
      // Send one notification for all kids in this group
      const firstOverride = overrides.find((o) => o.id === overrideIds[0]);
      if (firstOverride) {
        const kidIds = overrideIds
          .map((id) => overrides.find((o) => o.id === id)?.kid_id)
          .filter(Boolean) as string[];
        onNotifyCustodyChange({
          action: status as "approved" | "disputed" | "withdrawn",
          override: { start_date: firstOverride.start_date, end_date: firstOverride.end_date, parent_id: firstOverride.parent_id, reason: firstOverride.reason, response_note: responseNote, note: firstOverride.note },
          kidIds,
          familyId,
          changedBy: currentUserId,
        });
      }
      setRespondingTo(null);
      setResponseNote("");
    } catch (err) {
      console.error("[override] respond failed:", err);
    } finally {
      setRespondLoading(false);
    }
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

  // Group overrides with same note+date+status+parent (quick changes for multiple kids)
  interface OverrideGroup {
    primary: CustodyOverride;
    all: CustodyOverride[];
    kidIds: string[];
  }
  const groupedOverrides: OverrideGroup[] = [];
  const seen = new Set<string>();
  for (const o of visibleOverrides) {
    if (seen.has(o.id)) continue;
    // Find matching overrides (same note, date, status, parent)
    const matches = visibleOverrides.filter(
      (other) =>
        other.id !== o.id &&
        !seen.has(other.id) &&
        other.note === o.note &&
        other.start_date === o.start_date &&
        other.end_date === o.end_date &&
        other.parent_id === o.parent_id &&
        other.status === o.status
    );
    const all = [o, ...matches];
    all.forEach((m) => seen.add(m.id));
    groupedOverrides.push({
      primary: o,
      all,
      kidIds: all.map((m) => m.kid_id),
    });
  }

  // Sort: pending first, then by date
  const sortedOverrides = [...groupedOverrides].sort((a, b) => {
    const statusOrder: Record<OverrideStatus, number> = {
      pending: 0,
      disputed: 1,
      approved: 2,
      withdrawn: 3,
    };
    const sDiff = statusOrder[a.primary.status] - statusOrder[b.primary.status];
    if (sDiff !== 0) return sDiff;
    return a.primary.start_date.localeCompare(b.primary.start_date);
  });

  const pendingCount = overrides.filter(
    (o) => o.status === "pending" && o.created_by !== currentUserId
  ).length;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-2xl border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-divider)] shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-bold">
              Custody Change Requests
            </h2>
            {pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                {pendingCount} needs response
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[var(--color-input)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Override list */}
          {sortedOverrides.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-faint)]">
              No custody change requests. To request a change, tap a
              pickup or drop-off event on the calendar.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedOverrides.map((group) => {
                const override = group.primary;
                const allIds = group.all.map((o) => o.id);
                const kidNamesStr = group.kidIds.map(getKidName).join(" & ");
                const statusCfg = STATUS_CONFIG[override.status];
                const StatusIcon = statusCfg.icon;
                const isExpanded = expandedOverride === override.id;
                const isMyRequest = override.created_by === currentUserId;
                const needsMyResponse = !isMyRequest && override.status === "pending";
                const requesterName = override.created_by ? getMemberName(override.created_by) : "Unknown";

                // Build a short, clean title
                const shortDate = (d: string) => {
                  const dt = new Date(d + "T12:00:00");
                  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                };
                const dateRange = override.start_date === override.end_date
                  ? shortDate(override.start_date)
                  : `${shortDate(override.start_date)} – ${shortDate(override.end_date)}`;
                const shortTitle = `${kidNamesStr} · ${dateRange}`;

                // ── PENDING NEEDING MY RESPONSE: streamlined inline approve/dispute ──
                if (needsMyResponse) {
                  return (
                    <div
                      key={override.id}
                      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <Clock size={15} className="text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[var(--color-text)]">
                            {shortTitle}
                          </div>
                          {override.note && (
                            <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                              {override.note}
                            </div>
                          )}
                          <div className="text-[11px] text-[var(--color-text-faint)] mt-0.5">
                            Requested by {requesterName}
                          </div>
                        </div>
                      </div>

                      {/* Comment box */}
                      <textarea
                        value={respondingTo === override.id ? responseNote : ""}
                        onFocus={() => setRespondingTo(override.id)}
                        onChange={(e) => {
                          setRespondingTo(override.id);
                          setResponseNote(e.target.value);
                        }}
                        placeholder="Add a comment (required to dispute)..."
                        rows={1}
                        className="w-full px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] resize-none"
                      />

                      {/* Approve / Dispute — always visible */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleRespond(allIds, "approved")}
                          disabled={respondLoading}
                          className="flex-1 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {respondLoading && respondingTo === override.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <CheckCircle size={12} />
                          )}
                          Approve
                        </button>
                        <button
                          onClick={() => handleRespond(allIds, "disputed")}
                          disabled={respondLoading || !(respondingTo === override.id && responseNote.trim())}
                          className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {respondLoading && respondingTo === override.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <XCircle size={12} />
                          )}
                          Dispute
                        </button>
                      </div>
                    </div>
                  );
                }

                // ── ALL OTHER STATUSES: compact expandable card ──
                return (
                  <div
                    key={override.id}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-input)]"
                  >
                    <button
                      onClick={() => setExpandedOverride(isExpanded ? null : override.id)}
                      className="w-full flex items-center gap-3 p-3 text-left"
                    >
                      <StatusIcon size={15} className={statusCfg.color} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[var(--color-text)] truncate">
                          {shortTitle}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-faint)]">
                          {requesterName} → {getMemberName(override.parent_id)}
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusCfg.bg} ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      {isExpanded ? <ChevronUp size={14} className="text-[var(--color-text-faint)]" /> : <ChevronDown size={14} className="text-[var(--color-text-faint)]" />}
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
                            {override.status === "approved" ? "Approved" : "Disputed"} by {getMemberName(override.responded_by)}
                            {override.response_note && ` — "${override.response_note}"`}
                          </div>
                        )}
                        {/* Withdraw own request */}
                        {isMyRequest && override.status === "pending" && (
                          <button
                            onClick={() => handleRespond(allIds, "withdrawn")}
                            disabled={respondLoading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-semibold text-[var(--color-text-faint)] hover:bg-[var(--color-surface-alt)] transition-colors"
                          >
                            <XCircle size={12} />
                            Withdraw Request
                          </button>
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
