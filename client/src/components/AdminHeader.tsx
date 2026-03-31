/**
 * AdminHeader — shared header for all admin sub-pages.
 * Renders the full "HeyJade" logo row + grouped nav tabs.
 *
 * Nav structure (7 entries, 3 with dropdowns):
 *   Leads | Pipeline | Voice ▾ | Staff ▾ | Campaigns ▾ | Happiness | Jobs
 *
 * activeTab values: "leads" | "pipeline" | "callbacks" | "calls" |
 *   "agents" | "leaderboard" | "campaigns" | "always-on" |
 *   "completed-jobs" | "quality"
 */
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/NotificationBell";
import { toast } from "sonner";
import {
  Wifi,
  WifiOff,
  RotateCcw,
  Loader2,
  Eye,
  Phone,
  Columns,
  Users,
  Trophy,
  PhoneIncoming,
  Send,
  Star,
  Zap,
  Mic,
  Webhook,
  ClipboardCheck,
  HeartPulse,
  ChevronDown,
  Smile,
  Briefcase,
  Settings,
  BrainCircuit,
  Smartphone,
  Sparkles,
} from "lucide-react";

// ── Widget health badge ───────────────────────────────────────────────────
export function WidgetHealthBadge({ enabled = false }: { enabled?: boolean }) {
  const { data, isFetching, refetch } = trpc.system.widgetHealth.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: false,
    throwOnError: false,
    enabled,
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

// ── OpenPhone Webhook health badge ───────────────────────────────────────
export function WebhookHealthBadge({ enabled = false }: { enabled?: boolean }) {
  const { data, isFetching, refetch } = trpc.system.webhookHealth.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: false,
    throwOnError: false,
    enabled,
  });
  if (!data && isFetching) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 border border-gray-200 rounded-full px-2.5 py-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Webhook…
      </span>
    );
  }
  if (!data) return null;
  return (
    <button
      onClick={() => refetch()}
      title={
        data.ok
          ? `OpenPhone webhook is enabled. Click to re-check.`
          : `Webhook issue: ${data.error}. Click to re-check.`
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
        <Webhook className="w-3 h-3" />
      ) : (
        <WifiOff className="w-3 h-3" />
      )}
      {data.ok ? "SMS Webhook" : "Webhook DOWN"}
    </button>
  );
}

// ── Sync Health badge ────────────────────────────────────────────────────────
export function SyncHealthBadge({ enabled = false }: { enabled?: boolean }) {
  const { data, isFetching, refetch } = trpc.syncHealth.getSummary.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: false,
    throwOnError: false,
    enabled,
  });

  if (!data && isFetching) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 border border-gray-200 rounded-full px-2.5 py-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Sync…
      </span>
    );
  }
  if (!data) return null;

  const l27Status = data.launch27?.status;
  const aoStatus = data.alwaysOn?.status;
  const l27Ok = !l27Status || l27Status === "success" || l27Status === "skipped";
  const aoOk = !aoStatus || aoStatus === "success" || aoStatus === "skipped";
  const isOk = l27Ok && aoOk;

  const tooltip = isOk
    ? `Sync healthy — Launch27: ${l27Status ?? "no runs"}, Always-On: ${aoStatus ?? "no runs"}. Click to re-check.`
    : `Sync issue — Launch27: ${l27Status ?? "no runs"}, Always-On: ${aoStatus ?? "no runs"}. Click to re-check.`;

  return (
    <a
      href="/admin/sync-health"
      onClick={(e) => { e.preventDefault(); refetch(); window.location.href = "/admin/sync-health"; }}
      title={tooltip}
      className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 transition-opacity hover:opacity-80 ${
        isOk
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-red-50 text-red-700 border-red-200 animate-pulse"
      }`}
    >
      {isFetching ? (
        <RotateCcw className="w-3 h-3 animate-spin" />
      ) : (
        <HeartPulse className="w-3 h-3" />
      )}
      {isOk ? "Sync Healthy" : "Sync Issue"}
    </a>
  );
}

// ── Quality Widget (exported for footer use) ────────────────────────────────
export function QualityWidget({ enabled = false }: { enabled?: boolean }) {
  const { data } = trpc.quality.ratingSmsQueueSummary.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: false,
    throwOnError: false,
    enabled,
  });

  const hasPending = data && data.pending > 0;

  return (
    <a
      href="/admin/quality"
      title="Jobs Dashboard"
      className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 transition-all hover:opacity-80 ${
        hasPending
          ? "bg-amber-50 text-amber-700 border-amber-300 animate-pulse"
          : "bg-gray-50 text-gray-600 border-gray-200"
      }`}
    >
      <ClipboardCheck className="w-3 h-3" />
      {hasPending ? (
        <span>{data!.pending} SMS pending</span>
      ) : (
        <span>Jobs</span>
      )}
    </a>
  );
}

// ── Preview Agent View Button ─────────────────────────────────────────────
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

