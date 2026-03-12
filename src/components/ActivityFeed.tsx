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
  const colors: Record<string, string> = {
    created: "bg-[var(--color-tag-created-bg)] text-[var(--color-tag-created-text)]",
    updated: "bg-[var(--color-tag-updated-bg)] text-[var(--color-tag-updated-text)]",
    deleted: "bg-[var(--color-tag-deleted-bg)] text-red-400",
  };

  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
        colors[action] || "bg-[var(--color-input)] text-[var(--color-text-muted)]"
      }`}
    >
      {action}
    </span>
  );
}

export default function ActivityFeed({
  logs,
  loading,
  currentUserId,
  icalToken,
}: ActivityFeedProps) {
  return (
    <div className="w-72 shrink-0 self-start sticky top-4">
      {/* Notification log */}
      <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] p-5 mb-4">
        <h3 className="font-display text-sm text-[var(--color-text)] mb-3">
          📧 Recent Activity
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
        ) : logs.length === 0 ? (
          <p className="text-xs text-[var(--color-text-faint)] leading-relaxed">
            No activity yet. Changes to events will appear here with email
            notifications sent to the other parent.
          </p>
        ) : (
          <div className="space-y-0.5">
            {logs.map((log) => {
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
                    {!isMe && " → email notification sent"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* iCal subscribe info */}
      <div className="bg-[var(--color-surface)]/30 rounded-2xl border border-[var(--color-border)] p-5">
        <h3 className="font-display text-sm text-[var(--color-text)] mb-2">
          📤 iCal Feed
        </h3>
        <p className="text-[11px] text-[var(--color-text-faint)] leading-relaxed mb-3">
          Subscribe from Apple Calendar, Google Calendar, or Outlook to see
          events in your preferred app.
        </p>
        {icalToken ? (
          <div className="p-2.5 bg-[var(--color-input)] rounded-lg">
            <code className="text-[9px] text-[var(--color-text-faint)] break-all font-mono leading-relaxed">
              {typeof window !== "undefined"
                ? `${window.location.origin}/api/ical?token=${icalToken}`
                : `/api/ical?token=${icalToken}`}
            </code>
          </div>
        ) : (
          <div className="text-[10px] text-[var(--color-text-faint)] italic">
            iCal token not configured yet
          </div>
        )}
      </div>
    </div>
  );
}
