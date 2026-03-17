"use client";

import { useState } from "react";
import {
  X,
  Plus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  MessageSquare,
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
  onCreateOverride: (override: any) => Promise<CustodyOverride | null>;
  onRespondToOverride: (
    overrideId: string,
    status: OverrideStatus,
    note: string,
    userId: string
  ) => Promise<boolean>;
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
  onCreateOverride,
  onRespondToOverride,
  onClose,
}: CustodyOverridesProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState("");
  const [respondLoading, setRespondLoading] = useState(false);
  const [expandedOverride, setExpandedOverride] = useState<string | null>(null);

  // Create form state
  const [newKidId, setNewKidId] = useState(kids[0]?.id || "");
  const [newParentId, setNewParentId] = useState(currentUserId);
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newReason, setNewReason] = useState("");
  const [creating, setCreating] = useState(false);

  // Compliance check state
  const [complianceResult, setComplianceResult] = useState<any>(null);
  const [checkingCompliance, setCheckingCompliance] = useState(false);

  const getMemberName = (id: string) =>
    members.find((m) => m.id === id)?.full_name || "Unknown";

  const getKidName = (id: string) =>
    kids.find((k) => k.id === id)?.name || "Unknown";

  const latestAgreement = agreements.length > 0 ? agreements[0] : null;

  const checkCompliance = async () => {
    if (!latestAgreement?.parsed_terms) return;

    setCheckingCompliance(true);
    setComplianceResult(null);

    try {
      const res = await fetch("/api/custody/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: latestAgreement.parsed_terms,
          change: {
            type: "custody_override",
            kid: getKidName(newKidId),
            start_date: newStartDate,
            end_date: newEndDate,
            parent: getMemberName(newParentId),
            note: newNote,
            reason: newReason,
          },
        }),
      });

      if (res.ok) {
        const result = await res.json();
        setComplianceResult(result);
      }
    } catch (err) {
      console.error("[compliance] check failed:", err);
    } finally {
      setCheckingCompliance(false);
    }
  };

  const handleCreate = async () => {
    if (!newStartDate || !newEndDate || !newKidId) return;

    setCreating(true);
    try {
      await onCreateOverride({
        family_id: familyId,
        kid_id: newKidId,
        start_date: newStartDate,
        end_date: newEndDate,
        parent_id: newParentId,
        note: newNote || null,
        reason: newReason || null,
        compliance_status: complianceResult
          ? complianceResult.compliant
            ? "compliant"
            : "flagged"
          : "unchecked",
        compliance_issues: complianceResult?.issues || null,
        status: "pending" as OverrideStatus,
        created_by: currentUserId,
      });

      // Reset form
      setShowCreateForm(false);
      setNewNote("");
      setNewReason("");
      setNewStartDate("");
      setNewEndDate("");
      setComplianceResult(null);
    } catch (err) {
      console.error("[override] create failed:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleRespond = async (
    overrideIds: string[],
    status: OverrideStatus
  ) => {
    setRespondLoading(true);
    try {
      for (const id of overrideIds) {
        await onRespondToOverride(
          id,
          status,
          responseNote,
          currentUserId
        );
      }
      setRespondingTo(null);
      setResponseNote("");
    } catch (err) {
      console.error("[override] respond failed:", err);
    } finally {
      setRespondLoading(false);
    }
  };

  // Group overrides with same note+date+status+parent (quick changes for multiple kids)
  interface OverrideGroup {
    primary: CustodyOverride;
    all: CustodyOverride[];
    kidIds: string[];
  }
  const groupedOverrides: OverrideGroup[] = [];
  const seen = new Set<string>();
  for (const o of overrides) {
    if (seen.has(o.id)) continue;
    // Find matching overrides (same note, date, status, parent)
    const matches = overrides.filter(
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
              Custody Changes
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
          {/* Create new override */}
          {!showCreateForm ? (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all"
            >
              <Plus size={14} />
              Request Custody Change
            </button>
          ) : (
            <div className="bg-[var(--color-input)] rounded-xl p-4 space-y-3 border border-[var(--color-border)]">
              <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                New Custody Change Request
              </div>

              {/* Kid selector */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--color-text-faint)] font-semibold uppercase">
                    Child
                  </label>
                  <select
                    value={newKidId}
                    onChange={(e) => setNewKidId(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)]"
                  >
                    {kids.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-[var(--color-text-faint)] font-semibold uppercase">
                    Custody Goes To
                  </label>
                  <select
                    value={newParentId}
                    onChange={(e) => setNewParentId(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)]"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[var(--color-text-faint)] font-semibold uppercase">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--color-text-faint)] font-semibold uppercase">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)]"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-[10px] text-[var(--color-text-faint)] font-semibold uppercase">
                  Description
                </label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="e.g., Spring break vacation swap"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)]"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="text-[10px] text-[var(--color-text-faint)] font-semibold uppercase">
                  Reason for Change
                </label>
                <textarea
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  placeholder="Why is this custody change needed?"
                  rows={2}
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] resize-none"
                />
              </div>

              {/* Compliance check */}
              {latestAgreement?.parsed_terms && (
                <div>
                  {!complianceResult && !checkingCompliance && (
                    <button
                      onClick={checkCompliance}
                      disabled={!newStartDate || !newEndDate}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-[10px] font-semibold hover:bg-indigo-500/20 transition-colors disabled:opacity-40"
                    >
                      <Shield size={12} />
                      Check Agreement Compliance
                    </button>
                  )}

                  {checkingCompliance && (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-faint)]">
                      <Loader2 size={14} className="animate-spin" />
                      Checking against custody agreement...
                    </div>
                  )}

                  {complianceResult && (
                    <div
                      className={`rounded-lg p-3 border ${
                        complianceResult.compliant
                          ? "border-green-500/30 bg-green-500/10"
                          : "border-red-500/30 bg-red-500/10"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {complianceResult.compliant ? (
                          <CheckCircle
                            size={14}
                            className="text-green-400"
                          />
                        ) : (
                          <AlertTriangle
                            size={14}
                            className="text-red-400"
                          />
                        )}
                        <span
                          className={`text-xs font-semibold ${
                            complianceResult.compliant
                              ? "text-green-400"
                              : "text-red-400"
                          }`}
                        >
                          {complianceResult.compliant
                            ? "Compliant with Agreement"
                            : "Potential Violations Found"}
                        </span>
                      </div>

                      {complianceResult.issues?.length > 0 && (
                        <ul className="space-y-1 mt-2">
                          {complianceResult.issues.map(
                            (issue: string, i: number) => (
                              <li
                                key={i}
                                className="text-[11px] text-red-300 flex gap-1.5"
                              >
                                <span className="shrink-0">-</span>
                                {issue}
                              </li>
                            )
                          )}
                        </ul>
                      )}

                      {complianceResult.suggestions?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
                          <div className="text-[10px] font-semibold text-[var(--color-text-faint)] uppercase mb-1">
                            Suggestions
                          </div>
                          {complianceResult.suggestions.map(
                            (s: string, i: number) => (
                              <div
                                key={i}
                                className="text-[11px] text-[var(--color-text-muted)]"
                              >
                                {s}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => {
                    setShowCreateForm(false);
                    setComplianceResult(null);
                  }}
                  className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !newStartDate || !newEndDate}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  Submit Request
                </button>
              </div>

              {complianceResult && !complianceResult.compliant && (
                <p className="text-[10px] text-amber-400">
                  You can still submit this request — the other parent will
                  see the compliance warning and can approve or dispute it.
                </p>
              )}
            </div>
          )}

          {/* Override list */}
          {sortedOverrides.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-faint)]">
              No custody changes yet. Use the button above to request a
              schedule change.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedOverrides.map((group) => {
                const override = group.primary;
                const allIds = group.all.map((o) => o.id);
                const kidNamesStr = group.kidIds.map(getKidName).join(" & ");
                const statusCfg = STATUS_CONFIG[override.status];
                const compCfg =
                  COMPLIANCE_CONFIG[override.compliance_status];
                const StatusIcon = statusCfg.icon;
                const CompIcon = compCfg.icon;
                const isExpanded = expandedOverride === override.id;
                const isMyRequest =
                  override.created_by === currentUserId;
                const needsMyResponse =
                  !isMyRequest && override.status === "pending";

                return (
                  <div
                    key={override.id}
                    className={`rounded-xl border transition-colors ${
                      needsMyResponse
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-[var(--color-border)] bg-[var(--color-input)]"
                    }`}
                  >
                    {/* Summary row */}
                    <button
                      onClick={() =>
                        setExpandedOverride(isExpanded ? null : override.id)
                      }
                      className="w-full flex items-center gap-3 p-3 text-left"
                    >
                      <StatusIcon
                        size={16}
                        className={statusCfg.color}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--color-text)] truncate">
                            {override.note || "Custody Change"}
                          </span>
                          {needsMyResponse && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400">
                              ACTION NEEDED
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
                          <span>{kidNamesStr}</span>
                          <span>-</span>
                          <span>
                            {override.start_date} to {override.end_date}
                          </span>
                          <span>-</span>
                          <span>
                            with {getMemberName(override.parent_id)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {override.compliance_status === "flagged" && (
                          <AlertTriangle
                            size={14}
                            className="text-red-400"
                          />
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusCfg.bg} ${statusCfg.color}`}
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
                      </div>
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-3 border-t border-[var(--color-divider)]">
                        {/* Details */}
                        <div className="pt-3 grid grid-cols-2 gap-2 text-[11px]">
                          <div>
                            <span className="text-[var(--color-text-faint)]">
                              Requested by:{" "}
                            </span>
                            <span className="text-[var(--color-text)] font-medium">
                              {override.created_by
                                ? getMemberName(override.created_by)
                                : "Unknown"}
                            </span>
                          </div>
                          <div>
                            <span className="text-[var(--color-text-faint)]">
                              Custody to:{" "}
                            </span>
                            <span className="text-[var(--color-text)] font-medium">
                              {getMemberName(override.parent_id)}
                            </span>
                          </div>
                        </div>

                        {/* Reason */}
                        {override.reason && (
                          <div className="bg-[var(--color-surface)]/50 rounded-lg p-2.5">
                            <div className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase mb-1">
                              Reason
                            </div>
                            <p className="text-xs text-[var(--color-text)]">
                              {override.reason}
                            </p>
                          </div>
                        )}

                        {/* Compliance */}
                        {override.compliance_status !== "unchecked" && (
                          <div
                            className={`rounded-lg p-2.5 border ${
                              override.compliance_status === "compliant"
                                ? "border-green-500/20 bg-green-500/5"
                                : "border-red-500/20 bg-red-500/5"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <CompIcon
                                size={12}
                                className={compCfg.color}
                              />
                              <span
                                className={`text-[10px] font-bold uppercase ${compCfg.color}`}
                              >
                                {compCfg.label}
                              </span>
                            </div>
                            {override.compliance_issues &&
                              override.compliance_issues.length > 0 && (
                                <ul className="space-y-0.5">
                                  {override.compliance_issues.map(
                                    (issue, i) => (
                                      <li
                                        key={i}
                                        className="text-[11px] text-red-300 flex gap-1.5"
                                      >
                                        <span className="shrink-0">
                                          -
                                        </span>
                                        {issue}
                                      </li>
                                    )
                                  )}
                                </ul>
                              )}
                          </div>
                        )}

                        {/* Response from other parent */}
                        {override.responded_by && (
                          <div className="bg-[var(--color-surface)]/50 rounded-lg p-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <MessageSquare
                                size={12}
                                className="text-[var(--color-text-faint)]"
                              />
                              <span className="text-[10px] font-bold text-[var(--color-text-faint)] uppercase">
                                Response from{" "}
                                {getMemberName(override.responded_by)}
                              </span>
                            </div>
                            {override.response_note && (
                              <p className="text-xs text-[var(--color-text)]">
                                {override.response_note}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Response actions */}
                        {needsMyResponse && (
                          <div className="space-y-2">
                            {respondingTo === override.id ? (
                              <div className="space-y-2">
                                <textarea
                                  value={responseNote}
                                  onChange={(e) =>
                                    setResponseNote(e.target.value)
                                  }
                                  placeholder="Add a comment (required for disputes)..."
                                  rows={2}
                                  className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] resize-none"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      setRespondingTo(null);
                                      setResponseNote("");
                                    }}
                                    className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-[10px] font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleRespond(
                                        allIds,
                                        "approved"
                                      )
                                    }
                                    disabled={respondLoading}
                                    className="flex-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-[10px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                                  >
                                    {respondLoading ? (
                                      <Loader2
                                        size={12}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <CheckCircle size={12} />
                                    )}
                                    Approve
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleRespond(
                                        allIds,
                                        "disputed"
                                      )
                                    }
                                    disabled={respondLoading || !responseNote.trim()}
                                    className="flex-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[10px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
                                  >
                                    {respondLoading ? (
                                      <Loader2
                                        size={12}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <XCircle size={12} />
                                    )}
                                    Dispute
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() =>
                                  setRespondingTo(override.id)
                                }
                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-semibold hover:bg-amber-500/20 transition-colors"
                              >
                                <MessageSquare size={12} />
                                Respond to This Request
                              </button>
                            )}
                          </div>
                        )}

                        {/* Withdraw own request */}
                        {isMyRequest && override.status === "pending" && (
                          <button
                            onClick={() =>
                              handleRespond(
                                allIds,
                                "withdrawn"
                              )
                            }
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
