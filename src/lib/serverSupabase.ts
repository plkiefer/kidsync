// Server-side Supabase clients for use inside Next.js server actions
// and API routes. NOT marked "use server" — this file exports
// helpers, not actions. (A "use server" file treats every export as
// a server action endpoint, which is the wrong shape here.)
//
// Why these exist: the browser supabase client intermittently
// deadlocks on `_useSession()` → `_getSession()` → `_callRefreshToken()`
// — a known issue tied to navigator.locks contention between the
// realtime websocket and explicit calls. The browser-side
// workarounds (manualTokenRefresh, withTimeout wrappers,
// manualSignOut) papered over each surface as it broke.
//
// The architecturally correct fix is to move mutations to the
// server, where:
//   - Session reads come from request cookies, no async lock dance
//   - No realtime subscription competing for the auth state
//   - Validation + multi-step orchestration live in one place
//   - The browser client stays for reads (which are idempotent and
//     don't hit the same lock pattern as mutations)

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

/** Auth-respecting server client. Carries the calling user's
 *  session via the request cookies — RLS applies the same way it
 *  would in the browser. Use this for anything that should be
 *  scoped to the signed-in user. */
export function getServerSupabase(): SupabaseClient {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Pin to "/" so server-set cookies land at the same path as
      // browser-set cookies (basePath /kidsync would otherwise
      // scope cookies to /kidsync, and signOut deletions at /
      // would silently fail to clear them). See src/lib/supabase.ts.
      cookieOptions: { path: "/" },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // .set() is a no-op when called from a server component
          // (response already streamed). Server actions and route
          // handlers can set cookies — the try/catch silences the
          // benign server-component case.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, { ...options, path: "/" })
            );
          } catch {
            // server component context — ignore
          }
        },
      },
    }
  );
}

/** Service-role server client. Bypasses RLS entirely. Use only for
 *  trusted server-only operations (admin tasks, migrations, etc).
 *  Currently unused — every action goes through getServerSupabase
 *  so user permissions still apply. Provided here for future use. */
export function getServiceSupabase(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

/** Guard for every server action: assert the caller is signed in,
 *  return the verified User. Throws on failure — server actions
 *  catch and convert to ActionResult.error. */
export async function requireUser(
  supabase: SupabaseClient
): Promise<User> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error("Unauthorized");
  }
  return data.user;
}

/** Standard return shape for every server action so callers can
 *  branch on .ok without try/catch noise. Data is generic so each
 *  action can return whatever it needs. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function actionError(error: unknown): ActionResult<never> {
  const message =
    error instanceof Error ? error.message : "Unknown error";
  return { ok: false, error: message };
}
