"use server";

// Auth mutation server actions. Replaces the manual REST bypasses
// (updateAuthUser, manualSignOut) that the browser supabase client
// kept deadlocking on. Server-side calls don't hit the navigator.
// locks / realtime contention pattern that breaks `.update()` and
// `.signOut()` in the browser.

import { cookies } from "next/headers";
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

/** End the caller's session. Two layers of cookie deletion:
 *    1. supabase.auth.signOut() — invalidates the refresh_token
 *       server-side AND fires the setAll callback to expire the
 *       cookies. Should be sufficient on its own.
 *    2. Explicit cookie sweep — iterate every sb-*-auth-token*
 *       cookie and expire it at BOTH "/" and the basePath. Belt-
 *       and-suspenders for browsers whose cookies were originally
 *       set with a different path attribute (the basePath-mismatch
 *       bug that caused "sign out → blank screen → still signed
 *       in" before the path-pinning fix). One-time transition
 *       cost; new cookies are pinned to "/" so future signOuts
 *       only need layer 1.
 *
 *  scope: 'local' on signOut skips the network call to invalidate
 *  the session on other devices — we want THIS browser's cookie
 *  cleared, not to logout-all. Faster + less to go wrong. */
export async function signOutAction(): Promise<ActionResult<true>> {
  try {
    const supabase = getServerSupabase();
    await supabase.auth.signOut({ scope: "local" });

    // Layer 2: explicit cookie sweep. Run regardless of layer 1's
    // result — duplicates are harmless, missing cookies are the
    // bug we're guarding against.
    const cookieStore = cookies();
    const PATHS_TO_EXPIRE = ["/", "/kidsync"];
    for (const c of cookieStore.getAll()) {
      // Supabase auth cookies look like sb-<projectRef>-auth-token
      // with optional .0/.1/.2 chunks for large session payloads.
      if (!c.name.startsWith("sb-")) continue;
      if (!c.name.includes("-auth-token")) continue;
      for (const path of PATHS_TO_EXPIRE) {
        try {
          cookieStore.set(c.name, "", { path, maxAge: 0 });
        } catch {
          // ignore — server-component context, won't fire from a
          // server action anyway
        }
      }
    }

    return { ok: true, data: true };
  } catch (err) {
    return actionError(err);
  }
}
