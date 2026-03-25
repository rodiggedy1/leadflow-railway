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
import DailyRecapModal, { hasShownToday, markShownToday } from "@/components/DailyRecapModal";
import AdminHeader, { WidgetHealthBadge, WebhookHealthBadge, SyncHealthBadge, QualityWidget } from "@/components/AdminHeader";

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
  | "NOT_INTERESTED"
  | "FUTURE_BOOKING"
  | "FOLLOW_UP_SCHEDULED"
  | "WIDGET_SIZING"
  | "COLD";

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
    label: "Booked ✔",
    textColor: "#065f46",
    bgColor: "#d1fae5",
    borderColor: "#6ee7b7",
    order: 9,
  },
  NOT_INTERESTED: {
    label: "Not Interested",
    textColor: "#374151",
    bgColor: "#f3f4f6",
    borderColor: "#d1d5db",
    order: 10,
  },
  FUTURE_BOOKING: {
    label: "Future Booking 📅",
    textColor: "#1e40af",
    bgColor: "#eff6ff",
    borderColor: "#bfdbfe",
    order: 11,
  },
  FOLLOW_UP_SCHEDULED: {
    label: "Follow Up",
    textColor: "#7c3aed",
    bgColor: "#f5f3ff",
    borderColor: "#ddd6fe",
    order: 12,
  },
  WIDGET_SIZING: {
    label: "Sizing",
    textColor: "#0369a1",
    bgColor: "#e0f2fe",
    borderColor: "#bae6fd",
    order: 0,
  },
  COLD: {
    label: "Cold ❄️",
    textColor: "#334155",
    bgColor: "#f1f5f9",
    borderColor: "#cbd5e1",
    order: 13,
  },
};

