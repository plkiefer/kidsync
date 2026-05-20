"use client";

import { useEffect, useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { manualTokenRefresh } from "@/lib/refreshToken";
import { signOutAction } from "@/lib/actions/auth";
import { Profile } from "@/lib/types";
import { BASE_PATH } from "@/lib/basePath";

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithMagicLink: (email: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

/** JS-side cleanup of every sb-<projectRef>-auth-token* cookie at
 *  every plausible path. Supabase auth cookies are NOT HttpOnly
 *  (the browser client has to read them) so document.cookie
 *  expiration works on them. Defensive layer paired with the
 *  server-action's Set-Cookie response — if either succeeds, the
 *  cookie is gone. */
function deleteSupabaseAuthCookiesClientSide(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return;
  const projectRef = new URL(url).hostname.split(".")[0];
  const prefix = `sb-${projectRef}-auth-token`;
  const paths = ["/", "/kidsync"];
  const allCookies = document.cookie.split(";").map((c) => c.trim());
  for (const cookieStr of allCookies) {
    const name = cookieStr.split("=")[0];
    if (!name.startsWith(prefix)) continue;
    for (const path of paths) {
      document.cookie = `${name}=; path=${path}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = getSupabase();

  // Fetch profile for authenticated user
  const fetchProfile = useCallback(
    async (userId: string) => {
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError) {
        console.error("Error fetching profile:", profileError);
        return null;
      }
      return data as Profile;
    },
    [supabase]
  );

  // Initialize: use onAuthStateChange as the primary mechanism.
  // getSession() can hang during token refresh on hard reload,
  // so we don't block on it.
  useEffect(() => {
    let mounted = true;
    let initializing = true;

    const init = async () => {
      console.log("[auth] manually refreshing token...");
      // Bypass the Supabase client's getSession() which hangs on
      // expired tokens. Call the token refresh API directly.
      const freshSession = await manualTokenRefresh();

      if (freshSession && mounted) {
        console.log("[auth] token refreshed, setting session...");
        // Update the Supabase client with fresh tokens
        await supabase.auth.setSession({
          access_token: freshSession.access_token,
          refresh_token: freshSession.refresh_token,
        });
        setUser(freshSession.user as User);
        setLoading(false);
        initializing = false;
        // Fetch profile in background (with fresh token, this won't hang)
        const p = await fetchProfile(freshSession.user.id);
        if (mounted) setProfile(p);
      } else if (mounted) {
        console.log("[auth] no valid session");
        setLoading(false);
        initializing = false;
      }
    };

    init();

    // Listen for ongoing auth changes (sign in, sign out)
    // Ignore during init to prevent race conditions
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted || initializing) return;
      console.log("[auth] stateChange:", event);

      if (session?.user) {
        setUser(session.user);
        setLoading(false);
        const p = await fetchProfile(session.user.id);
        if (mounted) setProfile(p);
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }
    },
    [supabase]
  );

  const signInWithMagicLink = useCallback(
    async (email: string) => {
      setError(null);
      const { error: magicError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${BASE_PATH}/calendar`,
        },
      });
      if (magicError) {
        setError(magicError.message);
        throw magicError;
      }
    },
    [supabase]
  );

  const signUp = useCallback(
    async (email: string, password: string, fullName: string) => {
      setError(null);
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}${BASE_PATH}/calendar`,
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        throw signUpError;
      }
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    // Two layers of cookie clearing — server-action Set-Cookie
    // headers AND client-side document.cookie deletion. The server
    // action is the architecturally correct path (it knows the
    // exact cookie names + can invalidate sessions), but Supabase
    // auth cookies are JS-readable by design so the client can
    // also clear them — that's the defensive layer for any case
    // where the Set-Cookie response is stripped (proxy / path
    // mismatch / framework quirk) and would otherwise leave a
    // still-valid access_token in the browser.
    //
    // Run cookie cleanup BEFORE clearing React state. If we cleared
    // state first the calendar would immediately render its
    // `if (!user) return null` blank screen while the signOut work
    // is still pending — a slow or failed action then strands the
    // user looking at nothing.
    try {
      await signOutAction();
    } catch (err) {
      console.warn("[useAuth] signOutAction error:", err);
    }
    if (typeof document !== "undefined") {
      deleteSupabaseAuthCookiesClientSide();
    }
    setUser(null);
    setProfile(null);
  }, []);

  return {
    user,
    profile,
    loading,
    signInWithEmail,
    signInWithMagicLink,
    signUp,
    signOut,
    error,
  };
}
