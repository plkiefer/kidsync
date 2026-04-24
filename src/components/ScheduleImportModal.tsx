"use client";

import { useState, useRef, useMemo } from "react";
import {
  CalendarEvent,
  Kid,
  EventType,
  EventFormData,
  EVENT_TYPE_CONFIG,
  getEventKidIds,
} from "@/lib/types";
import { formatAllDayTimestamp } from "@/lib/allDay";
import { parseTimestamp } from "@/lib/dates";
import {
  Upload,
  X,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  Trash2,
  GitMerge,
  Plus,
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

type RowAction = "insert" | "merge" | "skip";

// Review-stage row: adds UI state (selection, edits, match, action) on top of
// the parsed row.
interface ReviewRow extends ExtractedEvent {
  id: string;                    // stable client-side id for list keys
  selected: boolean;
  match: CalendarEvent | null;   // existing event this row likely duplicates
  action: RowAction;             // what to do at insert time
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
  /**
   * Optional: apply a patch to each listed existing event. Used by Phase-B
   * near-duplicate merge. When omitted, matched rows can still be toggled
   * to "skip" but the "merge" action becomes unavailable.
   */
  onUpdateEvents?: (
    updates: Array<{ id: string; patch: Partial<EventFormData> }>
  ) => Promise<{ updated: number; failed: number; error?: string }>;
  /** Existing calendar events, used to detect near-duplicates per row. */
  existingEvents?: CalendarEvent[];
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

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const DOC_EXTENSIONS = new Set(["pdf", "docx", "doc", "txt"]);
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB per image raw → ~5.3 MB base64
const FILE_ACCEPT = ".pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp,.gif";

function fileExt(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}
function isImageFile(file: File): boolean {
  return IMAGE_EXTENSIONS.has(fileExt(file));
}
function isDocFile(file: File): boolean {
  return DOC_EXTENSIONS.has(fileExt(file));
}
function fileMediaType(file: File): string {
  // Trust the browser-provided MIME when present; fall back to extension
  // mapping for environments that drop it.
  if (file.type) return file.type;
  const ext = fileExt(file);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}
/** Read a file as a base-64 string (no data-URI prefix). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file as text"));
        return;
      }
      const commaIdx = result.indexOf(",");
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(file);
  });
}

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
  // All-day events go through formatAllDayTimestamp (lib/allDay.ts) so the
  // T12:00 UTC convention is applied consistently with the rest of the app.
  // Single-day events need ends_at padded by 1ms so the DB's CHECK constraint
  // (ends_at > starts_at) doesn't reject them.
  const isSingleDay = endDate === startDate;
  const starts_at = row.all_day
    ? formatAllDayTimestamp(startDate)
    : composeDateTime(startDate, row.start_time, "09:00");
  const ends_at = row.all_day
    ? formatAllDayTimestamp(endDate, { asEnd: isSingleDay })
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
  if (c >= 0.75) return "var(--ink)";
  if (c >= 0.5) return "var(--accent-amber)";
  return "var(--accent-red)";
}

/** Visual confidence bar — 36px wide, 4px tall, filled to percent. */
function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.max(0, Math.min(1, confidence));
  const color = confidenceColor(pct);
  const label =
    pct >= 0.75 ? "High confidence" :
    pct >= 0.5  ? "Medium confidence" :
                  "Low confidence";
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0"
      title={`${label} · ${Math.round(pct * 100)}%`}
    >
      <span
        aria-hidden
        style={{
          display: "block",
          width: 36,
          height: 4,
          background: "var(--stone-150)",
          position: "relative",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${pct * 100}%`,
            height: "100%",
            background: color,
          }}
        />
      </span>
    </span>
  );
}

// ─── Near-duplicate matching ───────────────────────────────────────────────

/** Common schedule filler words that shouldn't drive the match score. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "at", "to", "vs", "vs.",
  "game", "practice", "meet", "event", "day",
]);

/** Normalize a title into a de-stopworded token set. */
function tokenize(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Jaccard similarity with a subset-override: if one side is a strict subset
 *  of the other (e.g., "Soccer" vs "Soccer vs Riverside"), return 0.9 so we
 *  still match — the imported row is usually adding context to an existing
 *  shorter event (or vice versa). */
function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  if (ta.size <= tb.size && intersection === ta.size) return Math.max(0.9, intersection / union);
  if (tb.size <= ta.size && intersection === tb.size) return Math.max(0.9, intersection / union);
  return intersection / union;
}

/** Does an existing event cover the same calendar day as this row? */
function sameDay(row: ExtractedEvent, ev: CalendarEvent): boolean {
  const rowDate = row.start_date; // already YYYY-MM-DD
  const evDate = parseTimestamp(ev.starts_at);
  const yyyy = evDate.getFullYear();
  const mm = String(evDate.getMonth() + 1).padStart(2, "0");
  const dd = String(evDate.getDate()).padStart(2, "0");
  return rowDate === `${yyyy}-${mm}-${dd}`;
}

/**
 * Find the best existing-event match for an imported row, or null if none
 * is similar enough. Criteria: same calendar day, same event_type, title
 * similarity ≥ 0.4 (Jaccard with subset override at 0.9). Virtual events
 * (turnovers, holidays, recurrence instances) are excluded — they're not
 * first-class rows we'd want to merge into.
 */
function findMatch(row: ExtractedEvent, existing: CalendarEvent[]): CalendarEvent | null {
  const candidates = existing.filter(
    (e) =>
      !e._virtual &&
      !e._recurrence_parent &&
      e.event_type === row.event_type &&
      sameDay(row, e)
  );
  if (candidates.length === 0) return null;
  let best: { ev: CalendarEvent; score: number } | null = null;
  for (const ev of candidates) {
    const score = titleSimilarity(row.title, ev.title);
    if (!best || score > best.score) best = { ev, score };
  }
  return best && best.score >= 0.4 ? best.ev : null;
}

/**
 * Build an update patch for a merge. Purely additive — existing fields are
 * only replaced when they're empty / less specific. The parent's original
 * title survives; the new row's text is appended to notes as the imported
 * context ("uniform color gold, snacks Patrick"), keeping history readable.
 */
function buildMergePatch(
  existing: CalendarEvent,
  row: ReviewRow,
  kidIdsFromImport: string[]
): Partial<EventFormData> {
  const patch: Partial<EventFormData> = {};

  // Location: fill if empty.
  if (!existing.location && row.location) {
    patch.location = row.location;
  }

  // Notes: append imported context with a prefix so the provenance is clear.
  if (row.notes && row.notes.trim()) {
    const importedNote = `· Imported: ${row.notes.trim()}`;
    patch.notes = existing.notes
      ? `${existing.notes}\n${importedNote}`
      : importedNote;
  }

  // Time: if existing is all-day and imported has a specific time, upgrade.
  if (existing.all_day && !row.all_day && row.start_time) {
    patch.all_day = false;
    patch.starts_at = composeDateTime(row.start_date, row.start_time, "09:00");
    patch.ends_at = composeDateTime(
      row.end_date || row.start_date,
      row.end_time,
      row.start_time ? addOneHour(row.start_time) : "10:00"
    );
  }

  // Kids: union the existing kid list with the import's kid selection.
  const existingKids = getEventKidIds(existing);
  const merged = [...new Set([...existingKids, ...kidIdsFromImport])];
  if (merged.length > existingKids.length) {
    patch.kid_ids = merged;
  }

  return patch;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ScheduleImportModal({
  kids,
  onCreateEvents,
  onUpdateEvents,
  existingEvents = [],
  onClose,
  onDone,
}: ScheduleImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"configure" | "parsing" | "review" | "inserting" | "done">("configure");

  // Step 1 state
  const [files, setFiles] = useState<File[]>([]);
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
  const [mergedCount, setMergedCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [insertErrorMsg, setInsertErrorMsg] = useState<string | null>(null);

  // ── Derived ──
  const selectedCount = useMemo(() => rows.filter((r) => r.selected).length, [rows]);
  const matchedCount = useMemo(() => rows.filter((r) => r.match).length, [rows]);
  const mergeDisabled = !onUpdateEvents;
  const allImages = files.length > 0 && files.every(isImageFile);
  const singleDoc = files.length === 1 && isDocFile(files[0]);
  const validUpload = allImages || singleDoc;
  const canParse = validUpload && kidIds.length > 0 && !!scheduleType;
  const fileLabel =
    files.length === 0
      ? "Choose PDF, DOCX, TXT, or photos"
      : files.length === 1
        ? `${files[0].name} (${(files[0].size / 1024).toFixed(0)} KB)`
        : `${files.length} photos · ${(files.reduce((s, f) => s + f.size, 0) / 1024).toFixed(0)} KB total`;

  // ── Step 1 → Step 2: extract + parse ──
  // Two paths into the parser:
  //   Image mode: 1–N photos → base64 encode → send directly to /parse with
  //               `images`. Claude vision reads the schedule off the photos.
  //   Doc mode:   1 PDF/DOCX/TXT → /api/custody/extract (pdfjs / mammoth /
  //               utf-8) → forward extracted text to /parse with `text`.
  const handleParse = async () => {
    if (files.length === 0) return;
    setErrorMsg(null);

    if (allImages && files.length > MAX_IMAGES) {
      setErrorMsg(`Up to ${MAX_IMAGES} photos per import.`);
      return;
    }
    if (allImages) {
      const tooBig = files.find((f) => f.size > MAX_IMAGE_BYTES);
      if (tooBig) {
        setErrorMsg(
          `"${tooBig.name}" is ${(tooBig.size / 1024 / 1024).toFixed(1)} MB — max 4 MB per photo. Try a lower-resolution shot.`
        );
        return;
      }
    }

    setStep("parsing");

    try {
      let parseBody: Record<string, unknown>;

      if (allImages) {
        // Image mode — base64-encode every photo, preserve order.
        const images = await Promise.all(
          files.map(async (f) => ({
            mediaType: fileMediaType(f),
            data: await fileToBase64(f),
          }))
        );
        parseBody = {
          images,
          scheduleType,
          yearContext: yearContext.trim() || undefined,
        };
      } else {
        // Doc mode — run through the existing text extractor first.
        const formData = new FormData();
        formData.append("file", files[0]);
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
        parseBody = {
          text,
          scheduleType,
          yearContext: yearContext.trim() || undefined,
        };
      }

      const parseRes = await fetch("/api/schedules/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseBody),
      });
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        throw new Error(err.error || `Schedule parsing failed (${parseRes.status})`);
      }
      const parsed: ParseResponse = await parseRes.json();

      if (!parsed.events || parsed.events.length === 0) {
        throw new Error("No events were extracted. The document may not contain date-specific entries the parser could recognize.");
      }

      // 3. Seed review rows — all selected by default, and run near-duplicate
      //    detection so rows that match an existing calendar event default to
      //    "merge" (falling back to "insert" when the caller didn't wire an
      //    update handler).
      const seeded: ReviewRow[] = parsed.events.map((e, i) => {
        const match = findMatch(e, existingEvents);
        const defaultAction: RowAction =
          match && onUpdateEvents ? "merge" : "insert";
        return {
          ...e,
          id: `row-${i}-${e.start_date}`,
          selected: true,
          match,
          action: defaultAction,
        };
      });

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

  // ── Step 2 → Step 3: insert / merge ──
  const handleInsert = async () => {
    const active = rows.filter((r) => r.selected && r.action !== "skip");
    if (active.length === 0) return;

    setStep("inserting");
    setInsertedCount(0);
    setMergedCount(0);
    setFailedCount(0);
    setInsertErrorMsg(null);

    // Split by action. Inserts go through createEventsBatch (one call, one
    // realtime event, no token-refresh cascade — see useEvents docs). Merges
    // are a per-row updateEvent sequence wrapped into one batch via the
    // caller-provided onUpdateEvents callback.
    const inserts = active.filter((r) => r.action === "insert");
    const merges = active.filter(
      (r) => r.action === "merge" && r.match && onUpdateEvents
    );

    const insertPayloads = inserts.map((row) => toEventFormData(row, kidIds));
    const mergePayloads = merges.map((row) => ({
      id: row.match!.id,
      patch: buildMergePatch(row.match!, row, kidIds),
    }));

    const insertPromise: Promise<{ inserted: number; failed: number; error?: string }> =
      insertPayloads.length > 0
        ? onCreateEvents(insertPayloads)
        : Promise.resolve({ inserted: 0, failed: 0 });
    const mergePromise: Promise<{ updated: number; failed: number; error?: string }> =
      mergePayloads.length > 0 && onUpdateEvents
        ? onUpdateEvents(mergePayloads)
        : Promise.resolve({ updated: 0, failed: 0 });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Import took longer than 30 seconds — likely a Supabase deadlock or network stall. Check DevTools → Network for the calendar_events POST/PATCH."
            )
          ),
        30000
      )
    );

    try {
      const [insertRes, mergeRes] = await Promise.race([
        Promise.all([insertPromise, mergePromise]),
        timeout,
      ]);
      setInsertedCount(insertRes.inserted);
      setMergedCount(mergeRes.updated);
      setFailedCount(insertRes.failed + mergeRes.failed);
      const errMsg: string | null = insertRes.error ?? mergeRes.error ?? null;
      if (errMsg) setInsertErrorMsg(errMsg);
    } catch (err: any) {
      setInsertedCount(0);
      setMergedCount(0);
      setFailedCount(active.length);
      setInsertErrorMsg(err.message || String(err));
    }
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
              {step === "review" && (
                matchedCount > 0
                  ? `${rows.length} events found · ${matchedCount} match an existing event.`
                  : `${rows.length} events found. Review before adding to your calendar.`
              )}
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
              files={files}
              onFilesChange={setFiles}
              fileInputRef={fileInputRef}
              fileLabel={fileLabel}
              validUpload={validUpload}
              allImages={allImages}
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
              mergeDisabled={mergeDisabled}
            />
          )}

          {step === "inserting" && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin mb-4" style={{ color: "var(--ink)" }} />
              <div className="t-heading mb-1">
                Processing {selectedCount} event{selectedCount === 1 ? "" : "s"}
              </div>
              <div className="t-caption">Writing to calendar…</div>
            </div>
          )}

          {step === "done" && (() => {
            const totalSuccess = insertedCount + mergedCount;
            const fullFail = failedCount > 0 && totalSuccess === 0;
            const partial = failedCount > 0 && totalSuccess > 0;
            const iconColor = fullFail
              ? "var(--accent-red)"
              : partial
                ? "var(--accent-amber)"
                : "#3D7A4F";
            const Icon = fullFail ? AlertTriangle : partial ? AlertTriangle : CheckCircle2;
            const heading = fullFail
              ? "Import failed"
              : partial
                ? "Partial success"
                : "Import complete";

            return (
              <div className="flex flex-col items-center justify-center py-12">
                <Icon size={36} className="mb-4" style={{ color: iconColor }} />
                <div className="t-heading mb-1">{heading}</div>
                <div className="t-caption text-center">
                  {insertedCount > 0 && (
                    <>
                      {insertedCount} event{insertedCount === 1 ? "" : "s"} added
                    </>
                  )}
                  {insertedCount > 0 && mergedCount > 0 && " · "}
                  {mergedCount > 0 && (
                    <>
                      {mergedCount} merged into existing
                    </>
                  )}
                  {failedCount > 0 && ` · ${failedCount} failed`}
                  {totalSuccess === 0 && failedCount === 0 && "No events processed"}
                </div>

                {insertErrorMsg && (
                  <div
                    className="t-body mt-3 px-3 py-2"
                    style={{
                      color: "var(--accent-red)",
                      background: "var(--accent-red-tint)",
                      border: "1px solid var(--accent-red)",
                      maxWidth: 480,
                      textAlign: "center",
                    }}
                  >
                    {insertErrorMsg}
                  </div>
                )}

                {fullFail && (
                  <div className="t-caption mt-4" style={{ textAlign: "center", maxWidth: 420 }}>
                    Head back to review — you can edit rows, tweak the schedule type, or start over with a different file.
                  </div>
                )}
              </div>
            );
          })()}
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
                className="btn-action flex items-center gap-2"
                style={{ padding: "8px 16px", fontSize: 13 }}
              >
                Extract events
                <ArrowRight size={14} />
              </button>
            </>
          )}

          {step === "review" && (() => {
            const activeRows = rows.filter((r) => r.selected && r.action !== "skip");
            const insertCount = activeRows.filter((r) => r.action === "insert").length;
            const mergeCount = activeRows.filter((r) => r.action === "merge").length;
            const ctaLabel =
              activeRows.length === 0
                ? "Nothing selected"
                : insertCount > 0 && mergeCount > 0
                  ? `Insert ${insertCount} · Merge ${mergeCount}`
                  : mergeCount > 0
                    ? `Merge ${mergeCount} event${mergeCount === 1 ? "" : "s"}`
                    : `Insert ${insertCount} event${insertCount === 1 ? "" : "s"}`;
            return (
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
                  disabled={activeRows.length === 0}
                  className="btn-action flex items-center gap-2"
                  style={{ padding: "8px 16px", fontSize: 13 }}
                >
                  {ctaLabel}
                  <ArrowRight size={14} />
                </button>
              </>
            );
          })()}

          {step === "done" && (() => {
            const totalSuccess = insertedCount + mergedCount;
            const fullFail = failedCount > 0 && totalSuccess === 0;
            return (
              <>
                {fullFail ? (
                  <button
                    onClick={() => setStep("review")}
                    className="t-caption"
                    style={{
                      padding: "8px 16px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                    }}
                  >
                    Back to review
                  </button>
                ) : (
                  <span />
                )}
                <button
                  onClick={handleClose}
                  className="btn-action"
                  style={{ padding: "8px 16px", fontSize: 13 }}
                >
                  Done
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ConfigureStep(props: {
  files: File[];
  onFilesChange: (f: File[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  fileLabel: string;
  validUpload: boolean;
  allImages: boolean;
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
    files, onFilesChange, fileInputRef, fileLabel, validUpload, allImages,
    scheduleType, onScheduleTypeChange,
    kids, kidIds, onKidIdsChange,
    yearContext, onYearContextChange,
    errorMsg,
  } = props;

  const toggleKid = (id: string) => {
    if (kidIds.includes(id)) onKidIdsChange(kidIds.filter((k) => k !== id));
    else onKidIdsChange([...kidIds, id]);
  };

  const handleFilesSelected = (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    const incoming = Array.from(selected);
    // If any new file is an image, go image-mode: accept incoming images and
    // drop any previously-picked document. If any new file is a doc, go
    // doc-mode: keep one doc only.
    const newImages = incoming.filter(isImageFile);
    const newDocs = incoming.filter(isDocFile);
    if (newImages.length > 0) {
      const existingImages = files.filter(isImageFile);
      onFilesChange([...existingImages, ...newImages].slice(0, MAX_IMAGES));
    } else if (newDocs.length > 0) {
      onFilesChange([newDocs[0]]);
    } else {
      // Unknown type — let the API reject it by passing through to errorMsg.
      onFilesChange(incoming.slice(0, 1));
    }
  };

  const removeFile = (idx: number) => {
    onFilesChange(files.filter((_, i) => i !== idx));
  };

  const showMixingHint =
    files.length > 0 && !validUpload;

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
        <div className="t-label-sm mb-2">Document or photos</div>
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_ACCEPT}
          multiple
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 w-full text-left"
          style={{
            padding: "12px 14px",
            border: "1px solid var(--border)",
            background: files.length > 0 ? "var(--stone-100)" : "var(--bg)",
          }}
        >
          {files.length > 0 ? (
            <FileText size={16} style={{ color: "var(--ink)" }} />
          ) : (
            <Upload size={16} style={{ color: "var(--text-muted)" }} />
          )}
          <span className="t-body" style={{ color: files.length > 0 ? "var(--ink)" : "var(--text-muted)" }}>
            {fileLabel}
          </span>
        </button>

        {/* Selected-files chips (only shown when the user has uploaded
            multiple photos; a single file already reads clearly in the
            button label above). */}
        {files.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2 py-1 text-[11px]"
                style={{
                  background: "var(--bg-sunken)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                <span style={{ fontWeight: 500, color: "var(--ink)" }}>
                  {i + 1}.
                </span>
                <span className="truncate" style={{ maxWidth: 160 }}>
                  {f.name}
                </span>
                <button
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${f.name}`}
                  style={{ color: "var(--text-faint)" }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {showMixingHint && (
          <div
            className="t-caption mt-2"
            style={{ color: "var(--accent-red)", fontSize: 11 }}
          >
            Upload one document (PDF / DOCX / TXT) <em>or</em> up to {MAX_IMAGES} photos — not a mix.
          </div>
        )}

        {files.length > 0 && validUpload && (
          <div className="t-caption mt-2" style={{ fontSize: 11, color: "var(--text-faint)" }}>
            {allImages
              ? `${files.length} photo${files.length === 1 ? "" : "s"} — Claude will read them as pages 1–${files.length}.`
              : "Text will be extracted from the document, then parsed."}
          </div>
        )}
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
  mergeDisabled: boolean;
}) {
  const { rows, onToggleRow, onToggleAll, onUpdateRow, onRemoveRow, summary, warnings, yearDetected, mergeDisabled } = props;
  const allSelected = rows.length > 0 && rows.every((r) => r.selected);
  const matchedCount = rows.filter((r) => r.match).length;

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

      {matchedCount > 0 && (
        <div
          className="flex items-start gap-2 p-3"
          style={{ background: "var(--action-bg)", borderLeft: "3px solid var(--action)" }}
        >
          <GitMerge size={14} style={{ color: "var(--action)", marginTop: 2 }} />
          <div className="t-body" style={{ color: "var(--action)", fontSize: 12 }}>
            {matchedCount} row{matchedCount === 1 ? "" : "s"} match an existing event.
            {mergeDisabled
              ? " Merge isn't available here — each matched row will default to Insert."
              : " Matched rows default to Merge so you don't end up with duplicates."}
          </div>
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
            mergeDisabled={mergeDisabled}
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
  mergeDisabled: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<ReviewRow>) => void;
  onRemove: () => void;
}) {
  const { row, mergeDisabled, onToggle, onUpdate, onRemove } = props;
  const inputStyle = {
    padding: "6px 8px",
    border: "1px solid var(--border)",
    background: "var(--bg)",
    fontSize: 12,
    fontFamily: "var(--font-dm-sans), sans-serif",
    color: "var(--text)",
    minWidth: 0,
  } as const;

  const matchTime = row.match
    ? (() => {
        if (row.match.all_day) return "all day";
        const d = parseTimestamp(row.match.starts_at);
        const h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "p" : "a";
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${String(m).padStart(2, "0")}${ampm}`;
      })()
    : null;

  const muted = row.selected && row.action !== "skip" ? 1 : 0.5;

  return (
    <div
      className="flex flex-col gap-2 py-3"
      style={{
        borderBottom: "1px solid var(--border)",
        opacity: muted,
      }}
    >
      {/* Top row: [select] [title input] [confidence bar] [remove] */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={row.selected}
          onChange={onToggle}
          className="shrink-0"
          aria-label="Include this row"
        />
        <input
          type="text"
          value={row.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Event title"
          style={{
            ...inputStyle,
            flex: 1,
            fontWeight: 500,
            fontSize: 13,
            padding: "7px 10px",
          }}
        />
        <ConfidenceBar confidence={row.confidence} />
        <button
          onClick={onRemove}
          className="shrink-0"
          style={{ color: "var(--text-muted)", padding: 4 }}
          aria-label="Remove row"
          title="Remove row"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Second row: [type] [date] [all-day/start time] [end time/end date]. Indented
          under the checkbox so the title stays the row's visual anchor. */}
      <div className="flex items-center gap-2 flex-wrap" style={{ paddingLeft: 28 }}>
        <select
          value={row.event_type}
          onChange={(e) => onUpdate({ event_type: e.target.value as EventType })}
          style={{ ...inputStyle, width: 120 }}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{EVENT_TYPE_CONFIG[t]?.label || t}</option>
          ))}
        </select>

        <input
          type="date"
          value={row.start_date}
          onChange={(e) => onUpdate({ start_date: e.target.value })}
          style={{ ...inputStyle, width: 140 }}
        />

        {row.all_day ? (
          <button
            onClick={() => onUpdate({ all_day: false })}
            style={{
              ...inputStyle,
              cursor: "pointer",
              color: "var(--text-muted)",
              width: 110,
              fontWeight: 500,
            }}
            title="Click to set a start time"
          >
            All day
          </button>
        ) : (
          <input
            type="time"
            value={row.start_time || ""}
            onChange={(e) => onUpdate({ start_time: e.target.value })}
            style={{ ...inputStyle, width: 110 }}
          />
        )}

        {row.all_day ? (
          <input
            type="date"
            value={row.end_date || row.start_date}
            onChange={(e) => onUpdate({ end_date: e.target.value })}
            style={{ ...inputStyle, width: 140 }}
            aria-label="End date"
          />
        ) : (
          <input
            type="time"
            value={row.end_time || ""}
            onChange={(e) => onUpdate({ end_time: e.target.value })}
            style={{ ...inputStyle, width: 110 }}
            aria-label="End time"
          />
        )}

        {!row.all_day && (
          <button
            onClick={() => onUpdate({ all_day: true })}
            className="t-caption"
            style={{
              fontSize: 10,
              color: "var(--text-faint)",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
            title="Mark as all-day"
          >
            all-day
          </button>
        )}
      </div>

      {/* Optional third/fourth rows: match action bar, then AI notes when present.
          Indented to align with the second row. */}
      {row.match && (
        <div style={{ paddingLeft: 28 }}>
          <MatchActionBar
            row={row}
            matchTime={matchTime}
            mergeDisabled={mergeDisabled}
            onUpdate={onUpdate}
          />
        </div>
      )}

      {row.notes && (
        <div
          className="t-caption"
          style={{
            paddingLeft: 28,
            fontSize: 11,
            color: "var(--text-faint)",
            fontStyle: "italic",
          }}
        >
          {row.notes}
        </div>
      )}
    </div>
  );
}

/**
 * Inline "matches existing event" chip with an action selector.
 * Shown inside ReviewRowEditor when the row has a `match`.
 * Three actions:
 *   - Insert new: create a new event alongside the existing one
 *   - Merge:     update the existing event (location/notes/etc)
 *   - Skip:      don't import this row at all
 *
 * Merge is the default when an update handler is wired and a match was
 * found; falls back to Insert if the parent didn't pass onUpdateEvents.
 */
function MatchActionBar(props: {
  row: ReviewRow;
  matchTime: string | null;
  mergeDisabled: boolean;
  onUpdate: (patch: Partial<ReviewRow>) => void;
}) {
  const { row, matchTime, mergeDisabled, onUpdate } = props;
  const match = row.match!;

  const actions: { value: RowAction; label: string; icon: typeof GitMerge }[] = [
    { value: "insert", label: "Insert", icon: Plus },
    { value: "merge", label: "Merge", icon: GitMerge },
    { value: "skip", label: "Skip", icon: X },
  ];

  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-[2px]"
      style={{
        border: "1px solid var(--action)",
        background: "var(--action-bg)",
        color: "var(--action)",
        fontSize: 10.5,
      }}
    >
      <GitMerge size={10} />
      <span style={{ fontWeight: 600 }}>Matches:</span>
      <span className="truncate" style={{ maxWidth: 140, color: "var(--text)" }}>
        {match.title}
      </span>
      {matchTime && (
        <span style={{ color: "var(--text-muted)" }}>· {matchTime}</span>
      )}
      <span
        style={{
          width: 1,
          height: 12,
          background: "var(--action)",
          opacity: 0.35,
          marginLeft: 2,
        }}
      />
      {actions.map((a) => {
        const active = row.action === a.value;
        const disabled = a.value === "merge" && mergeDisabled;
        return (
          <button
            key={a.value}
            type="button"
            disabled={disabled}
            onClick={() => onUpdate({ action: a.value })}
            title={disabled ? "Update handler not wired by host — use Insert" : a.label}
            className="inline-flex items-center gap-0.5 px-1.5 py-[1px]"
            style={{
              fontSize: 10,
              fontWeight: 600,
              border: "1px solid",
              borderColor: active ? "var(--action)" : "transparent",
              background: active ? "var(--action)" : "transparent",
              color: active ? "var(--action-fg)" : disabled ? "var(--text-faint)" : "var(--action)",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <a.icon size={9} />
            {a.label}
          </button>
        );
      })}
    </span>
  );
}
