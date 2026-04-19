import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Schedule parser.
 *
 * Takes already-extracted text (use /api/custody/extract for PDF/DOCX → text)
 * plus a lightweight type hint, and returns an array of event candidates the
 * user can review before insert. The caller assigns kid_id(s) at insert time —
 * this route is kid-agnostic so one code path serves school calendars, sports
 * schedules, camp rosters, activity programs, etc.
 *
 * Design notes:
 *  - Every event comes back with YYYY-MM-DD start_date (required) and optional
 *    end_date, start_time, end_time, all_day. The review UI lets the user fix
 *    anything the AI got wrong, so we bias the prompt toward *inclusion* —
 *    missed events are worse than mis-dated ones (which are trivial to edit).
 *  - event_type is drawn from the existing EventType enum so the review UI
 *    and calendar render without a mapping layer.
 *  - confidence is per-event, 0-1, used to flag shaky rows in the review UI.
 *  - No dedup against existing events. User handles collisions manually for v1.
 */

const SYSTEM_PROMPT = `You are a schedule parser. Extract every date-specific event from the provided document into a structured list.

Return ONLY valid JSON (no markdown, no commentary) matching this exact shape:
{
  "events": [
    {
      "title": "string — short, calendar-ready label (e.g. 'First Day of School', 'Game vs. Riverbend', 'Teacher Workday')",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null (for multi-day events like breaks)",
      "all_day": true,
      "start_time": "HH:mm (24h) or null",
      "end_time": "HH:mm (24h) or null",
      "event_type": "school | sports | medical | activity | holiday | other",
      "location": "string or null",
      "notes": "string or null (include any qualifier the document gives — 'early dismissal', 'away game', 'no school', 'half day', etc.)",
      "confidence": 0.0 to 1.0
    }
  ],
  "summary": "1-2 sentence plain-English description of what this schedule covers (e.g. 'King George Elementary 2026–2027 academic calendar — holidays, breaks, workdays, and early dismissals.')",
  "year_detected": "YYYY or YYYY-YYYY (the school/season year this document covers) or null",
  "warnings": ["array of strings — flag ambiguous dates, missing year context, or rows you skipped"]
}

RULES
- Every event MUST have start_date. If the document only gives day-of-week without a concrete date, skip it and note in warnings.
- If a date appears without a year, use year_context (passed in user message) or infer from surrounding dates. If still ambiguous, skip and warn.
- Anything that appears on a SCHOOL calendar → event_type: "school". This includes closures, breaks ("Thanksgiving Break", "Winter Break", "Spring Break"), teacher workdays, early dismissals, parent-teacher conferences, testing windows, first/last day of school, AND school-observed federal/religious holidays (because the calendar is the source — a parent needs to know whether THIS school has school that day). The qualifier goes in the notes field ("closure", "early dismissal at 12:30", "break"), not the type.
- Reserve event_type: "holiday" for schedules that are EXPLICITLY lists of federal/religious/cultural holidays (e.g. a separate holiday document) — NOT for school-calendar rows. KidSync renders a separate virtual holiday layer; school-sourced closures should stay "school" to avoid doubling up.
- Games, practices, meets, tournaments → event_type: "sports". Include opponent and home/away in notes when stated.
- Lessons, classes, camps, programs → event_type: "activity".
- Appointments, checkups → event_type: "medical".
- Anything else date-specific → event_type: "other".
- Multi-day ranges (spring break, winter break) → ONE event with end_date set. Do NOT expand into per-day duplicates.
- Recurring items ("every Tuesday 4pm") are OUT OF SCOPE for this route — skip them and mention in warnings so the user adds them manually.
- If the document lists times like "8:00 AM - 3:00 PM", normalize to 24h (08:00, 15:00) and set all_day: false.
- Be generous with inclusion: parents want to see everything. Set confidence lower (0.4-0.6) for rows you're unsure about rather than dropping them.
- Keep titles under 60 characters. Strip boilerplate ("King George Public Schools - " etc.) from titles; it belongs in the document context, not every row.`;

// Type-specific hint appended to the user message to bias extraction.
const TYPE_HINTS: Record<string, string> = {
  school:
    "This is a SCHOOL calendar. Expect: first/last day of school, teacher workdays, early dismissals, parent-teacher conferences, breaks (fall/winter/spring), testing windows, and school-observed holidays. ALL rows from this document should be event_type: 'school' — the notes field carries the qualifier (closure, break, early dismissal, workday). Do NOT emit event_type: 'holiday' from a school calendar.",
  sports:
    "This is a SPORTS schedule. Expect: games (home/away), practices, tournaments, meets, playoff brackets. Every row should have event_type 'sports'. Include opponent and location when stated.",
  activity:
    "This is an ACTIVITY / program schedule. Expect: weekly classes, camps, lessons, enrichment programs. Use event_type 'activity' unless rows are clearly sports or medical.",
  daycare:
    "This is a DAYCARE / preschool schedule. Expect: closure days, parent events, field trips, staff development days. All rows → event_type: 'school' (daycare counts as school for scheduling purposes). The notes field carries the qualifier (closure, parent event, field trip).",
  medical:
    "This is a MEDICAL schedule. Expect: checkups, appointments, specialist visits, vaccine schedules. Every row should have event_type 'medical'.",
  other: "This is a generic schedule. Infer event_type per row from context.",
};

// Keep MAX_INPUT_CHARS conservative — large calendars (20+ pages) approach
// Claude's context cost curve fast. 50K is the same ceiling the custody route
// uses and covers a typical K-12 annual calendar with headroom.
const MAX_INPUT_CHARS = 50000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, scheduleType, yearContext } = body as {
      text?: string;
      scheduleType?: string;
      yearContext?: string;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing extracted text" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "ANTHROPIC_API_KEY not configured. Add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    const typeKey = (scheduleType || "other").toLowerCase();
    const typeHint = TYPE_HINTS[typeKey] || TYPE_HINTS.other;
    const yearLine = yearContext
      ? `Year context: ${yearContext} (use this when dates omit the year).`
      : "Year context: not provided — infer from document headers / first mentioned full date.";

    const userMessage = `${typeHint}

${yearLine}

DOCUMENT TEXT:
${text.slice(0, MAX_INPUT_CHARS)}`;

    const message = await anthropic.messages.create({
      // Sonnet 4.6 is plenty for structured extraction and keeps cost sane for
      // a user-triggered upload. Bump to Opus only if accuracy complaints land.
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const responseText =
      message.content[0]?.type === "text" ? message.content[0].text : "";

    let parsed;
    try {
      const jsonStr = responseText
        .replace(/^```json?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: responseText },
        { status: 500 }
      );
    }

    if (!parsed || !Array.isArray(parsed.events)) {
      return NextResponse.json(
        { error: "AI returned invalid shape — missing events array", raw: parsed },
        { status: 500 }
      );
    }

    return NextResponse.json({
      events: parsed.events,
      summary: parsed.summary ?? null,
      year_detected: parsed.year_detected ?? null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    });
  } catch (err: any) {
    console.error("[schedules/parse] error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
