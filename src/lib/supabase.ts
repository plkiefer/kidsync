import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// ── Browser Client (for components & hooks) ──────────────
// Uses @supabase/ssr which properly handles cookie-based auth
// and token refresh without hanging on hard reload.
//
// cookieOptions.path is pinned to "/" so cookies are always scoped
// to the root of the host, NOT the basePath (/kidsync). Without
// this, the browser scopes the cookie to whatever URL set it
// (e.g. /kidsync/login → cookie path /kidsync). The server signOut
// then tries to delete at path / and the browser ignores it,
// leaving the user "signed out" in app state but still holding a
// valid auth token → middleware bounces them back to /calendar.
function makeBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { path: "/" },
    }
  );
}

// ── Server Client (for API routes with service role) ─────
export function createServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ── Singleton browser client for hooks ───────────────────
let browserClient: ReturnType<typeof makeBrowserClient> | null = null;

export function getSupabase() {
  if (!browserClient) {
    browserClient = makeBrowserClient();
  }
  return browserClient;
}
