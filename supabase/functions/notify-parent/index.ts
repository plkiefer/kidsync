// supabase/functions/notify-parent/index.ts
//
// Triggered by pg_net from Postgres triggers whenever:
//   1. A calendar event is created, updated, or deleted
//   2. A custody override is created or its status changes
// Sends an email to the OTHER parent in the family via Resend.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "KidSync <onboarding@resend.dev>";
const APP_URL = "https://yourdomain.com"; // TODO: update when you have a production domain

// TEST MODE: Override recipient emails so real users don't get notifications
// Remove this map (and the remap in sendToAll) when going to production
const TEST_EMAIL_MAP: Record<string, string> = {
  "p.l.kiefer@proton.me": "p.l.kiefer@proton.me",   // Patrick → same
  // Danielle's real email → your gmail for testing
};
const TEST_FALLBACK_EMAIL = "p.l.kiefer@gmail.com";

serve(async (req) => {
  try {
    const payload = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Route to the right handler based on payload type
    if (payload.type === "custody_override") {
      return await handleCustodyOverride(supabase, payload);
    } else {
      return await handleCalendarEvent(supabase, payload);
    }
  } catch (error) {
    console.error("Notification error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
    });
  }
});

// ── Calendar event notifications ──────────────────────────────

async function handleCalendarEvent(
  supabase: ReturnType<typeof createClient>,
  { action, event, family_id, changed_by }: {
    action: string;
    event: Record<string, unknown>;
    family_id: string;
    changed_by: string;
  }
) {
  const recipients = await getRecipients(supabase, family_id, changed_by);
  if (!recipients.length) return noRecipients();

  const actor = await getName(supabase, changed_by);
  const kidName = await getKidName(supabase, event.kid_id as string);

  const actionVerb: Record<string, string> = {
    created: "added a new event",
    updated: "updated an event",
    deleted: "removed an event",
  };
  const verb = actionVerb[action] || "changed an event";

  const eventDate = new Date(event.starts_at as string).toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }
  );

  const subject = `KidSync: ${actor} ${verb} for ${kidName}`;
  const html = emailWrapper(
    "Calendar Update",
    `${actor} ${verb}`,
    `
      <h3 style="color: #1C1C1C; margin: 0 0 8px 0;">${event.title}</h3>
      <p style="color: #686460; margin: 0; font-size: 14px;">
        ${kidName}<br/>
        ${eventDate}<br/>
        ${event.location ? `${event.location}<br/>` : ""}
        ${event.notes || ""}
      </p>
    `
  );

  return await sendToAll(recipients, subject, html);
}

// ── Custody override notifications ────────────────────────────

async function handleCustodyOverride(
  supabase: ReturnType<typeof createClient>,
  { action, override, family_id, changed_by }: {
    type: string;
    action: string;
    override: Record<string, unknown>;
    family_id: string;
    changed_by: string;
  }
) {
  const recipients = await getRecipients(supabase, family_id, changed_by);
  if (!recipients.length) return noRecipients();

  const actor = await getName(supabase, changed_by);
  const kidName = await getKidName(supabase, override.kid_id as string);
  const custodyParent = await getName(supabase, override.parent_id as string);

  const startDate = formatDate(override.start_date as string);
  const endDate = formatDate(override.end_date as string);
  const dateRange =
    override.start_date === override.end_date
      ? startDate
      : `${startDate} – ${endDate}`;

  // Build action-specific messaging
  let subject: string;
  let headline: string;
  let detail: string;
  let borderColor = "#383838";

  switch (action) {
    case "requested":
      subject = `KidSync: ${actor} requested a custody change for ${kidName}`;
      headline = "Custody Change Request";
      detail = `${actor} is requesting custody of ${kidName} with ${custodyParent} for ${dateRange}.`;
      borderColor = "#F59E0B"; // amber
      break;
    case "approved":
      subject = `KidSync: Custody change approved for ${kidName}`;
      headline = "Custody Change Approved";
      detail = `${actor} approved the custody change for ${kidName} (${dateRange}).`;
      borderColor = "#22C55E"; // green
      break;
    case "disputed":
      subject = `KidSync: Custody change disputed for ${kidName}`;
      headline = "Custody Change Disputed";
      detail = `${actor} disputed the custody change for ${kidName} (${dateRange}).`;
      borderColor = "#EF4444"; // red
      break;
    case "withdrawn":
      subject = `KidSync: Custody change withdrawn for ${kidName}`;
      headline = "Custody Change Withdrawn";
      detail = `${actor} withdrew the custody change request for ${kidName} (${dateRange}).`;
      borderColor = "#6B7280"; // gray
      break;
    default:
      subject = `KidSync: Custody update for ${kidName}`;
      headline = "Custody Update";
      detail = `${actor} made a custody change for ${kidName} (${dateRange}).`;
  }

  const reason = override.reason || override.response_note;
  const html = emailWrapper(
    headline,
    detail,
    `
      <p style="color: #686460; margin: 0; font-size: 14px;">
        <strong>${kidName}</strong><br/>
        ${dateRange}<br/>
        Custody with: ${custodyParent}
        ${reason ? `<br/><br/><em>"${reason}"</em>` : ""}
      </p>
    `,
    borderColor
  );

  return await sendToAll(recipients, subject, html);
}

// ── Shared helpers ────────────────────────────────────────────

async function getRecipients(
  supabase: ReturnType<typeof createClient>,
  familyId: string,
  excludeUserId: string
) {
  const { data } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("family_id", familyId)
    .neq("id", excludeUserId);
  return data || [];
}

async function getName(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single();
  return data?.full_name || "A family member";
}

async function getKidName(
  supabase: ReturnType<typeof createClient>,
  kidId: string
): Promise<string> {
  const { data } = await supabase
    .from("kids")
    .select("name")
    .eq("id", kidId)
    .single();
  return data?.name || "your child";
}

function formatDate(dateStr: string): string {
  const dt = new Date(dateStr + "T12:00:00");
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function emailWrapper(
  headline: string,
  subtitle: string,
  bodyContent: string,
  borderColor = "#383838"
): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: #FAFAF8; padding: 24px; border-radius: 12px; border: 1px solid #E0E0DC;">
        <h2 style="color: #1C1C1C; margin: 0 0 4px 0;">${headline}</h2>
        <p style="color: #686460; margin: 0 0 20px 0; font-size: 14px;">
          ${subtitle}
        </p>
        <div style="background: #F4F4F2; padding: 16px; border-radius: 8px; border-left: 4px solid ${borderColor};">
          ${bodyContent}
        </div>
        <a href="${APP_URL}/calendar"
           style="display: inline-block; margin-top: 20px; padding: 10px 20px;
                  background: #383838; color: #fff; border-radius: 8px;
                  text-decoration: none; font-weight: 600; font-size: 14px;">
          View Calendar
        </a>
      </div>
    </div>
  `;
}

function noRecipients() {
  return new Response(JSON.stringify({ message: "No recipients" }), { status: 200 });
}

async function sendToAll(
  recipients: { email: string; full_name: string }[],
  subject: string,
  html: string
) {
  for (const recipient of recipients) {
    // TEST MODE: remap emails so Danielle doesn't get notified during testing
    const toEmail = TEST_EMAIL_MAP[recipient.email] ?? TEST_FALLBACK_EMAIL;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: toEmail,
        subject,
        html,
      }),
    });
  }

  return new Response(
    JSON.stringify({ message: `Notified ${recipients.length} recipient(s)` }),
    { status: 200 }
  );
}
