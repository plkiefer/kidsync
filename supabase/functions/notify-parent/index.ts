// supabase/functions/notify-parent/index.ts
//
// Triggered by pg_net from the Postgres trigger whenever
// a calendar event is created, updated, or deleted.
// Sends an email to the OTHER parent in the family.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = "KidSync <notifications@yourdomain.com>";

serve(async (req) => {
  try {
    const { action, event, family_id, changed_by } = await req.json();

    // Initialize Supabase admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get all family members except the one who made the change
    const { data: recipients } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("family_id", family_id)
      .neq("id", changed_by);

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ message: "No recipients" }), {
        status: 200,
      });
    }

    // Get the actor's name
    const { data: actor } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", changed_by)
      .single();

    // Get kid name
    const { data: kid } = await supabase
      .from("kids")
      .select("name")
      .eq("id", event.kid_id)
      .single();

    // Build email content
    const actionVerb =
      {
        created: "added a new event",
        updated: "updated an event",
        deleted: "removed an event",
      }[action as string] || "changed an event";

    const eventDate = new Date(event.starts_at).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const subject = `KidSync: ${actor?.full_name} ${actionVerb} for ${kid?.name}`;

    const htmlBody = `
      <div style="font-family: -apple-system, sans-serif; max-width: 500px; margin: 0 auto;">
        <div style="background: #FAFAF8; padding: 24px; border-radius: 12px; border: 1px solid #E0E0DC;">
          <h2 style="color: #1C1C1C; margin: 0 0 4px 0;">KidSync Update</h2>
          <p style="color: #686460; margin: 0 0 20px 0; font-size: 14px;">
            ${actor?.full_name} ${actionVerb}
          </p>

          <div style="background: #F4F4F2; padding: 16px; border-radius: 8px; border-left: 4px solid #383838;">
            <h3 style="color: #1C1C1C; margin: 0 0 8px 0;">${event.title}</h3>
            <p style="color: #686460; margin: 0; font-size: 14px;">
              ${kid?.name}<br/>
              ${eventDate}<br/>
              ${event.location ? `${event.location}<br/>` : ""}
              ${event.notes ? `${event.notes}` : ""}
            </p>
          </div>

          <a href="https://yourdomain.com/calendar"
             style="display: inline-block; margin-top: 20px; padding: 10px 20px;
                    background: #383838; color: #fff; border-radius: 8px;
                    text-decoration: none; font-weight: 600; font-size: 14px;">
            View Calendar
          </a>
        </div>
      </div>
    `;

    // Send via Resend
    for (const recipient of recipients) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipient.email,
          subject,
          html: htmlBody,
        }),
      });
    }

    return new Response(
      JSON.stringify({
        message: `Notified ${recipients.length} recipient(s)`,
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error("Notification error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
    });
  }
});
