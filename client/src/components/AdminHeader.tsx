/**
 * AdminHeader — shared header for all admin sub-pages.
 * Renders the full "Maids in Black" logo row + all nav tabs,
 * matching the AdminDashboard header exactly.
 *
 * Usage:
 *   <AdminHeader activeTab="calls" />
 *
 * activeTab values: "leads" | "pipeline" | "agents" | "leaderboard" |
 *   "callbacks" | "campaigns" | "completed-jobs" | "always-on" |
 *   "sync-health" | "calls"
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/NotificationBell";
import { toast } from "sonner";
import {
  Wifi,
  WifiOff,
  RotateCcw,
  Loader2,
  Bot,
  Eye,
  Phone,
  Columns,
  Users,
  Trophy,
  PhoneIncoming,
  Send,
  CheckCircle2,
  Star,
  Zap,
  Activity,
  Mic,
} from "lucide-react";

// ── Widget health badge (same as AdminDashboard) ──────────────────────────
function WidgetHealthBadge() {
  const { data, isFetching, refetch } = trpc.system.widgetHealth.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });
  if (!data && isFetching) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 border border-gray-200 rounded-full px-2.5 py-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Widget…
      </span>
    );
  }
  if (!data) return null;
  return (
    <button
      onClick={() => refetch()}
      title={
        data.ok
          ? `Widget v${data.version ?? "?"} is live. Click to re-check.`
          : `Widget ERROR: ${data.error}. Click to re-check.`
      }
      className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 transition-opacity hover:opacity-80 ${
        data.ok
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      {isFetching ? (
        <RotateCcw className="w-3 h-3 animate-spin" />
      ) : data.ok ? (
        <Wifi className="w-3 h-3" />
      ) : (
        <WifiOff className="w-3 h-3" />
      )}
      {data.ok ? `Widget v${data.version ?? "?"}` : "Widget DOWN"}
    </button>
  );
}

// ── Preview Agent View Button (same as AdminDashboard) ────────────────────
function PreviewAgentButton() {
  const previewMutation = trpc.agents.previewAsAgent.useMutation({
    onSuccess: () => {
      window.open("/agent", "_blank");
    },
    onError: (err) => toast.error(err.message || "Could not open agent preview"),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => previewMutation.mutate()}
      disabled={previewMutation.isPending}
      className="gap-2 text-xs"
      title="Open the agent workspace in a new tab as yourself"
    >
      {previewMutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Eye className="w-3.5 h-3.5" />
      )}
      Agent View
    </Button>
  );
}

// ── Nav tab definitions ───────────────────────────────────────────────────
type AdminTab =
  | "leads"
  | "pipeline"
  | "agents"
  | "leaderboard"
  | "callbacks"
  | "campaigns"
  | "completed-jobs"
  | "always-on"
  | "sync-health"
  | "calls";

const NAV_TABS: {
  id: AdminTab;
  label: string;
  href: string;
  icon: React.ReactNode;
}[] = [
  { id: "leads", label: "Leads", href: "/admin", icon: <Phone className="w-3.5 h-3.5" /> },
  { id: "pipeline", label: "Pipeline", href: "/admin?tab=pipeline", icon: <Columns className="w-3.5 h-3.5" /> },
  { id: "agents", label: "Agents", href: "/admin?tab=agents", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "leaderboard", label: "Leaderboard", href: "/admin?tab=leaderboard", icon: <Trophy className="w-3.5 h-3.5" /> },
  { id: "callbacks", label: "Callbacks", href: "/admin?tab=callbacks", icon: <PhoneIncoming className="w-3.5 h-3.5" /> },
  { id: "campaigns", label: "Campaigns", href: "/admin/campaigns", icon: <Send className="w-3.5 h-3.5" /> },
  { id: "completed-jobs", label: "Reviews", href: "/admin/completed-jobs", icon: <Star className="w-3.5 h-3.5" /> },
  { id: "always-on", label: "Always-On", href: "/admin/always-on", icon: <Zap className="w-3.5 h-3.5" /> },
  { id: "sync-health", label: "Sync Health", href: "/admin/sync-health", icon: <Activity className="w-3.5 h-3.5" /> },
  { id: "calls", label: "All Calls", href: "/admin/calls", icon: <Mic className="w-3.5 h-3.5" /> },
];

// ── Main component ────────────────────────────────────────────────────────
interface AdminHeaderProps {
  /** Which tab to highlight as active */
  activeTab: AdminTab;
  /** Optional extra content for the right side of the logo row */
  rightExtra?: React.ReactNode;
}

export default function AdminHeader({ activeTab, rightExtra }: AdminHeaderProps) {
  return (
    <header className="bg-white border-b sticky top-0 z-40" style={{ borderColor: "#F0D8D0" }}>
      {/* Logo row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <a href="/admin" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#E8603C" }}
          >
            <span className="text-white text-sm font-bold">M</span>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 text-lg leading-tight">Maids in Black</h1>
            <p className="text-xs text-gray-500">Leads Dashboard</p>
          </div>
        </a>
        <div className="flex items-center gap-3">
          <WidgetHealthBadge />
          {rightExtra}
          <NotificationBell />
          <PreviewAgentButton />
        </div>
      </div>

      {/* Tab navigation */}
      <div
        className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 border-t overflow-x-auto"
        style={{ borderColor: "#F0D8D0" }}
      >
        {NAV_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <a
              key={tab.id}
              href={tab.href}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
              style={
                isActive
                  ? { borderColor: "#E8603C", color: "#E8603C" }
                  : { borderColor: "transparent", color: "#6b7280" }
              }
            >
              {tab.icon}
              {tab.label}
            </a>
          );
        })}
      </div>
    </header>
  );
}
