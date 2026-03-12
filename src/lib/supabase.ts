import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

// ── Browser Client (for components) ─────────────────────────
// Uses cookies for auth, safe for client components
export function createBrowserClient() {
  return createClientComponentClient();
}

// ── Server Client (for server components & API routes) ──────
export function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ── Singleton browser client for hooks ──────────────────────
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabase() {
  if (!browserClient) {
    browserClient = createBrowserClient();
  }
  return browserClient;
}
