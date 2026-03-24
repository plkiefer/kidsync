"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Lock, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";

export default function SettingsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const supabase = getSupabase();

  // Email state
  const [newEmail, setNewEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState("");
  const [emailError, setEmailError] = useState("");

  // Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  const handleChangeEmail = async () => {
    setEmailError("");
    setEmailSuccess("");

    if (!newEmail.trim()) {
      setEmailError("Please enter a new email address.");
      return;
    }

    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      setEmailSuccess(`Confirmation email sent to ${newEmail}`);
      setNewEmail("");
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : "Failed to update email.");
    } finally {
      setEmailLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    setPasswordSuccess("");

    if (!newPassword) {
      setPasswordError("Please enter a new password.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordSuccess("Password updated successfully.");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[var(--color-text-muted)] animate-spin" />
      </div>
    );
  }

  const inputCls =
    "w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-sm placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[rgba(56,56,56,0.12)] transition-all";

  return (
    <div className="min-h-screen p-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/calendar"
          className="p-2 -ml-2 rounded-xl text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold text-[var(--color-text)] tracking-tight">
          Settings
        </h1>
      </div>

      {/* Current user info */}
      <div className="mb-6 text-sm text-[var(--color-text-muted)]">
        <p>
          Signed in as{" "}
          <span className="text-[var(--color-text)] font-medium">
            {profile?.full_name ?? "..."}
          </span>
        </p>
        <p className="text-[var(--color-text-faint)] mt-0.5">{user.email}</p>
      </div>

      <div className="space-y-5">
        {/* Change Email Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h2 className="font-display text-base font-semibold text-[var(--color-text)]">
              Change Email
            </h2>
          </div>

          <div className="space-y-3">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="New email address"
              className={inputCls}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleChangeEmail();
              }}
            />

            {emailError && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                {emailError}
              </div>
            )}

            {emailSuccess && (
              <div className="text-emerald-300 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                {emailSuccess}
              </div>
            )}

            <button
              onClick={handleChangeEmail}
              disabled={emailLoading || !newEmail.trim()}
              className="w-full py-3 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {emailLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Update Email"
              )}
            </button>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h2 className="font-display text-base font-semibold text-[var(--color-text)]">
              Change Password
            </h2>
          </div>

          <div className="space-y-3">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className={inputCls}
            />

            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className={inputCls}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleChangePassword();
              }}
            />

            {passwordError && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="text-emerald-300 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                {passwordSuccess}
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={passwordLoading || !newPassword || !confirmPassword}
              className="w-full py-3 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {passwordLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Update Password"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
