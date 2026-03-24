"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { User, ArrowLeft, Loader2, Lock } from "lucide-react";

interface FamilyMember {
  id: string;
  full_name: string;
  email: string;
}

const CARD_ACCENTS = [
  {
    bg: "bg-indigo-500/10",
    border: "border-indigo-500/30",
    hover: "hover:border-indigo-400/50 hover:bg-indigo-500/15",
    avatar: "bg-indigo-500/20 text-indigo-300",
    ring: "ring-indigo-500/40",
  },
  {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    hover: "hover:border-amber-400/50 hover:bg-amber-500/15",
    avatar: "bg-amber-500/20 text-amber-300",
    ring: "ring-amber-500/40",
  },
];

export default function LoginPage() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [selectedParent, setSelectedParent] = useState<FamilyMember | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingMembers, setFetchingMembers] = useState(true);

  const { signInWithEmail, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    async function fetchMembers() {
      try {
        const res = await fetch("/api/family/members");
        if (res.ok) {
          const data: FamilyMember[] = await res.json();
          setMembers(data);
        }
      } catch {
        // silently fail — members will be empty
      } finally {
        setFetchingMembers(false);
      }
    }
    fetchMembers();
  }, []);

  const handleSignIn = async () => {
    if (!selectedParent || !password) return;
    setLoading(true);
    try {
      await signInWithEmail(selectedParent.email, password);
      router.push("/calendar");
    } catch {
      // error is set in hook
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedParent(null);
    setPassword("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
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

        {fetchingMembers ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-[var(--color-text-faint)] animate-spin" />
          </div>
        ) : selectedParent === null ? (
          /* ── Parent Selection ── */
          <div className="animate-scale-in">
            <p className="text-[var(--color-text-muted)] text-sm mb-6">
              Who&apos;s signing in?
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {members.map((member, i) => {
                const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
                const initial = member.full_name.charAt(0).toUpperCase();

                return (
                  <button
                    key={member.id}
                    onClick={() => setSelectedParent(member)}
                    className={`group relative flex flex-col items-center gap-4 p-6 rounded-2xl border transition-all duration-200 cursor-pointer ${accent.bg} ${accent.border} ${accent.hover} shadow-[var(--shadow-card)]`}
                  >
                    {/* Avatar */}
                    <div
                      className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${accent.avatar} transition-transform duration-200 group-hover:scale-110`}
                    >
                      {initial}
                    </div>

                    {/* Name */}
                    <span className="text-[var(--color-text)] font-semibold text-lg">
                      {member.full_name}
                    </span>

                    {/* Subtle icon */}
                    <User className="absolute top-3 right-3 w-4 h-4 text-[var(--color-text-faint)] opacity-40" />
                  </button>
                );
              })}
            </div>

            <p className="text-[var(--color-text-faint)] text-[11px] mt-8 leading-relaxed">
              Both parents use this same login page.
              <br />
              Your family calendar is shared automatically.
            </p>
          </div>
        ) : (
          /* ── Password Form ── */
          <div className="animate-scale-in">
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)] text-sm mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-6 shadow-[var(--shadow-card)]">
              {/* Selected parent avatar */}
              {(() => {
                const idx = members.findIndex((m) => m.id === selectedParent.id);
                const accent = CARD_ACCENTS[idx >= 0 ? idx % CARD_ACCENTS.length : 0];
                const initial = selectedParent.full_name.charAt(0).toUpperCase();

                return (
                  <div
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-4 ${accent.avatar}`}
                  >
                    {initial}
                  </div>
                );
              })()}

              <h2 className="font-display text-xl font-semibold text-[var(--color-text)] mb-6">
                Sign in as {selectedParent.full_name}
              </h2>

              <div className="space-y-3">
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-faint)]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoFocus
                    className="w-full pl-10 pr-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-xl text-[var(--color-text)] text-sm placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[rgba(56,56,56,0.12)] transition-all"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSignIn();
                    }}
                  />
                </div>

                {error && (
                  <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                    {error}
                  </div>
                )}

                <button
                  onClick={handleSignIn}
                  disabled={loading || !password}
                  className="w-full py-3 rounded-xl bg-[var(--color-accent)] text-white text-sm font-semibold shadow-lg shadow-[var(--shadow-card)] hover:shadow-[rgba(56,56,56,0.25)] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
