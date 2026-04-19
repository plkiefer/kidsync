"use client";

import { useState, useRef, useMemo } from "react";
import {
  Kid,
  EventType,
  EventFormData,
  EVENT_TYPE_CONFIG,
} from "@/lib/types";
import {
  Upload,
  X,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  Trash2,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

type ScheduleType = "school" | "sports" | "activity" | "daycare" | "medical" | "other";

interface ExtractedEvent {
  title: string;
  start_date: string;            // YYYY-MM-DD
  end_date: string | null;       // YYYY-MM-DD for multi-day ranges
  all_day: boolean;
  start_time: string | null;     // HH:mm 24h
  end_time: string | null;
  event_type: EventType;
  location: string | null;
  notes: string | null;
  confidence: number;
}

interface ParseResponse {
  events: ExtractedEvent[];
  summary: string | null;
  year_detected: string | null;
  warnings: string[];
}

// Review-stage row: adds UI state (selection, edits) on top of the parsed row.
interface ReviewRow extends ExtractedEvent {
  id: string;                    // stable client-side id for list keys
  selected: boolean;
}

interface ScheduleImportModalProps {
  kids: Kid[];
  /**
   * Bulk insert. Receives the full selected event list in one call — this
   * MUST be a batch-capable handler (single Supabase insert). Per-row looping
   * from the client triggers token-refresh contention with the realtime
   * subscription and deadlocks at 0 / N. See useEvents.createEventsBatch.
   */
  onCreateEvents: (
    rows: EventFormData[]
  ) => Promise<{ inserted: number; failed: number; error?: string }>;
  onClose: () => void;
  onDone?: () => void;           // called after successful insert (e.g., refetch)
}

// ─── Constants ─────────────────────────────────────────────────────────────

const SCHEDULE_TYPES: { value: ScheduleType; label: string; hint: string }[] = [
  { value: "school", label: "School calendar", hint: "Closures, breaks, teacher workdays, early dismissal" },
  { value: "sports", label: "Sports schedule", hint: "Games, practices, tournaments" },
  { value: "activity", label: "Activity / program", hint: "Classes, camps, lessons" },
  { value: "daycare", label: "Daycare schedule", hint: "Closure days, parent events" },
  { value: "medical", label: "Medical schedule", hint: "Appointments, checkups" },
  { value: "other", label: "Other", hint: "We'll infer event types per row" },
];

const EVENT_TYPES: EventType[] = [
  "school", "sports", "medical", "custody", "activity", "travel", "holiday", "other",
];

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Compose a datetime-local string ("YYYY-MM-DDTHH:mm") from separate date +
 * time components. For all-day rows we pin to 00:00 / 23:59 to match how the
 * rest of the app renders those (see EventModal for reference).
 */
function composeDateTime(date: string, time: string | null, fallback: string): string {
  const t = (time && /^\d{2}:\d{2}$/.test(time)) ? time : fallback;
  return `${date}T${t}`;
}

function toEventFormData(row: ReviewRow, kidIds: string[]): EventFormData {
  const startDate = row.start_date;
  const endDate = row.end_date || row.start_date;
  // App convention (see virtualEvents.ts, calendar/page.tsx birthday events,
  // CustodyOverrides): anchor all-day events at noon so TZ conversion from
  // the timestamptz column never shifts the visible date across a boundary.
  // T00:00 / T23:59 serialized as UTC renders as the PREVIOUS / NEXT day in
  // any western timezone.
  const starts_at = row.all_day
    ? `${startDate}T12:00:00`
    : composeDateTime(startDate, row.start_time, "09:00");
  const ends_at = row.all_day
    ? `${endDate}T12:00:00`
    : composeDateTime(endDate, row.end_time, row.start_time ? addOneHour(row.start_time) : "10:00");

  return {
    title: row.title,
    kid_ids: kidIds,
    event_type: row.event_type,
    starts_at,
    ends_at,
    all_day: row.all_day,
    recurring_rule: "",
    location: row.location || "",
    notes: row.notes || "",
  };
}

function addOneHour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const next = (h + 1) % 24;
  return `${String(next).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function confidenceColor(c: number): string {
  if (c >= 0.75) return "var(--color-text-muted)";
  if (c >= 0.5) return "var(--accent-amber)";
  return "var(--accent-red)";
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ScheduleImportModal({
  kids,
  onCreateEvents,
  onClose,
  onDone,
}: ScheduleImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"configure" | "parsing" | "review" | "inserting" | "done">("configure");

  // Step 1 state
  const [file, setFile] = useState<File | null>(null);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("school");
  const [kidIds, setKidIds] = useState<string[]>(kids.length > 0 ? [kids[0].id] : []);
  const [yearContext, setYearContext] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 2 state
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [yearDetected, setYearDetected] = useState<string | null>(null);

  // Step 3 state
  const [insertedCount, setInsertedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [insertErrorMsg, setInsertErrorMsg] = useState<string | null>(null);

  // ── Derived ──
  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);
  const canParse = !!file && kidIds.length > 0 && !!scheduleType;
  const fileLabel = file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : "Choose PDF, DOCX, or TXT";

  // ── Step 1 → Step 2: extract + parse ──
  const handleParse = async () => {
    if (!file) return;
    setErrorMsg(null);
    setStep("parsing");

    try {
      // 1. Extract text via existing generic extractor (custody/extract is content-agnostic).
      const formData = new FormData();
      formData.append("file", file);
      const extractRes = await fetch("/api/custody/extract", {
        method: "POST",
        body: formData,
      });
      if (!extractRes.ok) {
        const err = await extractRes.json().catch(() => ({}));
        throw new Error(err.error || `Text extraction failed (${extractRes.status})`);
      }
      const { text } = await extractRes.json();
      if (!text || typeof text !== "string") {
        throw new Error("No text could be extracted from the document.");
      }

      // 2. Parse via Claude.
      const parseRes = await fetch("/api/schedules/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          scheduleType,
          yearContext: yearContext.trim() || undefined,
        }),
      });
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        throw new Error(err.error || `Schedule parsing failed (${parseRes.status})`);
      }
      const parsed: ParseResponse = await parseRes.json();

      if (!parsed.events || parsed.events.length === 0) {
        throw new Error("No events were extracted. The document may not contain date-specific entries the parser could recognize.");
      }

      // 3. Seed review rows — all selected by default.
      const seeded: ReviewRow[] = parsed.events.map((e, i) => ({
        ...e,
        id: `row-${i}-${e.start_date}`,
        selected: true,
      }));

      setRows(seeded);
      setSummary(parsed.summary);
      setWarnings(parsed.warnings || []);
      setYearDetected(parsed.year_detected);
      setStep("review");
    } catch (err: any) {
      console.error("[ScheduleImport] parse error:", err);
      setErrorMsg(err.message || "Something went wrong. Check the browser console for details.");
      setStep("configure");
    }
  };

  // ── Step 2: row mutators ──
  const toggleRow = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  };
  const toggleAll = (next: boolean) => {
    setRows((prev) => prev.map((r) => ({ ...r, selected: next })));
  };
  const updateRow = (id: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  // ── Step 2 → Step 3: insert ──
  const handleInsert = async () => {
    const toInsert = rows.filter((r) => r.selected);
    if (toInsert.length === 0) return;

    setStep("inserting");
    setInsertedCount(0);
    setFailedCount(0);
    setInsertErrorMsg(null);

    // Batch insert — sequential per-row looping hits a token-refresh deadlock
    // with the events-table realtime subscription. One call, one realtime
    // event, no cascade.
    const payloads = toInsert.map((row) => toEventFormData(row, kidIds));
    const { inserted, failed, error } = await onCreateEvents(payloads);
    setInsertedCount(inserted);
    setFailedCount(failed);
    if (error) setInsertErrorMsg(error);
    setStep("done");
  };

  const handleClose = () => {
    if (step === "done" && onDone) onDone();
    onClose();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: "rgba(26, 26, 26, 0.35)" }}
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-4xl my-8 animate-scale-in"
        style={{
          background: "var(--bg-card)",
          boxShadow: "var(--shadow-modal)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <div className="t-label-xl mb-1">Import Schedule</div>
            <div className="t-caption">
              {step === "configure" && "Upload a schedule — we'll extract events for review."}
              {step === "parsing" && "Reading document and extracting events…"}
              {step === "review" && `${rows.length} events found. Review before adding to your calendar.`}
              {step === "inserting" && "Adding events to your calendar…"}
              {step === "done" && "Import complete."}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 transition-colors"
            style={{ color: "var(--text-muted)" }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-5">
          {step === "configure" && (
            <ConfigureStep
              file={file}
              onFileChange={setFile}
              fileInputRef={fileInputRef}
              fileLabel={fileLabel}
              scheduleType={scheduleType}
              onScheduleTypeChange={setScheduleType}
              kids={kids}
              kidIds={kidIds}
              onKidIdsChange={setKidIds}
              yearContext={yearContext}
              onYearContextChange={setYearContext}
              errorMsg={errorMsg}
            />
          )}

          {step === "parsing" && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin mb-4" style={{ color: "var(--ink)" }} />
              <div className="t-heading mb-1">Parsing schedule</div>
              <div className="t-caption">Claude is reading the document…</div>
            </div>
          )}

          {step === "review" && (
            <ReviewStep
              rows={rows}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              onUpdateRow={updateRow}
              onRemoveRow={removeRow}
              summary={summary}
              warnings={warnings}
              yearDetected={yearDetected}
            />
          )}

          {step === "inserting" && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin mb-4" style={{ color: "var(--ink)" }} />
              <div className="t-heading mb-1">Adding {selectedCount} event{selectedCount === 1 ? "" : "s"}</div>
              <div className="t-caption">Writing to calendar…</div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-12">
              {failedCount > 0 ? (
                <AlertTriangle size={36} className="mb-4" style={{ color: "var(--accent-amber)" }} />
              ) : (
                <CheckCircle2 size={36} className="mb-4" style={{ color: "var(--ink)" }} />
              )}
              <div className="t-heading mb-1">
                {failedCount > 0 && insertedCount === 0 ? "Import failed" : "Import complete"}
              </div>
              <div className="t-caption text-center">
                {insertedCount} event{insertedCount === 1 ? "" : "s"} added
                {failedCount > 0 && ` · ${failedCount} failed`}
              </div>
              {insertErrorMsg && (
                <div
                  className="t-body mt-3 px-3 py-2"
                  style={{
                    color: "var(--accent-red)",
                    background: "var(--accent-red-tint)",
                    border: "1px solid var(--accent-red)",
                    maxWidth: 480,
                  }}
                >
                  {insertErrorMsg}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between px-6 py-4 gap-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          {step === "configure" && (
            <>
              <button
                onClick={handleClose}
                className="t-caption"
                style={{
                  padding: "8px 16px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleParse}
                disabled={!canParse}
                className="btn-primary flex items-center gap-2"
                style={{ padding: "8px 16px", fontSize: 13 }}
              >
                Extract events
                <ArrowRight size={14} />
              </button>
            </>
          )}

          {step === "review" && (
            <>
              <button
                onClick={() => setStep("configure")}
                className="t-caption"
                style={{
                  padding: "8px 16px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                }}
              >
                Back
              </button>
              <button
                onClick={handleInsert}
                disabled={selectedCount === 0}
                className="btn-primary flex items-center gap-2"
                style={{ padding: "8px 16px", fontSize: 13 }}
              >
                Insert {selectedCount} event{selectedCount === 1 ? "" : "s"}
                <ArrowRight size={14} />
              </button>
            </>
          )}

          {step === "done" && (
            <>
              <span />
              <button
                onClick={handleClose}
                className="btn-primary"
                style={{ padding: "8px 16px", fontSize: 13 }}
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ConfigureStep(props: {
  file: File | null;
  onFileChange: (f: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  fileLabel: string;
  scheduleType: ScheduleType;
  onScheduleTypeChange: (t: ScheduleType) => void;
  kids: Kid[];
  kidIds: string[];
  onKidIdsChange: (ids: string[]) => void;
  yearContext: string;
  onYearContextChange: (v: string) => void;
  errorMsg: string | null;
}) {
  const {
    file, onFileChange, fileInputRef, fileLabel,
    scheduleType, onScheduleTypeChange,
    kids, kidIds, onKidIdsChange,
    yearContext, onYearContextChange,
    errorMsg,
  } = props;

  const toggleKid = (id: string) => {
    if (kidIds.includes(id)) onKidIdsChange(kidIds.filter((k) => k !== id));
    else onKidIdsChange([...kidIds, id]);
  };

  return (
    <div className="flex flex-col gap-5">
      {errorMsg && (
        <div
          className="flex items-start gap-2 p-3"
          style={{
            background: "var(--accent-red-tint)",
            border: "1px solid var(--accent-red)",
          }}
        >
          <AlertTriangle size={14} style={{ color: "var(--accent-red)", marginTop: 2 }} />
          <div className="t-body" style={{ color: "var(--accent-red)" }}>{errorMsg}</div>
        </div>
      )}

      {/* File picker */}
      <div>
        <div className="t-label-sm mb-2">Document</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt"
          onChange={(e) => onFileChange(e.target.files?.[0] || null)}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 w-full text-left"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--border)",
            background: file ? "var(--stone-100)" : "var(--bg)",
          }}
        >
          {file ? <FileText size={16} style={{ color: "var(--ink)" }} /> : <Upload size={16} style={{ color: "var(--text-muted)" }} />}
          <span className="t-body" style={{ color: file ? "var(--ink)" : "var(--text-muted)" }}>
            {fileLabel}
          </span>
        </button>
      </div>

      {/* Schedule type */}
      <div>
        <div className="t-label-sm mb-2">Schedule type</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {SCHEDULE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => onScheduleTypeChange(t.value)}
              className="text-left"
              style={{
                padding: "10px 12px",
                border: `1px solid ${scheduleType === t.value ? "var(--ink)" : "var(--border)"}`,
                background: scheduleType === t.value ? "var(--stone-100)" : "var(--bg)",
              }}
            >
              <div className="t-heading" style={{ fontSize: 13, marginBottom: 2 }}>{t.label}</div>
              <div className="t-caption" style={{ fontSize: 11 }}>{t.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Kid selector */}
      <div>
        <div className="t-label-sm mb-2">Applies to</div>
        <div className="flex flex-wrap gap-2">
          {kids.map((kid) => {
            const active = kidIds.includes(kid.id);
            return (
              <button
                key={kid.id}
                onClick={() => toggleKid(kid.id)}
                style={{
                  padding: "8px 14px",
                  border: `1.5px solid ${active ? kid.color : "var(--border)"}`,
                  background: active ? `${kid.color}14` : "transparent",
                  color: active ? kid.color : "var(--text-muted)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {kid.name}
              </button>
            );
          })}
        </div>
        {kidIds.length === 0 && (
          <div className="t-caption mt-2" style={{ color: "var(--accent-red)" }}>
            Select at least one kid.
          </div>
        )}
      </div>

      {/* Year hint */}
      <div>
        <div className="t-label-sm mb-2">Year hint <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--text-muted)" }}>(optional)</span></div>
        <input
          type="text"
          value={yearContext}
          onChange={(e) => onYearContextChange(e.target.value)}
          placeholder="e.g. 2026-2027"
          className="input-field w-full"
          style={{ padding: "10px 12px", fontSize: 14 }}
        />
        <div className="t-caption mt-1" style={{ fontSize: 11 }}>
          Use when the document doesn't spell out the full year anywhere.
        </div>
      </div>
    </div>
  );
}

function ReviewStep(props: {
  rows: ReviewRow[];
  onToggleRow: (id: string) => void;
  onToggleAll: (next: boolean) => void;
  onUpdateRow: (id: string, patch: Partial<ReviewRow>) => void;
  onRemoveRow: (id: string) => void;
  summary: string | null;
  warnings: string[];
  yearDetected: string | null;
}) {
  const { rows, onToggleRow, onToggleAll, onUpdateRow, onRemoveRow, summary, warnings, yearDetected } = props;
  const allSelected = rows.length > 0 && rows.every((r) => r.selected);

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div
          className="p-3"
          style={{ background: "var(--stone-100)", border: "1px solid var(--border)" }}
        >
          <div className="t-caption" style={{ color: "var(--text)" }}>{summary}</div>
          {yearDetected && (
            <div className="t-label-sm mt-1" style={{ textTransform: "none", letterSpacing: 0 }}>
              Year detected: <span style={{ color: "var(--ink)", fontWeight: 600 }}>{yearDetected}</span>
            </div>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div
          className="p-3"
          style={{ background: "var(--accent-amber-tint)", borderLeft: "3px solid var(--accent-amber)" }}
        >
          <div className="t-label-sm mb-1" style={{ color: "var(--accent-amber)" }}>
            <AlertTriangle size={11} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />
            {warnings.length} parser warning{warnings.length === 1 ? "" : "s"}
          </div>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="t-body" style={{ fontSize: 12, color: "var(--accent-amber)" }}>· {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Select-all bar */}
      <div className="flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => onToggleAll(e.target.checked)}
          />
          <span className="t-label-sm" style={{ textTransform: "none", letterSpacing: 0 }}>
            Select all
          </span>
        </label>
        <div className="t-caption">{rows.filter((r) => r.selected).length} of {rows.length} selected</div>
      </div>

      {/* Rows */}
      <div className="flex flex-col" style={{ maxHeight: 420, overflowY: "auto" }}>
        {rows.map((row) => (
          <ReviewRowEditor
            key={row.id}
            row={row}
            onToggle={() => onToggleRow(row.id)}
            onUpdate={(patch) => onUpdateRow(row.id, patch)}
            onRemove={() => onRemoveRow(row.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewRowEditor(props: {
  row: ReviewRow;
  onToggle: () => void;
  onUpdate: (patch: Partial<ReviewRow>) => void;
  onRemove: () => void;
}) {
  const { row, onToggle, onUpdate, onRemove } = props;
  const inputStyle = {
    padding: "6px 8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    fontSize: 12,
    fontFamily: "var(--font-dm-sans), sans-serif",
    color: "var(--text)",
  } as const;

  return (
    <div
      className="grid gap-2 py-2.5"
      style={{
        gridTemplateColumns: "28px 1fr 110px 90px 90px 90px 28px",
        alignItems: "center",
        borderBottom: "1px solid var(--border)",
        opacity: row.selected ? 1 : 0.5,
      }}
    >
      {/* Select */}
      <input type="checkbox" checked={row.selected} onChange={onToggle} />

      {/* Title + notes + confidence */}
      <div>
        <input
          type="text"
          value={row.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          style={{ ...inputStyle, width: "100%", fontWeight: 500 }}
        />
        <div className="flex items-center gap-2 mt-1">
          <span
            className="t-label-sm"
            style={{
              textTransform: "none",
              letterSpacing: 0,
              fontSize: 10,
              color: confidenceColor(row.confidence),
              fontWeight: 600,
            }}
          >
            {Math.round(row.confidence * 100)}%
          </span>
          {row.notes && (
            <span className="t-caption" style={{ fontSize: 11, color: "var(--text-muted)" }}>
              · {row.notes}
            </span>
          )}
        </div>
      </div>

      {/* Type */}
      <select
        value={row.event_type}
        onChange={(e) => onUpdate({ event_type: e.target.value as EventType })}
        style={inputStyle}
      >
        {EVENT_TYPES.map((t) => (
          <option key={t} value={t}>{EVENT_TYPE_CONFIG[t]?.label || t}</option>
        ))}
      </select>

      {/* Date */}
      <input
        type="date"
        value={row.start_date}
        onChange={(e) => onUpdate({ start_date: e.target.value })}
        style={inputStyle}
      />

      {/* Start time or All-day */}
      {row.all_day ? (
        <button
          onClick={() => onUpdate({ all_day: false })}
          style={{ ...inputStyle, cursor: "pointer", color: "var(--text-muted)" }}
        >
          All day
        </button>
      ) : (
        <input
          type="time"
          value={row.start_time || ""}
          onChange={(e) => onUpdate({ start_time: e.target.value })}
          style={inputStyle}
        />
      )}

      {/* End date (for multi-day) or End time */}
      {row.all_day ? (
        <input
          type="date"
          value={row.end_date || row.start_date}
          onChange={(e) => onUpdate({ end_date: e.target.value })}
          style={inputStyle}
        />
      ) : (
        <input
          type="time"
          value={row.end_time || ""}
          onChange={(e) => onUpdate({ end_time: e.target.value })}
          style={inputStyle}
        />
      )}

      {/* Remove */}
      <button
        onClick={onRemove}
        style={{ color: "var(--text-muted)", padding: 4 }}
        aria-label="Remove row"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
