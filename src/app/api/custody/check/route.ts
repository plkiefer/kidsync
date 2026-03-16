import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are a family law compliance checker. Given a custody agreement's terms
and a proposed schedule change (event, override, or vacation), determine whether the change
complies with the custody agreement.

Return ONLY valid JSON:
{
  "compliant": true or false,
  "issues": ["list of specific violations or concerns"],
  "suggestions": ["list of suggestions to make the change compliant"],
  "relevant_provisions": ["quotes or references from the agreement that apply"]
}

Be specific about which provisions are relevant. If the change is compliant, issues should be empty.
Consider notification requirements, right of first refusal, travel restrictions, holiday schedules, etc.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { terms, change } = body;

    if (!terms || !change) {
      return NextResponse.json(
        { error: "Missing terms or change description" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Custody Agreement Terms:\n${JSON.stringify(terms, null, 2)}\n\nProposed Change:\n${JSON.stringify(change, null, 2)}\n\nDoes this change comply with the custody agreement?`,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

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

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error("[custody/check] error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