// ── Nav tab type ──────────────────────────────────────────────────────────
export type AdminTab =
  | "leads"
  | "pipeline"
  | "callbacks"
  | "calls"
  | "agents"
  | "leaderboard"
  | "campaigns"
  | "always-on"
  | "campaign-approval"
  | "completed-jobs"
  | "quality"
  | "tracker-flow"
  | "command-center"
  | "settings"
  | "field-management"
  | "reactivation"
  | "review-tracker"
  | "hiring";

// ── Dropdown nav item ─────────────────────────────────────────────────────
interface DropdownItem {
  id: AdminTab;
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface NavEntry {
  id: string;          // unique key; for dropdowns this is the group id
  label: string;
  icon: React.ReactNode;
  // standalone
  href?: string;
  tabId?: AdminTab;
  // dropdown
  children?: DropdownItem[];
}

const NAV_ENTRIES: NavEntry[] = [
  {
    id: "command-center",
    label: "AI Center",
    icon: <BrainCircuit className="w-3.5 h-3.5" />,
    href: "/admin/command-center",
    tabId: "command-center",
  },
  {
    id: "leads",
    label: "Leads",
    icon: <Phone className="w-3.5 h-3.5" />,
    href: "/admin/leads",
    tabId: "leads",
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: <Columns className="w-3.5 h-3.5" />,
    href: "/admin/leads?tab=pipeline",
    tabId: "pipeline",
  },
  {
    id: "voice",
    label: "Voice",
    icon: <Mic className="w-3.5 h-3.5" />,
    children: [
      { id: "callbacks", label: "Callbacks", href: "/admin/leads?tab=callbacks", icon: <PhoneIncoming className="w-3.5 h-3.5" /> },
      { id: "calls",     label: "All Calls", href: "/admin/calls",          icon: <Mic className="w-3.5 h-3.5" /> },
    ],
  },
  {
    id: "staff",
    label: "Staff",
    icon: <Users className="w-3.5 h-3.5" />,
    children: [
      { id: "agents",      label: "Team",        href: "/admin/leads?tab=agents",      icon: <Users className="w-3.5 h-3.5" /> },
      { id: "leaderboard", label: "Leaderboard", href: "/admin/leads?tab=leaderboard", icon: <Trophy className="w-3.5 h-3.5" /> },
    ],
  },
  {
    id: "campaigns-group",
    label: "Campaigns",
    icon: <Send className="w-3.5 h-3.5" />,
    children: [
      { id: "campaigns", label: "Campaigns", href: "/admin/campaigns",  icon: <Send className="w-3.5 h-3.5" /> },
      { id: "always-on", label: "Always-On", href: "/admin/always-on", icon: <Zap className="w-3.5 h-3.5" /> },
      { id: "campaign-approval", label: "Approvals", href: "/admin/campaign-approval", icon: <ClipboardCheck className="w-3.5 h-3.5" /> },
      { id: "reactivation", label: "Reactivation Engine", href: "/admin/reactivation", icon: <Sparkles className="w-3.5 h-3.5" /> },
    ],
  },
  // Happiness nav item hidden — to be redesigned later
  // { id: "completed-jobs", label: "Happiness", icon: <Smile className="w-3.5 h-3.5" />, href: "/admin/completed-jobs", tabId: "completed-jobs" },
  {
    id: "field-management",
    label: "Field Mgmt",
    icon: <Briefcase className="w-3.5 h-3.5" />,
    href: "/admin/field-management",
    tabId: "field-management",
  },
  {
    id: "quality",
    label: "Jobs",
    icon: <ClipboardCheck className="w-3.5 h-3.5" />,
    href: "/admin/quality",
    tabId: "quality",
  },
  {
    id: "tracker-flow",
    label: "Journey",
    icon: <Smartphone className="w-3.5 h-3.5" />,
    href: "/admin/tracker-flow",
    tabId: "tracker-flow",
  },
  {
    id: "review-tracker",
    label: "Reviews",
    icon: <Star className="w-3.5 h-3.5" />,
    href: "/admin/review-tracker",
    tabId: "review-tracker",
  },
  {
    id: "hiring",
    label: "Hiring",
    icon: <Users className="w-3.5 h-3.5" />,
    href: "/admin/hiring",
    tabId: "hiring" as AdminTab,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings className="w-3.5 h-3.5" />,
    href: "/admin/settings",
    tabId: "settings",
  },
];

// ── Voice pending callbacks badge ───────────────────────────────────────
function VoicePendingBadge() {
  const { data } = trpc.voice.listCallbacks.useQuery(
    { includeCompleted: false },
    { refetchInterval: 60_000, staleTime: 55_000, retry: false, throwOnError: false }
  );
  const count = data?.length ?? 0;
  if (count === 0) return null;
  return (
    <span className="ml-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
      {count}
    </span>
  );
}

// ── Dropdown component ────────────────────────────────────────────────────
function NavDropdown({
  entry,
  activeTab,
  allowedPageIds,
}: {
  entry: NavEntry;
  activeTab: AdminTab;
  allowedPageIds: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const isActive = entry.children?.some((c) => c.id === activeTab) ?? false;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleOpen() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
        style={
          isActive
            ? { borderColor: "#000000", color: "#000000", fontWeight: 700 }
            : { borderColor: "transparent", color: "#888888" }
        }
      >
        {entry.icon}
        {entry.label}
        {entry.id === "voice" && <VoicePendingBadge />}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg z-[9999] min-w-[180px] py-1"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {entry.children!.filter(child => allowedPageIds === null || allowedPageIds.includes(child.id)).map((child) => {
            const childActive = child.id === activeTab;
            return (
              <a
                key={child.id}
                href={child.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-50"
                style={
                  childActive
                    ? { color: "#000000", fontWeight: 700 }
                    : { color: "#555555" }
                }
              >
                {child.icon}
                {child.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
interface AdminHeaderProps {
  activeTab: AdminTab;
  rightExtra?: React.ReactNode;
  onSessionOpen?: (sessionId: number) => void;
  /** null = unrestricted (admin or legacy agent). string[] = allowed page IDs. */
  pagePermissions?: string[] | null;
  /** true = full admin (Manus OAuth). false/undefined = agent session only. */
  isAdmin?: boolean;
  /** Number of follow-ups due today — shows orange dot on bell when > 0 */
  followUpCount?: number;
  /** Callback to open the Live Call Guide panel */
  onCallGuide?: () => void;
}

function CallGuideButton() {
  const [, navigate] = useLocation();
  return (
    <button
      onClick={() => navigate("/call-assist")}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
    >
      <Phone className="w-3 h-3" />
      Call Assist
    </button>
  );
}

export default function AdminHeader({ activeTab, rightExtra, onSessionOpen, pagePermissions, isAdmin = false, followUpCount = 0, onCallGuide }: AdminHeaderProps) {
  // Determine which page IDs this agent is allowed to see.
  // null means unrestricted (admin or no restrictions set).
  const allowedPageIds: string[] | null = pagePermissions ?? null;
  const headerRef = (el: HTMLElement | null) => {
    if (el) {
      // Keep CSS variable in sync so detail panels can align below this header
      const update = () => document.documentElement.style.setProperty('--admin-header-height', `${el.offsetHeight}px`);
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
    }
  };

  return (
    <header ref={headerRef} className="bg-white border-b sticky top-0 z-40" style={{ borderColor: "#E5E5E5" }}>
      {/* Logo row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        <a href="/admin/command-center" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#AAFF00" }}
          >
            <span className="text-black text-sm font-bold">J</span>
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-lg leading-tight" style={{ letterSpacing: "-0.02em" }}>
              HeyJade
            </h1>
            <p className="text-xs text-gray-500">Leads Dashboard</p>
          </div>
        </a>
        <div className="flex items-center gap-3">
          {!isAdmin && (
            <a
              href="/agent"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors border border-gray-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              Workspace
            </a>
          )}
          {isAdmin && <WidgetHealthBadge enabled={isAdmin} />}
          {isAdmin && <WebhookHealthBadge enabled={isAdmin} />}
          {isAdmin && <SyncHealthBadge enabled={isAdmin} />}
          {onCallGuide && (
            <CallGuideButton />
          )}
          {rightExtra}
          <NotificationBell onSessionOpen={onSessionOpen} enabled={isAdmin} followUpCount={followUpCount} />
          {isAdmin && <PreviewAgentButton />}
        </div>
      </div>

      {/* Tab navigation */}
      <div
        className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 border-t overflow-x-auto scrollbar-none"
        style={{ borderColor: "#E5E5E5" }}
      >
        {NAV_ENTRIES.map((entry) => {
          if (entry.children) {
            // Filter dropdown children by page permissions
            const visibleChildren = allowedPageIds === null
              ? entry.children
              : entry.children.filter(c => allowedPageIds.includes(c.id));
            if (visibleChildren.length === 0) return null;
            const filteredEntry = { ...entry, children: visibleChildren };
            return (
              <NavDropdown key={entry.id} entry={filteredEntry} activeTab={activeTab} allowedPageIds={allowedPageIds} />
            );
          }
          // Standalone entry: check if allowed
          if (allowedPageIds !== null && entry.tabId && !allowedPageIds.includes(entry.tabId)) return null;
          const isActive = entry.tabId === activeTab;
          return (
            <a
              key={entry.id}
              href={entry.href}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
              style={
                isActive
                  ? { borderColor: "#000000", color: "#000000", fontWeight: 700 }
                  : { borderColor: "transparent", color: "#888888" }
              }
            >
              {entry.icon}
              {entry.label}
            </a>
          );
        })}
      </div>
    </header>
  );
}
