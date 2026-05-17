/**
 * AdminDashboard — Leads funnel monitor for Maids in Black
 *
 * Shows all conversation sessions with stage badges, lead details,
 * quoted prices, selected slots, addresses, and time elapsed.
 * Supports date range filtering and stage filtering.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import NotificationBell from "@/components/NotificationBell";
import { triggerTestChime } from "@/hooks/useNewReplyNotifier";
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
  Wand2,
  CheckCheck,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowUpRight,
  Clock3,
  BadgeCheck,
  Wallet,
  Waypoints,
  FileText,
  AlertTriangle,
  CircleAlert,
  SlidersHorizontal,
  Plus,
  Filter,
  CalendarDays,
  MoreHorizontal,
  AlertCircle,
  Flame,
  PanelRight,
  Inbox,
  SkipForward,
  SkipBack,
  Pause,
  Play,
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
import AdminHeader, { WidgetHealthBadge, WebhookHealthBadge, SyncHealthBadge } from "@/components/AdminHeader";
import { FollowUpReminderToast } from "@/components/FollowUpReminderToast";
import FollowUpsModal from "@/components/FollowUpsModal";
import CallGuide from "@/components/CallGuide";
import PipelineBoard from "@/components/PipelineBoard";
import { getStepLabel, getPhaseName, formatNextSendAt, STEP_PREVIEW } from "@/lib/nurtureUtils";
import { useOpsStream } from "@/hooks/useOpsStream";
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
      {/* Hiring */}
      <a href="/admin/hiring" className={tabCls} style={tabStyle(false)}>
        <User className="w-3.5 h-3.5" /> Hiring
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
  const [isPending, setIsPending] = useState(false);
  const loginMutation = {
    isPending,
    mutate: async ({ email: e, password: p }: { email: string; password: string }) => {
      setIsPending(true);
      try {
        const res = await fetch("/api/agents/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ email: e, password: p }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          toast.error(data.error || "Login failed");
          return;
        }
        if (!data.agent.isAdmin) {
          toast.error("This is the admin panel. Go to /agent for the agent workspace.", { duration: 6000 });
          return;
        }
        toast.success(`Welcome back, ${data.agent.name}!`);
        utils.agents.me.invalidate().then(() => onSuccess());
      } catch {
        toast.error("Login failed. Please try again.");
      } finally {
        setIsPending(false);
      }
    },
  };
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

type Stage =
  | "QUOTE_SENT"
  | "AVAILABILITY"
  | "SLOT_CHOICE"
  | "ADDRESS"
  | "CONFIRMATION"
  | "CALL_SCHEDULED"
  | "DONE"
  | "UNHANDLED"
  | "BOOKED"
  | "FOLLOW_UP_SCHEDULED"
  | "VOICEMAIL"
  | "WIDGET_SIZING"
  | "COLD"
  | "LOST"
  | "YELP_CONTACTED";
const STAGE_CONFIG: Record<
  Stage,
  { label: string; textColor: string; bgColor: string; borderColor: string; order: number }
> = {
  QUOTE_SENT: {
    label: "Quote Sent",
    textColor: "#1d4ed8",
    bgColor: "#dbeafe",
    borderColor: "#bfdbfe",
    order: 1,
  },
  AVAILABILITY: {
    label: "Availability",
    textColor: "#92400e",
    bgColor: "#fef3c7",
    borderColor: "#fde68a",
    order: 2,
  },
  SLOT_CHOICE: {
    label: "Slot Choice",
    textColor: "#9a3412",
    bgColor: "#ffedd5",
    borderColor: "#fed7aa",
    order: 3,
  },
  ADDRESS: {
    label: "Address",
    textColor: "#6b21a8",
    bgColor: "#f3e8ff",
    borderColor: "#e9d5ff",
    order: 4,
  },
  CONFIRMATION: {
    label: "Confirmation",
    textColor: "#134e4a",
    bgColor: "#ccfbf1",
    borderColor: "#99f6e4",
    order: 5,
  },
  CALL_SCHEDULED: {
    label: "Call Scheduled",
    textColor: "#1e3a5f",
    bgColor: "#e0e7ff",
    borderColor: "#c7d2fe",
    order: 6,
  },
  DONE: {
    label: "Done",
    textColor: "#14532d",
    bgColor: "#dcfce7",
    borderColor: "#bbf7d0",
    order: 7,
  },
  UNHANDLED: {
    label: "Needs Review",
    textColor: "#991b1b",
    bgColor: "#fee2e2",
    borderColor: "#fecaca",
    order: 8,
  },
  BOOKED: {
    label: "$ Booked",
    textColor: "#065f46",
    bgColor: "#d1fae5",
    borderColor: "#6ee7b7",
    order: 9,
  },
  FOLLOW_UP_SCHEDULED: {
    label: "🔔 Follow Up",
    textColor: "#7c3aed",
    bgColor: "#f5f3ff",
    borderColor: "#ddd6fe",
    order: 10,
  },
  VOICEMAIL: {
    label: "📞 Voicemail",
    textColor: "#0369a1",
    bgColor: "#e0f2fe",
    borderColor: "#bae6fd",
    order: 11,
  },
  WIDGET_SIZING: {
    label: "Sizing",
    textColor: "#0369a1",
    bgColor: "#e0f2fe",
    borderColor: "#bae6fd",
    order: 0,
  },
  COLD: {
    label: "❄️ Cold",
    textColor: "#334155",
    bgColor: "#f1f5f9",
    borderColor: "#cbd5e1",
    order: 12,
  },
  LOST: {
    label: "😞 Lost",
    textColor: "#6b7280",
    bgColor: "#f3f4f6",
    borderColor: "#d1d5db",
    order: 13,
  },
  YELP_CONTACTED: {
    label: "✅ Contacted via Yelp",
    textColor: "#b91c1c",
    bgColor: "#fff1f2",
    borderColor: "#fecdd3",
    order: 14,
  },
};

const ALL_STAGES = (Object.keys(STAGE_CONFIG) as Stage[]).sort(
  (a, b) => STAGE_CONFIG[a].order - STAGE_CONFIG[b].order
);

// Outcome-level stages shown in drawers — mid-conversation AI stages are hidden but still valid in DB
const OUTCOME_STAGES: Stage[] = [
  "BOOKED",
  "FOLLOW_UP_SCHEDULED",
  "VOICEMAIL",
  "COLD",
  "LOST",
  "YELP_CONTACTED",
];
// ── Helpers ────────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function toLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns the total quote price (base + extras) as a formatted string.
 * Falls back to the base price if extras can't be parsed.
 */
function computeTotalQuote(quotedPrice: string | null, extrasJson: string | null): string | null {
  if (!quotedPrice) return null;
  const base = parseInt(quotedPrice, 10);
  if (isNaN(base)) return quotedPrice;
  if (!extrasJson) return quotedPrice;
  let keys: string[] = [];
  try { keys = JSON.parse(extrasJson); } catch { return quotedPrice; }
  if (!keys.length) return quotedPrice;
  const total = base + calculateExtrasTotal(keys);
  return String(total);
}

// ── Funnel stats bar ──────────────────────────────────────────────────────────

