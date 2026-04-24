"use client";

import { EventChangeLog, Profile } from "@/lib/types";
import { format, parseISO } from "@/lib/dates";

interface ActivityFeedProps {
  logs: EventChangeLog[];
  loading: boolean;
  currentUserId: string;
  icalToken?: string | null;
}

function ActionBadge({ action }: { action: string }) {
  // Editorial pills: subtle tinted bg + semantic text color, sharp corners.
  const colors: Record<string, string> = {
    created: "bg-[var(--stone-100)] text-[var(--ink)] border-[var(--border-strong)]",
    updated: "bg-[var(--accent-amber-tint)] text-[var(--accent-amber)] border-[var(--accent-amber)]/30",
    deleted: "bg-[var(--accent-red-tint)] text-[var(--accent-red)] border-[var(--accent-red)]/30",
  };

  return (
    <span
      className={`text-[9.5px] font-semibold uppercase tracking-[0.08em] px-1.5 py-[1px] rounded-sm border ${
        colors[action] || "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border)]"
      }`}
    >
      {action}
    </span>
  );
}

const MAX_VISIBLE_LOGS = 8;

export default function ActivityFeed({
  logs,
  loading,
  currentUserId,
  icalToken,
}: ActivityFeedProps) {
  const visibleLogs = logs.slice(0, MAX_VISIBLE_LOGS);

  return (
    <div className="w-72 shrink-0 self-start sticky top-4">
      <div className="bg-[var(--bg)] border border-[var(--border-strong)] shadow-[var(--shadow-sm)] p-5">
        <h3 className="font-display text-sm text-[var(--color-text)] mb-3">
          Recent Activity
        </h3>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-3 bg-[var(--color-input)] rounded w-24 mb-1.5" />
                <div className="h-2.5 bg-[var(--color-surface-alt)] rounded w-full mb-1" />
                <div className="h-2 bg-[var(--color-surface-alt)]/60 rounded w-20" />
              </div>
            ))}
          </div>
        ) : visibleLogs.length === 0 ? (
          <p className="text-xs text-[var(--color-text-faint)] leading-relaxed">
            No activity yet. Changes to events will appear here.
          </p>
        ) : (
          <div className="space-y-0.5">
            {visibleLogs.map((log) => {
              const changer = log.changer as any;
              const snapshot = log.event_snapshot as any;
              const isMe = log.changed_by === currentUserId;

              return (
                <div
                  key={log.id}
                  className="py-2.5 border-b border-[var(--color-divider)] last:border-0 animate-slide-up"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ActionBadge action={log.action} />
                    <span className="text-[10px] text-[var(--color-text-faint)]">
                      {format(parseISO(log.created_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] font-medium">
                    {snapshot?.title || "Unknown event"}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                    {isMe ? "You" : changer?.full_name || "Co-parent"}
                    {!isMe && " — email notification sent"}
                  </div>
                </div>
              );
            })}
            {logs.length > MAX_VISIBLE_LOGS && (
              <div className="pt-2 text-[10px] text-[var(--color-text-faint)] text-center">
                +{logs.length - MAX_VISIBLE_LOGS} older entries
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
