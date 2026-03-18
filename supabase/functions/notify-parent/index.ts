// supabase/functions/notify-parent/index.ts
//
// Triggered by:
//   1. pg_net DB trigger on calendar_events (INSERT/UPDATE/DELETE)
//   2. Frontend call via supabase.functions.invoke() for custody overrides
// Sends an email to the OTHER parent in the family via Resend.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "KidSync <onboarding@resend.dev>";
const APP_URL = "https://kidsync-zeta.vercel.app";

// TEST MODE: Override recipient emails so real users don't get notifications
// Remove this map (and the remap in sendToAll) when going to production
const TEST_EMAIL_MAP: Record<string, string> = {
  "p.l.kiefer@proton.me": "p.l.kiefer@proton.me",
};
const TEST_FALLBACK_EMAIL = "p.l.kiefer@proton.me";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight from browser calls
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    let result;
    if (payload.type === "custody_override") {
      result = await handleCustodyOverride(supabase, payload);
    } else {
      result = await handleCalendarEvent(supabase, payload);
    }

    // Add CORS headers to the response
    const body = await result.text();
    return new Response(body, {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Notification error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Calendar event notifications (Notification style) ─────────

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
  const html = notificationEmail(
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
  { action, override, kid_ids, family_id, changed_by }: {
    type: string;
    action: string;
    override: Record<string, unknown>;
    kid_ids: string[];
    family_id: string;
    changed_by: string;
  }
) {
  const recipients = await getRecipients(supabase, family_id, changed_by);
  if (!recipients.length) return noRecipients();

  const actor = await getName(supabase, changed_by);
  const custodyParent = await getName(supabase, override.parent_id as string);

  // Look up all kid names
  const kidNames: string[] = [];
  for (const kidId of kid_ids) {
    kidNames.push(await getKidName(supabase, kidId));
  }
  const kidNamesStr = kidNames.join(" & ");

  const startDate = formatDate(override.start_date as string);
  const endDate = formatDate(override.end_date as string);
  const dateRange =
    override.start_date === override.end_date
      ? startDate
      : `${startDate} – ${endDate}`;

  const reason = (override.reason || override.response_note || "") as string;

  // "requested" → Action Required email; everything else → Notification email
  if (action === "requested") {
    const subject = `KidSync: Action Required — ${actor} requested a custody change for ${kidNamesStr}`;
    const html = actionRequiredEmail(
      `${actor} is requesting a custody change`,
      `
        <p style="color: #686460; margin: 0; font-size: 14px;">
          <strong>${kidNamesStr}</strong><br/>
          ${dateRange}<br/>
          Custody with: ${custodyParent}
          ${reason ? `<br/><br/><em>"${reason}"</em>` : ""}
        </p>
      `
    );
    return await sendToAll(recipients, subject, html);
  }

  // Approved / Disputed / Withdrawn → Notification style
  let verb: string;
  switch (action) {
    case "approved":
      verb = `approved a custody change for ${kidNamesStr}`;
      break;
    case "disputed":
      verb = `disputed a custody change for ${kidNamesStr}`;
      break;
    case "withdrawn":
      verb = `withdrew a custody change request for ${kidNamesStr}`;
      break;
    default:
      verb = `made a custody update for ${kidNamesStr}`;
  }

  const subject = `KidSync: ${actor} ${verb}`;
  const html = notificationEmail(
    `${actor} ${verb}`,
    `
      <p style="color: #686460; margin: 0; font-size: 14px;">
        <strong>${kidNamesStr}</strong><br/>
        ${dateRange}<br/>
        Custody with: ${custodyParent}
        ${reason ? `<br/><br/><em>"${reason}"</em>` : ""}
      </p>
    `
  );

  return await sendToAll(recipients, subject, html);
}

// ── Email templates ───────────────────────────────────────────

function actionRequiredEmail(subtitle: string, bodyContent: string): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: #FAFAF8; padding: 24px; border-radius: 12px; border: 1px solid #E0E0DC;">
        <div style="display: inline-block; padding: 4px 10px; background: #FEF3C7; color: #92400E; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
          Action Required
        </div>
        <h2 style="color: #1C1C1C; margin: 0 0 4px 0;">Custody Change Request</h2>
        <p style="color: #686460; margin: 0 0 20px 0; font-size: 14px;">
          ${subtitle}
        </p>
        <div style="background: #F4F4F2; padding: 16px; border-radius: 8px; border-left: 4px solid #F59E0B;">
          ${bodyContent}
        </div>
        <a href="${APP_URL}/calendar"
           style="display: inline-block; margin-top: 20px; padding: 10px 20px;
                  background: #D97706; color: #fff; border-radius: 8px;
                  text-decoration: none; font-weight: 600; font-size: 14px;">
          Review Request
        </a>
      </div>
    </div>
  `;
}

function notificationEmail(subtitle: string, bodyContent: string): string {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto;">
      <div style="background: #FAFAF8; padding: 24px; border-radius: 12px; border: 1px solid #E0E0DC;">
        <h2 style="color: #1C1C1C; margin: 0 0 4px 0;">KidSync Update</h2>
        <p style="color: #686460; margin: 0 0 20px 0; font-size: 14px;">
          ${subtitle}
        </p>
        <div style="background: #F4F4F2; padding: 16px; border-radius: 8px; border-left: 4px solid #383838;">
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
