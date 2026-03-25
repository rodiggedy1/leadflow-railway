import { useState, useRef, useEffect } from "react";
import { Bell, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// Event type → icon + color mapping
const EVENT_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  new_lead:           { icon: "📋", color: "text-blue-600",   label: "New Lead"        },
  lead_reply:         { icon: "💬", color: "text-green-600",  label: "Reply"           },
  ai_sms_sent:        { icon: "🤖", color: "text-purple-600", label: "AI SMS"          },
  booking:            { icon: "🎉", color: "text-emerald-600",label: "Booking"         },
  silence_nudge:      { icon: "🔔", color: "text-amber-600",  label: "Auto-Nudge"      },
  scheduled_followup: { icon: "📅", color: "text-orange-600", label: "Follow-Up"       },
  nightly_sync:       { icon: "🔄", color: "text-slate-600",  label: "Sync"            },
  always_on_batch:    { icon: "📤", color: "text-indigo-600", label: "Always-On Batch" },
};

function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

interface NotificationBellProps {
  onSessionOpen?: (sessionId: number) => void;
  /** Only fetch notifications when true (requires Manus OAuth session). */
  enabled?: boolean;
  /** Number of follow-ups due today — shows an orange dot badge when > 0 */
  followUpCount?: number;
}

export default function NotificationBell({ onSessionOpen, enabled = false, followUpCount = 0 }: NotificationBellProps = {}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Poll every 30 seconds for new activity — only when admin is logged in
  const { data, refetch } = trpc.activity.getFeed.useQuery(
    { limit: 50 },
    { refetchInterval: 30_000, refetchIntervalInBackground: false, retry: false, throwOnError: false, enabled }
  );

  const markAllRead = trpc.activity.markAllRead.useMutation({
    onSuccess: () => refetch(),
  });

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Mark all read when opening the panel
  function handleOpen() {
    setOpen(prev => !prev);
    if (!open && (data?.unreadCount ?? 0) > 0) {
      markAllRead.mutate();
    }
  }

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={handleOpen}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        {unreadCount === 0 && followUpCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5 rounded-full border-2 border-white"
            style={{ backgroundColor: "#F97316" }}
            title={`${followUpCount} follow-up${followUpCount > 1 ? "s" : ""} due today`}
          />
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-96 rounded-xl border border-border bg-background shadow-xl overflow-hidden flex flex-col max-h-[560px]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm">Activity Feed</span>
            {items.length > 0 && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => markAllRead.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Feed */}
          <ScrollArea className="h-[480px]">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">No activity yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map(item => {
                  const cfg = EVENT_CONFIG[item.eventType] ?? { icon: "📌", color: "text-foreground", label: item.eventType };
                  const isUnread = item.readAt === null;
                  return (
                    <div
                      key={item.id}
                      className={`flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50 ${isUnread ? "bg-blue-50/40 dark:bg-blue-950/20" : ""} ${onSessionOpen && item.meta?.sessionId ? "cursor-pointer" : ""}`}
                      onClick={() => {
                        const sid = item.meta?.sessionId;
                        if (onSessionOpen && typeof sid === "number") {
                          onSessionOpen(sid);
                          setOpen(false);
                        }
                      }}
                    >
                      {/* Icon */}
                      <div className="flex-shrink-0 mt-0.5 text-lg leading-none">{cfg.icon}</div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium leading-tight ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                            {item.title}
                          </p>
                          <span className="flex-shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                            {timeAgo(item.createdAt)}
                          </span>
                        </div>
                        {item.body && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {item.body}
                          </p>
                        )}
                        <Badge variant="outline" className={`mt-1.5 text-[10px] px-1.5 py-0 h-4 ${cfg.color}`}>
                          {cfg.label}
                        </Badge>
                      </div>

                      {/* Unread dot or clickable arrow */}
                      {onSessionOpen && item.meta?.sessionId ? (
                        <div className="flex-shrink-0 mt-1 text-muted-foreground opacity-50">
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      ) : isUnread ? (
                        <div className="flex-shrink-0 mt-1.5">
                          <div className="h-2 w-2 rounded-full bg-blue-500" />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Footer */}
          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-center">
              <span className="text-xs text-muted-foreground">Showing last {items.length} events · auto-refreshes every 30s</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