function FunnelStats({
  byStage,
  total,
  onStageClick,
  activeStage,
}: {
  byStage: Record<string, number>;
  total: number;
  onStageClick: (stage: string) => void;
  activeStage: string;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
      {ALL_STAGES.map(stage => {
        const cfg = STAGE_CONFIG[stage];
        const count = byStage[stage] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = activeStage === stage;
        const hasLeads = count > 0;

        return (
          <button
            key={stage}
            onClick={() => onStageClick(isActive ? "all" : stage)}
            className="rounded-xl border p-3 flex flex-col gap-1 text-left transition-all hover:shadow-md focus:outline-none"
            style={{
              backgroundColor: hasLeads ? cfg.bgColor : "#f9fafb",
              borderColor: isActive ? cfg.textColor : hasLeads ? cfg.borderColor : "#e5e7eb",
              borderWidth: isActive ? "2px" : "1px",
              opacity: hasLeads ? 1 : 0.55,
              boxShadow: isActive ? `0 0 0 3px ${cfg.borderColor}` : undefined,
            }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-wide leading-tight"
              style={{ color: hasLeads ? cfg.textColor : "#9ca3af" }}
            >
              {cfg.label}
            </span>
            <span
              className="text-2xl font-bold"
              style={{ color: hasLeads ? cfg.textColor : "#d1d5db" }}
            >
              {count}
            </span>
            <span className="text-xs" style={{ color: hasLeads ? cfg.textColor : "#9ca3af", opacity: 0.7 }}>
              {pct}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Stage badge ───────────────────────────────────────────────────────────────

function StageBadge({ stage }: { stage: string }) {
  const cfg = STAGE_CONFIG[stage as Stage] ?? {
    label: stage,
    textColor: "#374151",
    bgColor: "#f3f4f6",
    borderColor: "#e5e7eb",
  };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium border whitespace-nowrap"
      style={{
        fontSize: '11px',
        backgroundColor: cfg.bgColor,
        borderColor: cfg.borderColor,
        color: cfg.textColor,
      }}
    >
      {cfg.label}
    </span>
  );
}

// ── Conversation history drawer ───────────────────────────────────────────────

type DrawerSession = {
  id: number;
  leadName: string | null;
  leadPhone: string;
  stage: string;
  messageHistory: string;
  selectedSlot: string | null;
  address: string | null;
  quotedPrice: string | null;
  serviceType: string | null;
  extras: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  bookedAmount: number | null;
  isBooked: number;
  aiMode: number;
  // UTM attribution
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  gclid: string | null;
  leadSource: string | null;
  reactivationLastPrice: number | null;
  reactivationDiscountPct: number | null;
  followUpDate: string | null;
  followUpMessage: string | null;
  followUpSent: number;
  language: string | null;
  barkQA: string | null;
  jobFrequency: string | null;
  lastJobDate: string | null;
  lastJobPrice: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  // Nurture fields — optional, populated from leads.list batch query
  nurtureStatus?: 'active' | 'paused';
  nurtureNextStep?: number;
  nurtureNextSendAt?: Date | string | null;
  // Unread flag — true when the most recent inbound message is newer than lastReadAt
  hasUnread?: boolean;
};

/** Returns a flag emoji + language label for non-English sessions */
function getLanguageBadge(language: string | null): React.ReactElement | null {
  if (!language || language === "en") return null;
  const langMap: Record<string, { flag: string; label: string }> = {
    es: { flag: "🇪🇸", label: "Spanish" },
    fr: { flag: "🇫🇷", label: "French" },
    pt: { flag: "🇧🇷", label: "Portuguese" },
    zh: { flag: "🇨🇳", label: "Chinese" },
    ar: { flag: "🇸🇦", label: "Arabic" },
    hi: { flag: "🇮🇳", label: "Hindi" },
    ko: { flag: "🇰🇷", label: "Korean" },
    ja: { flag: "🇯🇵", label: "Japanese" },
    de: { flag: "🇩🇪", label: "German" },
    it: { flag: "🇮🇹", label: "Italian" },
    ru: { flag: "🇷🇺", label: "Russian" },
    vi: { flag: "🇻🇳", label: "Vietnamese" },
    tl: { flag: "🇵🇭", label: "Tagalog" },
    am: { flag: "🇪🇹", label: "Amharic" },
  };
  const info = langMap[language] ?? { flag: "🌐", label: language.toUpperCase() };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
      {info.flag} {info.label}
    </span>
  );
}

/**
 * Maps a leadSource string to a human-readable badge.
 * Handles always-on group types like "always-on:new-one-time" and "always-on-test:dormant".
 */
const SOURCE_PILL = "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium";

function getSourceBadge(leadSource: string | null): React.ReactElement {
  if (!leadSource || leadSource === "form") {
    return <span className={`${SOURCE_PILL} bg-stone-100 text-stone-700`}>MIB</span>;
  }
  if (leadSource === "widget") {
    return <span className={`${SOURCE_PILL} bg-blue-100 text-blue-700`}>Widget</span>;
  }
  if (leadSource === "email") {
    return <span className={`${SOURCE_PILL} bg-sky-100 text-sky-700`}>Google Ads</span>;
  }
  if (leadSource === "ai_call") {
    return <span className={`${SOURCE_PILL} bg-violet-100 text-violet-700`}>AI Call</span>;
  }
  if (leadSource === "voice" || leadSource === "phone") {
    return <span className={`${SOURCE_PILL} bg-zinc-100 text-zinc-700`}>Voice</span>;
  }
  if (leadSource === "reactivation") {
    return <span className={`${SOURCE_PILL} bg-purple-100 text-purple-700`}>Campaign</span>;
  }
  if (leadSource === "yelp") {
    return <span className={`${SOURCE_PILL} bg-red-100 text-red-700`}>Yelp</span>;
  }
  if (leadSource === "bark" || leadSource === "bark-sms") {
    return <span className={`${SOURCE_PILL} bg-slate-100 text-slate-700`}>Bark</span>;
  }
  if (leadSource === "thumbtack" || leadSource === "thumbtack-sms") {
    return <span className={`${SOURCE_PILL} bg-orange-100 text-orange-700`}>Thumbtack</span>;
  }
  if (leadSource.startsWith("campaign:")) {
    const campaignId = leadSource.replace("campaign:", "");
    const label = campaignId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return <span className={`${SOURCE_PILL} bg-indigo-100 text-indigo-700`}>Campaign: {label}</span>;
  }
  if (leadSource === "command-center") {
    return <span className={`${SOURCE_PILL} bg-indigo-100 text-indigo-700`}>Campaign</span>;
  }
  if (leadSource.startsWith("always-on:")) {
    const groupType = leadSource.replace("always-on:", "");
    const label = formatGroupType(groupType);
    return <span className={`${SOURCE_PILL} bg-orange-100 text-orange-700`}>Always-On: {label}</span>;
  }
  if (leadSource.startsWith("always-on-test:")) {
    const groupType = leadSource.replace("always-on-test:", "");
    const label = formatGroupType(groupType);
    return <span className={`${SOURCE_PILL} bg-yellow-100 text-yellow-700`}>Test: {label}</span>;
  }
  return <span className={`${SOURCE_PILL} bg-gray-100 text-gray-600`}>{leadSource}</span>;
}

const SERVICE_PILL = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-zinc-100 text-zinc-700";

function getServiceBadge(serviceType: string | null): React.ReactElement {
  const s = (serviceType ?? "").toLowerCase();
  if (s.includes("deep")) return <span className={SERVICE_PILL}>✨ Deep</span>;
  if (s.includes("move")) return <span className={SERVICE_PILL}>📦 Move-out</span>;
  if (s.includes("post") || s.includes("construct")) return <span className={SERVICE_PILL}>🏗️ Post-Con</span>;
  if (s.includes("office") || s.includes("commercial")) return <span className={SERVICE_PILL}>🏢 Office</span>;
  if (s.includes("airbnb") || s.includes("vacation") || s.includes("rental")) return <span className={SERVICE_PILL}>🏨 Rental</span>;
  if (s.includes("standard") || s.includes("regular") || s.includes("recurring")) return <span className={SERVICE_PILL}>🏠 Standard</span>;
  if (s) return <span className={SERVICE_PILL}>🧹 {serviceType}</span>;
  return <span className="text-zinc-300 text-sm">—</span>;
}

/** Converts a groupType slug to a readable label */
function formatGroupType(groupType: string): string {
  switch (groupType) {
    case "new-one-time": return "New One-Time";
    case "lapsed-one-time": return "Lapsed One-Time";
    case "lapsed-recurring": return "Lapsed Recurring";
    case "dormant": return "Dormant";
    default: return groupType.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }
}

/** Collapsible internal notes panel — saves vertical space in the drawer */
function AdminNotesSection({
  session,
  notes,
  setNotes,
  loadedNotes,
  notesSaved,
  updateNotes,
}: {
  session: DrawerSession;
  notes: string;
  setNotes: (v: string) => void;
  loadedNotes: string;
  notesSaved: boolean;
  updateNotes: ReturnType<typeof trpc.agents.updateNotes.useMutation>;
}) {
  const [open, setOpen] = useState(false);
  const currentNotes = notes !== "" ? notes : loadedNotes;
  return (
    <div className="border-t">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex items-center gap-1.5">
          Internal Notes
          {currentNotes && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
        </span>
        <span className="text-gray-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <Textarea
            placeholder="e.g. Left voicemail, price objection, follow up Friday..."
            value={currentNotes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="resize-none text-sm"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-400">Visible to agents and admins only</span>
            <div className="flex items-center gap-2">
              {notesSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => updateNotes.mutate({ sessionId: session.id, notes: currentNotes })}
                disabled={updateNotes.isPending}
              >
                {updateNotes.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Notes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConversationDrawer({
  session,
  onClose,
  isAdmin,
  agentList,
  onSessionUpdate,
  onRefresh,
  currentAgentName,
  initialTab,
  onOpenFirstMsg,
}: {
  session: DrawerSession;
  onClose: () => void;
  isAdmin: boolean;
  agentList: { id: number; name: string; isActive: number | boolean }[];
  onSessionUpdate: (updates: Partial<DrawerSession>) => void;
  onRefresh: () => void;
  currentAgentName?: string;
  initialTab?: "conversation" | "flow" | "performance";
  onOpenFirstMsg?: (details: string) => void;
}) {
  const utils = trpc.useUtils();
  let messages: { role: string; content: string }[] = [];
  try {
    messages = JSON.parse(session.messageHistory || "[]");
  } catch {
    messages = [];
  }

  // Mark as read when the drawer opens — clears the unread badge on this lead
  const markReadMutation = trpc.leads.markRead.useMutation({
    onSuccess: () => utils.leads.list.invalidate(),
  });
  useEffect(() => {
    if (session.hasUnread) {
      markReadMutation.mutate({ sessionId: session.id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const [pendingLostSession, setPendingLostSession] = useState<{ id: number; name: string | null } | null>(null);
  const adminUpdateStageMutation = trpc.leads.adminUpdateStage.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ stage: vars.stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Stage updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const agentUpdateStageMutation = trpc.leads.agentUpdateStage.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ stage: vars.stage as Stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Stage updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateStageMutation = isAdmin ? adminUpdateStageMutation : agentUpdateStageMutation;
  const markAsLostMutation = trpc.leads.markAsLost.useMutation({
    onSuccess: () => {
      onSessionUpdate({ stage: "LOST" as Stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Lead marked as lost");
    },
    onError: (e) => toast.error(e.message),
  });
  function handleStageSelect(val: string) {
    if (val === session.stage) return;
    if (val === "LOST") {
      setPendingLostSession({ id: session.id, name: session.leadName ?? session.leadPhone ?? null });
      return;
    }
    if (isAdmin) {
      adminUpdateStageMutation.mutate({ sessionId: session.id, stage: val as Stage });
    } else {
      agentUpdateStageMutation.mutate({ sessionId: session.id, stage: val as ("BOOKED" | "FOLLOW_UP_SCHEDULED" | "VOICEMAIL" | "COLD" | "LOST" | "YELP_CONTACTED") });
    }
  }

  const assignAgentMutation = trpc.leads.adminAssignAgent.useMutation({
    onSuccess: (_, vars) => {
      const agent = vars.agentId === null ? null : agentList.find(a => a.id === vars.agentId);
      onSessionUpdate({
        assignedAgentId: vars.agentId,
        assignedAgentName: agent?.name ?? null,
      });
      utils.leads.list.invalidate();
      utils.opsChat.listChannelMessages.invalidate({ channel: "command" });
      onRefresh();
      toast.success(vars.agentId === null ? "Lead unassigned" : `Assigned to ${agent?.name}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const activeAgents = agentList.filter(a => a.isActive);

  // Lead name editing
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(session.leadName ?? "");
  const updateLeadNameMutation = trpc.leads.updateLeadName.useMutation({
    onSuccess: (data) => {
      onSessionUpdate({ leadName: data.leadName });
      utils.leads.list.invalidate();
      setEditingName(false);
      toast.success("Name updated");
    },
    onError: (e) => toast.error(e.message),
  });

  // Phone editing
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState(session.leadPhone ?? "");
  const updateLeadPhoneMutation = trpc.leads.updateLeadPhone.useMutation({
    onSuccess: (data) => {
      onSessionUpdate({ leadPhone: data.leadPhone });
      utils.leads.list.invalidate();
      setEditingPhone(false);
      toast.success("Phone updated");
    },
    onError: (e) => toast.error(e.message),
  });

  // Booked amount editing
  const [bookedAmountInput, setBookedAmountInput] = useState(
    session.bookedAmount !== null && session.bookedAmount !== undefined
      ? String(session.bookedAmount)
      : ""
  );
  const [bookedAmountSaved, setBookedAmountSaved] = useState(false);
  const updateBookedAmountMutation = trpc.leads.updateBookedAmount.useMutation({
    onMutate: async (vars) => {
      // Cancel any in-flight refetches so they don't overwrite the optimistic value
      await utils.leads.list.cancel();
      // Snapshot previous cache for rollback
      const prev = utils.leads.list.getData({});
      // Optimistically patch the matching session in the list cache
      utils.leads.list.setData({}, (old) =>
        old
          ? old.map((s: any) =>
              s.id === vars.sessionId ? { ...s, bookedAmount: vars.bookedAmount } : s
            )
          : old
      );
      return { prev };
    },
    onSuccess: (_, vars) => {
      // Also update the open drawer session so the hint text refreshes
      onSessionUpdate({ bookedAmount: vars.bookedAmount });
      utils.leads.stats.invalidate();
      setBookedAmountSaved(true);
      setTimeout(() => setBookedAmountSaved(false), 2000);
      toast.success(vars.bookedAmount === null ? "Booked amount cleared" : `Booked amount set to $${vars.bookedAmount}`);
    },
    onError: (e, _vars, ctx) => {
      // Roll back the optimistic update on failure
      if (ctx?.prev) utils.leads.list.setData({}, ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => {
      // Sync with server to confirm the write
      utils.leads.list.invalidate();
    },
  });

  // Assign fallback timestamps to messages that don't have one.
  // Spread them evenly between createdAt and updatedAt so separators always fire.
  function withFallbackTs(
    msgs: { role: string; content: string; ts?: number }[],
    createdAt: Date | string,
    updatedAt: Date | string
  ) {
    if (msgs.length === 0) return msgs;
    const start = new Date(createdAt).getTime();
    const end = new Date(updatedAt).getTime();
    const span = Math.max(end - start, 0);
    return msgs.map((m, i) => ({
      ...m,
      ts: m.ts ?? Math.round(start + (span * i) / Math.max(msgs.length - 1, 1)),
    }));
  }

  // Reply / send message
  const [replyText, setReplyText] = useState("");
  const [localMessages, setLocalMessages] = useState<{ role: string; content: string; ts?: number }[]>(
    withFallbackTs(messages, session.createdAt, session.updatedAt)
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const smsComposeRef = useRef<HTMLTextAreaElement>(null);
  // On mount: immediately fetch fresh session data so the drawer never shows stale messages.
  // The sessions list polls every 30s, so a reply that arrived just before opening would be
  // missing from the prop. getById always returns the latest row from the DB.
  useEffect(() => {
    utils.leads.getById.fetch({ id: session.id }).then((fresh) => {
      if (fresh?.messageHistory) {
        try {
          const freshMsgs: { role: string; content: string; ts?: number }[] = JSON.parse(fresh.messageHistory);
          setLocalMessages(withFallbackTs(freshMsgs, session.createdAt, (fresh as any).updatedAt ?? session.updatedAt));
        } catch { /* ignore parse errors */ }
      }
    }).catch(() => { /* non-fatal — drawer still shows cached data */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);
  // Auto-scroll to bottom on first mount (skip past the AI banner)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, []);
  // When opened from the SMS icon (initialTab hint), focus the compose box
  useEffect(() => {
    if (initialTab === "conversation") {
      // Small delay to let the drawer animate in
      const t = setTimeout(() => {
        smsComposeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        smsComposeRef.current?.focus();
      }, 300);
      return () => clearTimeout(t);
    }
  }, [initialTab]);
  // AI closing recommendation — fetched on drawer open, can be refreshed
  const { data: closingRec, isLoading: isLoadingRec, refetch: refetchRec } = trpc.leads.getClosingRecommendation.useQuery(
    { sessionId: session.id },
    { staleTime: 5 * 60 * 1000, retry: 1 }
  );
  // Auto-refresh conversation every 5s when drawer is open
  const { data: freshSession } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 5000,
    select: (sessions) => sessions.find(s => s.id === session.id),
  });

  // Track previous inbound (user) message count to detect new lead replies
  const prevInboundCountRef = useRef<number | null>(null);

  // Sync local messages when fresh data arrives + chime on new inbound
  useEffect(() => {
    if (freshSession?.messageHistory) {
      try {
        const fresh: { role: string; content: string; ts?: number }[] = JSON.parse(freshSession.messageHistory);
        const inboundCount = fresh.filter(m => m.role === "user").length;
        if (prevInboundCountRef.current !== null && inboundCount > prevInboundCountRef.current) {
          void triggerTestChime();
        }
        prevInboundCountRef.current = inboundCount;
        setLocalMessages(withFallbackTs(fresh, session.createdAt, freshSession.updatedAt ?? session.updatedAt));
      } catch { /* ignore */ }
    }
  }, [freshSession?.messageHistory]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const sendMessageMutation = trpc.leads.sendMessage.useMutation({
    onSuccess: (_, vars) => {
      setLocalMessages(prev => [...prev, { role: "assistant", content: vars.message, ts: Date.now(), senderName: currentAgentName ?? "Agent" } as any]);
      setReplyText("");
    },
    onError: (e) => toast.error(e.message),
  });

  const setAiModeMutation = trpc.leads.setAiMode.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ aiMode: vars.aiMode });
      utils.leads.list.invalidate();
      toast.success(vars.aiMode === 1 ? "AI auto-reply enabled" : "Manual mode — you're now in control");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSend = () => {
    const text = replyText.trim();
    if (!text || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({ sessionId: session.id, message: text });
  };

  // Typing presence — signal to server when this agent is typing
  const setTypingMutation = trpc.leads.setTyping.useMutation();
  const handleTypingChange = (isTyping: boolean) => {
    setTypingMutation.mutate({ sessionId: session.id, isTyping });
  };

  // Poll for other agents typing in this conversation (every 2s)
  const { data: typingData } = trpc.leads.getTyping.useQuery(
    { sessionId: session.id },
    { refetchInterval: 2000 }
  );

  // Delete lead
  const deleteLeadMutation = trpc.leads.deleteLead.useMutation({
    onSuccess: () => {
      toast.success("Lead deleted");
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      // Also refresh the Command Chat Hot Leads tray so the card disappears immediately
      utils.opsChat.getCommandChatData.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // Mark as handled — removes from unresponded queue without closing the lead
  const markHandledMutation = trpc.leads.markHandled.useMutation({
     onSuccess: () => {
      toast.success("Marked as handled");
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      utils.leads.attentionItems.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  // Call logs (agent-logged)
  const { data: callLogs } = trpc.agents.getCallLogs.useQuery({ sessionId: session.id });
  // OpenPhone call recordings
  const { data: callRecordings, refetch: refetchCallRecordings } = trpc.leads.getCallRecordings.useQuery({ sessionId: session.id });
  // Voice calls (Vapi AI calls))
  const { data: voiceCalls } = trpc.voice.getCallsBySession.useQuery({ sessionId: session.id });
  // AI call scoring
  const [scoringRecId, setScoringRecId] = useState<number | null>(null);
  const scoreColor = (s: number) => s >= 80 ? "#16a34a" : s >= 60 ? "#d97706" : "#dc2626";

  const [showScoreModal, setShowScoreModal] = useState(false);
  const [scorePanel, setScorePanel] = useState<{ recId: number; data: {
    overallScore: number;
    categories: Array<{ name: string; score: number; maxScore: number; feedback: string }>;
    strengths: string[];
    improvements: string[];
    coachingTips: string[];
    summary: string;
  } } | null>(null);
  const scoreCallMutation = trpc.leads.scoreCall.useMutation({
    onSuccess: (data, vars) => {
      setScoringRecId(null);
      setScorePanel({ recId: vars.recordingId, data });
      setShowScoreModal(true);
      refetchCallRecordings();
    },
    onError: (e) => { setScoringRecId(null); toast.error(e.message); },
  });

  // Internal notes
  const { data: notesData } = trpc.agents.getNotes.useQuery({ sessionId: session.id });
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const updateNotes = trpc.agents.updateNotes.useMutation({
    onSuccess: () => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); },
    onError: (e) => toast.error(e.message),
  });
  const loadedNotes = notesData?.notes ?? "";

  // Customer history from completed_jobs (for campaign leads)
  const isCampaignLead = !!(session.leadSource && (
    session.leadSource.startsWith("campaign:") ||
    session.leadSource === "reactivation" ||
    session.leadSource === "command-center" ||
    session.leadSource.startsWith("always-on")
  ));
  const { data: customerHistory } = trpc.leads.getCustomerHistory.useQuery(
    { phone: session.leadPhone },
    { enabled: isCampaignLead, staleTime: 60_000 }
  );

  // Follow-up scheduling
  const DEFAULT_FOLLOWUP_MSG = "Hi, just circling back on this. We have some availability and would love to get you scheduled!";
  const [followUpDate, setFollowUpDate] = useState(session.followUpDate ?? "");
  const [followUpMessage, setFollowUpMessage] = useState(session.followUpMessage ?? DEFAULT_FOLLOWUP_MSG);
  const [followUpSaved, setFollowUpSaved] = useState(false);
  const setFollowUpMutation = trpc.leads.adminSetFollowUp.useMutation({
    onSuccess: (_, vars) => {
      setFollowUpSaved(true);
      setTimeout(() => setFollowUpSaved(false), 2000);
      onSessionUpdate({
        stage: vars.followUpDate ? "FOLLOW_UP_SCHEDULED" : "AVAILABILITY",
        followUpDate: vars.followUpDate,
        followUpMessage: vars.followUpMessage,
        followUpSent: 0,
      } as any);
      utils.leads.list.invalidate();
      toast.success(vars.followUpDate ? `Follow-up scheduled for ${vars.followUpDate}` : "Follow-up cleared");
    },
    onError: (e) => toast.error(e.message),
  });

  // Suggestion templates based on lead context
  const firstName = session.leadName?.split(" ")[0] ?? "there";
  // ── Nurture controls ─────────────────────────────────────────────────────
  const { data: nurtureData, refetch: refetchNurture } = trpc.nurture.bySession.useQuery(
    { sessionId: session.id },
    {
      staleTime: 30_000,
      // Show status strip instantly using data already fetched by the leads list,
      // while the full query (with message body preview) loads in the background.
      placeholderData: session.nurtureStatus
        ? {
            enrollment: {
              id: 0,
              status: session.nurtureStatus as 'active' | 'paused' | 'done',
              nextStep: session.nurtureNextStep ?? 1,
              // nextSendAt must be Date (non-nullable per tRPC inferred type);
              // use a far-future sentinel when unknown so the strip renders immediately
              nextSendAt: session.nurtureNextSendAt
                ? new Date(session.nurtureNextSendAt as string)
                : new Date(Date.now() + 86_400_000),
              lastStepSent: null as number | null,
            },
            nextMessageBody: (STEP_PREVIEW[session.nurtureNextStep ?? 3] ?? null) as string | null,
          }
        : undefined,
    }
  );
  const nurturePauseMutation = trpc.nurture.pause.useMutation({
    onSuccess: () => { refetchNurture(); toast.success("Nurture paused"); },
    onError: (e) => toast.error(e.message),
  });
  const nurtureResumeMutation = trpc.nurture.resume.useMutation({
    onSuccess: () => { refetchNurture(); toast.success("Nurture resumed"); },
    onError: (e) => toast.error(e.message),
  });
  const nurtureSkipMutation = trpc.nurture.skipStep.useMutation({
    onSuccess: () => { refetchNurture(); toast.success("Skipped to next step"); },
    onError: (e) => toast.error(e.message),
  });
  const nurtureSkipBackMutation = trpc.nurture.skipBackStep.useMutation({
    onSuccess: () => { refetchNurture(); toast.success("Moved back to previous step"); },
    onError: (e) => toast.error(e.message),
  });
  const nurtureEnrollMutation = trpc.nurture.enroll.useMutation({
    onSuccess: () => { refetchNurture(); toast.success("Enrolled in nurture"); },
    onError: (e) => toast.error(e.message),
  });
  const [nurtureEnrollStep, setNurtureEnrollStep] = useState<string>("3");
  const suggestions: Record<string, string> = {
    lockDate: `Hey ${firstName} — totally makes sense. We're already filling early May, so I can tentatively hold a spot now and adjust if needed. Want me to grab something before it fills up?`,
    softCheckIn: `Hey ${firstName} — just checking in! Want me to send over a couple openings that would work well for you?`,
    urgency: `Hey ${firstName} — quick heads up: our spots are starting to fill. Want me to hold one for you before they're gone?`,
    discount: `Hey ${firstName} — we had a schedule shift open up, so I may be able to get you a better rate if you want me to check options.`,
  };
  const [selectedAction, setSelectedAction] = useState<"lockDate" | "softCheckIn" | "urgency" | "discount">("lockDate");
  const [drawerTab, setDrawerTab] = useState<"conversation" | "flow" | "performance">(initialTab ?? "conversation");
  // Pre-fill compose box with AI suggested message on first load
  useEffect(() => {
    if (closingRec?.suggestedMessage && !replyText) {
      setReplyText(closingRec.suggestedMessage);
    }
  }, [closingRec?.suggestedMessage]);
  // Apply an AI-generated alternative message by index (0, 1, 2) or the primary message (-1)
  const applySuggestion = (index: number) => {
    if (index === -1) {
      // Primary move — use the AI's suggestedMessage
      setReplyText(closingRec?.suggestedMessage ?? "");
    } else {
      // Alternative move — use the matching alternativeMessages entry
      const msg = closingRec?.alternativeMessages?.[index];
      setReplyText(msg ?? "");
    }
    setDrawerTab("conversation");
  };
  const primaryRecommendation =
    selectedAction === "lockDate" ? "Create a soft commitment now so the lead doesn't disappear and your calendar gets first dibs." :
    selectedAction === "softCheckIn" ? "Best next move: keep the lead warm without pressure." :
    selectedAction === "urgency" ? "Best next move: create urgency as availability tightens." :
    "Best next move: use a schedule-fill incentive to convert.";
  const primaryMoveTitle =
    selectedAction === "lockDate" ? `Send "Lock ${session.followUpDate ? new Date(session.followUpDate).toLocaleString("en-US", { month: "long" }) : "May"} Spot" message` :
    selectedAction === "softCheckIn" ? "Send soft check-in message" :
    selectedAction === "urgency" ? "Send urgency nudge" :
    "Offer discount fill";
  const extrasArray: string[] = (() => {
    if (!session.extras) return [];
    try { return JSON.parse(session.extras) as string[]; } catch { return []; }
  })();
  const lastReplyTime = (() => {
    const last = [...localMessages].reverse().find(m => m.role === "user");
    if (!last?.ts) return null;
    const diff = Date.now() - last.ts;
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  })();
  const score = Math.min(100, Math.max(0, 40 + localMessages.filter(m => m.role === "user").length * 8));

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={e => e.stopPropagation()}
    >
      <div className="flex w-full max-w-[1080px] h-[90vh] gap-3 items-start">

        {/* ══════════════════════════════════════════════════════════
            LEFT PANEL — Conversation
        ══════════════════════════════════════════════════════════ */}
        <div className="flex flex-col flex-1 bg-white rounded-2xl shadow-xl overflow-hidden h-full min-w-0">

          {/* ── Header ── */}
          <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-gray-100 shrink-0">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
              style={{ backgroundColor: "#F97316" }}
            >
              {(session.leadName ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                {editingName ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = nameInput.trim();
                      if (!trimmed) return;
                      updateLeadNameMutation.mutate({ sessionId: session.id, leadName: trimmed });
                    }}
                  >
                    <input
                      autoFocus
                      className="text-[17px] font-bold text-gray-900 border-b border-gray-400 bg-transparent outline-none w-40"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") { setEditingName(false); setNameInput(session.leadName ?? ""); } }}
                    />
                    <button type="submit" disabled={updateLeadNameMutation.isPending} className="text-green-600 hover:text-green-700">
                      {updateLeadNameMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" onClick={() => { setEditingName(false); setNameInput(session.leadName ?? ""); }} className="text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    className="flex items-center gap-1.5 group"
                    onClick={() => { setNameInput(session.leadName ?? ""); setEditingName(true); }}
                    title="Edit name"
                  >
                    <span className="text-[17px] font-bold text-gray-900">{session.leadName ?? <span className="text-gray-400 font-normal italic">No name — click to add</span>}</span>
                    <Pencil className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>
                )}
                {/* AI context pill — where the conversation left off */}
                {closingRec?.objectionSummary && (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 whitespace-nowrap">
                    &#10024; {closingRec.objectionSummary}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {editingPhone ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = phoneInput.trim();
                      if (!trimmed) return;
                      updateLeadPhoneMutation.mutate({ sessionId: session.id, leadPhone: trimmed });
                    }}
                  >
                    <input
                      autoFocus
                      className="text-xs text-gray-700 border-b border-gray-400 bg-transparent outline-none w-32"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") { setEditingPhone(false); setPhoneInput(session.leadPhone ?? ""); } }}
                    />
                    <button type="submit" disabled={updateLeadPhoneMutation.isPending} className="text-green-600 hover:text-green-700">
                      {updateLeadPhoneMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    </button>
                    <button type="button" onClick={() => { setEditingPhone(false); setPhoneInput(session.leadPhone ?? ""); }} className="text-gray-400 hover:text-gray-600">
                      <X className="w-3 h-3" />
                    </button>
                  </form>
                ) : (
                  <button
                    className="flex items-center gap-1 group"
                    onClick={() => { setPhoneInput(session.leadPhone ?? ""); setEditingPhone(true); }}
                    title="Edit phone"
                  >
                    <span>{formatPhone(session.leadPhone)}</span>
                    <Pencil className="w-2.5 h-2.5 text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </button>
                )}
                {lastReplyTime && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
                    Last reply {lastReplyTime}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${
                    score >= 70 ? "bg-green-400" : score >= 40 ? "bg-amber-400" : "bg-red-400"
                  }`} />
                  Score {score}/100
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Status dropdown — quick stage update from header */}
              <Select
                value={session.stage}
                onValueChange={handleStageSelect}
                disabled={updateStageMutation.isPending || markAsLostMutation.isPending}
              >
                <SelectTrigger
                  className="h-8 text-xs font-semibold rounded-full border px-3 pr-2.5 gap-1.5 focus:ring-0 min-w-[120px]"
                  style={{
                    backgroundColor: STAGE_CONFIG[session.stage as Stage]?.bgColor ?? "#f3f4f6",
                    color: STAGE_CONFIG[session.stage as Stage]?.textColor ?? "#374151",
                    borderColor: STAGE_CONFIG[session.stage as Stage]?.borderColor ?? "#d1d5db",
                  }}
                >
                  <span className="truncate">{STAGE_CONFIG[session.stage as Stage]?.label ?? session.stage}</span>
                  {updateStageMutation.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin ml-1 shrink-0" />
                    : <ChevronDown className="w-3 h-3 ml-1 shrink-0 opacity-60" />}
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_STAGES.map(s => (
                    <SelectItem key={s} value={s} className="text-xs">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ backgroundColor: STAGE_CONFIG[s]?.bgColor, color: STAGE_CONFIG[s]?.textColor }}
                      >
                        {STAGE_CONFIG[s]?.label ?? s}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* First Message Generator wand */}
              <button
                title="Generate first outreach message"
                onClick={() => {
                  const parts: string[] = [];
                  if (session.leadName) parts.push(`Name: ${session.leadName}`);
                  if (session.leadPhone && !session.leadPhone.startsWith("thumbtack-sms-")) parts.push(`Phone: ${session.leadPhone}`);
                  if (session.serviceType) parts.push(`Service: ${session.serviceType}`);
                  if (session.quotedPrice) parts.push(`Quote: $${session.quotedPrice}`);
                  if (session.barkQA) parts.push(session.barkQA);
                  onOpenFirstMsg?.(parts.join("\n"));
                }}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-violet-100 text-gray-400 hover:text-violet-600 transition-colors"
              >
                <Wand2 className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex items-center gap-0 px-4 shrink-0 border-b border-gray-100">
            {(["conversation", "flow", "performance"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setDrawerTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
                  drawerTab === tab
                    ? "border-orange-400 text-gray-900"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {tab === "conversation" ? "Conversation" : tab === "flow" ? "Flow View" : "Performance"}
              </button>
            ))}
          </div>

          {/* ── Persistent note display ── */}
          {(loadedNotes || notes) && !showNoteInput && (
            <div className="mx-4 mt-2 mb-0 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50/60 border border-amber-100">
              <StickyNote className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
              <p className="flex-1 text-xs text-amber-800/80 leading-relaxed whitespace-pre-wrap">{notes || loadedNotes}</p>
              <button
                onClick={() => setShowNoteInput(true)}
                className="shrink-0 text-amber-300 hover:text-amber-500 transition-colors mt-0.5"
                title="Edit note"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* --- CONVERSATION TAB --- */}
          {drawerTab === "conversation" && (
            <div className="flex flex-col flex-1 min-h-0">
               {/* Messages scroll area — white bg, no gray */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-3 bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* AI recommendation — slim pinned strip */}
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50/70 border border-orange-100">
                  <span className="text-[10px] font-semibold text-orange-400 uppercase tracking-wide shrink-0">AI</span>
                  <span className="flex-1 text-xs text-orange-700/80 leading-snug">
                    {isLoadingRec ? (
                      <span className="animate-pulse text-orange-300">Analyzing...</span>
                    ) : closingRec ? (
                      closingRec.objectionSummary
                    ) : (
                      primaryRecommendation
                    )}
                  </span>
                  <button
                    onClick={() => refetchRec()}
                    className="shrink-0 text-orange-300 hover:text-orange-500 transition-colors"
                    title="Refresh recommendation"
                  >
                    {isLoadingRec ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-[11px]">&#8635;</span>}
                  </button>
                </div>
                <div className="space-y-4">
                {(() => {
                  // Build merged timeline: SMS messages + call recordings, sorted by timestamp
                  type TimelineItem =
                    | { kind: "msg"; msg: typeof localMessages[0]; i: number; prevTs?: number }
                    | { kind: "recording"; rec: NonNullable<typeof callRecordings>[0] };

                  const items: TimelineItem[] = [
                    ...localMessages.map((msg, i) => ({
                      kind: "msg" as const,
                      msg,
                      i,
                      prevTs: i > 0 ? localMessages[i - 1]?.ts : undefined,
                    })),
                    ...(callRecordings ?? []).map(rec => ({
                      kind: "recording" as const,
                      rec,
                    })),
                  ].sort((a, b) => {
                    const tsA = a.kind === "msg" ? (a.msg.ts ?? 0) : new Date(a.rec.callStartedAt ?? 0).getTime();
                    const tsB = b.kind === "msg" ? (b.msg.ts ?? 0) : new Date(b.rec.callStartedAt ?? 0).getTime();
                    return tsA - tsB;
                  });

                  if (items.length === 0) {
                    return <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No messages yet</div>;
                  }

                  let lastRenderedTs: number | undefined;

                  return items.map((item, idx) => {
                    if (item.kind === "recording") {
                      const rec = item.rec;
                      const recTs = rec.callStartedAt ? new Date(rec.callStartedAt).getTime() : undefined;
                      const showSep = recTs != null && (lastRenderedTs == null || isDifferentDay(lastRenderedTs, recTs));
                      if (recTs != null) lastRenderedTs = recTs;
                      const timeLabel = recTs ? new Date(recTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : null;
                      const mins = rec.durationSeconds ? Math.floor(rec.durationSeconds / 60) : 0;
                      const secs = rec.durationSeconds ? rec.durationSeconds % 60 : 0;
                      const durLabel = rec.durationSeconds ? `${mins}m ${secs}s` : null;
                      // Parse transcript dialogue array
                      type DialogueTurn = { identifier: string; content: string; start: number; end: number };
                      let dialogue: DialogueTurn[] = [];
                      if (rec.transcript) {
                        try { dialogue = JSON.parse(rec.transcript); } catch { dialogue = []; }
                      }
                      // Map phone identifiers to readable labels
                      const speakerLabel = (id: string) => {
                        if (!id) return "Unknown";
                        // External phone number = lead
                        if (id.startsWith("+")) return session.leadName ?? id;
                        // Internal user ID = staff
                        return "Staff";
                      };
                      // Parse existing score data if available
                      let existingScore: { overallScore: number; categories: Array<{ name: string; score: number; maxScore: number; feedback: string }>; strengths: string[]; improvements: string[]; coachingTips: string[]; summary: string } | null = null;
                      if (rec.scoreData) {
                        try { existingScore = JSON.parse(rec.scoreData); } catch { existingScore = null; }
                      }
                      const isScoring = scoringRecId === rec.id;
                      const activePanelData = scorePanel?.recId === rec.id ? scorePanel.data : existingScore;
                      return (
                        <div key={`rec-${rec.id ?? idx}`}>
                          {showSep && recTs != null && <MessageDateSeparator label={formatMsgDate(recTs)} />}
                          <div className="flex justify-center my-2">
                            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm w-full max-w-sm">
                              {/* Header row */}
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                                  <PhoneIncoming className="w-3.5 h-3.5 text-blue-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                                    {rec.direction === "outgoing" ? "Outbound call" : "Inbound call"}
                                    {durLabel && <span className="font-normal text-gray-400">· {durLabel}</span>}
                                    {rec.callScore != null && (
                                      <span className="ml-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                                        style={{ background: scoreColor(rec.callScore) + "22", color: scoreColor(rec.callScore) }}>
                                        {rec.callScore}/100
                                      </span>
                                    )}
                                  </div>
                                  {timeLabel && <div className="text-[11px] text-gray-400">{timeLabel}</div>}
                                </div>
                              </div>
                              {/* Audio player */}
                              {rec.recordingUrl && (
                                <audio
                                  controls
                                  src={rec.recordingUrl}
                                  className="w-full h-8 mb-2"
                                  style={{ accentColor: "#f97316" }}
                                />
                              )}
                              {/* Transcript */}
                              {dialogue.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide cursor-pointer select-none hover:text-gray-600 transition-colors">
                                    Transcript · {dialogue.length} {dialogue.length === 1 ? "block" : "turns"}
                                  </summary>
                                  <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                    {dialogue.map((turn, ti) => (
                                      <div key={ti} className="flex gap-2">
                                        <span className="text-[10px] font-semibold shrink-0 mt-0.5"
                                          style={{ color: turn.identifier?.startsWith("+") ? "#6b7280" : "#f97316" }}>
                                          {speakerLabel(turn.identifier)}
                                        </span>
                                        <span className="text-[11px] text-gray-600 leading-snug">{turn.content}</span>
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                              {/* AI Score button + View Analysis — only show if transcript exists */}
                              {rec.transcript && (
                                <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={() => {
                                      setScoringRecId(rec.id!);
                                      scoreCallMutation.mutate({ recordingId: rec.id! });
                                    }}
                                    disabled={isScoring}
                                    className="flex items-center gap-1.5 text-[11px] font-semibold text-purple-600 hover:text-purple-700 disabled:opacity-50 transition-colors"
                                  >
                                    {isScoring ? (
                                      <><RotateCcw className="w-3 h-3 animate-spin" /> Scoring...</>
                                    ) : rec.callScore != null ? (
                                      <><RotateCcw className="w-3 h-3" /> Re-score</>
                                    ) : (
                                      <><Sparkles className="w-3 h-3" /> AI Score</>
                                    )}
                                  </button>
                                  {activePanelData && (
                                    <button
                                      onClick={() => { setScorePanel({ recId: rec.id!, data: activePanelData }); setShowScoreModal(true); }}
                                      className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                                    >
                                      <BarChart2 className="w-3 h-3" /> View Analysis
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // SMS message item
                    const { msg, prevTs } = item;
                    const isOutbound = msg.role === "assistant";
                    const isSystem = msg.role === "system";
                    const curTs = msg.ts;
                    const showSeparator = curTs != null && (lastRenderedTs == null || isDifferentDay(lastRenderedTs, curTs));
                    if (curTs != null) lastRenderedTs = curTs;
                    const timeLabel = curTs != null
                      ? new Date(curTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      : null;
                    const senderName = (msg as any).senderName as string | undefined;
                    const isAiMessage = isOutbound && !senderName;
                    return (
                      <div key={idx}>
                        {showSeparator && curTs != null && (
                          <MessageDateSeparator label={formatMsgDate(curTs)} />
                        )}
                        {/* System event pill */}
                        {isSystem ? (
                          msg.content.startsWith("[AI CALL") ? (
                            /* AI Call timeline event */
                            <div className="flex justify-center my-3">
                              <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5 max-w-xs w-full text-center">
                                <div className="flex items-center justify-center gap-1.5 mb-1">
                                  <span className="text-violet-600 text-sm">&#128222;</span>
                                  <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">AI Call</span>
                                  {timeLabel && <span className="text-xs text-violet-400 ml-1">{timeLabel}</span>}
                                </div>
                                <div className="text-xs text-violet-600 whitespace-pre-line leading-relaxed">
                                  {msg.content.replace(/^\[AI CALL[^\]]*\]\n?/, "")}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex justify-center my-1">
                              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">
                                {msg.content.split(/(https?:\/\/\S+|thmtk\.com\/\S+|[a-z0-9-]+\.com\/\S+)/gi).map((part, pi) =>
                                  /^(https?:\/\/|thmtk\.com\/|[a-z0-9-]+\.com\/)/i.test(part)
                                    ? <a key={pi} href={part.startsWith("http") ? part : `https://${part}`} target="_blank" rel="noopener noreferrer" className="underline text-blue-500 hover:text-blue-700 break-all">{part}</a>
                                    : part
                                )}
                              </span>
                            </div>
                          )
                        ) : isOutbound ? (
                          /* ── Outbound ── */
                          <div className="flex items-end gap-2 justify-end">
                            <div className="flex flex-col items-end max-w-[76%]">
                              {/* Label row */}
                              <div className="flex items-center gap-2 mb-1 pr-1">
                                {isAiMessage ? (
                                  <span className="text-xs font-semibold text-orange-400">AI</span>
                                ) : senderName ? (
                                  <span className="text-xs font-semibold" style={{ color: "#F97316" }}>{senderName}</span>
                                ) : null}
                                {timeLabel && <span className="text-xs text-gray-400">{timeLabel}</span>}
                              </div>
                              {/* Bubble */}
                              <div
                                className="rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed"
                                style={isAiMessage
                                  ? { backgroundColor: "#FFF3E8", color: "#92400e" }
                                  : { backgroundColor: "#1a1a1a", color: "#ffffff" }
                                }
                              >
                                {msg.content}
                              </div>
                            </div>
                            {/* Avatar */}
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mb-0.5 text-xs font-semibold"
                              style={isAiMessage
                                ? { backgroundColor: "#FFF3E8", color: "#92400e", border: "1px solid #fed7aa" }
                                : { backgroundColor: "#1a1a1a", color: "#ffffff" }
                              }
                            >
                              {isAiMessage ? "AI" : (senderName?.charAt(0).toUpperCase() ?? "A")}
                            </div>
                          </div>
                        ) : (
                          /* ── Inbound ── */
                          <div className="flex items-end gap-2">
                            {/* Small gray person icon */}
                            <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mb-0.5">
                              <User className="w-3.5 h-3.5 text-gray-400" />
                            </div>
                            <div className="max-w-[76%]">
                              {/* Label row */}
                              <div className="flex items-center gap-2 mb-1 pl-1">
                                <span className="text-xs font-medium text-gray-500">
                                  {session.stage === "FOLLOW_UP_SCHEDULED" ? "Delay / Objection" :
                                   session.stage === "COLD" ? "Reconfirmed Delay" : "Customer"}
                                </span>
                                {timeLabel && <span className="text-xs text-gray-400">{timeLabel}</span>}
                              </div>
                              {/* Bubble — very soft gray, no border */}
                              <div className="bg-gray-50 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-700 leading-relaxed">
                                {msg.content}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
                </div>
                <div ref={messagesEndRef} />
              </div>

              {/* ── AI suggestion pills — single scrollable row ── */}
              <div className="shrink-0 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0 mr-0.5">AI</span>
                  {[
                    { index: -1, label: closingRec?.primaryMove ?? "Primary move" },
                    { index: 0, label: closingRec?.alternativeMoves?.[0] ?? "Alternative 1" },
                    { index: 1, label: closingRec?.alternativeMoves?.[1] ?? "Alternative 2" },
                    { index: 2, label: closingRec?.alternativeMoves?.[2] ?? "Alternative 3" },
                  ].map(({ index, label }, i) => {
                    const short = label.split(" ").slice(0, 3).join(" ");
                    return (
                      <button
                        key={index}
                        onClick={() => applySuggestion(index)}
                        title={label}
                        className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all whitespace-nowrap ${
                          i === 0
                            ? "border-orange-200 text-orange-600 bg-orange-50 hover:bg-orange-100"
                            : "border-gray-200 text-gray-500 bg-white hover:bg-gray-50"
                        }`}
                      >
                        {short}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Compose box ── */}
              <div className="mx-4 mb-4 mt-2 rounded-2xl border border-gray-150 bg-white overflow-hidden shrink-0 shadow-sm">
                {typingData?.typingAgentName && (
                  <div className="flex items-center gap-2 px-4 pt-2">
                    <span className="inline-flex gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                    <span className="text-xs text-orange-600 font-medium">{typingData.typingAgentName} is typing...</span>
                  </div>
                )}
                <textarea
                  ref={smsComposeRef}
                  value={replyText}
                  onChange={e => { setReplyText(e.target.value); handleTypingChange(e.target.value.length > 0); }}
                  onBlur={() => handleTypingChange(false)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message..."
                  rows={3}
                  className="w-full px-4 pt-3 pb-1 text-sm text-gray-800 resize-none outline-none bg-transparent placeholder-gray-300"
                />
                {/* Inline note input — shown when note icon is clicked */}
                {showNoteInput && (
                  <div className="px-4 pb-2 border-t border-gray-100 pt-2">
                    <Textarea
                      placeholder="e.g. Left voicemail, price objection, follow up Friday..."
                      value={notes !== "" ? notes : loadedNotes}
                      onChange={e => setNotes(e.target.value)}
                      rows={2}
                      className="resize-none text-sm"
                      autoFocus
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs text-gray-400">Visible to agents and admins only</span>
                      <div className="flex items-center gap-2">
                        {notesSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-xs"
                          onClick={() => { updateNotes.mutate({ sessionId: session.id, notes: notes !== "" ? notes : loadedNotes }); setShowNoteInput(false); }}
                          disabled={updateNotes.isPending}
                        >
                          {updateNotes.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                {/* Nurture status strip */}
                {nurtureData?.enrollment && (() => {
                  const enr = nurtureData.enrollment;
                  return (
                    <div className="mx-3 mb-2 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2 flex items-center gap-3">
                      <Zap className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-violet-700">
                            {enr.status === 'active' ? 'Nurture active' : enr.status === 'paused' ? 'Nurture paused' : `Nurture ${enr.status}`}
                          </span>
                          <span className="text-xs text-violet-500">&middot;</span>
                          <span className="text-xs text-violet-600">{getStepLabel(enr.nextStep)}</span>
                          {enr.status === 'active' && enr.nextSendAt && (
                            <>
                              <span className="text-xs text-violet-400">&middot;</span>
                              <span className="text-xs text-violet-400">{formatNextSendAt(enr.nextSendAt)}</span>
                            </>
                          )}
                        </div>
                        {nurtureData.nextMessageBody && (
                          <p className="text-xs text-violet-600/80 mt-0.5 truncate">{nurtureData.nextMessageBody}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {enr.status === 'active' && (
                          <>
                            <button
                              onClick={() => nurtureSkipBackMutation.mutate({ enrollmentId: enr.id })}
                              disabled={nurtureSkipBackMutation.isPending || enr.nextStep <= 3 || enr.id === 0}
                              title="Go back to previous step"
                              className="w-6 h-6 flex items-center justify-center rounded text-violet-400 hover:text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-40"
                            >
                              {nurtureSkipBackMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <SkipBack className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => nurtureSkipMutation.mutate({ enrollmentId: enr.id })}
                              disabled={nurtureSkipMutation.isPending || enr.id === 0}
                              title="Skip to next step"
                              className="w-6 h-6 flex items-center justify-center rounded text-violet-400 hover:text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-40"
                            >
                              {nurtureSkipMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <SkipForward className="w-3 h-3" />}
                            </button>
                            <button
                              onClick={() => nurturePauseMutation.mutate({ enrollmentId: enr.id })}
                              disabled={nurturePauseMutation.isPending || enr.id === 0}
                              title="Pause nurture"
                              className="w-6 h-6 flex items-center justify-center rounded text-violet-400 hover:text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-40"
                            >
                              {nurturePauseMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
                            </button>
                          </>
                        )}
                        {enr.status === 'paused' && (
                          <button
                            onClick={() => nurtureResumeMutation.mutate({ sessionId: session.id })}
                            disabled={nurtureResumeMutation.isPending}
                            title="Resume nurture"
                            className="w-6 h-6 flex items-center justify-center rounded text-violet-400 hover:text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-40"
                          >
                            {nurtureResumeMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {/* Nurture enroll strip — shown when no active/paused enrollment */}
                {!nurtureData?.enrollment && (
                  <div className="mx-3 mb-2 rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2 flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="text-xs text-violet-500 font-medium shrink-0">Enroll in nurture</span>
                    <Select value={nurtureEnrollStep} onValueChange={setNurtureEnrollStep}>
                      <SelectTrigger className="h-6 text-xs border-violet-200 bg-white text-violet-700 flex-1 min-w-0 max-w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">Step 3 · Holding a spot</SelectItem>
                        <SelectItem value="4">Step 4 · Urgency</SelectItem>
                        <SelectItem value="5">Step 5 · Soft reset</SelectItem>
                        <SelectItem value="6">Step 6 · Fresh start</SelectItem>
                        <SelectItem value="7">Step 7 · Simple CTA</SelectItem>
                        <SelectItem value="8">Step 8 · Last call</SelectItem>
                        <SelectItem value="9">Step 9 · Value reminder</SelectItem>
                        <SelectItem value="10">Step 10 · Circle back</SelectItem>
                        <SelectItem value="11">Step 11 · Timing opener</SelectItem>
                        <SelectItem value="12">Step 12 · First-time offer</SelectItem>
                        <SelectItem value="13">Step 13 · Still need help?</SelectItem>
                        <SelectItem value="14">Step 14 · Convenience reframe</SelectItem>
                        <SelectItem value="15">Step 15 · Trust signal</SelectItem>
                        <SelectItem value="16">Step 16 · Schedule gap fill</SelectItem>
                        <SelectItem value="17">Step 17 · Breakup text</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      onClick={() => nurtureEnrollMutation.mutate({ sessionId: session.id, startStep: parseInt(nurtureEnrollStep, 10) })}
                      disabled={nurtureEnrollMutation.isPending}
                      className="h-6 px-2.5 text-xs font-medium rounded bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-40 shrink-0"
                    >
                      {nurtureEnrollMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Enroll"}
                    </button>
                  </div>
                )}
                {/* Toolbar: note icon + AI toggle + Send */}
                <div className="flex items-center gap-2 px-3 pb-3 pt-1">
                  {/* Note icon — amber when note exists */}
                  <button
                    onClick={() => setShowNoteInput(v => !v)}
                    title={notes || loadedNotes ? "Edit note" : "Add note"}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                      notes || loadedNotes
                        ? "text-amber-500 bg-amber-50 hover:bg-amber-100"
                        : "text-gray-300 hover:text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    <StickyNote className="w-3.5 h-3.5" />
                  </button>
                  {/* AI assist toggle — compact icon+label */}
                  <button
                    onClick={() => setAiModeMutation.mutate({ sessionId: session.id, aiMode: session.aiMode === 1 ? 0 : 1 })}
                    disabled={setAiModeMutation.isPending}
                    title={session.aiMode === 1 ? "AI is handling replies — click to take over" : "AI is paused — click to resume"}
                    className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                      session.aiMode === 1
                        ? "text-green-700 bg-green-50 border-green-200 hover:bg-green-100"
                        : "text-gray-400 bg-white border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <Bot className="w-3.5 h-3.5" />
                    {session.aiMode === 1 ? "AI on" : "AI off"}
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim() || sendMessageMutation.isPending}
                    className="ml-auto flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                    style={{ backgroundColor: "#F97316" }}
                  >
                    {sendMessageMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Send &#8594;
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              FLOW VIEW TAB
          ══════════════════════════════════════════════════════════ */}
          {drawerTab === "flow" && (
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4 bg-white">
              {/* Flow tab */}
              {(() => {
                const pipelineStages = ["Lead In", "Quoted", "In Progress", "Follow-Up", "Re-engage", "Booked"];
                const stageToIndex: Record<string, number> = {
                  WIDGET_SIZING: 0, QUOTE_SENT: 1, AVAILABILITY: 2, SLOT_CHOICE: 2, ADDRESS: 2,
                  CONFIRMATION: 2, CALL_SCHEDULED: 2, DONE: 2, UNHANDLED: 2,
                  FOLLOW_UP_SCHEDULED: 3, VOICEMAIL: 3, COLD: 4, BOOKED: 5,
                };
                const currentIdx = stageToIndex[session.stage] ?? 0;
                return (
                  <div className="bg-gray-50 rounded-2xl p-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Pipeline Stage</div>
                    <div className="flex items-center gap-1">
                      {pipelineStages.map((stage, idx) => (
                        <div key={stage} className="flex items-center flex-1">
                          <div className={`flex-1 text-center py-2 px-1 rounded-lg text-xs font-medium ${
                            idx === currentIdx ? "bg-gray-900 text-white" :
                            idx < currentIdx ? "bg-orange-100 text-orange-700" :
                            "bg-white text-gray-400 border border-gray-200"
                          }`}>
                            {stage}
                          </div>
                          {idx < pipelineStages.length - 1 && (
                            <div className={`w-3 h-0.5 shrink-0 ${idx < currentIdx ? "bg-orange-300" : "bg-gray-200"}`} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Move Stage</div>
                <div className="flex items-center gap-2">
                  <Select
                    value={session.stage}
                    onValueChange={handleStageSelect}
                    disabled={updateStageMutation.isPending || markAsLostMutation.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OUTCOME_STAGES.map(s => (
                        <SelectItem key={s} value={s} className="text-xs">
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ backgroundColor: STAGE_CONFIG[s]?.bgColor, color: STAGE_CONFIG[s]?.textColor }}
                          >
                            {STAGE_CONFIG[s]?.label ?? s}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {updateStageMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">AI Playbook</div>
                <div className="space-y-2">
                  {[
                    { done: true, text: "Intro quote sent" },
                    { done: true, text: "Availability question sent" },
                    { done: session.stage !== "WIDGET_SIZING" && session.stage !== "QUOTE_SENT", text: "Slot confirmed or date captured" },
                    { done: !!session.followUpDate, text: "Follow-up scheduled" },
                    { done: session.stage === "BOOKED", text: "Booking confirmed" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-sm">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${item.done ? "bg-green-500" : "bg-gray-200"}`}>
                        {item.done && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </div>
                      <span className={item.done ? "text-gray-700" : "text-gray-400"}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              PERFORMANCE TAB
          ══════════════════════════════════════════════════════════ */}
          {drawerTab === "performance" && (
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4 bg-white">
              {/* Performance tab */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Close probability", value: `${Math.min(95, 30 + localMessages.filter(m => m.role === "user").length * 8)}%`, color: "text-green-600" },
                  { label: "Response likelihood", value: `${Math.min(95, 50 + localMessages.length * 4)}%`, color: "text-blue-600" },
                  { label: "Template win rate", value: "67%", color: "text-purple-600" },
                ].map(stat => (
                  <div key={stat.label} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm text-center">
                    <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                    <div className="text-xs text-gray-400 mt-0.5 leading-tight">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Top Message Variants</div>
                <div className="space-y-2">
                  {[
                    { text: "Hold a spot message", rate: "72%" },
                    { text: "Soft check-in", rate: "61%" },
                    { text: "Urgency nudge", rate: "54%" },
                  ].map((v, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{v.text}</span>
                      <span className="font-semibold text-gray-900">{v.rate}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ══════════════════════════════════════════════════════════
            RIGHT PANEL — Sidebar
        ══════════════════════════════════════════════════════════ */}
        <div className="w-[310px] shrink-0 flex flex-col gap-3 overflow-y-auto overscroll-contain h-full pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

          {/* ── NEXT ACTION card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Next Action</span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full text-orange-500 border border-orange-200">Recommended</span>
            </div>
            {/* Dark primary move card */}
            <div className="rounded-xl bg-gray-900 p-4 mb-4">
              <div className="text-[11px] font-semibold text-gray-400 mb-1.5">&#10024; Primary move</div>
              {isLoadingRec ? (
                <div className="text-sm text-gray-400 animate-pulse">Analyzing conversation...</div>
              ) : (
                <>
                  <div className="text-[15px] font-bold text-white leading-snug mb-2">
                    {closingRec?.primaryMove ?? primaryMoveTitle}
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {closingRec?.primaryMoveRationale ?? primaryRecommendation}
                  </p>
                </>
              )}
            </div>
            {/* 2×2 action buttons — larger, squarer */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => applySuggestion(-1)}
                className="py-3 px-3 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: "#F97316" }}
              >
                {closingRec?.primaryMove ?? "Send recommended message"}
              </button>
              <button
                onClick={() => applySuggestion(0)}
                className="py-3 px-3 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {closingRec?.alternativeMoves?.[0] ?? "Alternative 1"}
              </button>
              <button
                onClick={() => applySuggestion(1)}
                className="py-3 px-3 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {closingRec?.alternativeMoves?.[1] ?? "Alternative 2"}
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="py-3 px-3 rounded-xl text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors">
                    Close / Archive
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently remove the lead and all conversation history. This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => deleteLeadMutation.mutate({ sessionId: session.id })}
                    >
                      Yes, delete permanently
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* ── LEAD SNAPSHOT card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Lead Snapshot</span>
              <button className="text-gray-300 hover:text-gray-500 text-base leading-none">&#8943;</button>
            </div>

            {/* ── Previous job hero — shown first if available ── */}
            {customerHistory && (
              <div className="mb-4 p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Returning Customer</div>
                <div className="grid grid-cols-3 gap-3">
                  {customerHistory.lastBookingPrice != null && (
                    <div>
                      <div className="text-[10px] text-gray-400 mb-0.5">Last Price</div>
                      <div className="text-lg font-bold text-gray-900">${customerHistory.lastBookingPrice}</div>
                    </div>
                  )}
                  {customerHistory.frequency && (
                    <div>
                      <div className="text-[10px] text-gray-400 mb-0.5">Frequency</div>
                      <div className="text-sm font-semibold text-gray-900">{customerHistory.frequency}</div>
                    </div>
                  )}
                  {customerHistory.jobDate && (
                    <div>
                      <div className="text-[10px] text-gray-400 mb-0.5">Last Job</div>
                      <div className="text-sm font-semibold text-gray-900">
                        {new Date(customerHistory.jobDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Quote + Service ── */}
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Quote</div>
                <div className="text-2xl font-bold text-gray-900">
                  {session.bookedAmount != null && session.bookedAmount > 0
                    ? `$${session.bookedAmount}`
                    : session.quotedPrice && Number(session.quotedPrice) > 0
                      ? `$${Number(session.quotedPrice).toFixed(0)}`
                      : "\u2014"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-0.5">Service</div>
                <div className="text-sm font-semibold text-gray-900 mt-1">{session.serviceType ?? "Standard Cleaning"}</div>
              </div>
            </div>
            {extrasArray.length > 0 && (
              <div>
                <div className="text-xs text-gray-400 mb-1.5">Extras</div>
                <div className="flex flex-wrap gap-1.5">
                  {extrasArray.map(extra => (
                    <span key={extra} className="text-xs px-2.5 py-0.5 rounded-full border border-gray-200 text-gray-600 bg-gray-50">
                      {extra.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {session.address && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-xs text-gray-400 mb-0.5">Address</div>
                <div className="text-xs text-gray-700">{session.address}</div>
              </div>
            )}
            {session.barkQA && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="text-xs text-gray-400 mb-1">
                  {session.leadSource === "email" ? "Form Details" :
                   session.leadSource === "voice" ? "Call Details" :
                   session.leadSource === "bark" ? "Bark Q&A" : "Lead Details"}
                </div>
                <div className="text-xs text-gray-700 whitespace-pre-line">{session.barkQA}</div>
              </div>
            )}
            {/* ── Source — small footer pill ── */}
            {session.leadSource && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400">Source</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {session.leadSource === "email" ? "Google Ads Form" :
                   session.leadSource === "voice" ? "Google Ads Call" :
                   session.leadSource.replace("campaign:", "").replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}
                </span>
              </div>
            )}
          </div>

          {/* ── BOOKED AMOUNT card — always shown so agents can set/override the price ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-5" style={{ backgroundColor: "#f0fdf4" }}>
            <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-2">Booked Amount</p>
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                <Input
                  type="number"
                  min={0}
                  placeholder={
                    session.bookedAmount != null
                      ? String(session.bookedAmount)
                      : session.quotedPrice
                        ? String(Math.round(Number(session.quotedPrice)))
                        : "0"
                  }
                  value={bookedAmountInput}
                  onChange={e => setBookedAmountInput(e.target.value)}
                  className="pl-5 h-8 text-xs bg-white"
                />
              </div>
              {bookedAmountSaved && <span className="text-xs text-green-600 font-medium shrink-0">✓</span>}
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs shrink-0 bg-white"
                disabled={updateBookedAmountMutation.isPending}
                onClick={() => {
                  const val = bookedAmountInput.trim();
                  const parsed = val === "" ? null : parseInt(val, 10);
                  if (val !== "" && (isNaN(parsed!) || parsed! < 0)) {
                    toast.error("Enter a valid dollar amount");
                    return;
                  }
                  updateBookedAmountMutation.mutate({ sessionId: session.id, bookedAmount: parsed });
                }}
              >
                {updateBookedAmountMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
              </Button>
            </div>
            <p className="text-xs text-green-600 mt-1">
              {session.bookedAmount !== null && session.bookedAmount !== undefined
                ? `Set to $${session.bookedAmount} — also updates the lead row`
                : session.quotedPrice && Number(session.quotedPrice) > 0
                  ? `Using quoted price: $${Math.round(Number(session.quotedPrice))}`
                  : "Enter amount to set the price for this lead"
              }
            </p>
          </div>

          {/* ── FOLLOW-UP PLAN card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Follow-Up Plan</span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full text-purple-600 border border-purple-200">Smart Sequence</span>
            </div>
            <div className="space-y-2.5 mb-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-base shrink-0">&#128197;</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">Soft check-in</div>
                  <div className="text-xs text-gray-400">{session.followUpDate ?? "Apr 10"}</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border border-gray-200 text-gray-400 shrink-0">queued</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50">
                <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-base shrink-0">&#128276;</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">Filling up / urgency</div>
                  <div className="text-xs text-gray-400">Apr 25</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border border-orange-200 text-orange-500 bg-orange-50 shrink-0">recommended</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
                <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-base shrink-0">&#128197;</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-800">Last call before move-in</div>
                  <div className="text-xs text-gray-400">May 1</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full border border-purple-200 text-purple-500 bg-purple-50 shrink-0">drafted</span>
              </div>
            </div>
            <div className="pt-3 border-t border-gray-100 space-y-2">
              <input
                type="date"
                value={followUpDate}
                onChange={e => setFollowUpDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 focus:outline-none focus:border-orange-300"
              />
              <button
                onClick={() => setFollowUpMutation.mutate({ sessionId: session.id, followUpDate, followUpMessage })}
                disabled={!followUpDate || setFollowUpMutation.isPending}
                className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                style={{ backgroundColor: "#F97316" }}
              >
                {setFollowUpMutation.isPending ? "Saving..." : followUpSaved ? "Saved!" : "Schedule Follow-Up"}
              </button>
            </div>
          </div>

          {/* ── QUICK CONTROLS card ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-4">Quick Controls</div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => { if (session.leadPhone) window.open(`openphone://call?to=${session.leadPhone}`, "_self"); }}
                className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors"
              >
                <span>&#128222;</span> Call lead
              </button>
              <button
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set("sessionId", String(session.id));
                  if (session.leadName)    params.set("name",        encodeURIComponent(session.leadName));
                  if (session.leadPhone)   params.set("phone",       encodeURIComponent(session.leadPhone));
                  if (session.bedrooms)    params.set("bedrooms",    encodeURIComponent(String(session.bedrooms)));
                  if (session.bathrooms)   params.set("bathrooms",   encodeURIComponent(String(session.bathrooms)));
                  if (session.serviceType) params.set("serviceType", encodeURIComponent(session.serviceType));
                  if (session.address)     params.set("address",     encodeURIComponent(session.address));
                  window.open(`/call-assist?${params.toString()}`, "_blank");
                }}
                className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-100 transition-colors"
              >
                <span>&#127381;</span> Call Assist
              </button>
              <button
                onClick={() => applySuggestion(-1)}
                className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors"
              >
                <span>&#128197;</span> Reschedule
              </button>
              <button
                onClick={() => {
                  setAiModeMutation.mutate({ sessionId: session.id, aiMode: 1 });
                  toast.success("Handed back to AI");
                }}
                className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors"
              >
                <span>&#129302;</span> Hand back to AI
              </button>
              <button
                onClick={() => markHandledMutation.mutate({ sessionId: session.id })}
                disabled={markHandledMutation.isPending}
                className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 transition-colors disabled:opacity-50"
              >
                <span>&#10003;</span> Mark as handled
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors">
                    <span>&#128230;</span> Archive
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                    <AlertDialogDescription>This will permanently remove the lead and all conversation history. This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => deleteLeadMutation.mutate({ sessionId: session.id })}
                    >
                      Yes, delete permanently
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {isAdmin && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                <div className="text-xs text-gray-400 font-medium">Assigned Agent</div>
                <div className="flex items-center gap-1.5">
                  <Select
                    value={session.assignedAgentId?.toString() ?? "unassigned"}
                    onValueChange={(val) => {
                      const agentId = val === "unassigned" ? null : parseInt(val, 10);
                      if (agentId === session.assignedAgentId) return;
                      assignAgentMutation.mutate({ sessionId: session.id, agentId });
                    }}
                    disabled={assignAgentMutation.isPending}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned" className="text-xs">— Unassigned —</SelectItem>
                      {activeAgents.map(a => (
                        <SelectItem key={a.id} value={a.id.toString()} className="text-xs">{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {assignAgentMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>

    {/* ══ AI Call Score Modal ══ */}
    {scorePanel && (
      <Dialog open={showScoreModal} onOpenChange={setShowScoreModal}>
        <DialogContent className="max-w-xl w-full max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-purple-500" />
              AI Sales Analysis
            </DialogTitle>
          </DialogHeader>

          {/* Overall score */}
          <div className="flex items-center gap-4 py-3 border-b border-gray-100">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 font-bold text-xl"
              style={{
                background: scoreColor(scorePanel.data.overallScore) + '18',
                color: scoreColor(scorePanel.data.overallScore),
                border: `3px solid ${scoreColor(scorePanel.data.overallScore)}`,
              }}
            >
              {scorePanel.data.overallScore}
            </div>
            <div>
              <div className="text-sm font-bold text-gray-800">Overall Sales Score</div>
              <div className="text-xs text-gray-500 mt-0.5 leading-snug max-w-xs">{scorePanel.data.summary}</div>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="space-y-4 py-3 border-b border-gray-100">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Category Breakdown</div>
            {scorePanel.data.categories.map((cat, ci) => (
              <div key={ci}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-semibold text-gray-700">{cat.name}</span>
                  <span className="text-sm font-bold" style={{ color: scoreColor(Math.round(cat.score / cat.maxScore * 100)) }}>
                    {cat.score}/{cat.maxScore}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round(cat.score / cat.maxScore * 100)}%`,
                      background: scoreColor(Math.round(cat.score / cat.maxScore * 100)),
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{cat.feedback}</p>
              </div>
            ))}
          </div>

          {/* Strengths */}
          {scorePanel.data.strengths.length > 0 && (
            <div className="py-3 border-b border-gray-100">
              <div className="text-xs font-bold text-green-700 uppercase tracking-wide mb-2">✓ Strengths</div>
              <ul className="space-y-1">
                {scorePanel.data.strengths.map((s, si) => (
                  <li key={si} className="flex gap-2 text-sm text-gray-600">
                    <span className="text-green-500 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvements */}
          {scorePanel.data.improvements.length > 0 && (
            <div className="py-3 border-b border-gray-100">
              <div className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">↑ Areas to Improve</div>
              <ul className="space-y-1">
                {scorePanel.data.improvements.map((s, si) => (
                  <li key={si} className="flex gap-2 text-sm text-gray-600">
                    <span className="text-amber-500 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Coaching tips */}
          {scorePanel.data.coachingTips.length > 0 && (
            <div className="py-3">
              <div className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-2">💡 Coaching Tips</div>
              <ul className="space-y-2">
                {scorePanel.data.coachingTips.map((s, si) => (
                  <li key={si} className="flex gap-2 text-sm text-gray-600 bg-purple-50 rounded-lg px-3 py-2">
                    <span className="text-purple-500 shrink-0 font-bold">{si + 1}.</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    )}
      {/* ── Lost Reason Picker ── */}
      {pendingLostSession && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPendingLostSession(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-80 max-w-[90vw]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm font-bold text-gray-800">Mark as Lost</span>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Why is <span className="font-semibold text-gray-700">{pendingLostSession.name ?? "this lead"}</span> not moving forward?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "price" as const, label: "Price", color: "#ef4444", bg: "bg-red-50 hover:bg-red-100 border-red-200" },
                { key: "timing" as const, label: "Timing", color: "#f97316", bg: "bg-orange-50 hover:bg-orange-100 border-orange-200" },
                { key: "no_response" as const, label: "No Response", color: "#6b7280", bg: "bg-gray-50 hover:bg-gray-100 border-gray-200" },
                { key: "competitor" as const, label: "Competitor", color: "#8b5cf6", bg: "bg-violet-50 hover:bg-violet-100 border-violet-200" },
              ]).map(r => (
                <button
                  key={r.key}
                  onClick={() => {
                    markAsLostMutation.mutate(
                      { sessionId: pendingLostSession.id, lostReason: r.key },
                      { onSettled: () => setPendingLostSession(null) }
                    );
                  }}
                  disabled={markAsLostMutation.isPending}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition-colors ${r.bg}`}
                  style={{ color: r.color }}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                markAsLostMutation.mutate(
                  { sessionId: pendingLostSession.id, lostReason: "other" },
                  { onSettled: () => setPendingLostSession(null) }
                );
              }}
              disabled={markAsLostMutation.isPending}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-500 transition-colors"
            >
              Other
            </button>
            <button
              onClick={() => setPendingLostSession(null)}
              className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Date filter bar ───────────────────────────────────────────────────────────

type DatePreset = "today" | "yesterday" | "last7" | "last30" | "quarter" | "custom" | "all";

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
  if (preset === "quarter") {
    const q = Math.floor(today.getMonth() / 3);
    const from = new Date(today.getFullYear(), q * 3, 1);
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
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false, staleTime: 5 * 60 * 1000 });
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
  const [showFollowUpsModal, setShowFollowUpsModal] = useState(false);
  const [showCompletedCallbacks, setShowCompletedCallbacks] = useState(false);
  // Bulk selection for leads table
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
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
  const [statsMode, setStatsMode] = useState<'all' | 'organic' | 'campaign'>('all');
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<DrawerSession | null>(null);

  // ── Add Manual Lead modal ─────────────────────────────────────────────────
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState({
    name: "", phone: "", email: "", serviceType: "Standard Cleaning",
    notes: "", amount: "", status: "QUOTE_SENT",
    source: "phone" as "yelp" | "google" | "thumbtack" | "bark" | "phone" | "other",
  });
  const createManualLeadMutation = trpc.leads.createManual.useMutation({
    onSuccess: () => {
      toast.success("Lead added and claimed!");
      setAddLeadOpen(false);
      setAddLeadForm({ name: "", phone: "", email: "", serviceType: "Standard Cleaning", notes: "", amount: "", status: "QUOTE_SENT", source: "phone" });
      trpcUtils.leads.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // ── First Message Generator modal (shared across lead drawer wand buttons) ──
  const [firstMsgOpen, setFirstMsgOpen] = useState(false);
  const [firstMsgDetails, setFirstMsgDetails] = useState("");
  const [firstMsgResult, setFirstMsgResult] = useState("");
  const [firstMsgCopied, setFirstMsgCopied] = useState(false);
  const generateFirstMessageMutation = trpc.tools.generateFirstMessage.useMutation({
    onSuccess: (data) => { setFirstMsgResult(data.message); setFirstMsgCopied(false); },
    onError: () => toast.error("Failed to generate message. Try again."),
  });

  const [pipelineDateFilter, setPipelineDateFilter] = useState<"today" | "week" | "month">("month");
  const [pipelineView, setPipelineView] = useState<"pipeline" | "flow">("pipeline");
  const [pipelineSelectedLead, setPipelineSelectedLead] = useState<null>(null);
  const [pipelineIsPanelOpen, setPipelineIsPanelOpen] = useState(false);
  const [pipelinePanelMode, setPipelinePanelMode] = useState<"lead" | "actions">("lead");
  const [pipelineFlowIndex, setPipelineFlowIndex] = useState(0);
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [pipelineSelectedDate, setPipelineSelectedDate] = useState("Today");

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
  useOpsStream({
    onPhoneUpdate: (leadName, newPhone) => {
      toast.success(`Updated ${leadName}'s phone to ${newPhone}`, { duration: 8000 });
    },
  }, { enabled: hasSession });

  // Call recording indicators — lightweight map of sessionId → { hasRecording, hasTranscript, callScore }
  const { data: recordingMap = {} } = trpc.leads.getSessionsWithRecordings.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: hasSession,
  });

  const { data: stats } = trpc.leads.stats.useQuery(dateRange, {
    refetchInterval: 30000,
    enabled: hasSession,
  });

  // Executive summary counts — computed from the same sessions array used by the leads table.
  // This guarantees the count and the filtered list are always identical.
  const attentionLoading = sessionsLoading;
  const attentionData = useMemo(() => {
    if (!sessions.length) return null;
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const FOUR_HOURS_MS = 4 * ONE_HOUR_MS;
    const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
    const closedStages = ["BOOKED", "COMPLETED", "CLOSED", "LOST", "COLD"];
    let unrespondedUrgent = 0;
    let unrespondedWarning = 0;
    let unhandledCount = 0;
    let hotLeadsCount = 0;
    let unreadCount2 = 0;
    for (const s of sessions) {
      const hist: Array<{ role: string; ts?: number }> = (() => {
        try { return JSON.parse((s as any).messageHistory ?? "[]"); } catch { return []; }
      })();
      const respondedAt = (s as any).respondedAt as number | null | undefined;
      // AWAITING_REPLY (unresponded) — same logic as the stageFilter === "AWAITING_REPLY" branch
      if (!closedStages.includes(s.stage ?? "")) {
        const lastMsg = hist.length > 0 ? hist[hist.length - 1] : null;
        if (lastMsg && (lastMsg.role === "user" || lastMsg.role === "customer")) {
          const isHandled = respondedAt && lastMsg.ts && lastMsg.ts <= respondedAt;
          if (!isHandled) {
            const age = lastMsg.ts ? now - lastMsg.ts : 0;
            if (age > FOUR_HOURS_MS) unrespondedUrgent++;
            else if (age > ONE_HOUR_MS) unrespondedWarning++;
          }
        }
      }
      // UNHANDLED — same logic as stageFilter === "UNHANDLED" branch
      if (s.stage === "UNHANDLED") {
        const lastCustomer = [...hist].reverse().find(m => m.role === "user" || m.role === "customer");
        const isHandled = respondedAt && (!lastCustomer?.ts || lastCustomer.ts <= respondedAt);
        if (!isHandled) unhandledCount++;
      }
      // HOT_LEADS — same logic as stageFilter === "HOT_LEADS" branch
      if (!closedStages.includes(s.stage ?? "")) {
        const lastCustomer = [...hist].reverse().find(m => m.role === "user" || m.role === "customer");
        if (lastCustomer?.ts && (now - lastCustomer.ts) <= SEVENTY_TWO_HOURS_MS) hotLeadsCount++;
      }
      // UNREAD — same flag computed by leads.list server-side
      if (!!(s as any).hasUnread) unreadCount2++;
    }
    type Severity = "urgent" | "warning" | "ok";
    const items: Array<{ key: string; label: string; count: number; detail: string; severity: Severity }> = [
      {
        key: "unresponded",
        label: "Unresponded leads",
        count: unrespondedUrgent + unrespondedWarning,
        detail: unrespondedUrgent > 0
          ? `${unrespondedUrgent} lead${unrespondedUrgent !== 1 ? "s" : ""} waiting 4+ hours for a reply`
          : unrespondedWarning > 0
          ? `${unrespondedWarning} lead${unrespondedWarning !== 1 ? "s" : ""} waiting 1–4 hours for a reply`
          : "All leads have been responded to",
        severity: unrespondedUrgent > 0 ? "urgent" : unrespondedWarning > 0 ? "warning" : "ok",
      },
      {
        key: "unhandled",
        label: "Unhandled leads",
        count: unhandledCount,
        detail: unhandledCount > 0
          ? `${unhandledCount} lead${unhandledCount !== 1 ? "s" : ""} need immediate attention`
          : "No unhandled leads — great work!",
        severity: unhandledCount > 0 ? "urgent" : "ok",
      },
      {
        key: "hot_leads",
        label: "Hot leads",
        count: hotLeadsCount,
        detail: hotLeadsCount > 0
          ? `${hotLeadsCount} lead${hotLeadsCount !== 1 ? "s" : ""} active in the last 72 hours`
          : "No hot leads right now",
        severity: hotLeadsCount > 0 ? "warning" : "ok",
      },
      {
        key: "unread",
        label: "Unread messages",
        count: unreadCount2,
        detail: unreadCount2 > 0
          ? `${unreadCount2} lead${unreadCount2 !== 1 ? "s" : ""} with new messages you haven't seen`
          : "All messages have been read",
        severity: unreadCount2 > 0 ? "warning" : "ok",
      },
    ];
    const overallSeverity: Severity =
      items.some(i => i.severity === "urgent") ? "urgent" :
      items.some(i => i.severity === "warning") ? "warning" : "ok";
    return { items, overallSeverity };
  }, [sessions]);
  const { data: visitorStats } = trpc.leads.visitorStats.useQuery(dateRange, {
    refetchInterval: 60000,
    enabled: hasSession,
  });

  const { data: voiceStats } = trpc.voice.stats.useQuery({ days: 30, ...dateRange }, {
    refetchInterval: 300_000,
    enabled: hasSession,
  });

  const { data: dailyTrend = [] } = trpc.leads.dailyTrend.useQuery(undefined, {
    refetchInterval: 300_000, // refresh every 5 minutes
    enabled: hasSession,
  });
  // Agent photo map — name→photoUrl, mirrors opsChat.getAllAgentPhotoMap
  // Covers short names, full names, and OAuth aliases so lookups always resolve.
  const { data: agentPhotoMapData } = trpc.agents.getPhotoMap.useQuery(undefined, {
    staleTime: 0,
    refetchInterval: 30_000,
    enabled: hasSession,
  });
  const agentPhotoMap = agentPhotoMapData?.photos ?? {};

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
  const bulkDeleteMutation = trpc.leads.bulkDeleteLeads.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.deleted} lead${data.deleted === 1 ? '' : 's'} deleted`);
      setSelectedIds(new Set());
      setBulkDeleteConfirmOpen(false);
      trpcUtils.leads.list.invalidate();
      trpcUtils.leads.stats.invalidate();
      trpcUtils.leads.attentionItems.invalidate();
      trpcUtils.opsChat.getCommandChatData.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const bookLeadMutation = trpc.leads.agentUpdateStage.useMutation({
    onSuccess: () => {
      trpcUtils.leads.list.invalidate();
      trpcUtils.leads.stats.invalidate();
      toast.success("Lead booked");
    },
    onError: (e) => toast.error(e.message),
  });
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
      // AWAITING_REPLY is a synthetic filter: last message in history is from the customer (role:"user")
      // and the session is not booked/closed.
      let matchesStage: boolean;
      if (stageFilter === "AWAITING_REPLY") {
        try {
          const hist: Array<{ role: string; ts?: number }> = JSON.parse((s as any).messageHistory ?? "[]");
          const lastMsg = hist.length > 0 ? hist[hist.length - 1] : null;
          const lastRole = lastMsg?.role ?? null;
          const closedStages = ["BOOKED", "COMPLETED", "CLOSED", "LOST", "COLD"];
          const isUnresponded = (lastRole === "user" || lastRole === "customer") && !closedStages.includes(s.stage ?? "");
          // Exclude if agent already marked handled AND no new customer message since
          const respondedAt = (s as any).respondedAt as number | null | undefined;
          const isHandled = respondedAt && lastMsg?.ts && lastMsg.ts <= respondedAt;
          matchesStage = isUnresponded && !isHandled;
        } catch {
          matchesStage = false;
        }
      } else if (stageFilter === "UNHANDLED") {
        // UNHANDLED is also a synthetic filter: show only stage=UNHANDLED leads
        // that have NOT been marked handled (respondedAt is null, or last customer
        // message arrived AFTER respondedAt — meaning a new message came in).
        try {
          const hist: Array<{ role: string; ts?: number }> = JSON.parse((s as any).messageHistory ?? "[]");
          const lastCustomerMsg = [...hist].reverse().find(m => m.role === "user" || m.role === "customer");
          const respondedAt = (s as any).respondedAt as number | null | undefined;
          const isHandled = respondedAt && (!lastCustomerMsg?.ts || lastCustomerMsg.ts <= respondedAt);
          matchesStage = s.stage === "UNHANDLED" && !isHandled;
        } catch {
          matchesStage = s.stage === "UNHANDLED";
        }
      } else if (stageFilter === "HOT_LEADS") {
        // HOT_LEADS synthetic filter: active leads where the customer sent a message
        // within the last 72 hours (still thinking about booking).
        const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
        const closedStages = ["BOOKED", "COMPLETED", "CLOSED", "LOST", "COLD"];
        if (closedStages.includes(s.stage ?? "")) {
          matchesStage = false;
        } else {
          try {
            const hist: Array<{ role: string; ts?: number }> = JSON.parse((s as any).messageHistory ?? "[]");
            const lastCustomer = [...hist].reverse().find(m => m.role === "user" || m.role === "customer");
            matchesStage = !!lastCustomer?.ts && (Date.now() - lastCustomer.ts) <= SEVENTY_TWO_HOURS_MS;
          } catch {
            matchesStage = false;
          }
        }
      } else if (stageFilter === "UNREAD") {
        // UNREAD synthetic filter: leads where hasUnread is true (server-computed)
        matchesStage = !!(s as any).hasUnread;
      } else {
        matchesStage = stageFilter === "all" || s.stage === stageFilter;
      }
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
        (sourceFilter === "bark" && (s.leadSource === "bark" || s.leadSource === "bark-sms")) ||
        (sourceFilter === "yelp" && s.leadSource === "yelp") ||
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
  const unreadCount = sessions.filter(s => !!(s as any).hasUnread).length;
  const [leadsView, setLeadsView] = useState<"split" | "board">("split");
  const [leadsCollapsed, setLeadsCollapsed] = useState(false);
  const [selectedLeadPanel, setSelectedLeadPanel] = useState<typeof sessions[0] | null>(null);
  // No auto-select — table starts full-width with nothing selected
  // ── Auth guards (after ALL hooks)) ─────────────────────────────────────────────────────
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
    { value: "all", label: "All" },
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last7", label: "Last 7 days" },
    { value: "last30", label: "Last 30 days" },
    { value: "quarter", label: "This quarter" },
    { value: "custom", label: "Custom range" },
  ];

  return (
    <div className={"min-h-screen hj-theme" + (activeTab === "leads" || activeTab === "pipeline" ? " bg-[#f6f5f2]" : "")}>
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
            {activeTab === "leads" && (
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            )}
          </>
        }
       />
      {/* ── Date filter bar — Leads page only, pixel-perfect match to reference ── */}
      {activeTab === "leads" && (
        <div className="border-b border-zinc-200 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5">
            {/* Pill group container — single rounded border wrapping all pills */}
            <div className="inline-flex items-center rounded-2xl border border-zinc-200 bg-white px-1 py-1 gap-0.5">
              {DATE_PRESETS.filter(p => p.value !== "custom").map((p) => (
                <button
                  key={p.value}
                  onClick={() => { setDatePreset(p.value); setCustomFrom(""); setCustomTo(""); }}
                  className={`rounded-xl px-4 py-1.5 text-sm transition-all ${
                    datePreset === p.value
                      ? "bg-zinc-950 text-white font-semibold shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 font-normal"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {/* Custom range — standalone calendar icon button */}
              <button
                onClick={() => setDatePreset("custom")}
                className={`ml-0.5 flex h-8 w-8 items-center justify-center rounded-xl border transition-all ${
                  datePreset === "custom"
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-800"
                }`}
                title="Custom range"
              >
                <Calendar className="h-4 w-4" />
              </button>
            </div>
            {/* Custom date inputs — shown inline when custom is selected */}
            {datePreset === "custom" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
                <span className="text-zinc-400 text-sm">–</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                />
              </div>
            )}
          </div>
        </div>
      )}
      <main className={(activeTab === "leads" || activeTab === "pipeline") ? "py-0" : "max-w-7xl mx-auto px-4 sm:px-6 py-6"}>
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
        {activeTab === "pipeline" && <PipelineBoard onOpenConversation={(session) => setSelectedSession(session as DrawerSession)} />}
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
        {/* ── New Leads Page Design ─────────────────────────────────────────── */}
        <div id="leads-table-section" className="bg-[#f6f5f2] text-zinc-900" style={{ minHeight: "calc(100vh - 200px)" }}>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_280px]">
              {/* ── Left column ─────────────────────────────────────────────── */}
              <div className="space-y-6">
                {/* Metric cards */}
                {stats && (
                  <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    {/* Qualified Leads */}
                    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.18 }}>
                      <Card className="rounded-2xl border-black/5 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-zinc-500">Leads</div>
                                <Badge variant="outline" className="rounded-full border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                                  {datePreset === "all" ? "All time" : datePreset === "today" ? "Today" : datePreset === "yesterday" ? "Yesterday" : datePreset === "last7" ? "Last 7d" : datePreset === "last30" ? "Last 30d" : "Custom"}
                                </Badge>
                              </div>
                              <div className="mt-2 text-3xl font-semibold tracking-[-0.03em] leading-none">
                                {statsMode === "all" ? (stats.total ?? 0) : statsMode === "organic" ? (stats.organic?.total ?? 0) : (stats.campaign?.total ?? 0)}
                              </div>
                              <div className="mt-3 flex items-center gap-2 text-sm">
                                <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                                  {statsMode === "organic" ? "organic" : statsMode === "campaign" ? "campaign" : "all channels"}
                                </span>
                              </div>
                            </div>
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 shrink-0">
                              <Activity className="h-5 w-5 text-zinc-700" />
                            </div>
                          </div>
                          <div className="mt-3 flex items-end gap-2">
                            {(dailyTrend.length > 0 ? dailyTrend : Array(7).fill({ leads: 0 })).slice(-7).map((d, i) => {
                              const max = Math.max(...dailyTrend.map(x => x.leads), 1);
                              const h = Math.round(((d.leads ?? 0) / max) * 100);
                              return (
                                <div key={i} className="h-12 flex-1 rounded-full bg-zinc-100 p-1">
                                  <div className="w-full rounded-full bg-lime-300/80" style={{ height: `${h}%` }} />
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                    {/* Booked Revenue */}
                    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.18 }}>
                      <Card className="rounded-2xl border-black/5 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-500">Booked revenue</div>
                              <div className="mt-2 text-3xl font-semibold tracking-[-0.03em] leading-none">
                                ${(() => {
                                  const view = statsMode === "all" ? stats : statsMode === "organic" ? stats.organic : stats.campaign;
                                  return (view?.bookedRevenue ?? 0).toLocaleString();
                                })()}
                              </div>
                              <div className="mt-3 flex items-center gap-2 text-sm">
                                <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                                  from {(() => {
                                    const view = statsMode === "all" ? stats : statsMode === "organic" ? stats.organic : stats.campaign;
                                    return view?.bookedCount ?? 0;
                                  })()} jobs
                                </span>
                              </div>
                            </div>
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 shrink-0">
                              <Wallet className="h-5 w-5 text-zinc-700" />
                            </div>
                          </div>
                          <div className="mt-3 flex items-end gap-2">
                            {(dailyTrend.length > 0 ? dailyTrend : Array(7).fill({ booked: 0 })).slice(-7).map((d, i) => {
                              const max = Math.max(...dailyTrend.map(x => x.booked), 1);
                              const h = Math.round(((d.booked ?? 0) / max) * 100);
                              return (
                                <div key={i} className="h-12 flex-1 rounded-full bg-zinc-100 p-1">
                                  <div className="w-full rounded-full bg-lime-300/80" style={{ height: `${h}%` }} />
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                    {/* Conversion Rate */}
                    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.18 }}>
                      <Card className="rounded-2xl border-black/5 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-500">Conversion rate</div>
                              <div className="mt-2 text-3xl font-semibold tracking-[-0.03em] leading-none">
                                {(() => {
                                  const view = statsMode === "all" ? stats : statsMode === "organic" ? stats.organic : stats.campaign;
                                  return view?.conversionRate ?? 0;
                                })()}%
                              </div>
                              <div className="mt-3 flex items-center gap-2 text-sm">
                                <span className="rounded-full bg-zinc-100 px-2 py-1 font-medium text-zinc-600">lead → booked</span>
                              </div>
                            </div>
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 shrink-0">
                              <Waypoints className="h-5 w-5 text-zinc-700" />
                            </div>
                          </div>
                          <div className="mt-3 flex items-end gap-2">
                            {[28, 58, 42, 66, 51, 74, 49].map((h, i) => (
                              <div key={i} className="h-12 flex-1 rounded-full bg-zinc-100 p-1">
                                <div className="w-full rounded-full bg-lime-300/80" style={{ height: `${h}%` }} />
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                    {/* Incoming AI Calls */}
                    <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.18 }}>
                      <Card className="rounded-2xl border-black/5 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-500">Incoming AI calls</div>
                              <div className="mt-2 text-3xl font-semibold tracking-[-0.03em] leading-none">
                                {(voiceStats?.totalCalls ?? 0).toLocaleString()}
                              </div>
                              <div className="mt-3 flex items-center gap-2 text-sm">
                                <span className="rounded-full bg-zinc-100 px-2 py-1 font-medium text-zinc-600">
                                  {voiceStats?.totalCalls ? `${voiceStats.conversionRate}% booked` : "no calls yet"}
                                </span>
                              </div>
                            </div>
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-100 shrink-0">
                              <Bot className="h-5 w-5 text-zinc-700" />
                            </div>
                          </div>
                          <div className="mt-3 flex items-end gap-2">
                            {(voiceStats?.dailyTrend ?? Array(7).fill({ count: 0 })).slice(-7).map((d, i) => {
                              const arr = (voiceStats?.dailyTrend ?? []).slice(-7);
                              const max = Math.max(...arr.map(x => x.count), 1);
                              const h = Math.round(((d.count ?? 0) / max) * 100);
                              return (
                                <div key={i} className="h-12 flex-1 rounded-full bg-zinc-100 p-1">
                                  <div className="w-full rounded-full bg-lime-300/80" style={{ height: `${h}%` }} />
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  </section>
                )}

                {/* Action cards */}
                <section className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setStageFilter("BOOKED")}
                    className="rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md bg-emerald-50 border-emerald-200"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-zinc-500">Hot leads</div>
                        <div className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{stats?.byStage?.["BOOKED"] ?? 0}</div>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">Booked and confirmed jobs</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70">
                        <Star className="h-5 w-5" />
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setStageFilter("UNHANDLED")}
                    className="rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md bg-amber-50 border-amber-200"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-zinc-500">Needs rescue</div>
                        <div className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{stats?.byStage?.["UNHANDLED"] ?? 0}</div>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">Unhandled leads requiring review</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70">
                        <AlertTriangle className="h-5 w-5" />
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setStageFilter("COLD")}
                    className="rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md bg-rose-50 border-rose-200"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-zinc-500">Cold / Lost</div>
                        <div className="mt-1 text-3xl font-semibold tracking-[-0.03em]">{(stats?.byStage?.["COLD"] ?? 0) + (stats?.byStage?.["LOST"] ?? 0)}</div>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">Leads that went cold or were lost</p>
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/70">
                        <CircleAlert className="h-5 w-5" />
                      </div>
                    </div>
                  </button>
                </section>

                {/* Lead command center */}
                  <Card className="overflow-hidden rounded-[30px] border-black/5 bg-white shadow-[0_10px_40px_rgba(0,0,0,0.05)]">
                  <CardHeader className="border-b border-black/5 px-4 py-3">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-8">
                      <div>
                        <CardTitle className="text-[26px] tracking-[-0.03em]">Lead command center</CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">Cleaner hierarchy, stronger emphasis, faster decision-making.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(["all", "BOOKED", "QUOTE_SENT", "FOLLOW_UP_SCHEDULED", "UNHANDLED", "COLD"] as const).map((stage) => (
                          <button
                            key={stage}
                            onClick={() => setStageFilter(stage)}
                            className={`rounded-xl px-2.5 py-1 text-xs font-medium whitespace-nowrap transition ${
                              stageFilter === stage
                                ? "bg-zinc-950 text-white shadow-sm"
                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                            }`}
                          >
                            {stage === "all" ? "All" : STAGE_CONFIG[stage as Stage]?.label ?? stage}
                          </button>
                        ))}
                        {/* Unread quick-filter button */}
                        <button
                          onClick={() => setStageFilter(stageFilter === "UNREAD" ? "all" : "UNREAD")}
                          className={`relative rounded-xl px-2.5 py-1 text-xs font-medium whitespace-nowrap transition ${
                            stageFilter === "UNREAD"
                              ? "bg-blue-600 text-white shadow-sm"
                              : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                          }`}
                        >
                          Unread
                          {unreadCount > 0 && (
                            <span className="ml-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
                              {unreadCount}
                            </span>
                          )}
                        </button>
                        {/* Clear pill — shown when a synthetic/attention-driven filter is active */}
                        {stageFilter === "AWAITING_REPLY" && (
                          <span className="inline-flex items-center gap-1 rounded-xl bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                            Filtered: Unresponded
                            <button
                              onClick={() => setStageFilter("all")}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-amber-200 transition"
                              aria-label="Clear filter"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {stageFilter === "UNHANDLED" && (
                          <span className="inline-flex items-center gap-1 rounded-xl bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                            Filtered: Unhandled
                            <button
                              onClick={() => setStageFilter("all")}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-rose-200 transition"
                              aria-label="Clear filter"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {stageFilter === "HOT_LEADS" && (
                          <span className="inline-flex items-center gap-1 rounded-xl bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700">
                            Filtered: Hot Leads
                            <button
                              onClick={() => setStageFilter("all")}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-orange-200 transition"
                              aria-label="Clear filter"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                        {stageFilter === "UNREAD" && (
                          <span className="inline-flex items-center gap-1 rounded-xl bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                            Filtered: Unread
                            <button
                              onClick={() => setStageFilter("all")}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200 transition"
                              aria-label="Clear filter"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-1 flex-wrap items-center gap-3">
                        <div className="relative min-w-[160px] flex-1 xl:max-w-sm">
                          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                          <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name, phone, service, source..."
                            className="h-9 rounded-2xl border-zinc-200 bg-zinc-50 pl-10 text-sm"
                          />
                        </div>
                        <Select value={agentFilter} onValueChange={setAgentFilter}>
                          <SelectTrigger className="h-9 w-32 rounded-2xl border-zinc-200 bg-white text-sm">
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
                          <SelectTrigger className="h-9 w-32 rounded-2xl border-zinc-200 bg-white text-sm">
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
                            <SelectItem value="yelp">Yelp</SelectItem>
                          </SelectContent>
                        </Select>
                        {(agentFilter !== "all" || sourceFilter !== "all" || search) && (
                          <button
                            onClick={() => { setAgentFilter("all"); setSourceFilter("all"); setSearch(""); }}
                            className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-700 transition"
                          >
                            <X className="h-3.5 w-3.5" /> Clear
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          className="h-9 rounded-2xl bg-white text-sm"
                          onClick={() => setLeadsCollapsed(v => !v)}
                        >
                          {leadsCollapsed ? <PanelLeftOpen className="mr-2 h-4 w-4" /> : <PanelLeftClose className="mr-2 h-4 w-4" />}
                          {leadsCollapsed ? "Show list" : "Focus mode"}
                        </Button>
                        <div className="rounded-2xl bg-zinc-100 p-1">
                          <button
                            onClick={() => setLeadsView("split")}
                            className={`rounded-xl px-3 py-2 text-sm transition ${leadsView === "split" ? "bg-white shadow-sm" : "text-zinc-500"}`}
                          >
                            Split
                          </button>
                          <button
                            onClick={() => setLeadsView("board")}
                            className={`rounded-xl px-3 py-2 text-sm transition ${leadsView === "board" ? "bg-white shadow-sm" : "text-zinc-500"}`}
                          >
                            Board
                          </button>
                        </div>
                        <Button
                          size="sm"
                          className="h-9 rounded-2xl bg-zinc-950 hover:bg-zinc-800 px-4 text-sm"
                          onClick={() => setAddLeadOpen(true)}
                        >
                          <Plus className="mr-2 h-4 w-4" /> Add Lead
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {leadsView === "board" ? (
                      <div className="p-6">
                        {filtered.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
                            <Users className="h-10 w-10 mb-3 opacity-40" />
                            <div className="text-sm">No leads match the current filters</div>
                          </div>
                        ) : (
                          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {filtered.map((lead) => {
                              function boardStatusLabel(stage: string): string {
                                if (["BOOKED", "COMPLETED"].includes(stage)) return "Booked";
                                if (["QUOTE_SENT", "AVAILABILITY", "CONFIRMATION", "SLOT_CHOICE"].includes(stage)) return "Quoted";
                                if (["FOLLOW_UP_SCHEDULED", "COLD"].includes(stage)) return "Needs Follow-up";
                                if (["WIDGET_SIZING", "TIME_PREF", "ADDRESS"].includes(stage)) return "Sizing";
                                if (["LOST", "REACTIVATION"].includes(stage)) return "At Risk";
                                return "Quoted";
                              }
                              function boardStatusTone(status: string): string {
                                switch (status) {
                                  case "Booked": return "bg-emerald-100 text-emerald-700 border-emerald-200";
                                  case "Quoted": return "bg-sky-100 text-sky-700 border-sky-200";
                                  case "Needs Follow-up": return "bg-amber-100 text-amber-800 border-amber-200";
                                  case "Sizing": return "bg-violet-100 text-violet-700 border-violet-200";
                                  case "At Risk": return "bg-rose-100 text-rose-700 border-rose-200";
                                  default: return "bg-zinc-100 text-zinc-700 border-zinc-200";
                                }
                              }
                              function boardSourceLabel(src: string | null): string {
                                if (!src || src === "form") return "Quote";
                                if (src === "widget") return "Widget";
                                if (src === "email") return "Google Ads Form";
                                if (src === "voice") return "Phone";
                                if (src === "reactivation") return "Campaign";
                                if (src === "yelp") return "Yelp";
                                if (src === "bark") return "Bark";
                                if (src === "thumbtack" || src === "thumbtack-sms") return "Thumbtack";
                                if (src.startsWith("campaign:")) return "Campaign";
                                if (src === "command-center") return "Campaign";
                                if (src.startsWith("always-on:")) return "Referral";
                                return "Referral";
                              }
                              function boardLocation(address: string | null | undefined): string {
                                if (!address) return "";
                                const parts = address.split(",").map(s => s.trim());
                                if (parts.length >= 2) {
                                  const last = parts[parts.length - 1];
                                  const secondLast = parts[parts.length - 2];
                                  const stateMatch = last.match(/^([A-Z]{2})(\s+\d+)?$/);
                                  if (stateMatch) return `${secondLast}, ${stateMatch[1]}`;
                                  return last;
                                }
                                return address.length > 30 ? address.slice(0, 30) + "\u2026" : address;
                              }
                              const status = boardStatusLabel(lead.stage);
                              const tone = boardStatusTone(status);
                              const source = boardSourceLabel(lead.leadSource ?? null);
                              const location = boardLocation(lead.address ?? null);
                              const quote = lead.quotedPrice ? `$${parseInt(lead.quotedPrice, 10).toLocaleString()}` : "\u2014";
                              const agent = lead.assignedAgentName ?? "Unassigned";
                              const summary = lead.lastActivityText ?? "";
                              return (
                                <motion.button
                                  key={lead.id}
                                  whileHover={{ y: -3 }}
                                  transition={{ duration: 0.15 }}
                                  onClick={() => setSelectedSession(lead as unknown as DrawerSession)}
                                  className="rounded-[28px] border border-black/5 bg-white p-5 text-left shadow-sm transition hover:shadow-md w-full"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        {!!(lead as any).hasUnread && (
                                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" title="Unread message" />
                                        )}
                                        <div className="text-2xl font-semibold tracking-[-0.03em] truncate">{lead.leadName ?? lead.leadPhone}</div>
                                      </div>
                                      <div className="mt-1 text-sm text-zinc-500">{lead.leadPhone}</div>
                                    </div>
                                    <span className={`shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${tone}`}>{status}</span>
                                  </div>
                                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-2xl bg-zinc-50 p-3">
                                      <div className="text-zinc-500">Quote</div>
                                      <div className="mt-1 text-xl font-semibold">{quote}</div>
                                    </div>
                                    <div className="rounded-2xl bg-zinc-50 p-3">
                                      <div className="text-zinc-500">Agent</div>
                                      <div className="mt-1 text-xl font-semibold truncate">{agent}</div>
                                    </div>
                                  </div>
                                  <div className="mt-4 flex items-center justify-between text-sm text-zinc-500">
                                    <span>{source}</span>
                                    {location && <span>{location}</span>}
                                  </div>
                                  {summary && (
                                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-600">{summary}</p>
                                  )}
                                </motion.button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="relative min-h-[760px]">
                        {/* Lead list */}
                        {!leadsCollapsed && (
                          <div className="border-r border-black/5">
                            {sessionsLoading ? (
                              <div className="py-20 text-center text-zinc-400">
                                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
                                Loading leads…
                              </div>
                            ) : filtered.length === 0 ? (
                              <div className="py-20 text-center text-zinc-400">
                                <Search className="w-8 h-8 mx-auto mb-3 opacity-30" />
                                <p className="text-sm">No leads match your filters.</p>
                              </div>
                            ) : (
                              <>
                                <div className="grid grid-cols-[32px_1.4fr_1fr_1fr_0.8fr_1fr_1.2fr] gap-3 border-b border-black/5 px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                                  {/* Select-all checkbox */}
                                  <div className="flex items-center">
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 cursor-pointer"
                                      checked={filtered.length > 0 && filtered.every(s => selectedIds.has(s.id))}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedIds(new Set(filtered.map(s => s.id)));
                                        } else {
                                          setSelectedIds(new Set());
                                        }
                                      }}
                                    />
                                  </div>
                                  <div>Lead</div>
                                  <div>Source</div>
                                  <div>Service</div>
                                  <div>Quote</div>
                                  <div>Stage</div>
                                  <div>Agent / activity</div>
                                </div>
                                <div className="divide-y divide-black/5">
                                  {filtered.map((session) => {
                                    const isBooked = Number(session.isBooked) === 1;
                                    const recInfo = (recordingMap as Record<number, { hasRecording: boolean; hasTranscript: boolean; callScore: number | null }>)[session.id];
                                    // Sentiment dot derived from stage
                                    const sentimentColor = (() => {
                                      if (session.stage === "BOOKED" || session.stage === "DONE") return "bg-emerald-500";
                                      if (session.stage === "FOLLOW_UP_SCHEDULED" || session.stage === "AVAILABILITY" || session.stage === "QUOTE_SENT") return "bg-amber-500";
                                      if (session.stage === "UNHANDLED") return "bg-rose-500";
                                      return "bg-zinc-300";
                                    })();
                                    const total = computeTotalQuote(session.quotedPrice ?? null, session.extras ?? null);
                                    const isSelected = selectedLeadPanel?.id === session.id;
                                    const isChecked = selectedIds.has(session.id);
                                    return (
                                      <div
                                        key={session.id}
                                        className={`grid w-full grid-cols-[32px_1.4fr_1fr_1fr_0.8fr_1fr_1.2fr] items-center gap-3 px-6 py-4 transition hover:bg-zinc-50 cursor-pointer ${isChecked ? "bg-blue-50/60" : isSelected ? "bg-lime-50/60" : isBooked ? "bg-emerald-50/30" : ""}`}
                                        onClick={() => {
                                          setSelectedLeadPanel(session);
                                          if (leadsCollapsed) setLeadsCollapsed(false);
                                        }}
                                      >
                                        {/* Row checkbox */}
                                        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                                          <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 cursor-pointer"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              const next = new Set(selectedIds);
                                              if (e.target.checked) next.add(session.id);
                                              else next.delete(session.id);
                                              setSelectedIds(next);
                                            }}
                                          />
                                        </div>
                                        {/* Grid cells (no nested button) */}
                                        <div className="contents">
                                        {/* Lead name + phone + badges */}
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-3">
                                            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${sentimentColor}`} />
                                            <div className="min-w-0">
                                              <div className="text-[15px] font-semibold tracking-[-0.02em] leading-none">
                                                {session.leadName ?? <span className="text-zinc-400 font-normal text-sm">Unknown</span>}
                                              </div>
                                              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                                <span className="text-xs text-zinc-500">{formatPhone(session.leadPhone)}</span>
                                                {recInfo?.hasRecording && (
                                                  <Badge variant="outline" className="rounded-full bg-white text-xs px-2 py-0.5">
                                                    <Phone className="mr-1 h-3 w-3" /> Call
                                                  </Badge>
                                                )}
                                                {recInfo?.hasTranscript && (
                                                  <Badge variant="outline" className="rounded-full bg-white text-xs px-2 py-0.5">
                                                    <FileText className="mr-1 h-3 w-3" /> Transcript
                                                  </Badge>
                                                )}
                                                {(session as { nurtureStatus?: string }).nurtureStatus === 'active' && (
                                                  <Badge className="rounded-full text-xs px-2 py-0.5 bg-violet-100 text-violet-700 border-violet-200 border font-medium">
                                                    <Zap className="mr-1 h-3 w-3" />
                                                    Nurture · {getStepLabel((session as { nurtureNextStep?: number }).nurtureNextStep ?? 3)}
                                                  </Badge>
                                                )}
                                                {(session as { nurtureStatus?: string }).nurtureStatus === 'paused' && (
                                                  <Badge className="rounded-full text-xs px-2 py-0.5 bg-zinc-100 text-zinc-500 border-zinc-200 border font-medium">
                                                    <Pause className="mr-1 h-3 w-3" />
                                                    Paused
                                                  </Badge>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                        {/* Source */}
                                        <div className="flex items-center">
                                          {getSourceBadge(session.leadSource ?? null)}
                                        </div>
                                        {/* Service */}
                                        <div className="flex items-center min-w-0 pr-4">
                                          {getServiceBadge(session.serviceType ?? null)}
                                        </div>
                                        {/* Quote */}
                                        <div className="flex items-center min-w-0 text-[22px] font-semibold tracking-[-0.04em]">
                                          {session.bookedAmount != null && session.bookedAmount > 0
                                            ? `$${session.bookedAmount}`
                                            : total ? `$${total}` : session.reactivationLastPrice ? <span className="text-violet-700">${session.reactivationLastPrice}</span> : <span className="text-zinc-300 text-base">—</span>}
                                        </div>
                                        {/* Stage */}
                                        <div className="flex items-center min-w-0">
                                          <StageBadge stage={session.stage} />
                                        </div>
                                        {/* Agent + last activity */}
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="flex items-center gap-2.5 min-w-0">
                                            {session.assignedAgentName ? (
                                              agentPhotoMap[session.assignedAgentName] ? (
                                                <img
                                                  src={agentPhotoMap[session.assignedAgentName]!}
                                                  alt={session.assignedAgentName}
                                                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                                                />
                                              ) : (
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-300 font-semibold text-zinc-900 text-sm">
                                                  {session.assignedAgentName.charAt(0).toUpperCase()}
                                                </div>
                                              )
                                            ) : (
                                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                                                <User className="h-4 w-4" />
                                              </div>
                                            )}
                                            <div className="min-w-0">
                                              <div className="font-medium text-zinc-800 text-xs truncate">{session.assignedAgentName ?? "Unassigned"}</div>
                                              <div className="text-[11px] text-zinc-400 truncate max-w-[100px] leading-tight">{session.lastActivityText ?? "—"}</div>
                                            </div>
                                          </div>
                                          <div className="text-xs text-zinc-400 whitespace-nowrap shrink-0">
                                            {(() => {
                                              const actAt = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
                                              const updAt = session.updatedAt ? new Date(session.updatedAt) : null;
                                              const display = actAt && updAt && actAt > updAt ? updAt : (actAt ?? updAt);
                                              return display ? timeAgo(display) : "—";
                                            })()}
                                          </div>
                                        </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {/* Right detail panel — fixed overlay drawer */}
                        <AnimatePresence>
                          {selectedLeadPanel && (
                            <>
                              {/* Backdrop */}
                              <motion.div
                                key="backdrop"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="fixed inset-0 z-40 bg-black/20"
                                onClick={() => setSelectedLeadPanel(null)}
                              />
                              {/* Drawer */}
                              <motion.div
                                key={selectedLeadPanel.id}
                                initial={{ opacity: 0, x: 400 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 400 }}
                                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                                className="fixed inset-y-0 right-0 z-50 w-[400px] overflow-y-auto bg-white shadow-2xl p-6 space-y-5"
                              >
                              {/* Header + actions card */}
                              <div className="rounded-[28px] border border-black/5 bg-white p-6 shadow-sm">
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <div className="flex items-center gap-2.5">
                                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 mt-0.5 ${(() => {
                                      if (selectedLeadPanel.stage === "BOOKED" || selectedLeadPanel.stage === "DONE") return "bg-emerald-500";
                                      if (selectedLeadPanel.stage === "FOLLOW_UP_SCHEDULED" || selectedLeadPanel.stage === "AVAILABILITY" || selectedLeadPanel.stage === "QUOTE_SENT") return "bg-amber-500";
                                      if (selectedLeadPanel.stage === "UNHANDLED") return "bg-rose-500";
                                      return "bg-zinc-300";
                                    })()}`} />
                                    <h3 className="text-[22px] font-bold tracking-[-0.02em] leading-tight flex items-center gap-2">
                                      {!!(selectedLeadPanel as any).hasUnread && (
                                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" title="Unread message" />
                                      )}
                                      {selectedLeadPanel.leadName ?? "Unknown"}
                                    </h3>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-zinc-500">
                                    <span>{formatPhone(selectedLeadPanel.leadPhone)}</span>
                                    {selectedLeadPanel.serviceType && (
                                      <>
                                        <span className="h-1 w-1 rounded-full bg-zinc-300" />
                                        <span>{selectedLeadPanel.serviceType}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <StageBadge stage={selectedLeadPanel.stage} />
                                  <button
                                    onClick={() => setSelectedLeadPanel(null)}
                                    className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                              {/* Action buttons */}
                              <div className="mt-4 grid grid-cols-2 gap-2.5">
                                <a
                                  href={`openphone://call?to=${selectedLeadPanel.leadPhone}`}
                                  className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-zinc-950 text-white text-sm font-medium hover:bg-zinc-800 transition"
                                >
                                  <Phone className="h-4 w-4" /> Call lead
                                </a>
                                <button
                                  onClick={() => setSelectedSession(selectedLeadPanel as unknown as DrawerSession)}
                                  className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white text-sm font-medium hover:bg-zinc-50 transition"
                                >
                                  <MessageSquare className="h-4 w-4" /> Send SMS
                                </button>
                                <button
                                  onClick={() => bookLeadMutation.mutate({ sessionId: selectedLeadPanel.id, stage: "BOOKED" })}
                                  disabled={bookLeadMutation.isPending}
                                  className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#7EE8A2] text-slate-800 text-sm font-medium hover:bg-[#6EDB92] transition disabled:opacity-50"
                                >
                                  <CheckCircle2 className="h-4 w-4" /> Book
                                </button>
                                {(recordingMap as Record<number, { hasRecording: boolean; hasTranscript: boolean }>)[selectedLeadPanel.id]?.hasTranscript ? (
                                  <button
                                    onClick={() => {
                                      setDrawerInitialTab("performance");
                                      setSelectedSession(selectedLeadPanel as unknown as DrawerSession);
                                    }}
                                    className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white text-sm font-medium hover:bg-zinc-50 transition"
                                  >
                                    <FileText className="h-4 w-4" /> View transcript
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setSelectedSession(selectedLeadPanel as unknown as DrawerSession)}
                                    className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white text-sm font-medium hover:bg-zinc-50 transition"
                                  >
                                    <Eye className="h-4 w-4" /> Open full view
                                  </button>
                                )}
                              </div>
                              </div>{/* end header+actions card */}
                              {/* AI summary */}
                              <Card className="rounded-[28px] border-black/5 bg-white">
                                <CardContent className="p-5">
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <div className="text-sm font-medium text-zinc-500">AI summary</div>
                                      <p className="mt-2 text-sm leading-6 text-zinc-700">
                                        {selectedLeadPanel.lastActivityText ?? "No recent activity recorded."}
                                      </p>
                                    </div>
                                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-lime-100 shrink-0">
                                      <Sparkles className="h-4 w-4 text-zinc-900" />
                                    </div>
                                  </div>
                                  <div className="mt-5 rounded-2xl border border-lime-200 bg-lime-50 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Next best action</div>
                                    <div className="mt-2 text-base font-semibold tracking-[-0.02em]">
                                      {(() => {
                                        const s = selectedLeadPanel.stage;
                                        if (s === "UNHANDLED") return "Review and respond immediately — lead is waiting.";
                                        if (s === "QUOTE_SENT") return "Follow up on the quote — ask if they have questions.";
                                        if (s === "AVAILABILITY") return "Confirm availability and lock in a time slot.";
                                        if (s === "FOLLOW_UP_SCHEDULED") return "Follow-up is scheduled — prepare your talking points.";
                                        if (s === "BOOKED") return "Job is booked — confirm details with the client.";
                                        if (s === "COLD") return "Send a re-engagement SMS with a limited-time offer.";
                                        if (s === "LOST") return "Send a win-back message — offer a discount or referral.";
                                        return "Open the full conversation to see the latest context.";
                                      })()}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                              {/* Conversion timeline */}
                              <Card className="rounded-[28px] border-black/5 bg-white">
                                <CardContent className="p-4">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="text-sm font-medium text-zinc-500">Conversion timeline</div>
                                      <div className="mt-1 text-xl font-semibold tracking-[-0.02em]">Critical moments</div>
                                    </div>
                                    {computeTotalQuote(selectedLeadPanel.quotedPrice ?? null, selectedLeadPanel.extras ?? null) && (
                                      <Badge variant="outline" className="rounded-full bg-white px-3 py-1">
                                        ${computeTotalQuote(selectedLeadPanel.quotedPrice ?? null, selectedLeadPanel.extras ?? null)} quoted
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="mt-5 space-y-4">
                                    {(() => {
                                      // Build timeline from session data
                                      const events: { label: string; time: string; type: "good" | "warn" | "bad" | "neutral" }[] = [];
                                      if (selectedLeadPanel.createdAt) {
                                        events.push({ label: "Lead created", time: timeAgo(new Date(selectedLeadPanel.createdAt)), type: "good" });
                                      }
                                      if (selectedLeadPanel.quotedPrice || selectedLeadPanel.extras) {
                                        events.push({ label: "Quote sent", time: timeAgo(new Date(selectedLeadPanel.updatedAt ?? selectedLeadPanel.createdAt)), type: "neutral" });
                                      }
                                      if (selectedLeadPanel.stage === "FOLLOW_UP_SCHEDULED") {
                                        events.push({ label: "Follow-up scheduled", time: "Upcoming", type: "warn" });
                                      }
                                      if (selectedLeadPanel.stage === "BOOKED") {
                                        events.push({ label: "Job booked!", time: selectedLeadPanel.bookedAt ? timeAgo(new Date(selectedLeadPanel.bookedAt)) : "Recently", type: "good" });
                                      }
                                      if (selectedLeadPanel.stage === "UNHANDLED") {
                                        events.push({ label: "Awaiting response", time: "Now", type: "bad" });
                                      }
                                      if (selectedLeadPanel.stage === "COLD" || selectedLeadPanel.stage === "LOST") {
                                        events.push({ label: selectedLeadPanel.stage === "LOST" ? "Marked lost" : "Gone cold", time: timeAgo(new Date(selectedLeadPanel.updatedAt ?? selectedLeadPanel.createdAt)), type: "bad" });
                                      }
                                      if (events.length === 0) {
                                        events.push({ label: "Lead created", time: timeAgo(new Date(selectedLeadPanel.createdAt)), type: "neutral" });
                                      }
                                      return events.map((item, i) => (
                                        <div key={i} className="flex gap-4">
                                          <div className="flex flex-col items-center">
                                            <div className={`h-3 w-3 rounded-full ${item.type === "good" ? "bg-emerald-500" : item.type === "warn" ? "bg-amber-500" : item.type === "bad" ? "bg-rose-500" : "bg-zinc-300"}`} />
                                            {i !== events.length - 1 && <div className="mt-2 h-10 w-px bg-zinc-200" />}
                                          </div>
                                          <div className="flex-1 rounded-xl bg-zinc-50 p-3">
                                            <div className="flex items-center justify-between gap-4">
                                              <div className="font-medium text-zinc-800">{item.label}</div>
                                              <div className="text-sm text-zinc-500">{item.time}</div>
                                            </div>
                                          </div>
                                        </div>
                                      ));
                                    })()}
                                  </div>
                                </CardContent>
                              </Card>
                              {/* Mini cards */}
                              <div className="grid grid-cols-3 gap-2">
                                <Card className="rounded-[20px] border-black/5 bg-white">
                                  <CardContent className="p-3 flex flex-col items-center text-center gap-1.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
                                      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                                    </div>
                                    <div className="text-[10px] text-zinc-500">Source</div>
                                    <div className="text-xs font-semibold text-zinc-800 leading-tight text-center">{getSourceBadge(selectedLeadPanel.leadSource ?? null)}</div>
                                  </CardContent>
                                </Card>
                                <Card className="rounded-[20px] border-black/5 bg-white">
                                  <CardContent className="p-3 flex flex-col items-center text-center gap-1.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
                                      <Clock3 className="h-4 w-4 text-amber-700" />
                                    </div>
                                    <div className="text-[10px] text-zinc-500">Created</div>
                                    <div className="text-xs font-semibold text-zinc-800 leading-tight">{timeAgo(new Date(selectedLeadPanel.createdAt))}</div>
                                  </CardContent>
                                </Card>
                                <Card className="rounded-[20px] border-black/5 bg-white">
                                  <CardContent className="p-3 flex flex-col items-center text-center gap-1.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100">
                                      <User className="h-4 w-4 text-sky-700" />
                                    </div>
                                    <div className="text-[10px] text-zinc-500">Agent</div>
                                    <div className="text-xs font-semibold text-zinc-800 leading-tight">{selectedLeadPanel.assignedAgentName ?? "Unassigned"}</div>
                                  </CardContent>
                                </Card>
                              </div>
                              {/* Open full drawer CTA */}
                              <button
                                onClick={() => setSelectedSession(selectedLeadPanel as unknown as DrawerSession)}
                                className="w-full flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition"
                              >
                                <ExternalLink className="h-4 w-4" /> Open full conversation
                              </button>
                            </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Add Manual Lead Dialog */}
                <Dialog open={addLeadOpen} onOpenChange={setAddLeadOpen}>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Add Manual Lead</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 py-2">
                      <div className="mt-4 grid grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <Label>Name *</Label>
                          <Input value={addLeadForm.name} onChange={e => setAddLeadForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
                        </div>
                        <div className="space-y-1">
                          <Label>Phone *</Label>
                          <Input
                            value={addLeadForm.phone}
                            onChange={e => setAddLeadForm(f => ({ ...f, phone: e.target.value }))}
                            onBlur={e => {
                              const digits = e.target.value.replace(/\D/g, "");
                              if (digits.length === 10) {
                                setAddLeadForm(f => ({ ...f, phone: `+1${digits}` }));
                              } else if (digits.length === 11 && digits.startsWith("1")) {
                                setAddLeadForm(f => ({ ...f, phone: `+${digits}` }));
                              }
                            }}
                            placeholder="+1 555 000 0000"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>Email</Label>
                        <Input value={addLeadForm.email} onChange={e => setAddLeadForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <Label>Service Type</Label>
                          <Input value={addLeadForm.serviceType} onChange={e => setAddLeadForm(f => ({ ...f, serviceType: e.target.value }))} placeholder="Standard Cleaning" />
                        </div>
                        <div className="space-y-1">
                          <Label>Amount ($)</Label>
                          <Input type="number" min={0} value={addLeadForm.amount} onChange={e => setAddLeadForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2.5">
                        <div className="space-y-1">
                          <Label>Source</Label>
                          <Select value={addLeadForm.source} onValueChange={v => setAddLeadForm(f => ({ ...f, source: v as typeof f.source }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yelp">Yelp</SelectItem>
                              <SelectItem value="google">Google</SelectItem>
                              <SelectItem value="thumbtack">Thumbtack</SelectItem>
                              <SelectItem value="bark">Bark</SelectItem>
                              <SelectItem value="phone">Phone</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Status</Label>
                          <Select value={addLeadForm.status} onValueChange={v => setAddLeadForm(f => ({ ...f, status: v }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="QUOTE_SENT">Quote Sent</SelectItem>
                              <SelectItem value="AVAILABILITY">Availability</SelectItem>
                              <SelectItem value="BOOKED">Booked</SelectItem>
                              <SelectItem value="COLD">Cold</SelectItem>
                              <SelectItem value="DONE">Done</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>Notes</Label>
                        <Textarea rows={3} value={addLeadForm.notes} onChange={e => setAddLeadForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional notes…" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setAddLeadOpen(false)}>Cancel</Button>
                      <Button
                        disabled={!addLeadForm.name.trim() || !addLeadForm.phone.trim() || createManualLeadMutation.isPending}
                        onClick={() => createManualLeadMutation.mutate({
                          name: addLeadForm.name.trim(),
                          phone: addLeadForm.phone.trim(),
                          email: addLeadForm.email.trim() || undefined,
                          serviceType: addLeadForm.serviceType.trim() || "Standard Cleaning",
                          notes: addLeadForm.notes.trim() || undefined,
                          amount: addLeadForm.amount ? parseInt(addLeadForm.amount, 10) : undefined,
                          status: addLeadForm.status,
                          source: addLeadForm.source,
                        })}
                      >
                        {createManualLeadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Lead"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Traffic Source */}
                <Card className="rounded-2xl border-black/5 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
                  <CardContent className="p-5">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold tracking-[-0.02em]">Traffic Source</h3>
                      <p className="text-sm text-zinc-500 mt-0.5">Where your leads are coming from</p>
                    </div>
                    <SourceBreakdownChart data={sourceBreakdown} isLoading={sourceBreakdownLoading} />
                  </CardContent>
                </Card>
              </div>

              {/* ── Right sidebar ──────────────────────────────────────────── */}
              <div className="space-y-6">
                {/* Executive summary — real-data attention panel */}
                {(() => {
                  const severity = attentionData?.overallSeverity ?? "ok";
                  const items = attentionData?.items ?? [];
                  const isUrgent = severity === "urgent";
                  const isWarning = severity === "warning";
                  // Icon per item key
                  const itemIcon = (key: string) => {
                    if (key === "unresponded") return <MessageSquare className="h-3.5 w-3.5" />;
                    if (key === "unhandled") return <AlertTriangle className="h-3.5 w-3.5" />;
                    if (key === "nurture_paused") return <Inbox className="h-3.5 w-3.5" />;
                    if (key === "hot_leads") return <Flame className="h-3.5 w-3.5" />;
                    return <CircleAlert className="h-3.5 w-3.5" />;
                  };
                  const severityDot = (s: string) => {
                    if (s === "urgent") return "bg-red-400";
                    if (s === "warning") return "bg-amber-400";
                    return "bg-emerald-400";
                  };
                  return (
                    <div
                      className={`rounded-[30px] bg-zinc-950 text-white shadow-[0_10px_40px_rgba(0,0,0,0.15)] transition-all duration-700 ${
                        isUrgent
                          ? "ring-2 ring-red-500/60 shadow-[0_0_32px_rgba(239,68,68,0.25)] animate-pulse"
                          : isWarning
                          ? "ring-2 ring-amber-400/50 shadow-[0_0_24px_rgba(251,191,36,0.18)]"
                          : ""
                      }`}
                    >
                      <div className="p-5">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-white/60">Executive summary</div>
                            <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em]">What needs attention now</div>
                          </div>
                          <div className={`rounded-2xl p-3 transition-colors ${
                            isUrgent ? "bg-red-500/20" : isWarning ? "bg-amber-400/20" : "bg-white/10"
                          }`}>
                            {isUrgent ? (
                              <Flame className="h-5 w-5 text-red-400" />
                            ) : isWarning ? (
                              <AlertTriangle className="h-5 w-5 text-amber-400" />
                            ) : (
                              <Sparkles className="h-5 w-5" />
                            )}
                          </div>
                        </div>
                        <div className="mt-5 space-y-2.5">
                          {attentionLoading ? (
                            <div className="flex items-center gap-2 text-white/40 text-sm py-4">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading attention items...
                            </div>
                          ) : items.length === 0 ? (
                            <div className="rounded-2xl bg-white/6 p-4 text-sm text-white/60">No data available</div>
                          ) : (
                            items.map(item => {
                              // Determine navigation action per item key
                              const handleAttentionClick = () => {
                                if (item.key === "unresponded") {
                                  setActiveTab("leads");
                                  setStageFilter("AWAITING_REPLY");
                                  setTimeout(() => {
                                    document.getElementById("leads-table-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 80);
                                } else if (item.key === "unhandled") {
                                  setActiveTab("leads");
                                  setStageFilter("UNHANDLED");
                                  setTimeout(() => {
                                    document.getElementById("leads-table-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 80);
                                } else if (item.key === "nurture_paused") {
                                  window.location.href = "/admin/lead-nurturing?filter=paused";
                                } else if (item.key === "hot_leads") {
                                  setActiveTab("leads");
                                  setStageFilter("HOT_LEADS");
                                  setTimeout(() => {
                                    document.getElementById("leads-table-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 80);
                                } else if (item.key === "unread") {
                                  setActiveTab("leads");
                                  setStageFilter("UNREAD");
                                  setTimeout(() => {
                                    document.getElementById("leads-table-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 80);
                                }
                              };
                              const isClickable = item.count > 0 || item.key === "nurture_paused" || item.key === "hot_leads" || item.key === "unread";
                              return (
                              <button
                                key={item.key}
                                onClick={isClickable ? handleAttentionClick : undefined}
                                className={`w-full text-left rounded-2xl p-4 transition-all ${
                                  item.severity === "urgent"
                                    ? "bg-red-500/15 border border-red-500/20"
                                    : item.severity === "warning"
                                    ? "bg-amber-400/10 border border-amber-400/20"
                                    : "bg-white/6"
                                } ${isClickable ? "cursor-pointer hover:brightness-110 hover:scale-[1.01] active:scale-[0.99]" : "cursor-default"}`}
                              >
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityDot(item.severity)}`} />
                                  <div className={`flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] font-medium ${
                                    item.severity === "urgent" ? "text-red-400" :
                                    item.severity === "warning" ? "text-amber-400" :
                                    "text-white/45"
                                  }`}>
                                    {itemIcon(item.key)}
                                    {item.label}
                                    {item.count > 0 && (
                                      <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                        item.severity === "urgent" ? "bg-red-500/30 text-red-300" :
                                        item.severity === "warning" ? "bg-amber-400/30 text-amber-300" :
                                        "bg-white/10 text-white/50"
                                      }`}>{item.count}</span>
                                    )}
                                  </div>
                                  {isClickable && (
                                    <ChevronRight className="ml-auto h-3.5 w-3.5 text-white/30 flex-shrink-0" />
                                  )}
                                </div>
                                <div className="text-sm font-medium leading-5 text-white/90">{item.detail}</div>
                              </button>
                              );
                            })
                          )}
                        </div>
                        {!attentionLoading && severity === "ok" && (
                          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400/80">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            All systems clear
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Today's operational pulse */}
                <Card className="rounded-[30px] border-black/5 bg-white">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xl tracking-[-0.02em]">Today's operational pulse</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      {
                        label: "Calls answered by AI",
                        value: voiceStats?.totalCalls ? `${voiceStats.conversionRate}%` : "—",
                        icon: Bot,
                      },
                      {
                        label: "AI voice calls",
                        value: (voiceStats?.totalCalls ?? 0).toLocaleString(),
                        icon: Mic,
                      },
                      {
                        label: "Quote-to-booked",
                        value: stats ? `${stats.conversionRate}%` : "—",
                        icon: BadgeCheck,
                      },
                      {
                        label: "Unhandled leads",
                        value: (stats?.byStage?.["UNHANDLED"] ?? 0).toString(),
                        icon: XCircle,
                      },
                    ].map((item) => {
                      const Icon = item.icon;
                      return (
                        <div key={item.label} className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm">
                              <Icon className="h-5 w-5 text-zinc-700" />
                            </div>
                            <div className="text-sm text-zinc-600">{item.label}</div>
                          </div>
                          <div className="text-lg font-semibold tracking-[-0.02em]">{item.value}</div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
        </>}
      </main>

      {/* ── Sticky footer bar: Quality, Recap, AI Simulator ── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-center gap-3 py-2 px-4 bg-white/80 backdrop-blur border-t border-gray-100">
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

      {/* Follow-ups modal — opened from Overdue Follow-ups attention card */}
      <FollowUpsModal
        open={showFollowUpsModal}
        onClose={() => setShowFollowUpsModal(false)}
      />

      {/* Floating bulk-action bar — appears when rows are checked */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl bg-zinc-900 px-5 py-3 shadow-2xl border border-white/10">
          <span className="text-sm font-medium text-white">
            {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <button
            className="text-xs text-zinc-400 hover:text-white transition"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
          <div className="w-px h-4 bg-white/20" />
          <button
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 transition px-3 py-1.5 text-sm font-semibold text-white"
            onClick={() => setBulkDeleteConfirmOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.size === 1 ? 'this lead' : `these ${selectedIds.size} leads`} and all associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-500"
              onClick={() => bulkDeleteMutation.mutate({ sessionIds: Array.from(selectedIds) })}
            >
              {bulkDeleteMutation.isPending ? 'Deleting…' : `Delete ${selectedIds.size} lead${selectedIds.size === 1 ? '' : 's'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
          onOpenFirstMsg={(details) => {
            setFirstMsgDetails(details);
            setFirstMsgResult("");
            setFirstMsgCopied(false);
            setFirstMsgOpen(true);
          }}
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

      {/* ── First Message Generator Modal (Lead List) ── */}
      {firstMsgOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setFirstMsgOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                  <Wand2 className="h-4 w-4 text-white" />
                </div>
                <h2 className="text-base font-bold text-slate-900">First Message Generator</h2>
              </div>
              <button className="rounded-xl p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition" onClick={() => setFirstMsgOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-1.5 block">Paste Booking Details</label>
                <p className="text-xs text-slate-400 mb-2 leading-relaxed">Paste the raw booking info and the AI will craft a personalized first outreach message.</p>
                <Textarea
                  value={firstMsgDetails}
                  onChange={(e) => setFirstMsgDetails(e.target.value)}
                  placeholder={`e.g.\nName: Sarah Johnson\nCity: Arlington, VA\nHome: 3 bed / 2 bath\nService: Deep clean\nQuote: $220\u2013$260`}
                  rows={6}
                  className="resize-none rounded-xl border-slate-200 text-sm font-mono"
                  autoFocus
                />
              </div>
              {firstMsgResult && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-semibold text-slate-700">Generated Message</label>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(firstMsgResult).then(() => { setFirstMsgCopied(true); setTimeout(() => setFirstMsgCopied(false), 2500); }); }}
                      className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition ${ firstMsgCopied ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200" }`}
                    >
                      {firstMsgCopied ? <><CheckCheck className="h-3.5 w-3.5" /> Copied!</> : <><MessageSquare className="h-3.5 w-3.5" /> Copy Message</>}
                    </button>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{firstMsgResult}</div>
                </div>
              )}
            </div>
            <div className="flex gap-3 px-5 py-4 border-t border-slate-100">
              <Button variant="outline" className="flex-1 rounded-xl border-slate-200 text-slate-700" onClick={() => setFirstMsgOpen(false)}>Close</Button>
              <Button
                className="flex-1 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white"
                disabled={!firstMsgDetails.trim() || generateFirstMessageMutation.isPending}
                onClick={() => generateFirstMessageMutation.mutate({ bookingDetails: firstMsgDetails.trim() })}
              >
                {generateFirstMessageMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Generating…</> : <><Wand2 className="h-4 w-4 mr-1.5" /> Generate Message</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
 
