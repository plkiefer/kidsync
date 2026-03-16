import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a legal document parser specializing in family law custody agreements.
Extract the custody schedule and terms from the provided document text into structured JSON.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "primary_custodian": "mother" or "father",
  "alternating_weekends": {
    "enabled": true/false,
    "parent": "father" or "mother" (who gets alternating weekends),
    "days": ["Friday", "Saturday", "Sunday"],
    "pickup_time": "3:00 PM" or null,
    "dropoff_time": "5:00 PM" or null,
    "start_date": "2026-01-02" or null (the anchor date when the alternating pattern begins, in YYYY-MM-DD format)
  },
  "weekday_schedule": {
    "monday": "mother" or "father",
    "tuesday": "mother" or "father",
    "wednesday": "mother" or "father",
    "thursday": "mother" or "father",
    "friday": "mother" or "father"
  },
  "holidays": [
    { "name": "Thanksgiving", "rule": "alternating years, father has odd years" },
    { "name": "Christmas Eve", "rule": "always with mother" }
  ],
  "summer_schedule": "description or null",
  "spring_break": "description or null",
  "winter_break": "description or null",
  "restrictions": ["list of restrictions, travel notifications, etc."],
  "provisions": ["right of first refusal", "24hr notification for schedule changes", etc.],
  "summary": "Brief 2-3 sentence plain-English summary of the custody arrangement"
}

If a field cannot be determined from the document, use null or empty array.
Be precise with times and days. If the document references "standard possession order"
or similar, expand it to the specific days/times it implies.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, familyId } = body;

    if (!text || !familyId) {
      return NextResponse.json(
        { error: "Missing text or familyId" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured. Add it to your environment variables." },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Parse this custody agreement and extract the custody schedule:\n\n${text.slice(0, 50000)}`,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Parse the JSON response
    let parsed;
    try {
      // Handle potential markdown code blocks in response
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

    return NextResponse.json({ terms: parsed });
  } catch (err: any) {
    console.error("[custody/parse] error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
