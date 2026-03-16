"use client";

import { useState, useRef } from "react";
import { X, Upload, FileText, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { Kid, Profile, ParsedCustodyTerms } from "@/lib/types";

interface CustodySettingsProps {
  familyId: string;
  kids: Kid[];
  members: Profile[];
  currentUserId: string;
  onClose: () => void;
}

type Step = "upload" | "parsing" | "review" | "done" | "error";

export default function CustodySettings({
  familyId,
  kids,
  members,
  currentUserId,
  onClose,
}: CustodySettingsProps) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [terms, setTerms] = useState<ParsedCustodyTerms | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const supabase = getSupabase();

  const extractText = async (file: File): Promise<string> => {
    // For PDF files, use pdf-parse via API route
    // For Word files, use mammoth via API route
    // For now, we'll send the raw file to a text extraction endpoint
    // or handle client-side for .txt
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "txt") {
      return await file.text();
    }

    // Send file to server for text extraction
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/custody/extract", {
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
      // 1. Extract text from document
      const text = await extractText(file);

      // 2. Upload file to Supabase Storage
      const filePath = `custody/${familyId}/${Date.now()}_${file.name}`;
      await supabase.storage.from("attachments").upload(filePath, file);

      // 3. Send text to AI for parsing
      const parseRes = await fetch("/api/custody/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, familyId }),
      });

      if (!parseRes.ok) {
        const err = await parseRes.json();
        throw new Error(err.error || "Failed to parse agreement");
      }

      const { terms: parsedTerms } = await parseRes.json();

      // 4. Store in custody_agreements table
      await supabase.from("custody_agreements").insert({
        family_id: familyId,
        file_name: file.name,
        file_path: filePath,
        parsed_terms: parsedTerms,
        raw_text: text.slice(0, 100000), // cap storage
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

    try {
      // Map "mother"/"father" to actual parent IDs
      // Heuristic: current user is one parent, the other member is the other
      const otherParent = members.find((m) => m.id !== currentUserId);
      const parentMap: Record<string, string> = {};

      // Ask user to confirm mapping (for now, assume current user is father)
      // This could be improved with a UI step
      parentMap["father"] = currentUserId;
      parentMap["mother"] = otherParent?.id || "";

      const parentAId =
        parentMap[terms.alternating_weekends?.parent || "father"];
      const parentBId =
        parentMap[
          terms.alternating_weekends?.parent === "father" ? "mother" : "father"
        ];

      // Map weekend days to numbers
      const dayMap: Record<string, number> = {
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
        thursday: 4, friday: 5, saturday: 6,
      };

      const patternDays = (terms.alternating_weekends?.days || [])
        .map((d) => dayMap[d.toLowerCase()])
        .filter((d) => d !== undefined);

      // Create/upsert custody schedules for each kid
      for (const kid of kids) {
        await supabase.from("custody_schedules").upsert(
          {
            family_id: familyId,
            kid_id: kid.id,
            pattern_type: terms.alternating_weekends?.enabled
              ? "alternating_weeks"
              : "fixed_days",
            parent_a_id: parentAId,
            parent_b_id: parentBId,
            // Default anchor: next Friday from today
            anchor_date: getNextFriday(),
            pattern_days: patternDays.length > 0 ? patternDays : [5, 6, 0],
            fixed_day_map: terms.weekday_schedule
              ? buildFixedDayMap(terms.weekday_schedule, parentMap)
              : null,
          },
          { onConflict: "family_id,kid_id" }
        );
      }

      setStep("done");
    } catch (err: any) {
      console.error("[custody] apply error:", err);
      setError(err.message || "Failed to apply schedule");
      setStep("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] rounded-2xl w-full max-w-lg border border-[var(--color-border)] shadow-[var(--shadow-modal)] animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-divider)]">
          <h2 className="font-display text-lg font-bold">Custody Settings</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[var(--color-input)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-[var(--color-surface-alt)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5">
          {/* Upload step */}
          {step === "upload" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
                <Upload size={28} className="text-indigo-500" />
              </div>
              <h3 className="font-display text-base font-semibold mb-2">
                Upload Custody Agreement
              </h3>
              <p className="text-xs text-[var(--color-text-faint)] mb-6 max-w-sm mx-auto">
                Upload your custody agreement (PDF or Word doc) and AI will
                automatically extract the schedule, holidays, and provisions.
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
                className="px-6 py-3 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Choose File
              </button>
              <p className="text-[10px] text-[var(--color-text-faint)] mt-3">
                Supports PDF, Word (.doc/.docx), and plain text files
              </p>
            </div>
          )}

          {/* Parsing step */}
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

          {/* Review step */}
          {step === "review" && terms && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle size={18} />
                <span className="text-sm font-semibold">Agreement Parsed Successfully</span>
              </div>

              {/* Summary */}
              <div className="bg-[var(--color-input)] rounded-xl p-4">
                <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                  Summary
                </div>
                <p className="text-sm text-[var(--color-text)] leading-relaxed">
                  {terms.summary}
                </p>
              </div>

              {/* Schedule */}
              {terms.alternating_weekends?.enabled && (
                <div className="bg-[var(--color-input)] rounded-xl p-4">
                  <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                    Weekend Schedule
                  </div>
                  <p className="text-sm text-[var(--color-text)]">
                    {terms.alternating_weekends.parent === "father" ? "Dad" : "Mom"} gets
                    alternating weekends ({terms.alternating_weekends.days?.join(", ")})
                    {terms.alternating_weekends.pickup_time &&
                      ` — pickup at ${terms.alternating_weekends.pickup_time}`}
                  </p>
                </div>
              )}

              {/* Holidays */}
              {terms.holidays && terms.holidays.length > 0 && (
                <div className="bg-[var(--color-input)] rounded-xl p-4">
                  <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Holiday Provisions
                  </div>
                  <div className="space-y-1">
                    {terms.holidays.slice(0, 5).map((h, i) => (
                      <div key={i} className="text-xs text-[var(--color-text)]">
                        <span className="font-semibold">{h.name}:</span> {h.rule}
                      </div>
                    ))}
                    {terms.holidays.length > 5 && (
                      <div className="text-[10px] text-[var(--color-text-faint)]">
                        +{terms.holidays.length - 5} more provisions
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Provisions */}
              {terms.provisions && terms.provisions.length > 0 && (
                <div className="bg-[var(--color-input)] rounded-xl p-4">
                  <div className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                    Key Provisions
                  </div>
                  <ul className="space-y-1">
                    {terms.provisions.map((p, i) => (
                      <li key={i} className="text-xs text-[var(--color-text)] flex gap-1.5">
                        <span className="text-[var(--color-accent)] shrink-0">-</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setStep("upload"); setTerms(null); }}
                  className="px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] transition-colors"
                >
                  Re-upload
                </button>
                <button
                  onClick={handleApplySchedule}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
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

          {/* Done step */}
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
                className="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          )}

          {/* Error step */}
          {step === "error" && (
            <div className="text-center py-8">
              <AlertTriangle size={40} className="text-amber-500 mx-auto mb-4" />
              <h3 className="font-display text-base font-semibold mb-2">
                Something Went Wrong
              </h3>
              <p className="text-xs text-red-400 mb-6 max-w-sm mx-auto">
                {error}
              </p>
              <button
                onClick={() => { setStep("upload"); setError(""); }}
                className="px-6 py-2.5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
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
