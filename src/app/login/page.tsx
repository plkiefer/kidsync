"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const { signInWithEmail, signInWithMagicLink, error } = useAuth();
  const router = useRouter();

  const handleMagicLink = async () => {
    setLoading(true);
    try {
      await signInWithMagicLink(email);
      setMagicSent(true);
    } catch {
      // error is set in hook
    } finally {
      setLoading(false);
    }
  };

  const handlePassword = async () => {
    setLoading(true);
    try {
      await signInWithEmail(email, password);
      router.push("/calendar");
    } catch {
      // error is set in hook
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-sm placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[rgba(56,56,56,0.12)] transition-all";

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        {/* Logo */}
        <div className="mb-2">
          <span className="text-5xl">📅</span>
        </div>
        <h1 className="font-display text-4xl font-bold text-[var(--color-text)] tracking-tight mb-1">
          KidSync
        </h1>
        <p className="text-[var(--color-text-faint)] text-sm mb-10">
          Co-parenting calendar for Ethan & Harrison
        </p>

        {magicSent ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 animate-scale-in">
            <span className="text-3xl mb-3 block">✉️</span>
            <h2 className="text-emerald-300 font-semibold text-lg mb-2">
              Check your email
            </h2>
            <p className="text-[var(--color-text-muted)] text-sm">
              We sent a sign-in link to{" "}
              <span className="text-[var(--color-text)] font-medium">{email}</span>.
              Click the link to access KidSync.
            </p>
            <button
              onClick={() => setMagicSent(false)}
              className="mt-4 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] transition-colors"
            >
              Try a different email
            </button>
          </div>
        ) : (
          <>
            {/* Mode toggle */}
            <div className="flex gap-1 p-1 bg-[var(--color-input)] rounded-xl mb-6">
              <button
                onClick={() => setMode("magic")}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  mode === "magic"
                    ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                    : "text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
                }`}
              >
                Magic Link
              </button>
              <button
                onClick={() => setMode("password")}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  mode === "password"
                    ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                    : "text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]"
                }`}
              >
                Email & Password
              </button>
            </div>

            {/* Form */}
            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className={inputCls}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    mode === "magic" ? handleMagicLink() : handlePassword();
                  }
                }}
              />

              {mode === "password" && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className={inputCls}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePassword();
                  }}
                />
              )}

              {error && (
                <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                  {error}
                </div>
              )}

              <button
                onClick={mode === "magic" ? handleMagicLink : handlePassword}
                disabled={loading || !email}
                className="w-full py-3 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading
                  ? "Signing in..."
                  : mode === "magic"
                  ? "Send Magic Link"
                  : "Sign In"}
              </button>
            </div>

            <p className="text-[var(--color-text-faint)] text-[11px] mt-8 leading-relaxed">
              Both parents use this same login page.
              <br />
              Your family calendar is shared automatically.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
