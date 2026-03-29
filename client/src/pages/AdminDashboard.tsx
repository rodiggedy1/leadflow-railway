/**
 * AdminDashboard — Leads funnel monitor for Maids in Black
 *
 * Shows all conversation sessions with stage badges, lead details,
 * quoted prices, selected slots, addresses, and time elapsed.
 * Supports date range filtering and stage filtering.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import NotificationBell from "@/components/NotificationBell";
import { triggerTestChime } from "@/hooks/useNewReplyNotifier";
import SharedConversationDrawer, { DrawerSession, Stage, STAGE_CONFIG, OUTCOME_STAGES, StageBadge, timeAgo, formatPhone, computeTotalQuote, toLocalDateInput, getSourceBadge, getLanguageBadge } from "@/components/ConversationDrawer";
import { useLeadReplyNotifier } from "@/hooks/useLeadReplyNotifier";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  Search,
  Phone,
  User,
  DollarSign,
  Clock,
  MapPin,
  Calendar,
  X,
  UserCheck,
  CheckCircle2,
  PhoneCall,
  Users,
  UserPlus,
  KeyRound,
  ShieldOff,
  ShieldCheck,
  Loader2,
  Bot,
  LogIn,
  Lock,
  Trophy,
  Medal,
  TrendingUp,
  Trash2,
  Send,
  BotOff,
  Wifi,
  WifiOff,
  RotateCcw,
  Zap,
  Activity,
  Columns,
  MessageSquare,
  Mic,
  MicOff,
  Volume2,
  PlayCircle,
  Eye,
  PhoneIncoming,
  Star,
  ClipboardCheck,
  Settings,
  LayoutGrid,
  ChevronDown,
  Pencil,
  Check,
  StickyNote,
  Bell,
  Sparkles,
  BarChart2,
  ChevronRight,
  Headphones,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { calculateExtrasTotal } from "@shared/extras";
import { ADMIN_PAGES } from "@shared/const";
import SmsSimulator from "@/components/SmsSimulator";
import SmsComposeBox from "@/components/SmsComposeBox";
import MessageDateSeparator, { formatMsgDate, isDifferentDay } from "@/components/MessageDateSeparator";
import SourceBreakdownChart from "@/components/SourceBreakdownChart";
import KanbanBoard from "@/components/KanbanBoard";
import AdminHeader, { WidgetHealthBadge, WebhookHealthBadge, SyncHealthBadge, QualityWidget } from "@/components/AdminHeader";
import { FollowUpReminderToast } from "@/components/FollowUpReminderToast";
import CallGuide from "@/components/CallGuide";
// ── Follow-up Reminder Toastt ───────────────────────────────────────────────────────────────────────────
/**
 * Slide-in toast stack that appears from the bottom-right when leads have
 * a follow-up scheduled for today. Each card is clickable and opens the
 * conversation drawer for that lead.
 */
// ── Sparkline ────────────────────────────────────────────────────────────────
/**
 * Tiny 7-bar sparkline rendered as inline SVG.
 * data: array of 7 numbers (oldest → newest)
 * color: bar fill color
 */
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const bars = data.length === 0 ? Array(7).fill(0) : data;
  const max = Math.max(...bars, 1); // avoid division by zero
  const W = 100;
  const H = 28;
  const gap = 2;
  const barW = (W - gap * (bars.length - 1)) / bars.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full mt-2"
      style={{ height: H }}
      aria-hidden="true"
    >
      {bars.map((v, i) => {
        const barH = Math.max((v / max) * H, v > 0 ? 2 : 0);
        const x = i * (barW + gap);
        const y = H - barH;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={1.5}
            fill={color}
            opacity={i === bars.length - 1 ? 1 : 0.45 + (i / bars.length) * 0.45}
          />
        );
      })}
    </svg>
  );
}

// ── Widget Health Badge — imported from AdminHeader ────────────────────────
// (removed local duplicate — now imported from @/components/AdminHeader)
function _unused_WidgetHealthBadge_placeholder() {
  const { data, isFetching, refetch } = trpc.system.widgetHealth.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 minutes
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
      title={data.ok
        ? `Widget v${data.version ?? '?'} is live. Click to re-check.`
        : `Widget ERROR: ${data.error}. Click to re-check.`
      }
      className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 transition-opacity hover:opacity-80 ${
        data.ok
          ? 'bg-green-50 text-green-700 border-green-200'
          : 'bg-red-50 text-red-700 border-red-200'
      }`}
    >
      {isFetching ? (
        <RotateCcw className="w-3 h-3 animate-spin" />
      ) : data.ok ? (
        <Wifi className="w-3 h-3" />
      ) : (
        <WifiOff className="w-3 h-3" />
      )}
      {data.ok ? `Widget v${data.version ?? '?'}` : 'Widget DOWN'}
    </button>
  );
}

// ── Preview Agent View Button ───────────────────────────────────────────────
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

// ── Quality Widget — imported from AdminHeader ─────────────────────────────
// (removed local duplicate — now imported from @/components/AdminHeader)
function _unused_QualityWidget_placeholder() {
  const { data } = trpc.quality.ratingSmsQueueSummary.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
  const hasPending = data && data.pending > 0;
  return (
    <a
      href="/admin/quality"
      title="Cleaner Quality Dashboard"
      className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-1 transition-all hover:opacity-80 ${
        hasPending
          ? 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse'
          : 'bg-gray-50 text-gray-600 border-gray-200'
      }`}
    >
      <ClipboardCheck className="w-3 h-3" />
      {hasPending ? <span>{data!.pending} SMS pending</span> : <span>Quality</span>}
    </a>
  );
}

