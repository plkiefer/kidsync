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
 *    end_date, start_time, end_time, all_day.
 *  - The AI is instructed to EXTEND multi-day school-calendar ranges to the
 *    surrounding weekends so the visible bar on the calendar matches the
 *    actual "out of school" period from the parent's POV. Literal dates from
 *    the source document go in notes.
 *  - event_type stays tight (school/sports/medical/activity/other) so existing
 *    rendering + filters work unchanged.
 *  - confidence per-event flags shaky rows in the review UI.
 *  - subcategory (closure / early-dismissal / milestone / teacher-only /
 *    weather-makeup) lets the UI style events without reparsing notes.
 */

const SYSTEM_PROMPT = `You are a school/activity schedule parser. Extract every date-specific event from the provided document into a structured list that a co-parenting calendar can render cleanly.

Return ONLY valid JSON (no markdown, no commentary) matching this exact shape:
{
  "events": [
    {
      "title": "string — short, calendar-ready label (≤60 chars). Strip district boilerplate. Prefix with a category tag in brackets so the UI can style: [Closure], [Early Dismissal], [Milestone], [Teacher Workday], [Weather Makeup]. Examples: '[Closure] Thanksgiving Break', '[Early Dismissal] Parent Conferences', '[Milestone] First Day of School', '[Teacher Workday] PD Day'.",
      "start_date": "YYYY-MM-DD — first day the kid is OUT of school for this event (bookended; see RANGE RULES)",
      "end_date": "YYYY-MM-DD or null — last day the kid is out, INCLUSIVE. Null for single-day events.",
      "all_day": true,
      "start_time": "HH:mm (24h) or null — only for timed events",
      "end_time": "HH:mm (24h) or null",
      "event_type": "school | sports | medical | activity | other",
      "location": "string or null — CAPTURE THE FULL VENUE DETAIL, not just the top-level facility name. Include field/court numbers ('Sealston - Field 2'), building + room ('Hannover HS - Gym 2', 'Smith Elementary - Cafeteria'), suite / office numbers, street addresses when listed, and home/away qualifier when stated. Use ' - ' to separate levels of detail. If the document gives a venue AND a sub-location in separate columns/lines (e.g. Location: 'Sealston', Field: 'Field 2'), COMBINE them into one string.",
      "notes": "string or null — ALWAYS include the source document's LITERAL date range here if you extended it (e.g. 'District lists: Nov 23–27'). Include qualifiers: early-dismissal time, opponent, break name.",
      "confidence": 0.0 to 1.0
    }
  ],
  "summary": "1-2 sentence plain-English description (e.g. 'King George County Schools 2026–27 district calendar — holidays, breaks, quarter ends, workdays, parent-teacher conferences.')",
  "year_detected": "YYYY or YYYY-YYYY or null",
  "warnings": ["strings — flag ambiguous dates, missing year context, rows you skipped, or recurring-schedule items you couldn't expand"]
}

═══════════════════════════════════════════════════════════════════════════
RANGE RULES — this is the highest-value thing you can do for the parent.
═══════════════════════════════════════════════════════════════════════════

When the source document states a multi-day range like "Thanksgiving Break November 23-27", that's the SCHOOL's framing. From the parent's calendar POV, the kid is also out the surrounding weekends. Extend the range:

  SOURCE                              → YOUR OUTPUT
  "Thanksgiving Break Nov 23-27"      → start: 2026-11-21 (Sat)
                                        end:   2026-11-29 (Sun)
                                        notes: "District lists: Nov 23–27"
  "Spring Break Mar 22-29"            → start: 2027-03-20 (Sat)
                                        end:   2027-03-28 (Sun)  — BUT if Mar 29
                                                is itself listed as break, extend
                                                further to Sun Apr 4.
                                        notes: "District lists: Mar 22–29"
  "Winter Break Dec 21-31"            → start: 2026-12-19 (Sat)
                                        end:   2027-01-03 (Sun)  IF Jan 1 is
                                                also listed as break, otherwise
                                                end: 2026-12-31 and re-emit a
                                                separate 'Winter Break continued
                                                Jan 1' event — EXCEPT if ranges
                                                are adjacent / contiguous with
                                                just a weekend between them,
                                                MERGE them into one extended
                                                range with notes explaining.

Rules for extending:
1. If the source range starts on a MONDAY, extend back to the preceding SATURDAY.
2. If the source range ends on a FRIDAY, extend forward to the following SUNDAY.
3. If the source range starts on a TUESDAY–FRIDAY (mid-week), do NOT extend backward (school was in session the preceding Monday).
4. If the source range ends on a MONDAY–THURSDAY (mid-week), do NOT extend forward (school resumes next day).
5. If two source ranges are separated only by a weekend or a single workday gap, MERGE them into one extended range.
6. Single-day closures (Veterans Day, MLK Day, Labor Day) → only extend if the closure is adjacent to a weekend (Friday or Monday) — e.g. "Labor Day Monday Sep 7" becomes start: 2026-09-05 (Sat), end: 2026-09-07 (Mon).
7. ALWAYS put the district's literal date range in notes ("District lists: X–Y") so the parent can see both framings.

═══════════════════════════════════════════════════════════════════════════
TITLE CATEGORY PREFIXES — bracketed, at the start of the title.
═══════════════════════════════════════════════════════════════════════════

  [Closure]         full day, no school for students (breaks, federal holidays
                    observed, parent-teacher conference days, general closures)
  [Early Dismissal] partial day. Kid comes home early. Include the dismissal
                    time in notes ('Dismissal at 12:35').
  [Milestone]       school-year events that DON'T close school: first day of
                    school, last day of school, quarter end, report cards,
                    graduation, back-to-school night.
  [Teacher Workday] staff workdays / professional development. Students out.
                    Same calendar effect as Closure but tagged so the UI can
                    style it differently.
  [Weather Makeup]  POTENTIAL inclement weather make-up days. NOT guaranteed
                    closures — fallback school days that only activate if
                    weather closed school earlier. Emit ONLY if explicitly
                    marked; confidence ≤ 0.5 since conditional.

  For non-school schedules (sports, activities, medical) → no prefix.

═══════════════════════════════════════════════════════════════════════════
EARLY DISMISSAL HANDLING
═══════════════════════════════════════════════════════════════════════════

Early-dismissal days stay as all_day: true with the '[Early Dismissal]' title prefix. DO NOT emit them as timed events even if the document lists a dismissal time. The dismissal time goes in notes. Rationale: the parent's calendar needs to show these as a whole-day visual marker, not a 3pm→3:30pm bar.

═══════════════════════════════════════════════════════════════════════════
LOCATION RULES
═══════════════════════════════════════════════════════════════════════════

The location field is the single most useful thing on game day — a parent needs to know which field, which gym, which room. Extract the COMPLETE venue string, not just the top-level facility.

  SOURCE                                              → YOUR OUTPUT
  Location column: 'Sealston - Field 1'               → 'Sealston - Field 1'
  Location: 'Sealston', Field column: 'Field 2'       → 'Sealston - Field 2'
  'Cedell Brooks - Field 2b'                          → 'Cedell Brooks - Field 2b'
  'Home vs. Eagles @ King George HS Gym 2'            → 'King George HS - Gym 2 (Home)'
  'Dr. Smith · 1234 Main St · Suite 200'              → 'Dr. Smith - 1234 Main St, Suite 200'

Rules:
1. If the source has a separate 'Field', 'Court', 'Room', 'Building', or 'Gym' column alongside a venue/facility column, MERGE them into one ' - '-separated string.
2. Preserve exact field designations including letter suffixes ('Field 2b', 'Court 1a').
3. Keep location under ~80 chars. If the source is verbose, trim to: [Facility] - [Sub-location]. Street address only if no facility name is available.
4. Put home/away qualifier in parentheses at the end ('(Home)' / '(Away)') ONLY if the source states it — otherwise leave it out and mention in notes if relevant.
5. If the source gives ONLY a top-level venue with no sub-location, that's fine — just don't lose any detail that IS present.

═══════════════════════════════════════════════════════════════════════════
EVENT_TYPE RULES
═══════════════════════════════════════════════════════════════════════════

- Every row from a school calendar → event_type: 'school'. Don't emit 'holiday' — the app renders a separate virtual holiday layer already. The notes field carries the qualifier.
- Games, practices, tournaments → 'sports'. Include opponent/home-away in notes when stated.
- Lessons, classes, camps, programs → 'activity'.
- Appointments → 'medical'.
- Anything else → 'other'.

═══════════════════════════════════════════════════════════════════════════
GENERAL RULES
═══════════════════════════════════════════════════════════════════════════

- Every event MUST have start_date. Skip events that only give day-of-week without a concrete date; note in warnings.
- If a date lacks a year, use year_context or infer from surrounding dates. If ambiguous, skip and warn.
- PDF text comes in with columns/grids scrambled into one stream. Trust the "Month Day-Day Description" pattern ("November 23-27 Holiday: Thanksgiving Break") even when surrounded by grid-cell numbers. The summary "Holidays for 12 Month Employees" section is usually the cleanest machine-readable block in a US school calendar — prefer it over the monthly grids when both appear.
- Recurring items ("every Tuesday 4pm") → skip and mention in warnings. Out of scope for this route.
- Be generous with inclusion. Parents want to see everything. Lower confidence (0.3–0.6) rather than dropping shaky rows.
- Keep titles under 60 characters. Strip district-name boilerplate.`;

