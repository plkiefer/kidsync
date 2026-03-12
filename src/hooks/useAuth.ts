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

  // Initialize: use onAuthStateChange as the primary mechanism.
  // getSession() can hang during token refresh on hard reload,
  // so we don't block on it.
  useEffect(() => {
    let mounted = true;

    // onAuthStateChange fires immediately with current session state
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (session?.user) {
        setUser(session.user);
        // Unblock the page immediately — profile loads in background
        setLoading(false);
        // Fetch profile without blocking
        try {
          const p = await fetchProfile(session.user.id);
          if (mounted) setProfile(p);
        } catch {
          // Profile fetch failed, page still works
        }
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    // Safety timeout in case onAuthStateChange never fires
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 3000);

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
