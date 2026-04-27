"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Lock, Check, Loader2, Palette } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { Kid } from "@/lib/types";
import { DEFAULT_PARENT_A_COLOR, resolvePalette } from "@/lib/palette";
import ColorPicker from "@/components/ColorPicker";

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

  // Color preferences — own color + per-kid colors. Optimistic
  // updates: write to DB on click, revert on error.
  const [myColor, setMyColor] = useState<string>(DEFAULT_PARENT_A_COLOR);
  const [kids, setKids] = useState<Kid[]>([]);
  const [colorSavingKey, setColorSavingKey] = useState<string | null>(null);
  const [colorError, setColorError] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  // Hydrate own color preference from profile
  useEffect(() => {
    if (profile?.color_preference) {
      setMyColor(profile.color_preference);
    }
  }, [profile?.color_preference]);

  // Load kids for color editing
  useEffect(() => {
    if (!user || !profile?.family_id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("kids")
        .select("*")
        .order("name");
      if (!cancelled && !error && data) setKids(data as Kid[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profile?.family_id, supabase]);

  const handleChangeMyColor = useCallback(
    async (key: string) => {
      if (!user) return;
      const previous = myColor;
      setMyColor(key); // optimistic
      setColorSavingKey("self");
      setColorError("");
      const { error } = await supabase
        .from("profiles")
        .update({ color_preference: key })
        .eq("id", user.id);
      setColorSavingKey(null);
      if (error) {
        setMyColor(previous);
        setColorError(error.message);
      }
    },
    [user, myColor, supabase]
  );

  const handleChangeKidColor = useCallback(
    async (kidId: string, key: string) => {
      const previous = kids.find((k) => k.id === kidId)?.color;
      setKids((prev) => prev.map((k) => (k.id === kidId ? { ...k, color: key } : k)));
      setColorSavingKey(kidId);
      setColorError("");
      const { error } = await supabase
        .from("kids")
        .update({ color: key })
        .eq("id", kidId);
      setColorSavingKey(null);
      if (error) {
        setKids((prev) =>
          prev.map((k) => (k.id === kidId ? { ...k, color: previous ?? k.color } : k))
        );
        setColorError(error.message);
      }
    },
    [kids, supabase]
  );

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
    "w-full px-4 py-2.5 bg-[var(--bg-sunken)] border border-[var(--border)] rounded-sm text-[var(--ink)] text-sm placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--action)] focus:shadow-[0_0_0_3px_var(--action-ring)] transition-colors";

  return (
    <div className="min-h-screen p-6 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/calendar"
          className="p-2 -ml-2 rounded-sm text-[var(--text-muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-sunken)] transition-colors"
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
        {/* Colors Card */}
        <div className="bg-[var(--bg)] border border-[var(--border-strong)] rounded-sm shadow-[var(--shadow-sm)] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Palette className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h2 className="font-display text-base font-semibold text-[var(--color-text)]">
              Colors
            </h2>
          </div>
          <p className="text-[11px] text-[var(--color-text-faint)] mb-5 ml-6">
            Pick a color for yourself and each kid. Used to tint days on the calendar
            and identify whose event is whose. Each parent can choose independently.
          </p>

          {colorError && (
            <div
              className="text-xs rounded-sm p-2.5 border mb-4"
              style={{
                color: "var(--accent-red)",
                background: "var(--accent-red-tint)",
                borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)",
              }}
            >
              {colorError}
            </div>
          )}

          <div className="space-y-5">
            {/* Self */}
            <ColorRow
              label="You"
              sublabel={profile?.full_name ?? user.email ?? ""}
              previewBg={resolvePalette(myColor).bg}
              saving={colorSavingKey === "self"}
            >
              <ColorPicker
                value={myColor}
                onChange={handleChangeMyColor}
                disabled={colorSavingKey === "self"}
                label="Your color"
              />
            </ColorRow>

            {/* Kids */}
            {kids.map((kid) => (
              <ColorRow
                key={kid.id}
                label={kid.name}
                sublabel="Kid"
                previewBg={resolvePalette(kid.color).bg}
                saving={colorSavingKey === kid.id}
              >
                <ColorPicker
                  value={kid.color}
                  onChange={(key) => handleChangeKidColor(kid.id, key)}
                  disabled={colorSavingKey === kid.id}
                  label={`${kid.name}'s color`}
                />
              </ColorRow>
            ))}
          </div>
        </div>

        {/* Change Email Card */}
        <div className="bg-[var(--bg)] border border-[var(--border-strong)] rounded-sm shadow-[var(--shadow-sm)] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-[var(--color-text-muted)]" />
            <h2 className="font-display text-base font-semibold text-[var(--color-text)]">
              Change Email
            </h2>
          </div>
          <p className="text-[11px] text-[var(--color-text-faint)] mb-4 ml-6">
            A confirmation link will be sent to the new address. Your email won&apos;t change until you click it.
          </p>

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
              <div className="text-xs rounded-sm p-2.5 border" style={{ color: "var(--accent-red)", background: "var(--accent-red-tint)", borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)" }}>
                {emailError}
              </div>
            )}

            {emailSuccess && (
              <div className="text-xs rounded-sm p-2.5 border flex items-center gap-2" style={{ color: "#3D7A4F", background: "rgba(142, 161, 138, 0.15)", borderColor: "rgba(142, 161, 138, 0.5)" }}>
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                {emailSuccess}
              </div>
            )}

            <button
              onClick={handleChangeEmail}
              disabled={emailLoading || !newEmail.trim()}
              className="w-full py-3 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--action-ring)]"
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
        <div className="bg-[var(--bg)] border border-[var(--border-strong)] rounded-sm shadow-[var(--shadow-sm)] p-5">
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
              <div className="text-xs rounded-sm p-2.5 border" style={{ color: "var(--accent-red)", background: "var(--accent-red-tint)", borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)" }}>
                {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="text-xs rounded-sm p-2.5 border flex items-center gap-2" style={{ color: "#3D7A4F", background: "rgba(142, 161, 138, 0.15)", borderColor: "rgba(142, 161, 138, 0.5)" }}>
                <Check className="w-3.5 h-3.5 flex-shrink-0" />
                {passwordSuccess}
              </div>
            )}

            {confirmPassword && newPassword !== confirmPassword && (
              <div className="text-xs rounded-sm p-2.5 border" style={{ color: "var(--accent-red)", background: "var(--accent-red-tint)", borderColor: "color-mix(in srgb, var(--accent-red) 30%, transparent)" }}>
                Passwords do not match.
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={passwordLoading || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 6}
              className="w-full py-3 bg-action text-action-fg text-sm font-semibold hover:bg-action-hover active:bg-action-pressed transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--action-ring)]"
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

// ── ColorRow ────────────────────────────────────────────────
// Single row in the colors card: name + day-cell preview swatch
// on the left, picker grid on the right.

interface ColorRowProps {
  label: string;
  sublabel: string;
  previewBg: string;
  saving: boolean;
  children: React.ReactNode;
}

function ColorRow({ label, sublabel, previewBg, saving, children }: ColorRowProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <div
          className="h-7 w-10 rounded-sm border border-[var(--border)] flex-shrink-0"
          style={{ backgroundColor: previewBg }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text)] leading-tight">
            {label}
          </div>
          <div className="text-[11px] text-[var(--text-faint)] leading-tight">
            {sublabel}
          </div>
        </div>
        {saving && (
          <Loader2 className="w-3.5 h-3.5 text-[var(--text-faint)] animate-spin flex-shrink-0" />
        )}
      </div>
      <div className="ml-[52px]">{children}</div>
    </div>
  );
}
