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
      "title": "string — describe WHAT the event IS, not the document header. See TITLE GENERATION below. (≤60 chars)",
      "start_date": "YYYY-MM-DD — first day the kid is OUT of school for this event (bookended; see RANGE RULES)",
      "end_date": "YYYY-MM-DD or null — last day the kid is out, INCLUSIVE. Null for single-day events.",
      "all_day": true,
      "start_time": "HH:mm (24h) or null — only for timed events",
      "end_time": "HH:mm (24h) or null",
      "event_type": "school | sports | medical | activity | other",
      "location": "string or null — CAPTURE THE FULL VENUE DETAIL, not just the top-level facility name. Include field/court numbers ('Sealston - Field 2'), building + room ('Hannover HS - Gym 2', 'Smith Elementary - Cafeteria'), suite / office numbers, street addresses when listed, and home/away qualifier when stated. Use ' - ' to separate levels of detail. If the document gives a venue AND a sub-location in separate columns/lines (e.g. Location: 'Sealston', Field: 'Field 2'), COMBINE them into one string.",
      "notes": "string or null — carry context the title shed: team/league/program name, source literal date range ('District lists: Nov 23–27'), opponent, uniform color, snack parent, dismissal time, break name. See NOTES RULES.",
      "suggested_kid_ids": "array of kid IDs this event applies to, or [] if unsure. See KID ASSIGNMENT.",
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
6. SINGLE-DAY federal holidays (MLK Day, Presidents' Day, Labor Day,
   Veterans Day, Memorial Day, Columbus Day, Independence Day) → emit
   ONLY the holiday day itself, NEVER extend to the surrounding weekend.
   Parents already know about Saturday/Sunday; bracketing a Monday
   holiday as Sat–Mon makes the calendar look like a 3-day break that
   it isn't actionably. The weekend is implicit, not a feature of the
   closure. Single-day closures get start_date = end_date = the
   holiday's actual date, with end_date EITHER null OR equal to
   start_date.
7. ALWAYS put the district's literal date range in notes ("District lists: X–Y") so the parent can see both framings.

═══════════════════════════════════════════════════════════════════════════
HOLIDAY DATE-RANGE REVIEW — extra-careful pass on multi-day breaks.
═══════════════════════════════════════════════════════════════════════════

Multi-day breaks (Thanksgiving, Winter, Spring) are the highest-stakes
items in a school import — a parent budgets childcare around them. Before
emitting any break with end_date - start_date ≥ 2 days, do this self-check:

  a. State the source range (literal start–end dates) in your head.
  b. Identify the day-of-week for source start AND source end.
  c. Apply rules 1–4 above. Compute the extended start and extended end.
  d. Verify: extended start is a SATURDAY (or stays on source start if not
     adjacent), and extended end is a SUNDAY (or stays on source end if
     not adjacent).
  e. Re-count the calendar days. A 5-school-day break → 9 calendar days
     after extension. A 7-school-day break (rare) → 11 calendar days.
  f. If your computed end_date doesn't match this self-check, recompute.
     Common mistake: dropping the last day of the source range, or
     stopping at Saturday instead of Sunday on a Friday-end source.

Worked example, Spring Break "March 22–29 2027":
  Source start Mar 22 = Sunday. Source end Mar 29 = Sunday.
  Source already brackets both weekends — no extension needed.
  Output: start_date 2027-03-22, end_date 2027-03-29 (8 calendar days).
  Notes: "District lists: Mar 22–29".

Worked example, Thanksgiving "Nov 23–27 2026":
  Source start Nov 23 = Monday. Source end Nov 27 = Friday.
  Rule 1: extend back to Sat Nov 21. Rule 2: extend forward to Sun Nov 29.
  Output: start_date 2026-11-21, end_date 2026-11-29 (9 calendar days).
  Notes: "District lists: Nov 23–27".

═══════════════════════════════════════════════════════════════════════════
TITLE GENERATION — critical. Titles describe WHAT the event IS, not the
document's top banner.
═══════════════════════════════════════════════════════════════════════════

The title goes on a calendar chip 10–20 chars wide. A parent glancing at their week should immediately know "oh right, soccer game" — NOT have to read "U6 KING Soccer Schedule Spring 2026" on every single row. The team / league / program context goes in NOTES, never the title.

  SOURCE                              → TITLE                     + NOTES
  (document header:                   'Soccer Game'               'Team: U6 KING Xplosion'
   'U6 KING Soccer Schedule           (nothing in source row
    Spring 2026', each row            itself says 'game' — infer
    is a date + location)              from schedule type = sports)
  'Practice - Tuesday 5:30 PM'        'Soccer Practice'           'Team: U6 KING Xplosion'
  'vs Riverside HOME 9:30 AM'         'Soccer Game'               'vs Riverside (Home) · Team: U6 KING Xplosion'
  'Piano Lesson — Ms. Chen'           'Piano Lesson'              'Instructor: Ms. Chen'
  'Ethan's 7th Birthday Party'        'Ethan's Birthday Party'    null (title already says it)
  'Dr. Smith Well Visit'              'Pediatrician'              'Dr. Smith · Well visit'
  'Swim Team Practice'                'Swim Practice'             'Team: [team name if given]'
  'Boy Scout Troop 317 Meeting'       'Scouts Meeting'            'Troop 317'
  'Science Fair Project Due'          'Science Fair Due'          null

