/**
 * AgentNotificationBell — notification bell for the agent workspace.
 * Uses agents.getNotifications (agent cookie auth, not Manus OAuth).
 * Shows recent leads assigned + bookings closed.
 */
import { useState, useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

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

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  booking:  { icon: "🎉", color: "text-emerald-600" },
  new_lead: { icon: "📋", color: "text-blue-600"    },
  default:  { icon: "🔔", color: "text-gray-500"    },
};

export default function AgentNotificationBell({ followUpCount = 0 }: { followUpCount?: number } = {}) {
  const [open, setOpen] = useState(false);
  const [readAt, setReadAt] = useState<Date>(() => new Date(Date.now() - 24 * 60 * 60 * 1000));
  const ref = useRef<HTMLDivElement>(null);

  const { data, refetch } = trpc.agents.getNotifications.useQuery(
    { limit: 30 },
    { refetchInterval: 30_000, refetchIntervalInBackground: false }
  );

  const notifications = data?.notifications ?? [];
  const unreadCount = notifications.filter(n => new Date(n.createdAt) > readAt).length;

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

  function handleOpen() {
    setOpen(prev => !prev);
    if (!open) {
      // Mark all as read by updating the readAt timestamp
      setReadAt(new Date());
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        className="relative h-8 w-8 p-0"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <Badge
            className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
            style={{ backgroundColor: "#E8603C", color: "white", border: "none" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </Badge>
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
        <div className="absolute right-0 top-10 z-50 w-80 bg-white rounded-xl shadow-xl border overflow-hidden" style={{ borderColor: "#F0D8D0" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#F0D8D0" }}>
            <span className="text-sm font-semibold text-gray-900">Notifications</span>
            <button
              onClick={() => { refetch(); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Refresh
            </button>
          </div>

          {/* Notification list */}
          <ScrollArea className="max-h-80">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                No notifications yet
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "#F9F0ED" }}>
                {notifications.map(n => {
                  const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.default;
                  const isUnread = new Date(n.createdAt) > readAt;
                  return (
                    <div
                      key={n.id}
                      className={`px-4 py-3 flex items-start gap-3 ${isUnread ? "bg-orange-50" : "bg-white"}`}
                    >
                      <span className="text-base mt-0.5 flex-shrink-0">{cfg.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold ${cfg.color}`}>{n.title}</p>
                        <p className="text-xs text-gray-700 truncate mt-0.5">{n.body}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                      </div>
                      {isUnread && (
                        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: "#E8603C" }} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
