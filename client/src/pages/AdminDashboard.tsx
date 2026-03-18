/**
 * AdminDashboard — Leads funnel monitor for Maids in Black
 *
 * Shows all conversation sessions with stage badges, lead details,
 * quoted prices, selected slots, addresses, and time elapsed.
 * Supports date range filtering and stage filtering.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import NotificationBell from "@/components/NotificationBell";
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
  MessageSquare,
  Mic,
  MicOff,
  Volume2,
  PlayCircle,
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
import SmsSimulator from "@/components/SmsSimulator";
import SmsComposeBox from "@/components/SmsComposeBox";
import MessageDateSeparator, { formatMsgDate, isDifferentDay } from "@/components/MessageDateSeparator";
import SourceBreakdownChart from "@/components/SourceBreakdownChart";

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

// ── Widget Health Badge ─────────────────────────────────────────────────────
function WidgetHealthBadge() {
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

// ── Admin Login Screen ────────────────────────────────────────────────────────
function AdminLoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.agents.login.useMutation({
    onSuccess: (data) => {
      if (!data.agent.isAdmin) {
        toast.error("This is the admin panel. Go to /agent for the agent workspace.", { duration: 6000 });
        return;
      }
      toast.success(`Welcome back, ${data.agent.name}!`);
      onSuccess();
    },
    onError: (err) => toast.error(err.message || "Login failed"),
  });
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FFF8F5" }}>
      <div className="bg-white rounded-2xl border shadow-lg p-8 max-w-sm w-full mx-4" style={{ borderColor: "#F0D8D0" }}>
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "#E8603C" }}>
            <Lock className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Admin Access</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in with your admin credentials</p>
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
            style={{ backgroundColor: "#E8603C", color: "white" }}
          >
            {loginMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</>
            ) : (
              <><LogIn className="w-4 h-4 mr-2" /> Sign In</>
            )}
          </Button>
        </form>
        <p className="text-center text-xs text-gray-400 mt-4">
          This area is restricted to admin users only.
        </p>
        <p className="text-center text-xs text-gray-500 mt-2">
          Are you an agent?{" "}
          <a href="/agent" className="underline font-medium" style={{ color: "#E8603C" }}>Go to Agent Workspace →</a>
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
  | "WIDGET_SIZING";

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
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border"
      style={{
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
  if (leadSource === "voice") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-violet-100 text-violet-700">Voice Call</span>;
  }
  if (leadSource === "reactivation") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-700">Campaign</span>;
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
}: {
  session: DrawerSession;
  onClose: () => void;
  isAdmin: boolean;
  agentList: { id: number; name: string; isActive: number | boolean }[];
  onSessionUpdate: (updates: Partial<DrawerSession>) => void;
  onRefresh: () => void;
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

  // Auto-refresh conversation every 5s when drawer is open
  const { data: freshSession } = trpc.leads.list.useQuery(undefined, {
    refetchInterval: 5000,
    select: (sessions) => sessions.find(s => s.id === session.id),
  });

  // Sync local messages when fresh data arrives
  useEffect(() => {
    if (freshSession?.messageHistory) {
      try {
        const fresh = JSON.parse(freshSession.messageHistory);
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
      setLocalMessages(prev => [...prev, { role: "assistant", content: vars.message, ts: Date.now() }]);
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
    if (!text) return;
    sendMessageMutation.mutate({ sessionId: session.id, message: text });
  };

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
  const updateNotes = trpc.agents.updateNotes.useMutation({
    onSuccess: () => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); },
    onError: (e) => toast.error(e.message),
  });
  const loadedNotes = notesData?.notes ?? "";

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Wide two-column modal: left = conversation, right = details */}
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-4xl h-[92vh] sm:max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">

        {/* ── Shared header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <div className="flex items-center gap-3">
            {/* Avatar circle */}
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ backgroundColor: "#E8603C" }}>
              {(session.leadName ?? "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 leading-tight">{session.leadName ?? "Unknown Lead"}</h2>
              <p className="text-xs text-gray-500">{formatPhone(session.leadPhone)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getSourceBadge(session.leadSource)}
            {getLanguageBadge(session.language)}
            <StageBadge stage={session.stage} />
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* ── Two-column body ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* LEFT: full-height conversation + compose */}
          <div className="flex flex-col flex-1 min-w-0 border-r">
            {/* Messages */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-gray-50">
              {localMessages.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">No messages yet</p>
              ) : (
                localMessages.map((msg, i) => {
                  const isOutbound = msg.role === "assistant";
                  const prevTs = i > 0 ? localMessages[i - 1]?.ts : undefined;
                  const curTs = msg.ts;
                  // Show a day separator whenever the calendar day changes (ts is always set now via fallback)
                  const showSeparator = curTs != null && (
                    i === 0 || (prevTs != null ? isDifferentDay(prevTs, curTs) : true)
                  );
                  // Small time label shown below each bubble (e.g. "2:34 PM")
                  const timeLabel = curTs != null
                    ? new Date(curTs).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                    : null;
                  return (
                    <div key={i}>
                      {showSeparator && curTs != null && (
                        <MessageDateSeparator label={formatMsgDate(curTs)} />
                      )}
                      <div className={`flex flex-col mb-3 ${isOutbound ? "items-end" : "items-start"}`}>
                        <div
                          className="max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words"
                          style={
                            isOutbound
                              ? { backgroundColor: "#E8603C", color: "white", borderBottomRightRadius: "4px" }
                              : { backgroundColor: "#ffffff", color: "#1f2937", borderBottomLeftRadius: "4px", border: "1px solid #e5e7eb" }
                          }
                        >
                          {msg.content}
                        </div>
                        {timeLabel && (
                          <span className="text-[10px] text-gray-400 mt-0.5 px-1">{timeLabel}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Compose box */}
            <div className="px-4 pt-2.5 pb-3 border-t bg-white shrink-0">
              {/* AI / Manual toggle */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs">
                  {session.aiMode === 1
                    ? <span className="flex items-center gap-1 text-green-600 font-medium"><Bot className="w-3.5 h-3.5" />AI is handling replies</span>
                    : <span className="flex items-center gap-1 text-amber-600 font-medium"><BotOff className="w-3.5 h-3.5" />Manual mode — you're in control</span>
                  }
                </span>
                <button
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    session.aiMode === 1
                      ? "border-amber-300 text-amber-700 hover:bg-amber-50"
                      : "border-green-300 text-green-700 hover:bg-green-50"
                  }`}
                  onClick={() => setAiModeMutation.mutate({ sessionId: session.id, aiMode: session.aiMode === 1 ? 0 : 1 })}
                  disabled={setAiModeMutation.isPending}
                >
                  {session.aiMode === 1 ? "Take over" : "Hand back to AI"}
                </button>
              </div>
              <SmsComposeBox
                value={replyText}
                onChange={setReplyText}
                onSend={handleSend}
                isSending={sendMessageMutation.isPending}
                placeholder="Write a message..."
              />
            </div>
          </div>

          {/* RIGHT: lead details panel */}
          <div className="w-72 shrink-0 flex flex-col overflow-y-auto bg-white">

            {/* Lead info */}
            <div className="px-4 py-4 border-b">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Lead Details</p>
              <div className="space-y-2 text-sm">
                {session.quotedPrice && (() => {
                  const total = computeTotalQuote(session.quotedPrice, session.extras);
                  const hasExtras = total !== session.quotedPrice;
                  return (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Quote</span>
                      <span className="font-semibold" style={{ color: "#E8603C" }}>
                        ${total}{hasExtras && <span className="ml-1 text-xs text-gray-400">(+extras)</span>}
                      </span>
                    </div>
                  );
                })()}
                {/* Reactivation: last booking price with discount */}
                {session.leadSource === "reactivation" && session.reactivationLastPrice != null && (() => {
                  const discountPct = session.reactivationDiscountPct ?? 10;
                  const discounted = Math.round(session.reactivationLastPrice * (1 - discountPct / 100));
                  return (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Last Booking</span>
                      <span className="font-semibold text-right" style={{ color: "#E8603C" }}>
                        <span className="line-through text-gray-400 mr-1">${session.reactivationLastPrice}</span>
                        ${discounted}
                        <span className="ml-1 text-xs font-normal text-green-600">({discountPct}% off)</span>
                      </span>
                    </div>
                  );
                })()}
                {session.serviceType && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Service</span>
                    <span className="font-medium text-right max-w-[55%] truncate">{session.serviceType}</span>
                  </div>
                )}
                {session.selectedSlot && (
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500 shrink-0">Slot</span>
                    <span className="font-medium text-right text-xs">{session.selectedSlot}</span>
                  </div>
                )}
                {session.address && (
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-500 shrink-0">Address</span>
                    <span className="font-medium text-right text-xs leading-snug">{session.address}</span>
                  </div>
                )}
                {session.extras && (() => {
                  let extrasArr: string[] = [];
                  try { extrasArr = JSON.parse(session.extras); } catch { extrasArr = []; }
                  return extrasArr.length > 0 ? (
                    <div className="flex justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Extras</span>
                      <span className="font-medium text-right text-xs">{extrasArr.map(k => k.replace(/_/g, " ")).join(", ")}</span>
                    </div>
                  ) : null;
                })()}
                {!isAdmin && session.assignedAgentName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Agent</span>
                    <span className="font-medium">{session.assignedAgentName}</span>
                  </div>
                )}
                {/* UTM Attribution */}
                {(session.utmSource || session.utmMedium || session.utmCampaign || session.gclid) && (
                  <div className="pt-1 border-t space-y-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Traffic Source</p>
                    {session.utmSource && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Source</span>
                        <span className="font-medium text-xs capitalize">{session.utmSource}</span>
                      </div>
                    )}
                    {session.utmMedium && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Medium</span>
                        <span className="font-medium text-xs">{session.utmMedium}</span>
                      </div>
                    )}
                    {session.utmCampaign && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Campaign</span>
                        <span className="font-medium text-xs truncate max-w-[55%] text-right">{session.utmCampaign}</span>
                      </div>
                    )}
                    {session.gclid && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">Google Ad</span>
                        <span className="font-medium text-xs text-green-600">✓ tracked</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-between text-xs text-gray-400 pt-1 border-t">
                  <span>Started</span><span>{timeAgo(session.createdAt)}</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Updated</span><span>{timeAgo(session.updatedAt)}</span>
                </div>
              </div>
            </div>

            {/* Admin controls: stage + agent */}
            {isAdmin && (
              <div className="px-4 py-4 border-b bg-orange-50 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Admin Controls</p>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">Stage</span>
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={session.stage}
                      onValueChange={(val) => {
                        if (val === session.stage) return;
                        updateStageMutation.mutate({ sessionId: session.id, stage: val as Stage });
                      }}
                      disabled={updateStageMutation.isPending}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {([
                          "WIDGET_SIZING",
                          "QUOTE_SENT",
                          "AVAILABILITY",
                          "SLOT_CHOICE",
                          "TIME_PREF",
                          "ADDRESS",
                          "CONFIRMATION",
                          "CALL_SCHEDULED",
                          "DONE",
                          "UNHANDLED",
                          "BOOKED",
                          "NOT_INTERESTED",
                          "FUTURE_BOOKING",
                          "FOLLOW_UP_SCHEDULED",
                        ] as const).map(s => (
                          <SelectItem key={s} value={s} className="text-xs">
                            {STAGE_CONFIG[s as Stage]?.label ?? s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {updateStageMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">Agent</span>
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
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned" className="text-xs">— Unassigned —</SelectItem>
                        {activeAgents.map(a => (
                          <SelectItem key={a.id} value={a.id.toString()} className="text-xs">
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {assignAgentMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />}
                  </div>
                </div>

                {/* Booked amount — only when stage is BOOKED */}
                {session.stage === "BOOKED" && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-gray-600">Booked Amount</span>
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                        <Input
                          type="number"
                          min={0}
                          placeholder={computeTotalQuote(session.quotedPrice, session.extras) ?? "0"}
                          value={bookedAmountInput}
                          onChange={e => setBookedAmountInput(e.target.value)}
                          className="pl-5 h-8 text-xs"
                        />
                      </div>
                      {bookedAmountSaved && <span className="text-xs text-green-600 font-medium shrink-0">✓</span>}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2.5 text-xs shrink-0"
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
                      {session.bookedAmount !== null && session.bookedAmount !== undefined && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs text-gray-400 shrink-0"
                          onClick={() => {
                            setBookedAmountInput("");
                            updateBookedAmountMutation.mutate({ sessionId: session.id, bookedAmount: null });
                          }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {session.bookedAmount !== null && session.bookedAmount !== undefined
                        ? `Override: $${session.bookedAmount}`
                        : `Using quote: $${computeTotalQuote(session.quotedPrice, session.extras) ?? "0"}`
                      }
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Follow-Up Scheduler */}
            <div className="border-t">
              <details className="group">
                <summary className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide hover:bg-gray-50 transition-colors cursor-pointer list-none">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    Schedule Follow-Up
                    {session.followUpDate && !session.followUpSent && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-violet-100 text-violet-700">{session.followUpDate}</span>
                    )}
                    {session.followUpSent === 1 && (
                      <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700">Sent ✓</span>
                    )}
                  </span>
                  <span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <div className="px-4 pb-3 space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">Follow-up date</label>
                    <Input
                      type="date"
                      value={followUpDate}
                      onChange={e => setFollowUpDate(e.target.value)}
                      className="h-8 text-xs"
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">Message (editable)</label>
                    <Textarea
                      value={followUpMessage}
                      onChange={e => setFollowUpMessage(e.target.value)}
                      rows={3}
                      className="resize-none text-xs"
                      placeholder="Hi, just circling back on this..."
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {followUpSaved && <span className="text-xs text-green-600 font-medium">Saved ✓</span>}
                      {followUpDate && (
                        <button
                          type="button"
                          className="text-xs text-red-400 hover:text-red-600 underline"
                          onClick={() => {
                            setFollowUpDate("");
                            setFollowUpMessage(DEFAULT_FOLLOWUP_MSG);
                            setFollowUpMutation.mutate({ sessionId: session.id, followUpDate: null, followUpMessage: null });
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-xs bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100"
                      onClick={() => setFollowUpMutation.mutate({ sessionId: session.id, followUpDate: followUpDate || null, followUpMessage })}
                      disabled={setFollowUpMutation.isPending || !followUpDate}
                    >
                      {setFollowUpMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Follow-Up"}
                    </Button>
                  </div>
                </div>
              </details>
            </div>

            {/* Call History */}
            {callLogs && callLogs.length > 0 && (
              <div className="px-4 pb-2">
                <details open>
                  <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none flex items-center gap-1.5 py-1">
                    <Phone className="w-3 h-3" />
                    Call History ({callLogs.length})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {callLogs.map((log) => {
                      const outcomeColors: Record<string, string> = {
                        ANSWERED: "bg-green-100 text-green-700",
                        BOOKED: "bg-emerald-100 text-emerald-700",
                        NO_ANSWER: "bg-gray-100 text-gray-600",
                        VOICEMAIL: "bg-blue-100 text-blue-700",
                        BUSY: "bg-yellow-100 text-yellow-700",
                        CALLBACK: "bg-violet-100 text-violet-700",
                      };
                      const colorClass = outcomeColors[log.outcome] ?? "bg-gray-100 text-gray-600";
                      return (
                        <div key={log.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colorClass}`}>
                                {log.outcome.replace("_", " ")}
                              </span>
                              <span className="text-xs text-gray-500">{log.agentName}</span>
                            </div>
                            <span className="text-[10px] text-gray-400 shrink-0">
                              {new Date(log.calledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            </span>
                          </div>
                          {log.notes && (
                            <p className="text-xs text-gray-600 leading-relaxed">{log.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}

            {/* Voice Calls (Vapi AI) */}
            {voiceCalls && voiceCalls.length > 0 && (
              <div className="px-4 pb-2">
                <details open>
                  <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none flex items-center gap-1.5 py-1">
                    <Mic className="w-3 h-3" />
                    AI Voice Calls ({voiceCalls.length})
                  </summary>
                  <div className="mt-2 space-y-3">
                    {voiceCalls.map((call) => {
                      const outcomeColors: Record<string, string> = {
                        booked: "bg-emerald-100 text-emerald-700",
                        quote_given: "bg-blue-100 text-blue-700",
                        faq_answered: "bg-violet-100 text-violet-700",
                        transferred: "bg-orange-100 text-orange-700",
                        callback_requested: "bg-yellow-100 text-yellow-700",
                        no_action: "bg-gray-100 text-gray-500",
                      };
                      const colorClass = outcomeColors[call.outcome] ?? "bg-gray-100 text-gray-600";
                      const durationMin = Math.floor((call.durationSeconds ?? 0) / 60);
                      const durationSec = (call.durationSeconds ?? 0) % 60;
                      const durationLabel = call.durationSeconds
                        ? `${durationMin}:${String(durationSec).padStart(2, "0")}`
                        : null;
                      return (
                        <div key={call.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5 space-y-1.5">
                          {/* Header row */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <Mic className="w-3 h-3 text-gray-400" />
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colorClass}`}>
                                {call.outcome.replace(/_/g, " ")}
                              </span>
                              {durationLabel && (
                                <span className="text-[10px] text-gray-400">{durationLabel}</span>
                              )}
                            </div>
                            <span className="text-[10px] text-gray-400 shrink-0">
                              {new Date(call.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            </span>
                          </div>
                          {/* Summary */}
                          {call.summary && (
                            <p className="text-xs text-gray-600 leading-relaxed">{call.summary}</p>
                          )}
                          {/* Recording link */}
                          {call.recordingUrl && (
                            <a
                              href={call.recordingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                            >
                              <PlayCircle className="w-3 h-3" />
                              Listen to recording
                            </a>
                          )}
                          {/* Transcript toggle */}
                          {call.transcript && (
                            <details className="mt-1">
                              <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                                View transcript
                              </summary>
                              <p className="mt-1 text-[10px] text-gray-500 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                                {call.transcript}
                              </p>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </div>
            )}

            {/* Internal Notes */}
            <div className="px-4 py-4 flex-1">
              <AdminNotesSection
                session={session}
                notes={notes}
                setNotes={setNotes}
                loadedNotes={loadedNotes}
                notesSaved={notesSaved}
                updateNotes={updateNotes}
              />
            </div>

            {/* Delete lead */}
            {isAdmin && (
              <div className="px-4 pb-4 shrink-0">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full h-8 text-xs text-red-400 hover:text-red-600 hover:bg-red-50"
                      disabled={deleteLeadMutation.isPending}
                    >
                      {deleteLeadMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <><Trash2 className="w-3.5 h-3.5 mr-1" />Delete Lead</>}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete <strong>{session.leadName ?? "this lead"}</strong> and all their conversation history. This action cannot be undone.
                      </AlertDialogDescription>
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

  const leaderboard = [...perf].sort(
    (a, b) => b.bookingsThisWeek - a.bookingsThisWeek || b.callsThisWeek - a.callsThisWeek
  );
  const medalColors = ["#FFD700", "#C0C0C0", "#CD7F32"];

  return (
    <div className="py-2">

      {/* Leaderboard */}
      {leaderboard.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-base font-semibold text-gray-900">This Week's Leaderboard</h2>
            <span className="text-xs text-gray-400">(Mon – today)</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {leaderboard.map((agent, idx) => {
              const medal = medalColors[idx];
              const convColor =
                agent.conversionRate >= 50 ? "#16a34a" :
                agent.conversionRate >= 25 ? "#d97706" : "#6b7280";
              return (
                <div
                  key={agent.id}
                  className="bg-white rounded-2xl border p-4 shadow-sm relative overflow-hidden"
                  style={{ borderColor: idx === 0 ? "#FFD700" : "#F0D8D0" }}
                >
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
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-xl py-2">
                      <p className="text-lg font-bold text-gray-900">{agent.callsThisWeek}</p>
                      <p className="text-xs text-gray-500">Calls</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl py-2">
                      <p className="text-lg font-bold" style={{ color: "#E8603C" }}>{agent.bookingsThisWeek}</p>
                      <p className="text-xs text-gray-500">Booked</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl py-2">
                      <p className="text-lg font-bold" style={{ color: convColor }}>{agent.conversionRate}%</p>
                      <p className="text-xs text-gray-500">Conv.</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                    <span>{agent.totalAssigned} assigned</span>
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
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(agent.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
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
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  // ── Auth state (must come before all other hooks) ────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const meQuery = trpc.agents.me.useQuery(undefined, { retry: false });
  const isAdmin = meQuery.data?.isAdmin === true;
  const authChecked = !meQuery.isLoading;
  const handleLoginSuccess = useCallback(() => setIsAuthenticated(true), []);

  // ── Dashboard state (all hooks declared unconditionally) ─────────────────────────
  const [activeTab, setActiveTab] = useState<"leads" | "agents" | "simulator" | "leaderboard">("leads");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selectedSession, setSelectedSession] = useState<DrawerSession | null>(null);

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
  } = trpc.leads.list.useQuery(dateRange, { refetchInterval: 30000, enabled: isAdmin || isAuthenticated });

  const { data: stats } = trpc.leads.stats.useQuery(dateRange, {
    refetchInterval: 30000,
    enabled: isAdmin || isAuthenticated,
  });

  const { data: visitorStats } = trpc.leads.visitorStats.useQuery(dateRange, {
    refetchInterval: 60000,
    enabled: isAdmin || isAuthenticated,
  });

  const { data: voiceStats } = trpc.voice.stats.useQuery({ days: 30 }, {
    refetchInterval: 300_000,
    enabled: isAdmin || isAuthenticated,
  });

  const { data: dailyTrend = [] } = trpc.leads.dailyTrend.useQuery(undefined, {
    refetchInterval: 300_000, // refresh every 5 minutes
    enabled: isAdmin || isAuthenticated,
  });

  const { data: sourceBreakdown = [], isLoading: sourceBreakdownLoading } = trpc.leads.sourceBreakdown.useQuery(dateRange, {
    refetchInterval: 60000,
    enabled: isAdmin || isAuthenticated,
  });

  // Agent list for assignment dropdown in the drawer (admin only)
  const { data: agentListForDrawer = [] } = trpc.agents.list.useQuery(undefined, {
    enabled: isAdmin,
  });

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
        (sourceFilter === "always-on" && (s.leadSource?.startsWith("always-on:") ?? false)) ||
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

  if (!isAdmin && !isAuthenticated) {
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
    <div className="min-h-screen" style={{ backgroundColor: "#FFF8F5" }}>
      {/* Top bar */}
      <header className="bg-white border-b sticky top-0 z-40" style={{ borderColor: "#F0D8D0" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "#E8603C" }}
            >
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 text-lg leading-tight">
                Maids in Black
              </h1>
              <p className="text-xs text-gray-500">Leads Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Widget health indicator */}
            <WidgetHealthBadge />
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
            <NotificationBell />
          </div>
        </div>
        {/* Tab navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 border-t" style={{ borderColor: "#F0D8D0" }}>
          {(["leads", "agents", "leaderboard", "simulator"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
              style={activeTab === tab
                ? { borderColor: "#E8603C", color: "#E8603C" }
                : { borderColor: "transparent", color: "#6b7280" }}
            >
              {tab === "leads" ? <Phone className="w-3.5 h-3.5" /> : tab === "agents" ? <Users className="w-3.5 h-3.5" /> : tab === "leaderboard" ? <Trophy className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
              {tab === "leads" ? "Leads" : tab === "agents" ? "Agents" : tab === "leaderboard" ? "Leaderboard" : "AI Simulator"}
            </button>
          ))}
          <a
            href="/admin/campaigns"
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{ borderColor: "transparent", color: "#6b7280" }}
          >
            <Send className="w-3.5 h-3.5" />
            Campaigns
          </a>
          <a
            href="/admin/completed-jobs"
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{ borderColor: "transparent", color: "#6b7280" }}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Completed Jobs
          </a>
          <a
            href="/admin/always-on"
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{ borderColor: "transparent", color: "#6b7280" }}
          >
            <Zap className="w-3.5 h-3.5" />
            Always-On
          </a>
          <a
            href="/admin/sync-health"
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors"
            style={{ borderColor: "transparent", color: "#6b7280" }}
          >
            <Activity className="w-3.5 h-3.5" />
            Sync Health
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {activeTab === "agents" && <AgentManagement />}
        {activeTab === "leaderboard" && <AgentLeaderboard dateRange={dateRange} />}
        {activeTab === "simulator" && (
          <div className="py-4">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">AI Simulator</h2>
              <p className="text-sm text-gray-500 mt-0.5">Test Madison's responses in real time. Configure the lead context on the left, then type as if you were the lead.</p>
            </div>
            <SmsSimulator />
          </div>
        )}
        {activeTab === "leads" && <>
        {/* Summary + date filter row */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-gray-900">{stats?.total ?? 0}</span>
            <span className="text-gray-500 text-sm">leads</span>
          </div>

          {/* Date preset selector */}
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {DATE_PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => setDatePreset(p.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                style={
                  datePreset === p.value
                    ? { backgroundColor: "#E8603C", color: "white", borderColor: "#E8603C" }
                    : { backgroundColor: "white", color: "#6b7280", borderColor: "#e5e7eb" }
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range inputs */}
        {datePreset === "custom" && (
          <div className="flex items-center gap-3 mb-5 bg-white rounded-xl border p-3" style={{ borderColor: "#F0D8D0" }}>
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
            <div
              className="rounded-xl border p-4 flex flex-col gap-1"
              style={{ backgroundColor: "#eff6ff", borderColor: "#bfdbfe" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#1e40af" }}>
                Visitors
              </span>
              <span className="text-2xl font-bold" style={{ color: "#1e40af" }}>
                {(visitorStats?.visitors ?? 0).toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: "#1e40af", opacity: 0.7 }}>
                page views in range
              </span>
              <Sparkline data={dailyTrend.map(d => d.visitors)} color="#3b82f6" />
            </div>

            {/* Leads */}
            <div
              className="rounded-xl border p-4 flex flex-col gap-1"
              style={{ backgroundColor: "#fffbeb", borderColor: "#fde68a" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#92400e" }}>
                Leads
              </span>
              <span className="text-2xl font-bold" style={{ color: "#92400e" }}>
                {(stats.total ?? 0).toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: "#92400e", opacity: 0.7 }}>
                {visitorStats?.visitors
                  ? `${((stats.total / visitorStats.visitors) * 100).toFixed(1)}% visitor → lead`
                  : "form submissions"}
              </span>
              <Sparkline data={dailyTrend.map(d => d.leads)} color="#f59e0b" />
            </div>

            {/* Jobs Booked */}
            <div
              className="rounded-xl border p-4 flex flex-col gap-1"
              style={{ backgroundColor: "#dbeafe", borderColor: "#93c5fd" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#1e40af" }}>
                Jobs Booked
              </span>
              <span className="text-2xl font-bold" style={{ color: "#1e40af" }}>
                {stats.bookedCount ?? 0}
              </span>
              <span className="text-xs" style={{ color: "#1e40af", opacity: 0.7 }}>
                {stats.total > 0
                  ? `${stats.conversionRate ?? 0}% lead → booked`
                  : "no leads yet"}
              </span>
              <Sparkline data={dailyTrend.map(d => d.booked)} color="#2563eb" />
            </div>

            {/* Booked Revenue */}
            <div
              className="rounded-xl border p-4 flex flex-col gap-1"
              style={{ backgroundColor: "#d1fae5", borderColor: "#6ee7b7" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#065f46" }}>
                Booked Revenue
              </span>
              <span className="text-2xl font-bold" style={{ color: "#065f46" }}>
                ${(stats.bookedRevenue ?? 0).toLocaleString()}
              </span>
              {/* Source breakdown bar */}
              {stats.revenueBySource && stats.bookedRevenue > 0 && (() => {
                const rbs = stats.revenueBySource as Record<string, number>;
                const total = stats.bookedRevenue;
                const sources = [
                  { key: 'form', label: 'Form', color: '#059669' },
                  { key: 'widget', label: 'Widget', color: '#0d9488' },
                  { key: 'reactivation', label: 'Reactivation', color: '#7c3aed' },
                ];
                return (
                  <div className="mt-1 space-y-1">
                    <div className="flex h-2 rounded-full overflow-hidden gap-px">
                      {sources.map(s => {
                        const pct = total > 0 ? ((rbs[s.key] ?? 0) / total) * 100 : 0;
                        return pct > 0 ? (
                          <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} />
                        ) : null;
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {sources.filter(s => (rbs[s.key] ?? 0) > 0).map(s => (
                        <span key={s.key} className="flex items-center gap-1 text-xs" style={{ color: '#065f46', opacity: 0.85 }}>
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                          {s.label}: ${(rbs[s.key] ?? 0).toLocaleString()}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {!(stats.revenueBySource && stats.bookedRevenue > 0) && (
                <span className="text-xs" style={{ color: "#065f46", opacity: 0.7 }}>
                  from {stats.bookedCount ?? 0} job{(stats.bookedCount ?? 0) !== 1 ? "s" : ""}
                </span>
              )}
              <Sparkline data={dailyTrend.map(d => d.booked)} color="#059669" />
            </div>

            {/* Voice Calls */}
            <div
              className="rounded-xl border p-4 flex flex-col gap-1"
              style={{ backgroundColor: "#f5f3ff", borderColor: "#c4b5fd" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#5b21b6" }}>
                AI Voice Calls
              </span>
              <span className="text-2xl font-bold" style={{ color: "#5b21b6" }}>
                {(voiceStats?.totalCalls ?? 0).toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: "#5b21b6", opacity: 0.7 }}>
                {voiceStats?.totalCalls
                  ? `${voiceStats.conversionRate}% booked · avg ${Math.floor((voiceStats.avgDurationSeconds ?? 0) / 60)}:${String((voiceStats.avgDurationSeconds ?? 0) % 60).padStart(2, "0")}`
                  : "no calls yet"}
              </span>
              <Sparkline data={voiceStats?.dailyTrend?.map(d => d.count) ?? Array(7).fill(0)} color="#7c3aed" />
            </div>
          </div>
        )}

        {/* Traffic Source Breakdown */}
        <div className="rounded-xl border bg-card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Traffic Source</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Where your leads are coming from</p>
            </div>
          </div>
          <SourceBreakdownChart data={sourceBreakdown} isLoading={sourceBreakdownLoading} />
        </div>

        {/* Search + stage filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search name, phone, service…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-44 bg-white">
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
            <SelectTrigger className="w-44 bg-white">
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
            <SelectTrigger className="w-40 bg-white">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="form">Quote Form</SelectItem>
              <SelectItem value="widget">Widget</SelectItem>
              <SelectItem value="reactivation">Campaign</SelectItem>
              <SelectItem value="always-on">Always-On</SelectItem>
            </SelectContent>
          </Select>
          {(stageFilter !== "all" || agentFilter !== "all" || sourceFilter !== "all") && (
            <button
              onClick={() => { setStageFilter("all"); setAgentFilter("all"); setSourceFilter("all"); }}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 self-center"
            >
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
          <span className="text-sm text-gray-500 self-center">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border overflow-hidden shadow-sm" style={{ borderColor: "#F0D8D0" }}>
          {sessionsLoading ? (
            <div className="py-20 text-center text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" style={{ color: "#E8603C" }} />
              Loading leads…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center text-gray-400">
              <div className="text-4xl mb-3">📋</div>
              <p className="font-medium text-gray-600">No leads found</p>
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
                  <TableRow className="border-b" style={{ backgroundColor: "#fafafa" }}>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 pl-4 w-48">Lead</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 w-24">Source</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5">Service</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 w-24">Quote</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 w-36">Stage</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 w-32">Agent</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 w-44">Last Activity</TableHead>
                    <TableHead className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide py-2.5 w-24 pr-4">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(session => {
                    const isBooked = session.isBooked === 1;
                    const rowBg = isBooked ? "#f0fdf4" : "";
                    const accentColor = isBooked ? "#16a34a" : "transparent";
                    return (
                    <TableRow
                      key={session.id}
                      className="cursor-pointer transition-all duration-100 group"
                      style={{ backgroundColor: rowBg, borderLeft: `3px solid ${accentColor}` }}
                      onClick={() => setSelectedSession(session)}
                      onMouseEnter={e => { if (!isBooked) e.currentTarget.style.backgroundColor = "#FFF8F5"; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = rowBg; }}
                    >
                      {/* Lead — name + phone */}
                      <TableCell className="py-3 pl-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold text-gray-900 leading-tight">
                            {session.leadName ?? <span className="text-gray-300 font-normal">Unknown</span>}
                          </span>
                          <span className="text-xs text-gray-400 tabular-nums">
                            {formatPhone(session.leadPhone)}
                          </span>
                        </div>
                      </TableCell>

                      {/* Source */}
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-1">
                          {getSourceBadge(session.leadSource)}
                          {getLanguageBadge(session.language)}
                        </div>
                      </TableCell>

                      {/* Service — type + size */}
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm text-gray-800 leading-tight">
                            {session.serviceType ?? <span className="text-gray-300">—</span>}
                          </span>
                          {session.serviceType && (
                            <span className="text-xs text-gray-400">
                              {session.serviceType === "Office Cleaning"
                                ? (session.bedrooms ? `${session.bedrooms} sqft` : null)
                                : (session.bedrooms && session.bathrooms
                                    ? `${session.bedrooms} bd · ${session.bathrooms} ba`
                                    : null)
                              }
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Quote */}
                      <TableCell className="py-3">
                        {session.quotedPrice ? (() => {
                          const total = computeTotalQuote(session.quotedPrice, session.extras);
                          return (
                            <span className="text-sm font-bold tabular-nums" style={{ color: "#E8603C" }}>
                              ${total}
                            </span>
                          );
                        })() : (
                          <span className="text-gray-300 text-sm">—</span>
                        )}
                      </TableCell>

                      {/* Stage */}
                      <TableCell className="py-3">
                        <StageBadge stage={session.stage} />
                      </TableCell>

                      {/* Agent — avatar initial + name */}
                      <TableCell className="py-3">
                        {session.assignedAgentName ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                              style={{ backgroundColor: "#E8603C" }}
                            >
                              {session.assignedAgentName.charAt(0).toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-700 leading-tight">{session.assignedAgentName}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </TableCell>

                      {/* Last Activity — message preview primary, call note secondary */}
                      <TableCell className="py-3">
                        {session.lastActivityText ? (
                          <div className="flex items-start gap-1.5 max-w-[200px]">
                            {session.lastActivityType === "call" ? (
                              <PhoneCall className="w-3 h-3 text-blue-400 shrink-0 mt-0.5" />
                            ) : (
                              <MessageSquare className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "#E8603C", opacity: 0.6 }} />
                            )}
                            <span className="text-xs text-gray-700 truncate leading-tight">{session.lastActivityText}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </TableCell>

                      {/* When — single relative timestamp */}
                      <TableCell className="py-3 pr-4">
                        <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                          {session.lastActivityAt
                            ? timeAgo(session.lastActivityAt)
                            : timeAgo(session.updatedAt)}
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

        <p className="text-xs text-gray-400 mt-4 text-center">
          Auto-refreshes every 30 seconds · Click any row or stage card to filter · Click a stage card again to clear
        </p>
        </>}
      </main>

      {/* Conversation drawer */}
      {selectedSession && (
        <ConversationDrawer
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          isAdmin={isAdmin}
          agentList={agentListForDrawer}
          onSessionUpdate={(updates) => setSelectedSession(prev => prev ? { ...prev, ...updates } : null)}
          onRefresh={() => refetch()}
        />
      )}
    </div>
  );
}
