import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// ── Browser Client (for components & hooks) ──────────────
// Uses @supabase/ssr which properly handles cookie-based auth
// and token refresh without hanging on hard reload.
function makeBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