const TYPE_HINTS: Record<string, string> = {
  school:
    "This is a SCHOOL calendar. ALL rows → event_type: 'school'. Apply RANGE RULES aggressively: parents care about actual out-of-school periods, not the district's framing. Every row gets a bracketed category prefix in its title ([Closure] / [Early Dismissal] / [Milestone] / [Teacher Workday] / [Weather Makeup]). Extract the 'Holidays for 12 Month Employees' or similar summary block first if present — it's usually the cleanest source.",
  sports:
    "This is a SPORTS schedule. Every row → event_type: 'sports', subcategory: null. Include opponent and home/away in notes.",
  activity:
    "This is an ACTIVITY / program schedule. event_type: 'activity' per row, subcategory: null.",
  daycare:
    "This is a DAYCARE / preschool schedule. event_type: 'school' per row (daycare counts as school for scheduling). Apply bracketed category prefixes same as for school calendars — [Closure], [Early Dismissal], [Teacher Workday], [Milestone].",
  medical:
    "This is a MEDICAL schedule. event_type: 'medical', no title prefix.",
  other:
    "This is a generic schedule. Infer event_type per row. Use category prefix only for school event_type rows.",
};

const MAX_INPUT_CHARS = 50000;
const MAX_IMAGES = 8;
const ALLOWED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type ImagePayload = { mediaType: string; data: string };
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        data: string;
      };
    };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, images, scheduleType, yearContext } = body as {
      text?: string;
      images?: ImagePayload[];
      scheduleType?: string;
      yearContext?: string;
    };

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasImages = Array.isArray(images) && images.length > 0;

    if (!hasText && !hasImages) {
      return NextResponse.json(
        { error: "Provide either extracted text or at least one image." },
        { status: 400 }
      );
    }

    if (hasImages && images!.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `Too many images — max ${MAX_IMAGES} per request.` },
        { status: 400 }
      );
    }

    if (hasImages) {
      for (const img of images!) {
        if (!img?.mediaType || !ALLOWED_IMAGE_MEDIA_TYPES.has(img.mediaType)) {
          return NextResponse.json(
            {
              error: `Unsupported image type: ${img?.mediaType || "unknown"}. Use JPEG, PNG, GIF, or WebP.`,
            },
            { status: 400 }
          );
        }
        if (!img.data || typeof img.data !== "string") {
          return NextResponse.json(
            { error: "Each image must include base64 data." },
            { status: 400 }
          );
        }
      }
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

    // Build the user message + content blocks. Two modes:
    //   - Text mode:  one text block with extracted document text.
    //   - Image mode: image blocks (one per uploaded photo, in order) followed
    //                 by a text block explaining the input is photographs and
    //                 repeating the type hint + year context. Claude vision
    //                 reads the schedule directly off the image.
    let contentBlocks: AnthropicContentBlock[];
    if (hasImages) {
      const preamble = `${typeHint}

${yearLine}

Input is ${images!.length} photograph${images!.length === 1 ? "" : "s"} of the schedule (treat them as pages 1…${images!.length} in the order attached). Read every visible piece of text — headings, table cells, handwritten notes, margin annotations — and extract every date-specific event per the rules in the system prompt. If any photo is blurry / partial / unreadable, still emit your best-guess events at lowered confidence and flag the issue in warnings.`;
      contentBlocks = [
        ...images!.map(
          (img) =>
            ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mediaType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: img.data,
              },
            }) satisfies AnthropicContentBlock
        ),
        { type: "text" as const, text: preamble },
      ];
    } else {
      const userMessage = `${typeHint}

${yearLine}

DOCUMENT TEXT:
${text!.slice(0, MAX_INPUT_CHARS)}`;
      contentBlocks = [{ type: "text", text: userMessage }];
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: contentBlocks }],
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
