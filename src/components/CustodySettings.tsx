"use client";

import { useState, useRef } from "react";
import { X, Upload, FileText, CheckCircle, AlertTriangle, Loader2, ExternalLink, Shield, Archive } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { withBasePath } from "@/lib/basePath";
import { Kid, Profile, ParsedCustodyTerms, CustodyAgreement, CustodySchedule } from "@/lib/types";
import type { CompactReport } from "@/lib/types";

interface CustodySettingsProps {
  familyId: string;
  kids: Kid[];
  members: Profile[];
  currentUserId: string;
  agreements: CustodyAgreement[];
  schedules: CustodySchedule[];
  onClose: () => void;
  /** Optional — when supplied, renders a "Compact change history"
   *  control on the current-agreement screen. Sweeps redundant /
   *  no-op / stale overrides into `superseded`. Non-destructive. */
  onCompactOverrides?: (familyId: string) => Promise<CompactReport>;
}

type Step = "current" | "upload" | "parsing" | "review" | "done" | "error";

export default function CustodySettings({
  familyId,
  kids,
  members,
  currentUserId,
  agreements,
  schedules,
  onClose,
  onCompactOverrides,
}: CustodySettingsProps) {
  const [compacting, setCompacting] = useState(false);
  const [compactReport, setCompactReport] = useState<CompactReport | null>(
    null
  );
  const [compactError, setCompactError] = useState("");
  const latestAgreement = agreements.length > 0 ? agreements[0] : null;
  const hasSchedule = schedules.length > 0;

  const [step, setStep] = useState<Step>(
    latestAgreement ? "current" : "upload"
  );
  const [fileName, setFileName] = useState("");
  const [terms, setTerms] = useState<ParsedCustodyTerms | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = getSupabase();

  const extractText = async (file: File): Promise<string> => {
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "txt") {
      return await file.text();
    }

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(withBasePath("/api/custody/extract"), {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Failed to extract text");
    }

    const data = await res.json();
    return data.text;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "doc", "docx", "txt"].includes(ext || "")) {
      setError("Please upload a PDF, Word document, or text file.");
      return;
    }

    setFileName(file.name);
    setStep("parsing");
    setError("");

    try {
      const text = await extractText(file);

      const filePath = `custody/${familyId}/${Date.now()}_${file.name}`;
      await supabase.storage.from("attachments").upload(filePath, file);

      const parseRes = await fetch(withBasePath("/api/custody/parse"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, familyId }),
      });

      if (!parseRes.ok) {
        const err = await parseRes.json();
        throw new Error(err.error || "Failed to parse agreement");
      }

      const { terms: parsedTerms } = await parseRes.json();

      await supabase.from("custody_agreements").insert({
        family_id: familyId,
        file_name: file.name,
        file_path: filePath,
        parsed_terms: parsedTerms,
        raw_text: text.slice(0, 100000),
        parsed_at: new Date().toISOString(),
        uploaded_by: currentUserId,
      });

      setTerms(parsedTerms);
      setStep("review");
    } catch (err: any) {
      console.error("[custody] parse error:", err);
      setError(err.message || "Failed to process agreement");
      setStep("error");
    }
  };

  const handleApplySchedule = async () => {
    if (!terms) return;
    setSaving(true);
    setError("");

    try {
      // Clear ALL active overrides when reapplying the agreement
      // (clean slate — prevents any stale custom exchanges from persisting)
      await supabase
        .from("custody_overrides")
        .update({ status: "withdrawn" })
        .eq("family_id", familyId)
        .neq("status", "withdrawn");

      const otherParent = members.find((m) => m.id !== currentUserId);
      const parentMap: Record<string, string> = {};
      parentMap["father"] = currentUserId;
      parentMap["mother"] = otherParent?.id || "";

      const parentAId =
        parentMap[terms.alternating_weekends?.parent || "father"];
      const parentBId =
        parentMap[
          terms.alternating_weekends?.parent === "father" ? "mother" : "father"
        ];

      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
      };

      const patternDays = (terms.alternating_weekends?.days || [])
        .map((d) => dayMap[d.toLowerCase()])
        .filter((d) => d !== undefined);

      for (const kid of kids) {
        const { error: upsertErr } = await supabase.from("custody_schedules").upsert(
          {
            family_id: familyId,
            kid_id: kid.id,
            pattern_type: terms.alternating_weekends?.enabled
              ? "alternating_weeks"
              : "fixed_days",
            parent_a_id: parentAId,
            parent_b_id: parentBId,
            anchor_date: terms.alternating_weekends?.start_date || getNextFriday(),
            pattern_days: patternDays.length > 0 ? patternDays : [5, 6, 0],
            fixed_day_map: terms.weekday_schedule
              ? buildFixedDayMap(terms.weekday_schedule, parentMap)
              : null,
          },
          { onConflict: "family_id,kid_id" }
        );

        if (upsertErr) {
          throw new Error(`Failed to save schedule for ${kid.name}: ${upsertErr.message}`);
        }
      }

      setStep("done");
    } catch (err: any) {
      console.error("[custody] apply error:", err);
      setError(err.message || "Failed to apply schedule");
      setStep("error");
      return;
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadAgreement = async () => {
    if (!latestAgreement?.file_path) return;
    const { data } = await supabase.storage
      .from("attachments")
      .createSignedUrl(latestAgreement.file_path, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, "_blank");
    }
  };

  const existingTerms = latestAgreement?.parsed_terms as ParsedCustodyTerms | null;

  /** Reusable block that renders parsed terms */
  const renderTermsSummary = (t: ParsedCustodyTerms) => (
    <div className="space-y-3">
      <div className="bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm p-4">
        <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
          Summary
        </div>
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          {t.summary}
        </p>
      </div>

      {t.alternating_weekends?.enabled && (
        <div className="bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm p-4">
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
            Weekend Schedule
          </div>
          <p className="text-sm text-[var(--color-text)]">
            {t.alternating_weekends.parent === "father" ? "Dad" : "Mom"} gets
            alternating weekends ({t.alternating_weekends.days?.join(", ")})
            {t.alternating_weekends.pickup_time &&
              ` — pickup at ${t.alternating_weekends.pickup_time}`}
          </p>
        </div>
      )}

      {t.holidays && t.holidays.length > 0 && (
        <div className="bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm p-4">
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Holiday Provisions
          </div>
          <div className="space-y-1">
            {t.holidays.slice(0, 5).map((h, i) => (
              <div key={i} className="text-xs text-[var(--color-text)]">
                <span className="font-semibold">{h.name}:</span> {h.rule}
              </div>
            ))}
            {t.holidays.length > 5 && (
              <div className="text-[10px] text-[var(--color-text-faint)]">
                +{t.holidays.length - 5} more provisions
              </div>
            )}
          </div>
        </div>
      )}

      {t.provisions && t.provisions.length > 0 && (
        <div className="bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm p-4">
          <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Key Provisions
          </div>
          <ul className="space-y-1">
            {t.provisions.map((p, i) => (
              <li key={i} className="text-xs text-[var(--color-text)] flex gap-1.5">
                <span className="text-[var(--color-accent)] shrink-0">-</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--bg)] w-full max-w-lg max-h-[85vh] flex flex-col border border-[var(--border-strong)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-divider)] shrink-0">
          <h2 className="font-display text-lg font-bold">Custody Settings</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-sm border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] flex items-center justify-center hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Current agreement view ── */}
          {step === "current" && existingTerms && (
            <div className="space-y-4">
              {/* Status banner */}
              <div className="flex items-center gap-2 mb-1">
                <Shield size={16} className="text-indigo-400" />
                <span className="text-sm font-semibold text-[var(--color-text)]">
                  Current Custody Agreement
                </span>
                {hasSchedule && (
                  <span className="px-1.5 py-[1px] rounded-sm border border-[#8ea18a]/50 bg-[#8ea18a]/15 text-[#3D7A4F] text-[10px] font-semibold uppercase tracking-[0.08em]">
                    Active
                  </span>
                )}
              </div>

              {/* File info */}
              <div className="flex items-center gap-3 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm p-3">
                <div className="w-9 h-9 rounded-sm bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-indigo-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {latestAgreement!.file_name}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-faint)]">
                    Uploaded {new Date(latestAgreement!.created_at).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                    })}
                    {latestAgreement!.parsed_at && " — AI-parsed"}
                  </div>
                </div>
                {latestAgreement!.file_path && (
                  <button
                    onClick={handleDownloadAgreement}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-sm border border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors shrink-0"
                  >
                    <ExternalLink size={11} />
                    View
                  </button>
                )}
              </div>

              {/* Parsed terms */}
              {renderTermsSummary(existingTerms)}

              {/* ── Custody change history compaction ──
                  Optional surface — only renders when the parent
                  passes onCompactOverrides. Marks redundant approved
                  rows + no-op approved rows + stale (>30 day) pending
                  rows as superseded/withdrawn. Non-destructive: rows
                  stay in the DB for audit, just hidden from active
                  rendering. */}
              {onCompactOverrides && (
                <div className="bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Archive size={14} className="text-[var(--color-text-muted)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[var(--color-text)]">
                        Change-Request History
                      </div>
                      <div className="text-[10px] text-[var(--color-text-faint)] leading-snug">
                        Old change requests pile up over time. Compacting
                        hides redundant, no-op, and stale rows from the
                        Changes list. Nothing is deleted.
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!onCompactOverrides || compacting) return;
                        setCompactError("");
                        setCompactReport(null);
                        setCompacting(true);
                        try {
                          const r = await onCompactOverrides(familyId);
                          setCompactReport(r);
                        } catch (err) {
                          setCompactError(
                            err instanceof Error ? err.message : "Compact failed"
                          );
                        } finally {
                          setCompacting(false);
                        }
                      }}
                      disabled={compacting}
                      className="px-2.5 py-1.5 rounded-sm border border-[var(--border)] bg-[var(--bg)] text-[10px] font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
                    >
                      {compacting ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Archive size={11} />
                      )}
                      {compacting ? "Compacting..." : "Compact"}
                    </button>
                  </div>
                  {compactReport && (
                    <div
                      className="text-[10.5px] leading-relaxed pt-2 border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      {(() => {
                        const total =
                          compactReport.redundantApproved +
                          compactReport.noopApproved +
                          compactReport.stalePending;
                        if (total === 0) {
                          return (
                            <div
                              className="flex items-center gap-1.5"
                              style={{ color: "#3D7A4F" }}
                            >
                              <CheckCircle size={11} />
                              Already clean — nothing to compact.
                            </div>
                          );
                        }
                        return (
                          <div className="space-y-0.5">
                            <div
                              className="flex items-center gap-1.5 font-semibold"
                              style={{ color: "#3D7A4F" }}
                            >
                              <CheckCircle size={11} />
                              Compacted {total} row{total === 1 ? "" : "s"}.
                            </div>
                            <ul className="text-[var(--color-text-muted)] ml-4 list-disc">
                              {compactReport.redundantApproved > 0 && (
                                <li>
                                  {compactReport.redundantApproved} redundant
                                  approved override
                                  {compactReport.redundantApproved === 1
                                    ? ""
                                    : "s"}
                                </li>
                              )}
                              {compactReport.noopApproved > 0 && (
                                <li>
                                  {compactReport.noopApproved} no-op approved
                                  override
                                  {compactReport.noopApproved === 1 ? "" : "s"}{" "}
                                  (matched standard schedule)
                                </li>
                              )}
                              {compactReport.stalePending > 0 && (
                                <li>
                                  {compactReport.stalePending} stale pending
                                  request
                                  {compactReport.stalePending === 1
                                    ? ""
                                    : "s"}{" "}
                                  (older than 30 days)
                                </li>
                              )}
                            </ul>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {compactError && (
                    <div
                      className="text-[10.5px] leading-relaxed pt-2 border-t flex items-center gap-1.5"
                      style={{
                        borderColor: "var(--border)",
                        color: "var(--accent-red)",
                      }}
                    >
                      <AlertTriangle size={11} />
                      {compactError}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-sm border border-[var(--border)] text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => setStep("upload")}
                  className="flex-1 px-4 py-2 rounded-sm border border-action/40 bg-action-bg text-action text-xs font-semibold hover:bg-action/10 transition-colors flex items-center justify-center gap-2"
                >
                  <Upload size={14} />
                  Upload New Agreement
                </button>
              </div>
            </div>
          )}

          {/* ── Upload step ── */}
          {step === "upload" && (
            <div className="text-center py-8">
              <div className="w-14 h-14 rounded-sm bg-action-bg border border-action/30 flex items-center justify-center mx-auto mb-4 text-action">
                <Upload size={28} className="text-indigo-500" />
              </div>
              <h3 className="font-display text-base font-semibold mb-2">
                {latestAgreement ? "Upload New Agreement" : "Upload Custody Agreement"}
              </h3>
              <p className="text-xs text-[var(--color-text-faint)] mb-6 max-w-sm mx-auto">
                {latestAgreement
                  ? "Upload a new agreement to replace the current one. The previous agreement will remain in history."
                  : "Upload your custody agreement (PDF or Word doc) and AI will automatically extract the schedule, holidays, and provisions."}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="px-6 py-2.5 rounded-sm bg-action text-action-fg text-sm font-semibold hover:bg-action-hover transition-colors"
              >
                Choose File
              </button>
              <p className="text-[10px] text-[var(--color-text-faint)] mt-3">
                Supports PDF, Word (.doc/.docx), and plain text files
              </p>
              {latestAgreement && (
                <button
                  onClick={() => setStep("current")}
                  className="mt-4 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition-colors"
                >
                  Back to current agreement
                </button>
              )}
            </div>
          )}

          {/* ── Parsing step ── */}
          {step === "parsing" && (
            <div className="text-center py-8">
              <Loader2 size={32} className="text-[var(--color-accent)] animate-spin mx-auto mb-4" />
              <h3 className="font-display text-base font-semibold mb-1">
                Analyzing Agreement
              </h3>
              <p className="text-xs text-[var(--color-text-faint)]">
                Reading {fileName} and extracting custody terms...
              </p>
            </div>
          )}

          {/* ── Review step ── */}
          {step === "review" && terms && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle size={18} />
                <span className="text-sm font-semibold">Agreement Parsed Successfully</span>
              </div>

              {renderTermsSummary(terms)}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setStep("upload"); setTerms(null); }}
                  className="px-4 py-2 rounded-sm border border-[var(--border)] text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] transition-colors"
                >
                  Re-upload
                </button>
                <button
                  onClick={handleApplySchedule}
                  disabled={saving}
                  className="flex-1 px-4 py-2 rounded-sm bg-action text-action-fg text-xs font-semibold hover:bg-action-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <CheckCircle size={14} />
                  )}
                  Apply Custody Schedule
                </button>
              </div>
            </div>
          )}

          {/* ── Done step ── */}
          {step === "done" && (
            <div className="text-center py-8">
              <CheckCircle size={40} className="text-green-500 mx-auto mb-4" />
              <h3 className="font-display text-base font-semibold mb-2">
                Custody Schedule Applied
              </h3>
              <p className="text-xs text-[var(--color-text-faint)] mb-6">
                The calendar will now show custody indicators based on your
                agreement. Vacation and schedule changes will be checked for
                compliance.
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-sm bg-action text-action-fg text-sm font-semibold hover:bg-action-hover transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {/* ── Error step ── */}
          {step === "error" && (
            <div className="text-center py-8">
              <AlertTriangle size={40} className="text-amber-500 mx-auto mb-4" />
              <h3 className="font-display text-base font-semibold mb-2">
                Something Went Wrong
              </h3>
              <p className="text-xs mb-6 max-w-sm mx-auto" style={{ color: "var(--accent-red)" }}>
                {error}
              </p>
              <button
                onClick={() => { setStep(latestAgreement ? "current" : "upload"); setError(""); }}
                className="px-6 py-2.5 rounded-sm bg-action text-action-fg text-sm font-semibold hover:bg-action-hover transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getNextFriday(): string {
  const d = new Date();
  const day = d.getDay();
  const daysUntilFri = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilFri);
  return d.toISOString().slice(0, 10);
}

function buildFixedDayMap(
  weekdaySchedule: Record<string, string>,
  parentMap: Record<string, string>
): Record<number, string> {
  const dayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5,
  };
  const result: Record<number, string> = {};
  for (const [day, parent] of Object.entries(weekdaySchedule)) {
    const dayNum = dayMap[day.toLowerCase()];
    if (dayNum !== undefined && parentMap[parent]) {
      result[dayNum] = parentMap[parent];
    }
  }
  return result;
}
