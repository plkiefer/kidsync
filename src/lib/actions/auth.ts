"use server";

// Auth mutation server actions. Replaces the manual REST bypasses
// (updateAuthUser, manualSignOut) that the browser supabase client
// kept deadlocking on. Server-side calls don't hit the navigator.
// locks / realtime contention pattern that breaks `.update()` and
// `.signOut()` in the browser.

import {
  actionError,
  getServerSupabase,
  type ActionResult,
} from "@/lib/serverSupabase";

// ── updateUser ────────────────────────────────────────────────

interface UpdateUserPayload {
  email?: string;
  password?: string;
}

/** Update the caller's auth profile — email and/or password.
 *  Server-side wrapper around supabase.auth.updateUser, which on
 *  the browser side hangs when the auth lock is contended. */
export async function updateUserAction(
  payload: UpdateUserPayload
): Promise<ActionResult<true>> {
  try {
    if (!payload.email && !payload.password) {
      return { ok: false, error: "Nothing to update" };
    }
    const supabase = getServerSupabase();
    // updateUser requires an authenticated session; getSession from
    // the server cookie store doesn't deadlock.
    const { error } = await supabase.auth.updateUser(payload);
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: true };
  } catch (err) {
    return actionError(err);
  }
}

// ── signOut ───────────────────────────────────────────────────

/** End the caller's session. The server signOut deletes the auth
 *  cookie via the Next.js cookies API (the proper way) so the next
 *  request from this browser arrives unauthenticated. Caller does
 *  the navigation — hard nav recommended to clear all client state. */
export async function signOutAction(): Promise<ActionResult<true>> {
  try {
    const supabase = getServerSupabase();
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Best-effort: even if the server signOut errors, the cookie
      // is usually still gone. Treat as success so the client can
      // navigate away — better than leaving the user stuck on a
      // page they think they signed out of.
      return { ok: true, data: true };
    }
    return { ok: true, data: true };
  } catch (err) {
    return actionError(err);
  }
}