const ALL_STAGES = (Object.keys(STAGE_CONFIG) as Stage[]).sort(
  (a, b) => STAGE_CONFIG[a].order - STAGE_CONFIG[b].order
);

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  bookedAmount: number | null;
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
function getSourceBadge(leadSource: string | null): React.ReactElement {
  if (!leadSource || leadSource === "form") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">Quote Form</span>;
  }
  if (leadSource === "widget") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700">Widget</span>;
  }
  if (leadSource === "email") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700">Google Ads Form</span>;
  }
  if (leadSource === "voice") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-violet-100 text-violet-700">Google Ads Call</span>;
  }
  if (leadSource === "reactivation") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-700">Campaign</span>;
  }
  if (leadSource === "bark") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">Bark</span>;
  }
  // campaign:tomorrow_slots, campaign:reactivation, campaign:quote_followup, etc.
  if (leadSource.startsWith("campaign:")) {
    const campaignId = leadSource.replace("campaign:", "");
    // Convert snake_case to Title Case for display
    const label = campaignId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">📣 Campaign: {label}</span>;
  }
  // command-center (legacy, before campaign-specific tagging)
  if (leadSource === "command-center") {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-indigo-100 text-indigo-700">📣 Campaign</span>;
  }
  // always-on:new-one-time, always-on:lapsed-one-time, always-on:lapsed-recurring, always-on:dormant
  if (leadSource.startsWith("always-on:")) {
    const groupType = leadSource.replace("always-on:", "");
    const label = formatGroupType(groupType);
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-orange-100 text-orange-700">Always-On: {label}</span>;
  }
  // always-on-test:new-one-time, etc.
  if (leadSource.startsWith("always-on-test:")) {
    const groupType = leadSource.replace("always-on-test:", "");
    const label = formatGroupType(groupType);
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-700">Test: {label}</span>;
  }
  // Fallback for any unknown source
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-600">{leadSource}</span>;
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
}: {
  session: DrawerSession;
  onClose: () => void;
  isAdmin: boolean;
  agentList: { id: number; name: string; isActive: number | boolean }[];
  onSessionUpdate: (updates: Partial<DrawerSession>) => void;
  onRefresh: () => void;
  currentAgentName?: string;
}) {
  const utils = trpc.useUtils();
  let messages: { role: string; content: string }[] = [];
  try {
    messages = JSON.parse(session.messageHistory || "[]");
  } catch {
    messages = [];
  }

  const updateStageMutation = trpc.leads.adminUpdateStage.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ stage: vars.stage });
      utils.leads.list.invalidate();
      utils.leads.stats.invalidate();
      onRefresh();
      toast.success("Stage updated");
    },
    onError: (e) => toast.error(e.message),
  });

  const assignAgentMutation = trpc.leads.adminAssignAgent.useMutation({
    onSuccess: (_, vars) => {
      const agent = vars.agentId === null ? null : agentList.find(a => a.id === vars.agentId);
      onSessionUpdate({
        assignedAgentId: vars.agentId,
        assignedAgentName: agent?.name ?? null,
      });
      utils.leads.list.invalidate();
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

  // Booked amount editing
  const [bookedAmountInput, setBookedAmountInput] = useState(
    session.bookedAmount !== null && session.bookedAmount !== undefined
      ? String(session.bookedAmount)
      : ""
  );
  const [bookedAmountSaved, setBookedAmountSaved] = useState(false);
  const updateBookedAmountMutation = trpc.leads.updateBookedAmount.useMutation({
    onSuccess: (_, vars) => {
      onSessionUpdate({ bookedAmount: vars.bookedAmount });
      utils.leads.stats.invalidate();
      setBookedAmountSaved(true);
      setTimeout(() => setBookedAmountSaved(false), 2000);
      toast.success(vars.bookedAmount === null ? "Booked amount cleared" : `Booked amount set to $${vars.bookedAmount}`);
    },
    onError: (e) => toast.error(e.message),
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
  // Auto-scroll to bottom on first mount (skip past the AI banner)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
  }, []);
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
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // Call logs (agent-logged)
  const { data: callLogs } = trpc.agents.getCallLogs.useQuery({ sessionId: session.id });

  // Voice calls (Vapi AI calls)
  const { data: voiceCalls } = trpc.voice.getCallsBySession.useQuery({ sessionId: session.id });

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
  const suggestions: Record<string, string> = {
    lockDate: `Hey ${firstName} — totally makes sense. We're already filling early May, so I can tentatively hold a spot now and adjust if needed. Want me to grab something before it fills up?`,
    softCheckIn: `Hey ${firstName} — just checking in! Want me to send over a couple openings that would work well for you?`,
    urgency: `Hey ${firstName} — quick heads up: our spots are starting to fill. Want me to hold one for you before they're gone?`,
    discount: `Hey ${firstName} — we had a schedule shift open up, so I may be able to get you a better rate if you want me to check options.`,
  };
  const [selectedAction, setSelectedAction] = useState<"lockDate" | "softCheckIn" | "urgency" | "discount">("lockDate");
  const [drawerTab, setDrawerTab] = useState<"conversation" | "flow" | "performance">("conversation");
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 overscroll-contain"
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
                <span>{formatPhone(session.leadPhone)}</span>
                {lastReplyTime && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
                    Last reply {lastReplyTime}
                  </span>
                )}
                <span>&#128293; Score {score}/100</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Status dropdown — quick stage update from header */}
              <Select
                value={session.stage}
                onValueChange={(val) => {
                  if (val === session.stage) return;
                  updateStageMutation.mutate({ sessionId: session.id, stage: val as Stage });
                }}
                disabled={updateStageMutation.isPending}
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
                  {ALL_STAGES.map(s => (
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
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex items-center gap-1 px-4 pt-2.5 pb-2 shrink-0">
            {(["conversation", "flow", "performance"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setDrawerTab(tab)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  drawerTab === tab
                    ? "bg-gray-900 text-white"
                    : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                }`}
              >
                {tab === "conversation" ? "Conversation" : tab === "flow" ? "Flow View" : "Performance"}
              </button>
            ))}
          </div>

             {/* ── Persistent note display ── */}
          {(loadedNotes || notes) && !showNoteInput && (
            <div className="mx-4 mb-1 flex flex-col gap-1 px-3 py-2 rounded-xl bg-amber-50 border border-amber-100">
              <div className="flex items-center gap-1.5">
                <StickyNote className="w-3 h-3 text-amber-500 shrink-0" />
                <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Staff note</span>
              </div>
              <p className="flex-1 text-xs text-amber-800 leading-relaxed whitespace-pre-wrap">{notes || loadedNotes}</p>
              <button
                onClick={() => setShowNoteInput(true)}
                className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors"
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
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* AI recommendation banner — scrolls with messages */}
                <div className="mb-4 px-4 py-3 rounded-xl bg-orange-50">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="text-sm font-semibold text-orange-500">&#10024; AI recommendation</div>
                    <button
                      onClick={() => refetchRec()}
                      className="text-[11px] text-orange-400 hover:text-orange-600 transition-colors flex items-center gap-1"
                      title="Refresh recommendation"
                    >
                      {isLoadingRec ? (
                        <span className="animate-spin inline-block">&#8635;</span>
                      ) : (
                        <span>&#8635; refresh</span>
                      )}
                    </button>
                  </div>
                  {isLoadingRec ? (
                    <div className="text-sm text-orange-400 animate-pulse">Analyzing conversation...</div>
                  ) : closingRec ? (
                    <div className="text-sm text-orange-600">{closingRec.objectionSummary}</div>
                  ) : (
                    <div className="text-sm text-orange-600">{primaryRecommendation}</div>
                  )}
                </div>
                <div className="space-y-4">
                {localMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No messages yet</div>
                ) : (
                  localMessages.map((msg, i) => {
                    const isOutbound = msg.role === "assistant";
                    const isSystem = msg.role === "system";
                    const prevTs = i > 0 ? localMessages[i - 1]?.ts : undefined;
                    const curTs = msg.ts;
                    const showSeparator = curTs != null && (i === 0 || (prevTs != null ? isDifferentDay(prevTs, curTs) : true));
                    const timeLabel = curTs != null
                      ? new Date(curTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      : null;
                    const senderName = (msg as any).senderName as string | undefined;
                    const isAiMessage = isOutbound && !senderName;
                    return (
                      <div key={i}>
                        {showSeparator && curTs != null && (
                          <MessageDateSeparator label={formatMsgDate(curTs)} />
                        )}
                        {/* System event pill */}
                        {isSystem ? (
                          <div className="flex justify-center my-1">
                            <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">{msg.content}</span>
                          </div>
                        ) : isOutbound ? (
                          /* ── Outbound ── */
                          <div className="flex items-end gap-2 justify-end">
                            <div className="flex flex-col items-end max-w-[76%]">
                              {/* Label row */}
                              <div className="flex items-center gap-2 mb-1 pr-1">
                                {isAiMessage ? (
                                  <span className="text-xs font-semibold text-purple-500">AI Follow-Up</span>
                                ) : senderName ? (
                                  <span className="text-xs font-semibold" style={{ color: "#F97316" }}>{senderName}</span>
                                ) : null}
                                {timeLabel && <span className="text-xs text-gray-400">{timeLabel}</span>}
                              </div>
                              {/* Bubble */}
                              <div
                                className="rounded-2xl rounded-br-sm px-4 py-3 text-sm text-white leading-relaxed"
                                style={{ backgroundColor: isAiMessage ? "#F97316" : "#1a1a1a" }}
                              >
                                {msg.content}
                              </div>
                            </div>
                            {/* Avatar */}
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mb-0.5 text-white text-xs font-bold"
                              style={{ backgroundColor: isAiMessage ? "#7C3AED" : "#1a1a1a" }}
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
                              {/* Bubble — plain white, very soft shadow, no border */}
                              <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed shadow-sm">
                                {msg.content}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                </div>
                <div ref={messagesEndRef} />
              </div>

              {/* ── Suggestion pills — use AI-generated labels and messages ── */}
              <div className="shrink-0 bg-white border-t border-gray-100">
                {/* Row 1: 4 suggestion pills in a fixed grid */}
                <div className="grid grid-cols-4 gap-1.5 px-3 pt-2 pb-1">
                  {[
                    { index: -1, label: closingRec?.primaryMove ?? "Primary" },
                    { index: 0, label: closingRec?.alternativeMoves?.[0] ?? "Alt 1" },
                    { index: 1, label: closingRec?.alternativeMoves?.[1] ?? "Alt 2" },
                    { index: 2, label: closingRec?.alternativeMoves?.[2] ?? "Alt 3" },
                  ].map(({ index, label }) => (
                    <button
                      key={index}
                      onClick={() => applySuggestion(index)}
                      title={label}
                      className="text-xs font-medium px-2 py-1.5 rounded-full border transition-colors border-gray-200 text-gray-600 bg-white hover:bg-gray-50 truncate"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Row 2: Add Note + AI assist toggle */}
                <div className="flex items-center gap-2 px-3 pb-2">
                  <button
                    onClick={() => setShowNoteInput(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors"
                  >
                    <StickyNote className="w-3 h-3" />
                    {(notes || loadedNotes) ? "Edit Note" : "Add Note"}
                    {(notes || loadedNotes) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />}
                  </button>
                  <button
                    onClick={() => setAiModeMutation.mutate({ sessionId: session.id, aiMode: session.aiMode === 1 ? 0 : 1 })}
                    disabled={setAiModeMutation.isPending}
                    className={`ml-auto text-xs font-semibold px-3.5 py-1.5 rounded-full border transition-colors ${
                      session.aiMode === 1
                        ? "text-green-700 bg-white border-green-200 hover:bg-green-50"
                        : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {session.aiMode === 1 ? "AI assist on" : "AI assist off"}
                  </button>
                </div>
                {/* Inline note input — shown when Add Note is clicked */}
                {showNoteInput && (
                  <div className="px-3 pb-2">
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
              </div>

              {/* ── Compose box ── */}
              <div className="mx-4 mb-4 mt-2 rounded-2xl border border-gray-200 bg-white overflow-hidden shrink-0">
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
                <div className="flex items-center justify-between px-4 pb-3">
                  <span className="text-xs text-gray-300">
                    &#10024; Suggested from playbook &middot; AI message
                  </span>
                  <button
                    onClick={handleSend}
                    disabled={!replyText.trim() || sendMessageMutation.isPending}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
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
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-white">
              {(() => {
                const pipelineStages = ["Lead In", "Quoted", "In Progress", "Follow-Up", "Re-engage", "Booked"];
                const stageToIndex: Record<string, number> = {
                  WIDGET_SIZING: 0, QUOTE_SENT: 1, AVAILABILITY: 2, SLOT_CHOICE: 2, ADDRESS: 2,
                  CONFIRMATION: 2, CALL_SCHEDULED: 2, DONE: 2, UNHANDLED: 2,
                  FOLLOW_UP_SCHEDULED: 3, FUTURE_BOOKING: 3, COLD: 4, NOT_INTERESTED: 4, BOOKED: 5,
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
              {isAdmin && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-2">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Move Stage</div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={session.stage}
                      onValueChange={(val) => {
                        if (val === session.stage) return;
                        updateStageMutation.mutate({ sessionId: session.id, stage: val as Stage });
                      }}
                      disabled={updateStageMutation.isPending}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(["WIDGET_SIZING","QUOTE_SENT","AVAILABILITY","SLOT_CHOICE","TIME_PREF","ADDRESS","CONFIRMATION","CALL_SCHEDULED","DONE","UNHANDLED","BOOKED","NOT_INTERESTED","FUTURE_BOOKING","FOLLOW_UP_SCHEDULED","COLD"] as const).map(s => (
                          <SelectItem key={s} value={s} className="text-xs">{STAGE_CONFIG[s as Stage]?.label ?? s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {updateStageMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                  </div>
                </div>
              )}
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
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-white">
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
        <div className="w-[310px] shrink-0 flex flex-col gap-3 overflow-y-auto h-full pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

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
                  {session.quotedPrice && Number(session.quotedPrice) > 0 ? `$${Number(session.quotedPrice).toFixed(0)}` : "\u2014"}
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
                onClick={() => { if (session.leadPhone) window.open(`tel:${session.leadPhone}`, "_self"); }}
                className="flex items-center gap-2 py-3 px-3 rounded-xl text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-100 transition-colors"
              >
                <span>&#128222;</span> Call lead
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
  );
}

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

  const leaderboard = [...perf].sort(
    (a, b) => b.bookingsThisWeek - a.bookingsThisWeek || b.callsThisWeek - a.callsThisWeek
  );
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
  // ── Daily recap modal ────────────────────────────────────────────────────────
  const [showRecap, setShowRecap] = useState(false);
  const isLoggedIn = hasSession;;
  useEffect(() => {
    if (isLoggedIn && !hasShownToday()) {
      // Small delay so the dashboard renders first
      const t = setTimeout(() => setShowRecap(true), 800);
      return () => clearTimeout(t);
    }
  }, [isLoggedIn]);
  const handleLoginSuccess = useCallback(() => { meQuery.refetch(); }, [meQuery]);
  const handleCloseRecap = useCallback(() => {
    markShownToday();
    setShowRecap(false);
  }, []);

  // ── Dashboard state (all hooks declared unconditionally) ─────────────────────────
  const [activeTab, setActiveTab] = useState<"leads" | "pipeline" | "agents" | "leaderboard" | "callbacks">(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "pipeline" || t === "agents" || t === "leaderboard" || t === "callbacks") return t;
    }
    return "leads";
  });
  const [showSimulator, setShowSimulator] = useState(false);
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

  // Lock body scroll when drawer is open to prevent bleed-through
  useEffect(() => {
    if (selectedSession) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [selectedSession]);
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
      {showRecap && <DailyRecapModal onClose={handleCloseRecap} />}

      {/* Top bar — unified AdminHeader (includes AI Center + all nav) */}
      <AdminHeader
        activeTab={activeTab === "callbacks" ? "callbacks" : activeTab === "agents" ? "agents" : activeTab === "leaderboard" ? "leaderboard" : activeTab === "pipeline" ? "pipeline" : "leads"}
        pagePermissions={agentPagePermissions}
        isAdmin={isAdmin}
        onSessionOpen={handleSessionOpen}
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
                          </div>
                          {/* Click-to-call — only visible on row hover */}
                          <a
                            href={`tel:${session.leadPhone}`}
                            onClick={e => e.stopPropagation()}
                            title={`Call ${formatPhone(session.leadPhone)}`}
                            className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0 p-1.5 rounded-full text-gray-500"
                            style={{ '--tw-ring-color': '#AAFF00' } as React.CSSProperties}
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                          </a>
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

                      {/* When — single relative timestamp */}
                      <TableCell className="py-2 pr-4">
                        <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: '#777' }}>
                          {(() => {
                            // Prefer lastActivityAt but cap at session.updatedAt to avoid stale timestamps
                            const actAt = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
                            const updAt = session.updatedAt ? new Date(session.updatedAt) : null;
                            const display = actAt && updAt && actAt > updAt ? updAt : (actAt ?? updAt);
                            return display ? timeAgo(display) : '—';
                          })()}
                        </span>
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
        {/* Daily Recap preview trigger */}
        <button
          onClick={() => { localStorage.removeItem(`recap_shown_${new Date().toISOString().slice(0,10)}`); setShowRecap(true); }}
          title="Preview yesterday's recap"
          className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-[#AAFF00] hover:text-gray-700 transition-colors"
        >
          <span className="text-xs font-bold">☀</span>
        </button>
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
        />
      )}
    </div>
  );
}
