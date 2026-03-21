/**
 * CommandCenter — AI Lead Command Center for Maids in Black
 *
 * Sections:
 *   1. KPI stat cards (New Leads, Booked, Revenue, Response Rate, Conversion, Pipeline)
 *   2. Today Pulse (AI-generated alert / opportunity / revenue insight cards)
 *   3. AI Action Feed (ranked recommendations with one-click execute)
 *   4. Lead Funnel Breakdown
 *   5. Hot Leads Queue (ranked by intent score, one-click call/SMS)
 *   6. Speed to Lead panel
 *   7. Revenue Forecast panel
 *   8. Lead Source Intelligence table
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Phone,
  MessageSquare,
  Zap,
  RefreshCw,
  Loader2,
  BrainCircuit,
  AlertTriangle,
  Lightbulb,
  DollarSign,
  Users,
  Clock,
  Target,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Flame,
  Activity,
  Send,
  PhoneCall,
  RotateCcw,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = "today" | "7d" | "30d";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtDollar(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}

function fmtChange(n: number, suffix = "%") {
  if (n > 0) return { label: `+${n}${suffix}`, color: "text-emerald-600" };
  if (n < 0) return { label: `${n}${suffix}`, color: "text-red-500" };
  return { label: `—`, color: "text-gray-400" };
}

function TrendBadge({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const { label, color } = fmtChange(value, suffix);
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function Spinner() {
  return <Loader2 className="w-4 h-4 animate-spin text-gray-400" />;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  trend,
  trendSuffix,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  trend?: number;
  trendSuffix?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</span>
        <span className={`p-1.5 rounded-lg ${accent ?? "bg-gray-50"}`}>
          <Icon className="w-3.5 h-3.5 text-gray-600" />
        </span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-gray-900 leading-none">{value}</span>
        {trend !== undefined && <TrendBadge value={trend} suffix={trendSuffix} />}
      </div>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

// ─── Pulse Card ───────────────────────────────────────────────────────────────

const pulseStyles = {
  alert: {
    bg: "bg-gray-900",
    label: "Primary Alert",
    labelColor: "text-gray-400",
    titleColor: "text-white",
    bodyColor: "text-gray-300",
    metricColor: "text-white font-semibold",
    actionColor: "text-gray-400",
    icon: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
  },
  opportunity: {
    bg: "bg-emerald-50",
    label: "Opportunity",
    labelColor: "text-emerald-600",
    titleColor: "text-gray-900",
    bodyColor: "text-gray-600",
    metricColor: "text-emerald-700 font-semibold",
    actionColor: "text-emerald-600",
    icon: <Lightbulb className="w-3.5 h-3.5 text-emerald-500" />,
  },
  revenue: {
    bg: "bg-amber-50",
    label: "Hidden Revenue",
    labelColor: "text-amber-600",
    titleColor: "text-gray-900",
    bodyColor: "text-gray-600",
    metricColor: "text-amber-700 font-semibold",
    actionColor: "text-amber-600",
    icon: <DollarSign className="w-3.5 h-3.5 text-amber-500" />,
  },
};

function PulseCard({
  type,
  title,
  body,
  metric,
  action,
}: {
  type: string;
  title: string;
  body: string;
  metric: string;
  action: string;
}) {
  const style = pulseStyles[type as keyof typeof pulseStyles] ?? pulseStyles.opportunity;
  return (
    <div className={`${style.bg} rounded-xl p-5 flex flex-col gap-3 flex-1 min-w-0`}>
      <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${style.labelColor}`}>
        {style.icon}
        {style.label}
      </div>
      <div className={`text-base font-bold leading-snug ${style.titleColor}`}>{title}</div>
      <div className={`text-sm leading-relaxed ${style.bodyColor}`}>{body}</div>
      <div className={`text-sm ${style.metricColor}`}>{metric}</div>
      <div className={`text-xs ${style.actionColor} mt-auto`}>
        <span className="font-medium">Suggested move:</span> {action}
      </div>
    </div>
  );
}

// ─── Action Feed Item ─────────────────────────────────────────────────────────

const urgencyBadge = {
  high: "bg-red-50 text-red-600 border-red-100",
  medium: "bg-amber-50 text-amber-600 border-amber-100",
  low: "bg-gray-50 text-gray-500 border-gray-100",
};

const actionTypeIcon = {
  send_sms: <MessageSquare className="w-4 h-4" />,
  trigger_call: <PhoneCall className="w-4 h-4" />,
  review_leads: <Activity className="w-4 h-4" />,
  reactivate: <RotateCcw className="w-4 h-4" />,
};

function ActionFeedItem({
  id,
  title,
  description,
  estimatedValue,
  actionType,
  urgency,
  onExecute,
  executing,
}: {
  id: string;
  title: string;
  description: string;
  estimatedValue: string;
  actionType: string;
  urgency: string;
  onExecute: (id: string, actionType: string) => void;
  executing: boolean;
}) {
  return (
    <div className="flex items-start gap-4 py-4 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-gray-900">{title}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${urgencyBadge[urgency as keyof typeof urgencyBadge] ?? urgencyBadge.low}`}>
            {urgency}
          </span>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      </div>
      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="text-xs font-bold text-emerald-600 whitespace-nowrap">{estimatedValue}</span>
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 px-2.5 gap-1.5"
          onClick={() => onExecute(id, actionType)}
          disabled={executing}
        >
          {executing ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            actionTypeIcon[actionType as keyof typeof actionTypeIcon] ?? <Zap className="w-3 h-3" />
          )}
          Execute
        </Button>
      </div>
    </div>
  );
}

// ─── Funnel Bar ───────────────────────────────────────────────────────────────

function FunnelRow({
  label,
  count,
  pct,
  dropOff,
  isLast,
}: {
  label: string;
  count: number;
  pct: number;
  dropOff: number;
  isLast?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <div className="flex items-center gap-4">
          <span className="text-gray-500">{count} leads</span>
          <span className="font-semibold text-gray-900 w-12 text-right">{pct}%</span>
          {dropOff > 0 && (
            <span className="text-xs text-red-500 w-16 text-right">-{dropOff}% drop</span>
          )}
          {dropOff === 0 && <span className="w-16" />}
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gray-900 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Hot Lead Card ────────────────────────────────────────────────────────────

const stageColors: Record<string, string> = {
  CALL_SCHEDULED: "bg-purple-100 text-purple-700",
  CONFIRMATION: "bg-teal-100 text-teal-700",
  ADDRESS: "bg-indigo-100 text-indigo-700",
  SLOT_CHOICE: "bg-orange-100 text-orange-700",
  TIME_PREF: "bg-amber-100 text-amber-700",
  AVAILABILITY: "bg-yellow-100 text-yellow-700",
  QUOTE_SENT: "bg-blue-100 text-blue-700",
  UNHANDLED: "bg-red-100 text-red-700",
  COLD: "bg-gray-100 text-gray-500",
};

function HotLeadCard({
  lead,
  onSms,
  onCall,
  smsSending,
  callSending,
}: {
  lead: {
    id: number;
    name: string;
    phone: string;
    stage: string;
    serviceType: string;
    source: string;
    nextBestAction: string;
    intentScore: number;
    context: string | null;
  };
  onSms: (id: number, name: string) => void;
  onCall: (id: number, name: string) => void;
  smsSending: boolean;
  callSending: boolean;
}) {
  const isHot = lead.intentScore >= 80;
  const isWarm = lead.intentScore >= 60;
  const scoreBg = isHot ? "bg-red-500" : isWarm ? "bg-amber-500" : "bg-gray-400";
  const stageCls = stageColors[lead.stage] ?? "bg-gray-100 text-gray-500";

  return (
    <div className={`rounded-xl border p-4 mb-3 last:mb-0 transition-all ${
      isHot ? "border-red-200 bg-red-50/40" :
      isWarm ? "border-amber-200 bg-amber-50/30" :
      "border-gray-100 bg-white"
    }`}>
      <div className="flex items-start gap-3">
        {/* Intent score badge */}
        <div className={`${scoreBg} rounded-xl text-white text-center shrink-0 w-12 py-2`}>
          <div className="text-xl font-bold leading-none">{lead.intentScore}</div>
          <div className="text-[9px] font-semibold opacity-80 mt-0.5 tracking-wide">INTENT</div>
        </div>

        {/* Lead info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="font-bold text-sm text-gray-900">{lead.name}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${stageCls}`}>
              {lead.stage.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{lead.source}</span>
            {lead.serviceType && (
              <span className="text-xs text-gray-400">{lead.serviceType}</span>
            )}
          </div>
          {lead.context && (
            <p className="text-xs text-gray-500 leading-relaxed mb-2 line-clamp-2">{lead.context}</p>
          )}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100/80">
            <p className="text-xs font-semibold text-gray-700 flex-1 min-w-0 truncate">
              <span className="text-gray-400 font-normal">Next: </span>{lead.nextBestAction}
            </p>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 gap-1 text-xs bg-white"
                onClick={() => onSms(lead.id, lead.name)}
                disabled={smsSending}
              >
                {smsSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
                SMS
              </Button>
              <Button
                size="sm"
                className={`h-7 px-2.5 gap-1 text-xs ${
                  isHot ? "bg-red-500 hover:bg-red-600 text-white border-0" :
                  isWarm ? "bg-amber-500 hover:bg-amber-600 text-white border-0" :
                  "bg-white"
                }`}
                variant={isHot || isWarm ? "default" : "outline"}
                onClick={() => onCall(lead.id, lead.name)}
                disabled={callSending}
              >
                {callSending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
                Call
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CommandCenter() {
  const [range, setRange] = useState<Range>("30d");
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [smsSending, setSmsSending] = useState<number | null>(null);
  const [callSending, setCallSending] = useState<number | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const statsQuery = trpc.commandCenter.getDashboardStats.useQuery(
    { range },
    { refetchInterval: 60_000, staleTime: 30_000 }
  );
  const funnelQuery = trpc.commandCenter.getFunnelBreakdown.useQuery(
    { range: range === "today" ? "30d" : range },
    { staleTime: 60_000 }
  );
  const hotLeadsQuery = trpc.commandCenter.getHotLeads.useQuery(
    { limit: 8 },
    { refetchInterval: 120_000, staleTime: 60_000 }
  );
  const sourceQuery = trpc.commandCenter.getLeadSourceIntelligence.useQuery(
    { range },
    { staleTime: 60_000 }
  );
  const speedQuery = trpc.commandCenter.getSpeedToLead.useQuery(
    { range: range === "today" ? "7d" : range },
    { staleTime: 60_000 }
  );
  const insightsQuery = trpc.commandCenter.getAiInsights.useQuery(
    { range },
    { staleTime: 120_000 }
  );
  const convIntelQuery = trpc.commandCenter.getConversationIntelligence.useQuery(
    { range },
    { staleTime: 300_000 }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const executeLeadAction = trpc.commandCenter.executeLeadAction.useMutation();
  const executeBulkAction = trpc.commandCenter.executeBulkAction.useMutation();

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleActionFeedExecute = useCallback(async (id: string, actionType: string) => {
    setExecutingAction(id);
    try {
      if (actionType === "review_leads") {
        window.location.href = "/admin";
        return;
      }
      if (actionType === "reactivate") {
        const result = await executeBulkAction.mutateAsync({ actionType: "reactivate_pool" });
        toast.success(`Reactivation SMS sent to ${result.sent} leads`);
        return;
      }
      if (actionType === "send_sms") {
        const result = await executeBulkAction.mutateAsync({ actionType: "followup_cold" });
        toast.success(`Follow-up SMS sent to ${result.sent} leads`);
        return;
      }
      if (actionType === "trigger_call") {
        const result = await executeBulkAction.mutateAsync({ actionType: "followup_quote_sent" });
        toast.success(`Follow-up SMS sent to ${result.sent} open quotes`);
        return;
      }
      toast.info("Action executed");
    } catch (err) {
      toast.error("Action failed — check logs");
      console.error(err);
    } finally {
      setExecutingAction(null);
    }
  }, [executeBulkAction]);

  const handleLeadSms = useCallback(async (sessionId: number, name: string) => {
    setSmsSending(sessionId);
    try {
      const result = await executeLeadAction.mutateAsync({ sessionId, actionType: "send_sms" });
      if (result.success) {
        toast.success(`SMS sent to ${name}`);
      } else {
        toast.error("SMS failed");
      }
    } catch {
      toast.error("SMS failed");
    } finally {
      setSmsSending(null);
    }
  }, [executeLeadAction]);

  const handleLeadCall = useCallback(async (sessionId: number, name: string) => {
    setCallSending(sessionId);
    try {
      const result = await executeLeadAction.mutateAsync({ sessionId, actionType: "trigger_call" });
      if (result.success) {
        toast.success(`Call alert triggered for ${name}`);
      } else {
        toast.info("Call skipped — outside business hours or disabled");
      }
    } catch {
      toast.error("Call failed");
    } finally {
      setCallSending(null);
    }
  }, [executeLeadAction]);

  const stats = statsQuery.data;
  const funnel = funnelQuery.data;
  const hotLeads = hotLeadsQuery.data ?? [];
  const sources = sourceQuery.data ?? [];
  const speed = speedQuery.data;
  const insights = insightsQuery.data;

  const convIntel = convIntelQuery.data;
  const rangeLabel = { today: "Today", "7d": "7 Days", "30d": "30 Days" };

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activeTab="command-center" />

      {/* ── AI Pulse Hero (light) ──────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Title + live indicator */}
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center">
                  <BrainCircuit className="w-5 h-5 text-violet-600" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900">AI Lead Command Center</h1>
                  <span className="text-xs text-emerald-600 font-medium bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">Live</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Real-time pipeline, AI insights, and next-best actions
                </p>
              </div>
            </div>

            {/* Live KPI pills */}
            <div className="sm:ml-auto flex flex-wrap items-center gap-2">
              {stats ? (
                <>
                  <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                    <Flame className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs text-gray-700 font-medium">{stats.totalLeads} leads</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-xs text-gray-700 font-medium">{stats.bookedJobs} booked</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-violet-500" />
                    <span className="text-xs text-gray-700 font-medium">{fmtDollar(stats.pipelineValue)} pipeline</span>
                  </div>
                  {speed && (
                    <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
                      <Clock className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-xs text-gray-700 font-medium">{speed.avgFirstResponseMinutes} min avg contact</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="h-7 w-64 rounded-full bg-gray-100 animate-pulse" />
              )}
            </div>
          </div>

          {/* AI insight ticker */}
          {insights?.pulse && insights.pulse.length > 0 && (
            <div className="mt-3 flex items-start gap-2 bg-violet-50 border border-violet-100 rounded-xl px-4 py-2.5 max-w-3xl">
              <Activity className="w-3.5 h-3.5 text-violet-500 shrink-0 mt-0.5" />
              <p className="text-xs text-gray-600 leading-relaxed">
                <span className="text-violet-600 font-semibold">AI: </span>
                {insights.pulse[0].body}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Page Sub-Header (range + refresh) ────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-gray-400">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Real-time pipeline, AI insights, and next-best actions
          </p>
          <div className="flex items-center gap-2">
            {(["today", "7d", "30d"] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                  range === r
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                {rangeLabel[r]}
              </button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                statsQuery.refetch();
                insightsQuery.refetch();
                hotLeadsQuery.refetch();
                convIntelQuery.refetch();
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── KPI Cards ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statsQuery.isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 h-24 animate-pulse" />
            ))
          ) : stats ? (
            <>
              <KpiCard
                label="New Leads"
                value={fmt(stats.totalLeads)}
                sub="vs previous period"
                trend={stats.leadsChange}
                icon={Users}
                accent="bg-blue-50"
              />
              <KpiCard
                label="Booked Jobs"
                value={fmt(stats.bookedJobs)}
                sub="this period"
                trend={stats.bookedChange}
                trendSuffix=""
                icon={CheckCircle2}
                accent="bg-emerald-50"
              />
              <KpiCard
                label="Revenue Booked"
                value={fmtDollar(stats.bookedRevenue)}
                sub="confirmed bookings"
                icon={DollarSign}
                accent="bg-amber-50"
              />
              <KpiCard
                label="Response Rate"
                value={`${stats.responseRate}%`}
                sub={stats.responseRate < 70 ? "needs attention" : "on track"}
                icon={MessageSquare}
                accent="bg-purple-50"
              />
              <KpiCard
                label="Lead → Booking"
                value={`${stats.conversionRate}%`}
                sub="conversion rate"
                trend={stats.conversionChange}
                icon={Target}
                accent="bg-rose-50"
              />
              <KpiCard
                label="Pipeline Value"
                value={fmtDollar(stats.pipelineValue)}
                sub="est. open pipeline"
                icon={BarChart3}
                accent="bg-indigo-50"
              />
            </>
          ) : null}
        </div>

        {/* ── Today Pulse + AI Action Feed ─────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Today Pulse */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-gray-900">Today Pulse</h2>
                <p className="text-xs text-gray-400">What changed, what matters, what to do now.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                AI monitoring live
              </span>
            </div>
            {insightsQuery.isLoading ? (
              <div className="flex gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex-1 h-40 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : insights?.pulse ? (
              <div className="flex flex-col sm:flex-row gap-3">
                {insights.pulse.map((card, i) => (
                  <PulseCard key={i} {...card} />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400 py-8 text-center">No insights available yet</div>
            )}
          </div>

          {/* AI Action Feed */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-4 h-4 text-gray-700" />
                <h2 className="font-bold text-gray-900">AI Action Feed</h2>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Your manager-style to-do list for the day.</p>
            </div>
            {insightsQuery.isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : insights?.actionFeed ? (
              <div>
                {insights.actionFeed.map(item => (
                  <ActionFeedItem
                    key={item.id}
                    {...item}
                    onExecute={handleActionFeedExecute}
                    executing={executingAction === item.id}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400 py-8 text-center">No actions available</div>
            )}
          </div>
        </div>

        {/* ── Funnel + Hot Leads ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Lead Funnel Breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-gray-900">Lead Funnel Breakdown</h2>
                <p className="text-xs text-gray-400">Track exactly where leads are leaking.</p>
              </div>
              {funnel?.biggestDropOff && (
                <span className="text-xs text-gray-500">
                  Biggest drop-off: <span className="font-semibold text-gray-900">{funnel.biggestDropOff}</span>
                </span>
              )}
            </div>
            {funnelQuery.isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : funnel ? (
              <div className="space-y-4">
                {funnel.stages.map((stage, i) => (
                  <FunnelRow
                    key={stage.key}
                    label={stage.label}
                    count={stage.count}
                    pct={stage.pct}
                    dropOff={stage.dropOff}
                    isLast={i === funnel.stages.length - 1}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {/* Hot Leads Queue */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <h2 className="font-bold text-gray-900">Hot Leads Queue</h2>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Ranked by intent and urgency.</p>
              </div>
              {hotLeads.filter(l => l.intentScore >= 75).length > 0 && (
                <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2.5 py-1">
                  {hotLeads.filter(l => l.intentScore >= 75).length} need action now
                </span>
              )}
            </div>
            {hotLeadsQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : hotLeads.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No active hot leads right now</div>
            ) : (
              <div>
                {hotLeads.map(lead => (
                  <HotLeadCard
                    key={lead.id}
                    lead={lead}
                    onSms={handleLeadSms}
                    onCall={handleLeadCall}
                    smsSending={smsSending === lead.id}
                    callSending={callSending === lead.id}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Speed to Lead + Revenue Forecast ─────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          {/* Speed to First Contact */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="mb-4">
              <h2 className="font-bold text-gray-900">Speed to First Contact</h2>
              <p className="text-xs text-gray-400 mt-0.5">Time from lead arrival to first outbound SMS.</p>
            </div>
            {speedQuery.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-16 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : speed ? (
              <div className="space-y-3">
                <div className="bg-gray-900 rounded-xl p-4 text-white">
                  <p className="text-xs text-gray-400 mb-1">Avg first contact</p>
                  <p className="text-3xl font-bold">{speed.avgFirstResponseMinutes} <span className="text-base font-normal text-gray-400">min</span></p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">Contacted under 2 min</p>
                  <p className="text-xl font-bold text-gray-900">{speed.contactedUnder2MinPct}%</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">Leads contacted</p>
                  <p className="text-xl font-bold text-gray-900">{speed.contactedCount} <span className="text-sm font-normal text-gray-400">of {speed.totalLeads}</span></p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Revenue Forecast */}
          <div className="sm:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-bold text-gray-900 mb-4">Revenue Forecast</h2>
            {statsQuery.isLoading ? (
              <div className="h-32 rounded-lg bg-gray-100 animate-pulse" />
            ) : stats ? (
              <div className="space-y-3">
                <div className="bg-gray-900 rounded-xl p-4 text-white">
                  <p className="text-xs text-gray-400 mb-1">Pipeline value</p>
                  <p className="text-3xl font-bold">{fmtDollar(stats.pipelineValue)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Pipeline close probability", value: `${stats.conversionRate}%` },
                    { label: "Avg response time", value: `${stats.avgResponseMinutes} min` },
                    { label: "Booked this period", value: fmtDollar(stats.bookedRevenue) },
                    { label: "Lead → booking rate", value: `${stats.conversionRate}%` },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-0.5">{item.label}</p>
                      <p className="text-base font-bold text-gray-900">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Conversation Intelligence ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <BrainCircuit className="w-4 h-4 text-violet-500" />
                <h2 className="font-bold text-gray-900">Conversation Intelligence</h2>
              </div>
              <p className="text-xs text-gray-400">AI reads objections, urgency, and close likelihood from SMS conversations.</p>
            </div>
            {convIntelQuery.isFetching && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Analyzing...
              </div>
            )}
          </div>
          {convIntelQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : convIntel && convIntel.objections.length > 0 ? (
            <div className="space-y-4">
              {/* Objection cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {convIntel.objections.map((obj, i) => {
                  const barColors = ["bg-gray-900", "bg-gray-700", "bg-gray-500", "bg-gray-400", "bg-gray-300"];
                  return (
                    <div key={i} className="rounded-xl border border-gray-100 p-4 hover:border-gray-200 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-semibold text-sm text-gray-900">{obj.label}</span>
                        <span className="text-sm font-bold text-gray-700 shrink-0 ml-2">{obj.pct}%</span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
                        <div
                          className={`h-1.5 rounded-full ${barColors[i] ?? "bg-gray-300"} transition-all`}
                          style={{ width: `${Math.min(obj.pct, 100)}%` }}
                        />
                      </div>
                      {/* Coaching tip */}
                      <p className="text-xs text-violet-700 bg-violet-50 rounded-lg px-2.5 py-2 leading-relaxed mb-2">
                        <span className="font-semibold">Tip: </span>{obj.tip}
                      </p>
                      {/* Example quote */}
                      {obj.example && (
                        <p className="text-xs text-gray-400 italic">&ldquo;{obj.example}&rdquo;</p>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Top insight */}
              {convIntel.topInsight && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-amber-700">AI finding</span>
                    <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{convIntel.topInsight}</p>
                  </div>
                </div>
              )}
              <p className="text-xs text-gray-400">{convIntel.totalMessagesAnalyzed} messages analyzed</p>
            </div>
          ) : convIntel ? (
            <div className="text-sm text-gray-400 py-8 text-center">{convIntel.topInsight}</div>
          ) : null}
        </div>

        {/* ── Lead Source Intelligence ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-gray-900">Lead Source Intelligence</h2>
              <p className="text-xs text-gray-400">Know where the best jobs actually come from.</p>
            </div>
            <span className="text-xs text-gray-400">Sorted by revenue</span>
          </div>
          {sourceQuery.isLoading ? (
            <div className="h-32 rounded bg-gray-100 animate-pulse" />
          ) : sources.length === 0 ? (
            <div className="text-sm text-gray-400 py-6 text-center">No source data available for this period</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {["Source", "Leads", "CPL", "Booked", "Revenue", "ROAS", "AI Note"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 pb-2 pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sources.map(row => (
                    <tr key={row.source} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 pr-4 font-semibold text-gray-900">{row.label}</td>
                      <td className="py-3 pr-4 text-gray-600">{row.leads}</td>
                      <td className="py-3 pr-4 text-gray-600">{row.cpl > 0 ? `$${row.cpl}` : "—"}</td>
                      <td className="py-3 pr-4 text-gray-600">{row.booked}</td>
                      <td className="py-3 pr-4 text-gray-600">{row.revenue > 0 ? fmtDollar(row.revenue) : "$0"}</td>
                      <td className="py-3 pr-4 text-gray-600">{row.roas != null ? `${row.roas}x` : "—"}</td>
                      <td className="py-3 text-gray-500 italic">{row.aiNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