Rules:
1. Default for sports: '[Sport] Game'. If the row is explicitly a practice, scrimmage, tournament, or meet, use that noun instead ('Soccer Practice', 'Soccer Tournament', 'Track Meet'). Short weekend time slots at a field default to 'Game'.
2. Default for activity: a 2-word label combining the activity type + session noun ('Piano Lesson', 'Art Class', 'Dance Rehearsal', 'Scouts Meeting').
3. Default for medical: the specialty, not the doctor's name ('Pediatrician', 'Dentist', 'Orthodontist', 'Physical Therapy'). Doctor/practice name goes in notes.
4. Never use the document's overall schedule name ('U6 KING Soccer Schedule', 'Spring Recital Program', '2026 Camp Registration') as a per-row title. That's the source banner, not the event.
5. Keep titles short and generic enough to scan. No dates, no times, no opponent names, no uniform colors, no addresses in the title.
6. If the row itself is specific (a uniquely-named event like 'Back-to-School Night' or 'Graduation Ceremony'), keep that as the title — don't over-genericize.

═══════════════════════════════════════════════════════════════════════════
TITLE CATEGORY PREFIXES — bracketed, at the start of the title.
═══════════════════════════════════════════════════════════════════════════

A parent scanning their calendar wants ONE answer: "is my kid in school?"
Every variant of "kid is out" — closure, holiday, teacher workday, staff
workday, professional development day, potential weather makeup — collapses
to the same prefix: [Closure]. The subtype (workday vs. break vs. potential
makeup) goes in NOTES, never the prefix. There are exactly 3 prefixes:

  [Closure]         The kid is OR may be out of school. Use for all of:
                      - holiday breaks (Thanksgiving, Winter, Spring)
                      - federal holiday observances (MLK, Presidents', Labor)
                      - parent-teacher conference days
                      - general closures
                      - STAFF / TEACHER WORKDAYS, PROFESSIONAL DEVELOPMENT
                      - POTENTIAL INCLEMENT WEATHER MAKEUP DAYS
                    Subcategory goes in notes ('Staff workday', 'Teacher PD',
                    'Potential weather makeup — only used if school closed
                    earlier'). For weather makeup days specifically, set
                    confidence ≤ 0.5 since the day is conditional.
                    NEVER emit '[Teacher Workday]' or '[Weather Makeup]' as
                    the prefix — those collapse into [Closure].

  [Early Dismissal] partial day. Kid comes home early. Include the dismissal
                    time in notes ('Dismissal at 12:35').

  [Milestone]       school-year events that DO NOT close school: first day
                    of school, last day of school, quarter end, report
                    cards, graduation, back-to-school night.

  For non-school schedules (sports, activities, medical) → no prefix.

  When a single day is BOTH a closure AND a weather-makeup candidate (e.g.
  Presidents' Day also flagged as potential makeup), emit ONE event tagged
  [Closure] with notes capturing both ('Presidents' Day · also listed as
  potential weather makeup'). Don't emit two competing rows for the same
  day, and don't pick the weaker classification — closure wins.

═══════════════════════════════════════════════════════════════════════════
NOTES RULES
═══════════════════════════════════════════════════════════════════════════

Notes carry the per-row context that the (generic) title shed. Combine multiple qualifiers with ' · ' separators. Skip fields that weren't in the source.

  Components to include when present in the source:
  - Team / league / program name: 'Team: U6 KING Xplosion'
  - Opponent + home/away: 'vs Riverside (Home)' or '@ Mountain View (Away)'
  - Uniform / jersey color: 'Uniform: gold'
  - Snack parent: 'Snack: Carter'
  - Instructor / coach / doctor: 'Instructor: Ms. Chen' / 'Coach Miller'
  - Dismissal time (early-dismissal): 'Dismissal at 12:35'
  - School-closure subtype (carried in notes since [Closure] is the only
    closure prefix): 'Staff workday' / 'Teacher PD' / 'Parent-teacher
    conferences' / 'Potential weather makeup — only used if school
    closed earlier'
  - Literal source date range (when you extended it): 'District lists: Nov 23–27'
  - Any other row-specific qualifier the source calls out.

═══════════════════════════════════════════════════════════════════════════
KID ASSIGNMENT — suggested_kid_ids per event
═══════════════════════════════════════════════════════════════════════════

If the user provided a kid roster in the input context (name + age), infer which kid each event applies to based on signals in the row or document.

Signals to match on (strongest first):
1. Kid's NAME appearing in the row ('Ethan's practice', 'Harrison piano lesson') → that kid.
2. Age band in the document header or row ('U6' = under 6, '10U' / '10&Under' = under 10, '7-9 yr olds'). Match to a kid whose age falls in the band. 'U6' means kids who are 5 or under at the start of the season — be generous and include a 6-yr-old too if they just turned 6.
3. Grade mention ('1st grade', 'Kindergarten') → match to the kid in that grade (estimate grade from age: K=5, 1st=6, 2nd=7, 3rd=8, 4th=9, 5th=10, 6th=11, 7th=12, 8th=13).
4. A sport or activity the user has flagged as kid-specific (see CONTEXT block in the user message if provided).
5. Document is SPECIFICALLY a one-kid schedule (header names a team/class that only makes sense for one age) → assign that kid to every row.

Output rules:
- Emit suggested_kid_ids as an array of kid IDs (use the 'id' field the user provided, NOT the kid's name). Example: ['abc-123'] or ['abc-123', 'def-456'].
- If the schedule clearly belongs to ONE kid → every row gets just that kid's id.
- If ambiguous (can't tell from signals) → emit [] (empty array). The user will fall back to their modal-level selection.
- If the schedule is a family event (both kids), emit both ids.
- DO NOT guess. [] is better than a wrong assignment — empty just means 'defer to the user's default'.

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
    "This is a SCHOOL calendar. ALL rows → event_type: 'school'. Apply RANGE RULES aggressively: parents care about actual out-of-school periods, not the district's framing. EVERY 'kid is out' day — closures, holidays, staff workdays, teacher PD, professional development, AND potential weather makeup days — uses the [Closure] prefix. Subtype goes in notes. Only [Early Dismissal] and [Milestone] differ. Extract the 'Holidays for 12 Month Employees' or similar summary block first if present — it's usually the cleanest source.",
  sports:
    "This is a SPORTS schedule. Every row → event_type: 'sports', subcategory: null. Include opponent and home/away in notes.",
  activity:
    "This is an ACTIVITY / program schedule. event_type: 'activity' per row, subcategory: null.",
  daycare:
    "This is a DAYCARE / preschool schedule. event_type: 'school' per row (daycare counts as school for scheduling). Same prefix rules as school calendars: [Closure] for all kid-out days (closures, staff workdays, weather makeup), [Early Dismissal] for early-pickup, [Milestone] for non-closing events.",
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
type KidPayload = {
  id: string;
  name: string;
  /** YYYY-MM-DD; optional. When absent the parser falls back to name-only matching. */
  birth_date?: string | null;
};
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
    const { text, images, scheduleType, yearContext, kids } = body as {
      text?: string;
      images?: ImagePayload[];
      scheduleType?: string;
      yearContext?: string;
      kids?: KidPayload[];
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

    // Build a KID CONTEXT block when the caller supplied a roster. Claude uses
    // this to fill suggested_kid_ids per event (see KID ASSIGNMENT in the
    // system prompt). We compute current age from birth_date so age-band
    // matching ("U6", "10&Under") doesn't depend on Claude's training cutoff.
    const validKids = (Array.isArray(kids) ? kids : []).filter(
      (k): k is KidPayload =>
        !!k && typeof k.id === "string" && typeof k.name === "string"
    );
    const validKidIds = new Set(validKids.map((k) => k.id));
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const kidContextLine =
      validKids.length > 0
        ? `Kid roster (today is ${todayIso}):
${validKids
  .map((k) => {
    let age: number | null = null;
    if (k.birth_date && /^\d{4}-\d{2}-\d{2}$/.test(k.birth_date)) {
      const [by, bm, bd] = k.birth_date.split("-").map(Number);
      const birth = new Date(by, bm - 1, bd);
      age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
    }
    const ageFrag = age !== null ? `, age ${age}` : "";
    const dobFrag = k.birth_date ? ` (DOB ${k.birth_date})` : "";
    return `  - id="${k.id}", name="${k.name}"${ageFrag}${dobFrag}`;
  })
  .join("\n")}

Per KID ASSIGNMENT: fill suggested_kid_ids per event using name/age/grade signals. Emit [] (empty array) when you can't tell — [] is correct, guessing is wrong. Use the exact id values above (not names) in suggested_kid_ids.`
        : `Kid roster not provided — set suggested_kid_ids to [] for every event. The user will assign kids themselves.`;

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

${kidContextLine}

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

${kidContextLine}

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

    // Sanitize suggested_kid_ids on every event: filter to ids we actually
    // sent in the roster (Claude occasionally echoes a name or hallucinates a
    // uuid). Unknown ids would silently fan out to the wrong kid on insert.
    const sanitizedEvents = parsed.events.map((ev: any) => {
      const raw = Array.isArray(ev?.suggested_kid_ids) ? ev.suggested_kid_ids : [];
      const suggested = raw.filter(
        (id: unknown): id is string =>
          typeof id === "string" && validKidIds.has(id)
      );
      return { ...ev, suggested_kid_ids: suggested };
    });

    return NextResponse.json({
      events: sanitizedEvents,
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
