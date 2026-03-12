"use client";

import { useEffect, useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { Profile } from "@/lib/types";

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

  // Initialize: check existing session
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        console.log("[useAuth] init: calling getSession...");
        const {
          data: { session },
        } = await supabase.auth.getSession();
        console.log("[useAuth] init: getSession returned, session:", !!session);

        if (session?.user && mounted) {
          setUser(session.user);
          console.log("[useAuth] init: fetching profile...");
          const p = await fetchProfile(session.user.id);
          console.log("[useAuth] init: profile fetched:", !!p);
          if (mounted) setProfile(p);
        }
      } catch (err) {
        console.error("[useAuth] init error:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    // Safety timeout: if getSession hangs, unblock the page
    const timeout = setTimeout(() => {
      if (mounted) {
        console.warn("[useAuth] safety timeout: forcing loading=false");
        setLoading(false);
      }
    }, 4000);

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("[useAuth] onAuthStateChange:", event);
      if (session?.user) {
        setUser(session.user);
        const p = await fetchProfile(session.user.id);
        if (mounted) setProfile(p);
      } else {
        setUser(null);
        setProfile(null);
      }
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
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
          emailRedirectTo: `${window.location.origin}/calendar`,
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
          emailRedirectTo: `${window.location.origin}/calendar`,
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
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supabase]);

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