// ── AdminDashboardNav — grouped dropdown nav matching AdminHeader ─────────────
type DashTab = "leads" | "pipeline" | "agents" | "leaderboard" | "callbacks";
function AdminDashboardNav({
  activeTab,
  setActiveTab,
  callbackCount,
}: {
  activeTab: DashTab;
  setActiveTab: (t: DashTab) => void;
  callbackCount: number;
}) {
  // Dropdown state for Voice, Staff, Campaigns groups
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [campaignsOpen, setCampaignsOpen] = useState(false);
  const voiceRef = useRef<HTMLDivElement>(null);
  const staffRef = useRef<HTMLDivElement>(null);
  const campaignsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (voiceRef.current && !voiceRef.current.contains(e.target as Node)) setVoiceOpen(false);
      if (staffRef.current && !staffRef.current.contains(e.target as Node)) setStaffOpen(false);
      if (campaignsRef.current && !campaignsRef.current.contains(e.target as Node)) setCampaignsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const tabStyle = (active: boolean) =>
    active
      ? { borderColor: "#000000", color: "#000000", fontWeight: 700 as const }
      : { borderColor: "transparent", color: "#888888" };

  const tabCls = "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap";

  const dropdownCls = "absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[160px] py-1";
  const dropItemCls = (active: boolean) =>
    `flex items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-gray-50 ${
      active ? "font-bold text-black" : "text-gray-600"
    }`;

  const isVoiceActive = activeTab === "callbacks";
  const isStaffActive = activeTab === "agents" || activeTab === "leaderboard";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 border-t" style={{ borderColor: "#E5E5E5" }}>
      {/* Leads */}
      <button onClick={() => setActiveTab("leads")} className={tabCls} style={tabStyle(activeTab === "leads")}>
        <Phone className="w-3.5 h-3.5" /> Leads
      </button>
      {/* Pipeline */}
      <button onClick={() => setActiveTab("pipeline")} className={tabCls} style={tabStyle(activeTab === "pipeline")}>
        <Columns className="w-3.5 h-3.5" /> Pipeline
      </button>
      {/* Voice dropdown */}
      <div ref={voiceRef} className="relative">
        <button onClick={() => setVoiceOpen(v => !v)} className={tabCls} style={tabStyle(isVoiceActive)}>
          <Mic className="w-3.5 h-3.5" /> Voice
          <svg className={`w-3 h-3 transition-transform ${voiceOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        {voiceOpen && (
          <div className={dropdownCls}>
            <button onClick={() => { setActiveTab("callbacks"); setVoiceOpen(false); }} className={dropItemCls(activeTab === "callbacks")}>
              <PhoneIncoming className="w-3.5 h-3.5" /> Callbacks
              {callbackCount > 0 && <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{callbackCount}</span>}
            </button>
            <a href="/admin/calls" className={dropItemCls(false)}><Mic className="w-3.5 h-3.5" /> All Calls</a>
          </div>
        )}
      </div>
      {/* Staff dropdown */}
      <div ref={staffRef} className="relative">
        <button onClick={() => setStaffOpen(v => !v)} className={tabCls} style={tabStyle(isStaffActive)}>
          <Users className="w-3.5 h-3.5" /> Staff
          <svg className={`w-3 h-3 transition-transform ${staffOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        {staffOpen && (
          <div className={dropdownCls}>
            <button onClick={() => { setActiveTab("agents"); setStaffOpen(false); }} className={dropItemCls(activeTab === "agents")}>
              <Users className="w-3.5 h-3.5" /> Team
            </button>
            <button onClick={() => { setActiveTab("leaderboard"); setStaffOpen(false); }} className={dropItemCls(activeTab === "leaderboard")}>
              <Trophy className="w-3.5 h-3.5" /> Leaderboard
            </button>
          </div>
        )}
      </div>
      {/* Campaigns dropdown */}
      <div ref={campaignsRef} className="relative">
        <button onClick={() => setCampaignsOpen(v => !v)} className={tabCls} style={tabStyle(false)}>
          <Send className="w-3.5 h-3.5" /> Campaigns
          <svg className={`w-3 h-3 transition-transform ${campaignsOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        {campaignsOpen && (
          <div className={dropdownCls}>
            <a href="/admin/campaigns" className={dropItemCls(false)}><Send className="w-3.5 h-3.5" /> Campaigns</a>
            <a href="/admin/always-on" className={dropItemCls(false)}><Zap className="w-3.5 h-3.5" /> Always-On</a>
          </div>
        )}
      </div>
      {/* Happiness */}
      <a href="/admin/completed-jobs" className={tabCls} style={tabStyle(false)}>
        <Star className="w-3.5 h-3.5" /> Happiness
      </a>
      {/* Jobs */}
      <a href="/admin/quality" className={tabCls} style={tabStyle(false)}>
        <ClipboardCheck className="w-3.5 h-3.5" /> Jobs
      </a>
      {/* Settings */}
      <a href="/admin/settings" className={tabCls} style={tabStyle(false)}>
        <Settings className="w-3.5 h-3.5" /> Settings
      </a>
    </div>
  );
}

// ── Admin Login Screen ────────────────────────────────────────────────────────
function AdminLoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const utils = trpc.useUtils();
  const loginMutation = trpc.agents.login.useMutation({
    onSuccess: (data) => {
      if (!data.agent.isAdmin) {
        toast.error("This is the admin panel. Go to /agent for the agent workspace.", { duration: 6000 });
        return;
      }
      toast.success(`Welcome back, ${data.agent.name}!`);
      utils.agents.me.invalidate().then(() => onSuccess());
    },
    onError: (err) => toast.error(err.message || "Login failed"),
  });
  return (
    <div className="hj-theme min-h-screen flex items-center justify-center">
      <div className="hj-card p-8 max-w-sm w-full mx-4">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: 'var(--hj-green)', color: '#000' }}>
            <Lock className="w-7 h-7" />
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#0D0D0D' }}>Admin Access</h1>
          <p className="text-sm mt-1" style={{ color: '#888888' }}>Sign in with your admin credentials</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!email || !password) return;
            loginMutation.mutate({ email: email.trim(), password });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input
              id="admin-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loginMutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loginMutation.isPending}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending || !email || !password}
            style={{ backgroundColor: 'var(--hj-green)', color: '#000', fontWeight: 700 }}
          >
            {loginMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</>
            ) : (
              <><LogIn className="w-4 h-4 mr-2" /> Sign In</>
            )}
          </Button>
        </form>
        <p className="text-center text-xs mt-4" style={{ color: '#555555' }}>
          This area is restricted to admin users only.
        </p>
        <p className="text-center text-xs mt-2" style={{ color: '#666666' }}>
          Are you an agent?{" "}
          <a href="/agent" className="underline font-medium" style={{ color: 'var(--hj-green)' }}>Go to Agent Workspace →</a>
        </p>
      </div>
    </div>
  );
}

// ── Stage configuration ────────────────────────────────────────────────────────

// ConversationDrawer and related types/helpers are now in @/components/ConversationDrawer
// Re-export ALL_STAGES for use in AdminDashboard
const ALL_STAGES = (Object.keys(STAGE_CONFIG) as Stage[]).sort(
  (a, b) => STAGE_CONFIG[a].order - STAGE_CONFIG[b].order
);
// Alias for backward compat within this file
const ConversationDrawer = SharedConversationDrawer;


// ── Date filter bar ───────────────────────────────────────────────────────────

type DatePreset = "today" | "yesterday" | "last7" | "last30" | "custom" | "all";

function getPresetDates(preset: DatePreset): { from: string; to: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === "today") {
    return { from: toLocalDateInput(today), to: toLocalDateInput(today) };
  }
  if (preset === "yesterday") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from: toLocalDateInput(y), to: toLocalDateInput(y) };
  }
  if (preset === "last7") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toLocalDateInput(from), to: toLocalDateInput(today) };
  }
  if (preset === "last30") {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from: toLocalDateInput(from), to: toLocalDateInput(today) };
  }
  return null;
}

// ── Main dashboard ────────────────────────────────────────────────────────────

// ── Agent Leaderboard Panel ──────────────────────────────────────────────────

function AgentLeaderboard({ dateRange }: { dateRange: { dateFrom?: string; dateTo?: string } }) {
  const { data: rows = [], isLoading } = trpc.agents.leaderboard.useQuery(dateRange, {
    refetchInterval: 30000,
  });

  const rankColors = ["#E8603C", "#9B59B6", "#3498DB"];
  const rankLabels = ["1st", "2nd", "3rd"];

  return (
    <div className="py-4">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Trophy className="w-5 h-5" style={{ color: "#E8603C" }} />
          Agent Leaderboard
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">Ranked by revenue for the selected date range. Switch the date filter in the header to change the period.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#E8603C" }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No agents found. Add agents in the Agents tab.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((agent, idx) => (
            <div
              key={agent.id}
              className="bg-white rounded-xl border p-4 flex items-center gap-4 shadow-sm"
              style={{ borderColor: idx < 3 ? rankColors[idx] + "40" : "#F0D8D0" }}
            >
              {/* Rank badge */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: idx < 3 ? rankColors[idx] : "#9CA3AF" }}
              >
                {idx < 3 ? rankLabels[idx] : `${idx + 1}`}
              </div>

              {/* Agent info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 truncate">{agent.name}</span>
                  {idx === 0 && agent.bookedRevenue > 0 && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: "#FFF3E0", color: "#E8603C" }}>Top Earner</span>
                  )}
                </div>
                <span className="text-xs text-gray-400">{agent.email}</span>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-6 flex-shrink-0">
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900">{agent.bookedCount}</div>
                  <div className="text-xs text-gray-400">Jobs Booked</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: "#16a34a" }}>
                    ${agent.bookedRevenue.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400">Revenue</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-900">{agent.conversionRate}%</div>
                  <div className="text-xs text-gray-400">Conv. Rate</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-gray-500">{agent.leadsAssigned}</div>
                  <div className="text-xs text-gray-400">Assigned</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agent Management Panel ───────────────────────────────────────────────────

function AgentManagement() {
  const utils = trpc.useUtils();
  const { data: agentList = [], isLoading } = trpc.agents.list.useQuery();
  const { data: perf = [] } = trpc.agents.performance.useQuery();
  const { data: callStats = [] } = trpc.agents.callAssistStats.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ id: number; name: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [permissionsTarget, setPermissionsTarget] = useState<{ id: number; name: string; pagePermissions: string[] | null } | null>(null);
  const [editingPerms, setEditingPerms] = useState<string[]>([]);

  const createMutation = trpc.agents.create.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.success("Agent account created!");
      setShowCreate(false);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewPassword2("");
    },
    onError: (e) => toast.error(e.message),
  });

  const setActiveMutation = trpc.agents.setActive.useMutation({
    onSuccess: () => utils.agents.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const resetPasswordMutation = trpc.agents.resetPassword.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.success("Password reset!");
      setResetTarget(null);
      setResetPw("");
    },
    onError: (e) => toast.error(e.message),
  });

  const setPagePermissionsMutation = trpc.agents.setPagePermissions.useMutation({
    onSuccess: () => {
      utils.agents.list.invalidate();
      toast.success("Page permissions updated!");
      setPermissionsTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const callStatsMap = new Map(callStats.map(r => [r.id, r]));
  const leaderboard = [...perf]
    .sort((a, b) => b.bookingsThisWeek - a.bookingsThisWeek || b.callsThisWeek - a.callsThisWeek)
    .map(agent => ({
      ...agent,
      callAssist: callStatsMap.get(agent.id) ?? { totalCalls: 0, callsToday: 0, callBookings: 0, callRevenue: 0, callConversionRate: 0 },
    }));
  const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

  return (
    <div className="py-2">

      {/* Agent Performance Stats */}
      {leaderboard.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-gray-900">Agent Performance</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4">All-time stats · Response time = avg minutes from lead in to first call · Color: green &lt;1h, amber &lt;4h, red &gt;4h</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {leaderboard.map((agent, idx) => {
              const medal = medalColors[idx];
              const convColor =
                agent.conversionRate >= 50 ? "#16a34a" :
                agent.conversionRate >= 25 ? "#d97706" : "#6b7280";

              const rt = (agent as any).avgResponseTimeMinutes as number | null;
              const rtLabel = rt === null ? "—" : rt < 60 ? `${rt}m` : `${Math.floor(rt / 60)}h ${rt % 60}m`;
              const rtColor = rt === null ? "#9ca3af" : rt < 60 ? "#16a34a" : rt < 240 ? "#d97706" : "#dc2626";
              const rtBg = rt === null ? "bg-gray-50" : rt < 60 ? "bg-green-50" : rt < 240 ? "bg-amber-50" : "bg-red-50";
              const revenue = (agent as any).revenueBooked as number ?? 0;

              return (
                <div
                  key={agent.id}
                  className="bg-white rounded-2xl border p-4 shadow-sm relative overflow-hidden"
                  style={{ borderColor: idx === 0 ? "#FFD700" : "#F0D8D0" }}
                >
                  {/* Rank badge */}
                  <div
                    className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      backgroundColor: medal ? medal + "22" : "#f3f4f6",
                      color: medal ?? "#9ca3af",
                      border: `1.5px solid ${medal ?? "#e5e7eb"}`,
                    }}
                  >
                    #{idx + 1}
                  </div>

                  <p className="font-semibold text-gray-900 pr-8 truncate">{agent.name}</p>
                  <p className="text-xs text-gray-400 mb-3 truncate">{agent.email}</p>

                  {/* Primary metrics */}
                  <div className="grid grid-cols-2 gap-2 text-center mb-2">
                    <div className="bg-gray-50 rounded-xl py-2">
                      <p className="text-lg font-bold text-gray-900">{agent.totalAssigned}</p>
                      <p className="text-xs text-gray-500">Leads Handled</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl py-2">
                      <p className="text-lg font-bold" style={{ color: convColor }}>{agent.conversionRate}%</p>
                      <p className="text-xs text-gray-500">Conv. Rate</p>
                    </div>
                  </div>

                  {/* Coaching metrics */}
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className={`${rtBg} rounded-xl py-2`}>
                      <p className="text-lg font-bold" style={{ color: rtColor }}>{rtLabel}</p>
                      <p className="text-xs text-gray-500">Avg Response</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl py-2">
                      <p className="text-lg font-bold" style={{ color: "#16a34a" }}>
                        {revenue > 0 ? `$${revenue.toLocaleString()}` : "—"}
                      </p>
                      <p className="text-xs text-gray-500">Revenue Closed</p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                    <span>{agent.callsThisWeek} calls this week</span>
                    <span>{agent.bookingsAllTime} booked all-time</span>
                  </div>
                  {/* Call Assist section */}
                  <div className="mt-2 pt-2 border-t border-cyan-100 bg-cyan-50/60 rounded-xl px-3 py-2">
                    <p className="text-[10px] font-semibold text-cyan-600 uppercase tracking-wide mb-1.5">📞 Call Assist</p>
                    <div className="grid grid-cols-3 gap-1 text-center">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{agent.callAssist.totalCalls}</p>
                        <p className="text-[10px] text-gray-400">Total Calls</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{agent.callAssist.callBookings}</p>
                        <p className="text-[10px] text-gray-400">Booked</p>
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: agent.callAssist.callConversionRate >= 40 ? "#16a34a" : agent.callAssist.callConversionRate >= 20 ? "#d97706" : "#6b7280" }}>
                          {agent.callAssist.callConversionRate}%
                        </p>
                        <p className="text-[10px] text-gray-400">Conv. Rate</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 text-center">
                      {agent.callAssist.callsToday > 0 ? `${agent.callAssist.callsToday} call${agent.callAssist.callsToday > 1 ? "s" : ""} today` : "No calls today"}
                      {agent.callAssist.callRevenue > 0 ? ` · $${agent.callAssist.callRevenue.toLocaleString()} revenue` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent Accounts */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Agent Accounts</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage who can access the agent workspace at /agent</p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          style={{ backgroundColor: "#E8603C", color: "white" }}
          onClick={() => setShowCreate(true)}
        >
          <UserPlus className="w-4 h-4" /> Add Agent
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading agents…
        </div>
      ) : agentList.length === 0 ? (
        <div className="py-12 text-center text-gray-400 bg-white rounded-2xl border" style={{ borderColor: "#F0D8D0" }}>
          <Users className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="font-medium text-gray-600">No agents yet</p>
          <p className="text-sm mt-1">Click "Add Agent" to create the first agent account.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: "#F0D8D0" }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b" style={{ borderColor: "#F0D8D0" }}>
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Email</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Pages</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {agentList.map((agent) => (
                <tr key={agent.id} className="border-t hover:bg-gray-50" style={{ borderColor: "#f3f4f6" }}>
                  <td className="px-4 py-3 font-medium text-gray-900">{agent.name}</td>
                  <td className="px-4 py-3 text-gray-600">{agent.email}</td>
                  <td className="px-4 py-3">
                    {agent.isActive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                        <ShieldCheck className="w-3 h-3" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                        <ShieldOff className="w-3 h-3" /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {agent.isAdmin ? (
                      <span className="text-xs text-gray-400 italic">All pages</span>
                    ) : agent.pagePermissions === null ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                        <LayoutGrid className="w-3 h-3" /> Unrestricted
                      </span>
                    ) : agent.pagePermissions.length === 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">
                        No pages
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">
                        {agent.pagePermissions.length} page{agent.pagePermissions.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(agent.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {!agent.isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs gap-1 text-indigo-600 hover:bg-indigo-50"
                          onClick={() => {
                            setPermissionsTarget({ id: agent.id, name: agent.name, pagePermissions: agent.pagePermissions });
                            setEditingPerms(agent.pagePermissions ?? ADMIN_PAGES.map(p => p.id));
                          }}
                        >
                          <LayoutGrid className="w-3 h-3" /> Pages
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={() => setResetTarget({ id: agent.id, name: agent.name })}
                      >
                        <KeyRound className="w-3 h-3" /> Reset PW
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`h-7 px-2 text-xs gap-1 ${agent.isActive ? "text-red-600 hover:bg-red-50" : "text-green-600 hover:bg-green-50"}`}
                        onClick={() => setActiveMutation.mutate({ agentId: agent.id, isActive: !agent.isActive })}
                        disabled={setActiveMutation.isPending}
                      >
                        {agent.isActive ? (
                          <><ShieldOff className="w-3 h-3" /> Deactivate</>
                        ) : (
                          <><ShieldCheck className="w-3 h-3" /> Activate</>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Agent Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Agent Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Full Name</Label>
              <Input placeholder="Jane Smith" value={newName} onChange={e => setNewName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" placeholder="jane@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Password</Label>
              <Input type="password" placeholder="Min 6 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Confirm Password</Label>
              <Input type="password" placeholder="Repeat password" value={newPassword2} onChange={e => setNewPassword2(e.target.value)} />
            </div>
            {newPassword && newPassword2 && newPassword !== newPassword2 && (
              <p className="text-xs text-red-600">Passwords do not match</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ name: newName, email: newEmail, password: newPassword })}
              disabled={
                createMutation.isPending ||
                !newName || !newEmail || !newPassword ||
                newPassword !== newPassword2
              }
              style={{ backgroundColor: "#E8603C", color: "white" }}
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Create Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetTarget} onOpenChange={() => setResetTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password — {resetTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>New Password</Label>
              <Input type="password" placeholder="Min 6 characters" value={resetPw} onChange={e => setResetPw(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button
              onClick={() => resetTarget && resetPasswordMutation.mutate({ agentId: resetTarget.id, newPassword: resetPw })}
              disabled={resetPasswordMutation.isPending || resetPw.length < 6}
              style={{ backgroundColor: "#E8603C", color: "white" }}
            >
              {resetPasswordMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Page Permissions Dialog */}
      <Dialog open={!!permissionsTarget} onOpenChange={(open) => { if (!open) setPermissionsTarget(null); }}>
        <DialogContent className="max-w-md flex flex-col" style={{ maxHeight: "85vh" }}>
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-indigo-600" />
              Page Access — {permissionsTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 py-2 pr-1">
            <p className="text-xs text-gray-500 mb-4">
              Choose which admin pages this agent can access. Uncheck all to block access entirely.
              Admins always see everything regardless of this setting.
            </p>
            {/* Group pages by category */}
            {Array.from(new Set(ADMIN_PAGES.map(p => p.group))).map(group => (
              <div key={group} className="mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group}</p>
                <div className="space-y-1">
                  {ADMIN_PAGES.filter(p => p.group === group).map(page => {
                    const checked = editingPerms.includes(page.id);
                    return (
                      <label
                        key={page.id}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setEditingPerms(prev =>
                              checked ? prev.filter(id => id !== page.id) : [...prev, page.id]
                            );
                          }}
                          className="w-4 h-4 rounded accent-indigo-600"
                        />
                        <span className="text-sm text-gray-700">{page.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => setEditingPerms(ADMIN_PAGES.map(p => p.id))}
              >
                Select All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs text-red-600 hover:bg-red-50"
                onClick={() => setEditingPerms([])}
              >
                Clear All
              </Button>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t pt-4 mt-2">
            <Button variant="outline" onClick={() => setPermissionsTarget(null)}>Cancel</Button>
            <Button
              onClick={() => permissionsTarget && setPagePermissionsMutation.mutate({
                agentId: permissionsTarget.id,
                pagePermissions: editingPerms,
              })}
              disabled={setPagePermissionsMutation.isPending}
              style={{ backgroundColor: "#4f46e5", color: "white" }}
            >
              {setPagePermissionsMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  // ── Auth state (must come before all other hooks) ────────────────────────────────────
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, staleTime: 0 });
  const isAdmin = meQuery.data?.isAdmin === true;
  const agentPagePermissions = meQuery.data?.pagePermissions ?? null;
  const authChecked = !meQuery.isLoading;
  // hasSession: any agent with a valid session cookie — the single source of truth
  const hasSession = authChecked && !!meQuery.data;
  const handleLoginSuccess = useCallback(() => { meQuery.refetch(); }, [meQuery]);

  // ── Follow-up reminder toasts ──────────────────────────────────────────────────────
  const { data: todayFollowUps = [], refetch: refetchFollowUps } = trpc.leads.getTodayFollowUps.useQuery(undefined, {
    enabled: hasSession,
    refetchInterval: 5 * 60 * 1000, // re-check every 5 minutes
    staleTime: 60 * 1000,
  });

  // ── Dashboard state (all hooks declared unconditionally) ─────────────────────────
  const [activeTab, setActiveTab] = useState<"leads" | "pipeline" | "agents" | "leaderboard" | "callbacks">(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "pipeline" || t === "agents" || t === "leaderboard" || t === "callbacks") return t;
    }
    return "leads";
  });
  const [showSimulator, setShowSimulator] = useState(false);
  const [showCallGuide, setShowCallGuide] = useState(false);
  const [showCompletedCallbacks, setShowCompletedCallbacks] = useState(false);
  const { data: callbackList, refetch: refetchCallbacks } = trpc.voice.listCallbacks.useQuery(
    { includeCompleted: showCompletedCallbacks },
    { enabled: activeTab === "callbacks" }
  );
  const completeCallbackMutation = trpc.voice.completeCallback.useMutation({
    onSuccess: () => refetchCallbacks(),
  });
  const [search, setSearch] = useState("");
  // Read initial stage filter from URL param: /admin?stage=COLD
  const [stageFilter, setStageFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search).get("stage");
      if (p) return p;
    }
    return "all";
  });
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [statsMode, setStatsMode] = useState<'organic' | 'campaign'>('organic');
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<DrawerSession | null>(null);

  const [pipelineDateFilter, setPipelineDateFilter] = useState<"today" | "week" | "month">("month");

  // Compute the active date range to send to the backend
  const dateRange = useMemo(() => {
    if (datePreset === "all") return { dateFrom: undefined, dateTo: undefined };
    if (datePreset === "custom") {
      return { dateFrom: customFrom || undefined, dateTo: customTo || undefined };
    }
    const preset = getPresetDates(datePreset);
    return preset ? { dateFrom: preset.from, dateTo: preset.to } : { dateFrom: undefined, dateTo: undefined };
  }, [datePreset, customFrom, customTo]);

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    refetch,
    isFetching,
  } = trpc.leads.list.useQuery({}, { refetchInterval: 30000, enabled: hasSession });

  // Global new-reply chime — fires for ANY session that gets a new customer reply,
  // regardless of whether a conversation drawer is open.
  useLeadReplyNotifier(sessions);

  // Call recording indicators — lightweight map of sessionId → { hasRecording, hasTranscript, callScore }
  const { data: recordingMap = {} } = trpc.leads.getSessionsWithRecordings.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: hasSession,
  });

  const { data: stats } = trpc.leads.stats.useQuery(dateRange, {
    refetchInterval: 30000,
    enabled: hasSession,
  });

  const { data: visitorStats } = trpc.leads.visitorStats.useQuery(dateRange, {
    refetchInterval: 60000,
    enabled: hasSession,
  });

  const { data: voiceStats } = trpc.voice.stats.useQuery({ days: 30 }, {
    refetchInterval: 300_000,
    enabled: hasSession,
  });

  const { data: dailyTrend = [] } = trpc.leads.dailyTrend.useQuery(undefined, {
    refetchInterval: 300_000, // refresh every 5 minutes
    enabled: hasSession,
  });

  const { data: sourceBreakdown = [], isLoading: sourceBreakdownLoading } = trpc.leads.sourceBreakdown.useQuery(dateRange, {
    refetchInterval: 60000,
    enabled: hasSession,
  });

  // Agent list for assignment dropdown in the drawer (admin only)
  const { data: agentListForDrawer = [] } = trpc.agents.list.useQuery(undefined, {
    enabled: isAdmin,
  });

  // ── Activity feed → open drawer by session ID ────────────────────────────────
  const trpcUtils = trpc.useUtils();
  const handleSessionOpen = useCallback(async (sessionId: number) => {
    // First check if the session is already in the loaded list
    const existing = sessions.find(s => s.id === sessionId);
    if (existing) {
      setSelectedSession(existing as unknown as DrawerSession);
      return;
    }
    // Otherwise fetch it directly
    try {
      const session = await trpcUtils.leads.getById.fetch({ id: sessionId });
      if (session) {
        setSelectedSession(session as unknown as DrawerSession);
      }
    } catch (err) {
      console.error("[ActivityFeed] Failed to load session", sessionId, err);
    }
  }, [sessions, trpcUtils]);

  // Track which tab to open when auto-opening the drawer from a URL param
  const [drawerInitialTab, setDrawerInitialTab] = useState<"conversation" | "flow" | "performance" | undefined>(undefined);

  // Auto-open session drawer when ?session=<id> is in the URL (e.g. from Command Chat links)
  // ?tab=sms scrolls to the SMS compose box inside the conversation tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlSessionId = params.get("session");
    if (!urlSessionId) return;
    const id = parseInt(urlSessionId, 10);
    if (isNaN(id)) return;
    // Wait until sessions are loaded before trying to open
    if (sessions.length === 0) return;
    const tab = params.get("tab");
    setDrawerInitialTab(tab === "sms" ? "conversation" : undefined);
    handleSessionOpen(id);
    // Remove the params from the URL without triggering a navigation
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.delete("tab");
    window.history.replaceState({}, "", url.toString());
  }, [sessions, handleSessionOpen]);

  // Collect unique agent names for the agent filter dropdown (declared unconditionally)
  const agentNames = useMemo(() => {
    const names = new Set<string>();
    sessions.forEach(s => {
      if (s.assignedAgentName) names.add(s.assignedAgentName);
    });
    return Array.from(names).sort();
  }, [sessions]);

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      const matchesStage = stageFilter === "all" || s.stage === stageFilter;
      const matchesAgent =
        agentFilter === "all" ||
        (agentFilter === "unassigned" && !s.assignedAgentId) ||
        s.assignedAgentName === agentFilter;
      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "reactivation" && s.leadSource === "reactivation") ||
        (sourceFilter === "widget" && s.leadSource === "widget") ||
        (sourceFilter === "voice" && s.leadSource === "voice") ||
        (sourceFilter === "always-on" && (s.leadSource?.startsWith("always-on:") ?? false)) ||
        (sourceFilter === "bark" && s.leadSource === "bark") ||
        (sourceFilter === "email" && s.leadSource === "email") ||
        (sourceFilter === "form" && (s.leadSource === "form" || !s.leadSource));
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        (s.leadName ?? "").toLowerCase().includes(q) ||
        s.leadPhone.includes(q) ||
        (s.serviceType ?? "").toLowerCase().includes(q) ||
        (s.address ?? "").toLowerCase().includes(q) ||
        (s.assignedAgentName ?? "").toLowerCase().includes(q);
      return matchesStage && matchesAgent && matchesSource && matchesSearch;
    });
  }, [sessions, stageFilter, agentFilter, sourceFilter, search]);

  const unhandledCount = stats?.byStage?.["UNHANDLED"] ?? 0;

  // ── Auth guards (after ALL hooks) ─────────────────────────────────────────────────────
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FFF8F5" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#E8603C" }} />
      </div>
    );
  }

  // Allow through: any agent with a valid session (AdminPageGuard handles page-level permissions)
  if (!hasSession) {
    return <AdminLoginScreen onSuccess={handleLoginSuccess} />;
  }

  const DATE_PRESETS: { value: DatePreset; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last7", label: "Last 7 days" },
    { value: "last30", label: "Last 30 days" },
    { value: "custom", label: "Custom range" },
  ];

  return (
    <div className="min-h-screen hj-theme">
      {/* Daily recap modal — shows once per day after login */}


      {/* Follow-up reminder toasts — slide in from bottom-right for today's due follow-ups */}
      <FollowUpReminderToast
        leads={todayFollowUps}
        onOpen={handleSessionOpen}
        onDismiss={() => refetchFollowUps()}
      />

      {/* Top bar — unified AdminHeader (includes AI Center + all nav) */}
      <AdminHeader
        activeTab={activeTab === "callbacks" ? "callbacks" : activeTab === "agents" ? "agents" : activeTab === "leaderboard" ? "leaderboard" : activeTab === "pipeline" ? "pipeline" : "leads"}
        pagePermissions={agentPagePermissions}
        isAdmin={isAdmin}
        onSessionOpen={handleSessionOpen}
        followUpCount={todayFollowUps.length}
        onCallGuide={() => setShowCallGuide(true)}
        rightExtra={
          <>
            {unhandledCount > 0 && activeTab === "leads" && (
              <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 border border-red-200 text-xs font-semibold px-3 py-1.5 rounded-full">
                ⚠ {unhandledCount} need{unhandledCount === 1 ? "s" : ""} review
              </span>
            )}
            {activeTab === "leads" && (
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            )}
          </>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === "agents" && <AgentManagement />}
        {activeTab === "leaderboard" && <AgentLeaderboard dateRange={dateRange} />}
        {showSimulator && (
          <div className="py-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">AI Simulator</h2>
                <p className="text-sm text-gray-500 mt-0.5">Test Madison's responses in real time. Configure the lead context on the left, then type as if you were the lead.</p>
              </div>
              <button
                onClick={() => setShowSimulator(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="Close simulator"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <SmsSimulator />
          </div>
        )}
        {activeTab === "pipeline" && (
          <div className="py-4">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">Lead Pipeline</h2>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: "#a3e635", color: "#000" }}>Live</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {(["today", "week", "month"] as const).map((f) => {
                  const label = f === "today" ? "Today" : f === "week" ? "This Week" : "This Month";
                  const isActive = pipelineDateFilter === f;
                  return (
                    <button
                      key={f}
                      onClick={() => setPipelineDateFilter(f)}
                      className="px-4 py-1.5 text-xs font-semibold transition-all"
                      style={isActive
                        ? { backgroundColor: "#a3e635", color: "#000", border: "1.5px solid #a3e635", borderRadius: "6px" }
                        : { backgroundColor: "transparent", color: "#6b7280", border: "1.5px solid #d1d5db", borderRadius: "6px" }
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Stats bar */}
            {(() => {
              const allLeads = (sessions ?? []) as Parameters<typeof KanbanBoard>[0]['leads'];
              const now = Date.now();
              const filtered = allLeads.filter(l => {
                if (!l.createdAt) return false;
                const t = new Date(l.createdAt).getTime();
                if (pipelineDateFilter === "today") return now - t < 86400000;
                if (pipelineDateFilter === "week") return now - t < 7 * 86400000;
                return now - t < 31 * 86400000;
              });
              const totalLeads = filtered.length;
              const totalPipeline = filtered.reduce((sum, l) => sum + (parseInt(l.quotedPrice ?? "0", 10) || 0), 0);
              const booked = filtered.filter(l => l.stage === "BOOKED" || l.stage === "COMPLETED");
              const bookedValue = booked.reduce((sum, l) => sum + (parseInt(l.quotedPrice ?? "0", 10) || 0), 0);
              const checkingAvail = filtered.filter(l => l.stage === "AVAILABILITY").length;
              return (
                <div className="flex items-center gap-5 mb-4 text-sm text-gray-700 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-gray-400" />
                    <strong>{totalLeads}</strong>
                    <span className="text-gray-400">leads</span>
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-gray-400" />
                    <strong>${totalPipeline.toLocaleString()}</strong>
                    <span className="text-gray-400">total pipeline</span>
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <strong className="text-emerald-600">${bookedValue.toLocaleString()}</strong>
                    <span className="text-gray-400">booked</span>
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: "#f97316" }}>{checkingAvail}</span>
                    <span className="text-gray-400">quoted</span>
                  </span>
                </div>
              );
            })()}
            <KanbanBoard
              leads={(sessions ?? []) as Parameters<typeof KanbanBoard>[0]['leads']}
              onCardClick={lead => setSelectedSession(lead as unknown as DrawerSession)}
              onStageChange={() => { void refetch(); }}
              dateFilter={pipelineDateFilter}
            />
          </div>
        )}
        {activeTab === "callbacks" && (
          <div className="py-4">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Callback Requests</h2>
                <p className="text-sm text-gray-500 mt-0.5">Callers who asked to be called back. Mark as completed after you've reached them.</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showCompletedCallbacks}
                  onChange={e => setShowCompletedCallbacks(e.target.checked)}
                  className="rounded"
                />
                Show completed
              </label>
            </div>
            {!callbackList || callbackList.length === 0 ? (
              <div className="bg-white rounded-2xl border p-12 text-center" style={{ borderColor: "#F0D8D0" }}>
                <PhoneIncoming className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500 font-medium">No pending callbacks</p>
                <p className="text-sm text-gray-400 mt-1">When callers request a callback, they'll appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {callbackList.map(cb => {
                  const durationLabel = cb.callDurationSeconds
                    ? `${Math.floor(cb.callDurationSeconds / 60)}:${String(cb.callDurationSeconds % 60).padStart(2, "0")}`
                    : null;
                  const outcomeColors: Record<string, string> = {
                    booked: "bg-emerald-100 text-emerald-700",
                    quote_given: "bg-blue-100 text-blue-700",
                    faq_answered: "bg-violet-100 text-violet-700",
                    callback_requested: "bg-yellow-100 text-yellow-700",
                    no_action: "bg-gray-100 text-gray-500",
                  };
                  return (
                    <div
                      key={cb.id}
                      className={`bg-white rounded-2xl border p-5 space-y-3 ${
                        cb.completed ? "opacity-60" : ""
                      }`}
                      style={{ borderColor: cb.completed ? "#e5e7eb" : "#F0D8D0" }}
                    >
                      {/* Header */}
                      <div className="flex items-start gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                          style={{ backgroundColor: cb.completed ? "#f3f4f6" : "#FFF0EB" }}
                        >
                          <PhoneIncoming
                            className="w-5 h-5"
                            style={{ color: cb.completed ? "#9ca3af" : "#E8603C" }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900">
                              {cb.callerName ?? cb.callerPhone}
                            </span>
                            {cb.callerName && (
                              <span className="text-sm text-gray-400">{cb.callerPhone}</span>
                            )}
                            {cb.callOutcome && (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                outcomeColors[cb.callOutcome] ?? "bg-gray-100 text-gray-600"
                              }`}>
                                {cb.callOutcome.replace(/_/g, " ")}
                              </span>
                            )}
                            {cb.completed && (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                Done by {cb.completedByAgentName}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Preferred: <strong className="text-gray-600 ml-0.5">{cb.preferredCallbackTime}</strong>
                            </span>
                            {durationLabel && (
                              <span className="flex items-center gap-1">
                                <Mic className="w-3 h-3" />
                                {durationLabel} call
                              </span>
                            )}
                            <span>{new Date(cb.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                          </div>
                        </div>
                        {!cb.completed && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0 gap-1.5 text-xs"
                            style={{ borderColor: "#E8603C", color: "#E8603C" }}
                            disabled={completeCallbackMutation.isPending}
                            onClick={() => {
                              const agentName = (window as unknown as { __agentName?: string }).__agentName ?? "Admin";
                              completeCallbackMutation.mutate({ id: cb.id, completedByAgentName: agentName });
                            }}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Mark Done
                          </Button>
                        )}
                      </div>

                      {/* Notes from Madison */}
                      {cb.notes && (
                        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                          {cb.notes}
                        </p>
                      )}

                      {/* Call summary */}
                      {cb.callSummary && (
                        <p className="text-sm text-gray-600 leading-relaxed bg-orange-50 rounded-xl px-4 py-3">
                          {cb.callSummary}
                        </p>
                      )}

                      {/* Recording */}
                      {cb.callRecordingUrl && (
                        <div className="flex items-center gap-2">
                          <a
                            href={cb.callRecordingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            <PlayCircle className="w-3.5 h-3.5" />
                            Listen to recording
                          </a>
                        </div>
                      )}

                      {/* Transcript */}
                      {cb.callTranscript && (
                        <details>
                          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                            View transcript
                          </summary>
                          <div className="mt-2 text-xs text-gray-500 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3 max-h-48 overflow-y-auto">
                            {cb.callTranscript}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {activeTab === "leads" && <>
        <div className="-mx-4 sm:-mx-6 mt-2 px-4 sm:px-6 pt-6 pb-6" style={{ backgroundColor: '#F7F7F7', minHeight: 'calc(100vh - 200px)' }}>
        {/* Summary + date filter row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <div className="flex items-center gap-3">
            {/* Organic / Campaign toggle */}
            <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: '#E5E5E5' }}>
              <button
                onClick={() => setStatsMode('organic')}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={statsMode === 'organic'
                  ? { backgroundColor: '#000000', color: '#FFFFFF' }
                  : { backgroundColor: '#FFFFFF', color: '#666666' }}
              >
                Organic
              </button>
              <button
                onClick={() => setStatsMode('campaign')}
                className="px-3 py-1.5 text-sm font-medium transition-colors"
                style={statsMode === 'campaign'
                  ? { backgroundColor: '#000000', color: '#FFFFFF' }
                  : { backgroundColor: '#FFFFFF', color: '#666666' }}
              >
                Campaign
              </button>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ color: '#0D0D0D', fontFamily: 'Space Grotesk, sans-serif' }}>
                {statsMode === 'organic' ? (stats?.organic?.total ?? 0) : (stats?.campaign?.total ?? 0)}
              </span>
              <span className="text-sm" style={{ color: '#888888' }}>leads</span>
            </div>
          </div>
          {/* Date preset selector */}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setDatePreset(p.value)}
                className="hj-date-btn"
                style={datePreset === p.value ? { backgroundColor: '#000000', borderColor: '#000000', color: '#FFFFFF', fontWeight: 600 } : {}}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range inputs */}
        {datePreset === "custom" && (
          <div className="flex items-center gap-3 mb-5 rounded-xl border p-3" style={{ backgroundColor: '#F7F7F7', borderColor: '#E5E5E5' }}>
            <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-sm text-gray-600">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2"
                style={{ borderColor: "#e5e7eb" }}
              />
              <label className="text-sm text-gray-600">To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2"
                style={{ borderColor: "#e5e7eb" }}
              />
              {(customFrom || customTo) && (
                <button
                  onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Summary metrics row — Visitors → Leads → Booked → Revenue + Voice */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {/* Visitors */}
            <div className="hj-metric-card">
              <span className="hj-metric-label">Visitors</span>
              <span className="hj-metric-value">{(visitorStats?.visitors ?? 0).toLocaleString()}</span>
              <span className="hj-metric-sub">page views in range</span>
              <Sparkline data={dailyTrend.map(d => d.visitors)} color="#c8ff00" />
            </div>
            {/* Leads — scoped to statsMode */}
            {(() => {
              const view = statsMode === 'organic' ? stats.organic : stats.campaign;
              const leadsTotal = view?.total ?? 0;
              return (
                <div className="hj-metric-card hj-metric-card hj-metric-card--accent">
                  <span className="hj-metric-label">Leads</span>
                  <span className="hj-metric-value hj-metric-value--accent">{leadsTotal.toLocaleString()}</span>
                  <span className="hj-metric-sub">
                    {statsMode === 'organic' && visitorStats?.visitors
                      ? `${((leadsTotal / visitorStats.visitors) * 100).toFixed(1)}% visitor → lead`
                      : statsMode === 'campaign' ? 'campaign replies' : 'form submissions'}
                  </span>
                  <Sparkline data={dailyTrend.map(d => d.leads)} color="#f59e0b" />
                </div>
              );
            })()}

            {/* Jobs Booked — scoped to statsMode */}
            {(() => {
              const view = statsMode === 'organic' ? stats.organic : stats.campaign;
              const bookedCnt = view?.bookedCount ?? 0;
              const leadsTotal = view?.total ?? 0;
              const convRate = view?.conversionRate ?? 0;
              return (
                <div className="hj-metric-card">
                  <span className="hj-metric-label">Jobs Booked</span>
                  <span className="hj-metric-value">{bookedCnt}</span>
                  <span className="hj-metric-sub">{leadsTotal > 0 ? `${convRate}% lead → booked` : 'no leads yet'}</span>
                  <Sparkline data={dailyTrend.map(d => d.booked)} color="#c8ff00" />
                </div>
              );
            })()}

            {/* Booked Revenue — scoped to statsMode */}
            {(() => {
              const view = statsMode === 'organic' ? stats.organic : stats.campaign;
              const rev = view?.bookedRevenue ?? 0;
              const bookedCnt = view?.bookedCount ?? 0;
              // Source breakdown: for organic mode use revenueBySource; for campaign show single bar
              const rbs = stats.revenueBySource as Record<string, number> | undefined;
              const organicSources = [
                { key: 'form', label: 'Form', color: '#059669' },
                { key: 'widget', label: 'Widget', color: '#0d9488' },
              ];
              return (
                <div className="hj-metric-card hj-metric-card hj-metric-card--accent">
                  <span className="hj-metric-label">Booked Revenue</span>
                  <span className="hj-metric-value hj-metric-value--accent">${rev.toLocaleString()}</span>
                  {/* Source breakdown bar — organic mode only */}
                  {statsMode === 'organic' && rbs && rev > 0 && (() => {
                    return (
                      <div className="mt-1 space-y-1">
                        <div className="flex h-2 rounded-full overflow-hidden gap-px">
                          {organicSources.map(s => {
                            const pct = rev > 0 ? ((rbs[s.key] ?? 0) / rev) * 100 : 0;
                            return pct > 0 ? (
                              <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} />
                            ) : null;
                          })}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {organicSources.filter(s => (rbs[s.key] ?? 0) > 0).map(s => (
                            <span key={s.key} className="flex items-center gap-1 text-xs" style={{ color: '#059669', opacity: 0.85 }}>
                              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                              {s.label}: ${(rbs[s.key] ?? 0).toLocaleString()}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {!(statsMode === 'organic' && rbs && rev > 0) && (
                    <span className="hj-metric-sub">from {bookedCnt} job{bookedCnt !== 1 ? 's' : ''}</span>
                  )}
                  <Sparkline data={dailyTrend.map(d => d.booked)} color="#c8ff00" />
                </div>
              );
            })()}
            {/* Voice Calls */}
            <div className="hj-metric-card">
              <span className="hj-metric-label">AI Voice Calls</span>
              <span className="hj-metric-value">{(voiceStats?.totalCalls ?? 0).toLocaleString()}</span>
              <span className="hj-metric-sub">{voiceStats?.totalCalls ? `${voiceStats.conversionRate}% booked · avg ${Math.floor((voiceStats.avgDurationSeconds ?? 0) / 60)}:${String((voiceStats.avgDurationSeconds ?? 0) % 60).padStart(2, '0')}` : 'no calls yet'}</span>
              <Sparkline data={voiceStats?.dailyTrend?.map(d => d.count) ?? Array(7).fill(0)} color="#c8ff00" />
            </div>
          </div>
        )}

        {/* Search + stage filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#888888' }} />
            <Input
              placeholder="Search name, phone, service…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 hj-input"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-44 hj-select">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {ALL_STAGES.map(stage => (
                <SelectItem key={stage} value={stage}>
                  {STAGE_CONFIG[stage].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="w-44 hj-select">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {agentNames.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-40 hj-select">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="form">Quote Form</SelectItem>
              <SelectItem value="widget">Widget</SelectItem>
              <SelectItem value="email">Google Ads Form</SelectItem>
              <SelectItem value="voice">Google Ads Call</SelectItem>
              <SelectItem value="reactivation">Campaign</SelectItem>
              <SelectItem value="always-on">Always-On</SelectItem>
              <SelectItem value="bark">Bark</SelectItem>
            </SelectContent>
          </Select>
          {(stageFilter !== "all" || agentFilter !== "all" || sourceFilter !== "all") && (
            <button
              onClick={() => { setStageFilter("all"); setAgentFilter("all"); setSourceFilter("all"); }}
              className="text-xs flex items-center gap-1 self-center"
              style={{ color: '#888888' }}
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
          <span className="text-sm self-center" style={{ color: '#888888' }}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="hj-table-wrap">
          {sessionsLoading ? (
            <div className="py-20 text-center" style={{ color: '#888888' }}>
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" style={{ color: '#111111' }} />
              Loading leads…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center" style={{ color: '#888888' }}>
              <div className="text-4xl mb-3">📋</div>
              <p className="font-medium" style={{ color: '#888888' }}>No leads found</p>
              <p className="text-sm mt-1">
                {sessions.length === 0
                  ? "Leads will appear here once the form is submitted."
                  : "Try adjusting your filters."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hj-table-header">
                    <TableHead className="hj-th pl-4 w-48">Lead</TableHead>
                    <TableHead className="hj-th w-24">Source</TableHead>
                    <TableHead className="hj-th">Service</TableHead>
                    <TableHead className="hj-th w-24">Quote</TableHead>
                    <TableHead className="hj-th w-36">Stage</TableHead>
                    <TableHead className="hj-th w-32">Agent</TableHead>
                    <TableHead className="hj-th w-44">Last Activity</TableHead>
                    <TableHead className="hj-th w-24 pr-4">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(session => {
                    const isBooked = Number(session.isBooked) === 1;
                    const rowBg = isBooked ? 'rgba(191,255,0,0.06)' : '';
                    const accentColor = isBooked ? '#AAFF00' : 'transparent';
                    const recInfo = (recordingMap as Record<number, { hasRecording: boolean; hasTranscript: boolean; callScore: number | null }>)[session.id];
                    return (
                    <TableRow
                      key={session.id}
                      className="cursor-pointer transition-all duration-100 group hj-table-row"
                      style={{ backgroundColor: rowBg, borderLeft: `3px solid ${accentColor}` }}
                      onClick={() => setSelectedSession(session as unknown as DrawerSession)}
                      onMouseEnter={e => { if (!isBooked) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = rowBg; }}
                    >
                      {/* Lead — name + phone + click-to-call */}
                      <TableCell className="py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-sm font-semibold leading-tight" style={{ color: '#111111' }}>
                              {session.leadName ?? <span style={{ color: '#555555', fontWeight: 400 }}>Unknown</span>}
                            </span>
                            <span className="text-xs tabular-nums" style={{ color: '#777' }}>
                              {formatPhone(session.leadPhone)}
                            </span>
                            {/* Call recording / transcript / score badges */}
                            {recInfo?.hasRecording && (
                              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                                  <PhoneIncoming className="w-2.5 h-2.5" /> Call
                                </span>
                                {recInfo.hasTranscript && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                    📝 Transcript
                                  </span>
                                )}
                                {recInfo.callScore != null && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{
                                      background: (recInfo.callScore >= 80 ? '#16a34a' : recInfo.callScore >= 60 ? '#d97706' : '#dc2626') + '18',
                                      color: recInfo.callScore >= 80 ? '#16a34a' : recInfo.callScore >= 60 ? '#d97706' : '#dc2626',
                                    }}>
                                    <BarChart2 className="w-2.5 h-2.5" /> {recInfo.callScore}/100
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Click-to-call + Call Assist — always visible */}
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <a
                              href={`tel:${session.leadPhone}`}
                              onClick={e => e.stopPropagation()}
                              title={`Call ${formatPhone(session.leadPhone)}`}
                              className="flex-shrink-0 p-1.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                            </a>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                const params = new URLSearchParams();
                                if (session.id) params.set('sessionId', String(session.id));
                                if (session.leadName) params.set('name', session.leadName);
                                if (session.leadPhone) params.set('phone', session.leadPhone);
                                if (session.bedrooms) params.set('bedrooms', String(session.bedrooms));
                                if (session.bathrooms) params.set('bathrooms', String(session.bathrooms));
                                if (session.serviceType) params.set('serviceType', session.serviceType);
                                if (session.address) params.set('address', session.address);
                                window.open(`/call-assist?${params.toString()}`, '_blank');
                              }}
                              title="Open Call Assist for this lead"
                              className="flex-shrink-0 p-1.5 rounded-full text-violet-400 hover:text-violet-700 hover:bg-violet-50 transition-colors"
                            >
                              <Headphones className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </TableCell>

                      {/* Source */}
                      <TableCell className="py-2">
                        <div className="flex flex-col gap-1">
                          {getSourceBadge(session.leadSource)}
                          {getLanguageBadge(session.language)}
                        </div>
                      </TableCell>

                      {/* Service — type/frequency */}
                      <TableCell className="py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm leading-tight" style={{ color: '#555555' }}>
                            {session.serviceType ?? <span style={{ color: '#555555' }}>—</span>}
                          </span>
                          {session.serviceType && session.bedrooms && (
                            <span className="text-xs" style={{ color: '#777' }}>
                              {session.serviceType === "Office Cleaning"
                                ? `${session.bedrooms} sqft`
                                : `${String(session.bedrooms).replace(/ Bedrooms?/i, '')} bd${session.bathrooms ? ` · ${String(session.bathrooms).replace(/ Bathrooms?/i, '')} ba` : ''}`
                              }
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Quote — quoted price for form leads, last booking price for campaign leads */}
                      <TableCell className="py-2">
                        {(session.quotedPrice && parseInt(session.quotedPrice, 10) > 0) ? (() => {
                          const total = computeTotalQuote(session.quotedPrice, session.extras);
                          return (
                            <span className="text-sm font-bold tabular-nums" style={{ color: '#111111' }}>
                              ${total}
                            </span>
                          );
                        })() : session.reactivationLastPrice ? (
                          <span className="text-sm font-bold tabular-nums" style={{ color: '#7c3aed' }}>
                            ${session.reactivationLastPrice}
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: '#555555' }}>—</span>
                        )}
                      </TableCell>

                      {/* Stage */}
                      <TableCell className="py-2">
                        <StageBadge stage={session.stage} />
                      </TableCell>

                      {/* Agent — avatar initial + name */}
                      <TableCell className="py-2">
                        {session.assignedAgentName ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{ backgroundColor: '#AAFF00', color: '#000000' }}
                            >
                              {session.assignedAgentName.charAt(0).toUpperCase()}
                            </span>
                            <span className="text-xs leading-tight" style={{ color: '#666666' }}>{session.assignedAgentName}</span>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: '#555555' }}>—</span>
                        )}
                      </TableCell>

                      {/* Last Activity — message preview primary, call note secondary */}
                      <TableCell className="py-2">
                        {session.lastActivityText ? (
                          <div className="flex items-start gap-1.5 max-w-[180px]">
                            {session.lastActivityType === "call" ? (
                              <PhoneCall className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                            ) : (
                              <MessageSquare className="w-3 h-3 shrink-0 mt-0.5" style={{ color: '#888888', opacity: 1 }} />
                            )}
                            <span className="text-xs truncate leading-tight" style={{ color: '#666666' }}>{session.lastActivityText}</span>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: '#555555' }}>—</span>
                        )}
                      </TableCell>

                      {/* When — single relative timestamp + Call Assist hover button */}
                      <TableCell className="py-2 pr-4">
                        <div className="flex items-center gap-2 justify-between">
                          <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: '#777' }}>
                            {(() => {
                              // Prefer lastActivityAt but cap at session.updatedAt to avoid stale timestamps
                              const actAt = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
                              const updAt = session.updatedAt ? new Date(session.updatedAt) : null;
                              const display = actAt && updAt && actAt > updAt ? updAt : (actAt ?? updAt);
                              return display ? timeAgo(display) : '—';
                            })()}
                          </span>

                        </div>
                      </TableCell>

                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Traffic Source Breakdown */}
        <div className="hj-card mt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: '#111111' }}>Traffic Source</h3>
              <p className="text-xs mt-0.5" style={{ color: '#888888' }}>Where your leads are coming from</p>
            </div>
          </div>
          <SourceBreakdownChart data={sourceBreakdown} isLoading={sourceBreakdownLoading} />
        </div>

        <p className="text-xs mt-4 text-center" style={{ color: '#555555' }}>
          Auto-refreshes every 30 seconds · Click any row or stage card to filter · Click a stage card again to clear
        </p>
        </div>
        </>}
      </main>

      {/* ── Sticky footer bar: Quality, Recap, AI Simulator ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center gap-3 py-2 px-4 bg-white/80 backdrop-blur border-t border-gray-100">
        {isAdmin && <QualityWidget enabled={isAdmin} />}

        {/* AI Simulator shortcut */}
        <button
          onClick={() => setShowSimulator(v => !v)}
          title="AI Simulator"
          className={`inline-flex items-center justify-center w-8 h-8 rounded-full border transition-colors ${
            showSimulator
              ? 'border-black text-black bg-[#AAFF00]'
              : 'text-gray-500 border-gray-300 hover:border-gray-500 hover:text-gray-800'
          }`}
        >
          <Bot className="w-4 h-4" />
        </button>
      </div>

      {/* Conversation drawer */}
      {selectedSession && (
        <ConversationDrawer
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          isAdmin={isAdmin}
          agentList={agentListForDrawer}
          onSessionUpdate={(updates) => setSelectedSession(prev => prev ? { ...prev, ...updates } : null)}
          onRefresh={() => refetch()}
          currentAgentName={meQuery.data?.name ?? "Admin"}
          initialTab={drawerInitialTab}
        />
      )}

      {/* Live Call Guide slide-in panel */}
      {showCallGuide && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowCallGuide(false)}>
          <div
            className="relative w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
              <span className="text-sm font-semibold text-violet-700 flex items-center gap-1.5">
                <Phone className="w-4 h-4" />
                Live Call Guide
              </span>
              <button
                onClick={() => setShowCallGuide(false)}
                className="text-gray-400 hover:text-gray-700 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <CallGuide />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
 
