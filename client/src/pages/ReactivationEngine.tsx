/**
 * Reactivation Engine — AI SMS lifecycle dashboard
 * World-class AI-first design: precise, paced, revenue-first
 */
import { useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import {
  Sparkles,
  Play,
  Clock,
  TrendingUp,
  DollarSign,
  ShieldCheck,
  Search,
  ChevronRight,
  Zap,
  MessageSquare,
  Send,
  Edit3,
  BarChart2,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ArrowUpRight,
  RefreshCw,
  Filter,
  MoreHorizontal,
  Bot,
  Target,
  Flame,
  Star,
  Users,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// ── Types ────────────────────────────────────────────────────────────────────

type LeadStatus = "needs_attention" | "queued" | "follow_up_due" | "active" | "booked";
type SequenceTab = "recent" | "lapsed";
type PipelineStage = "new" | "contacted" | "engaged" | "quoted" | "booked";

interface Lead {
  id: string;
  initials: string;
  name: string;
  daysLapsed: number;
  value: number;
  status: LeadStatus;
  score: number;
  touchpoints: Array<{ day: number; type: "sms" | "reply" | "ai" | "call" }>;
}

interface PrioritySegment {
  id: string;
  label: string;
  description: string;
  count: number;
  color: string;
  icon: React.ReactNode;
  urgency: "high" | "medium" | "low";
}

interface SequenceStep {
  day: string;
  label: string;
}

// ── Mock Data ─────────────────────────────────────────────────────────────────

const PRIORITY_SEGMENTS: PrioritySegment[] = [
  {
    id: "high_intent",
    label: "High Intent",
    description: "Recent, high spend",
    count: 12,
    color: "emerald",
    icon: <Flame className="w-4 h-4" />,
    urgency: "high",
  },
  {
    id: "reactivation_gold",
    label: "Reactivation Gold",
    description: "Repeat customers",
    count: 18,
    color: "amber",
    icon: <Star className="w-4 h-4" />,
    urgency: "medium",
  },
  {
    id: "long_lapsed",
    label: "Long Lapsed",
    description: "120+ days",
    count: 42,
    color: "violet",
    icon: <Clock className="w-4 h-4" />,
    urgency: "low",
  },
];

const PIPELINE_STAGES: Array<{ id: PipelineStage; label: string; count: number }> = [
  { id: "new", label: "New", count: 40 },
  { id: "contacted", label: "Contacted", count: 34 },
  { id: "engaged", label: "Engaged", count: 19 },
  { id: "quoted", label: "Quoted", count: 11 },
  { id: "booked", label: "Booked", count: 6 },
];

const LEADS: Lead[] = [
  {
    id: "sarah",
    initials: "S",
    name: "Sarah M",
    daysLapsed: 18,
    value: 220,
    status: "needs_attention",
    score: 82,
    touchpoints: [
      { day: 8, type: "sms" }, { day: 8, type: "reply" },
      { day: 11, type: "ai" }, { day: 17, type: "call" },
      { day: 8, type: "sms" }, { day: 8, type: "sms" }, { day: 8, type: "ai" },
    ],
  },
  {
    id: "john",
    initials: "J",
    name: "John D",
    daysLapsed: 57,
    value: 180,
    status: "queued",
    score: 74,
    touchpoints: [
      { day: 11, type: "sms" }, { day: 17, type: "reply" },
      { day: 8, type: "sms" }, { day: 8, type: "ai" },
    ],
  },
  {
    id: "priya",
    initials: "P",
    name: "Priya R",
    daysLapsed: 11,
    value: 260,
    status: "follow_up_due",
    score: 88,
    touchpoints: [
      { day: 9, type: "sms" }, { day: 13, type: "reply" },
      { day: 8, type: "sms" }, { day: 8, type: "ai" },
    ],
  },
  {
    id: "marcus",
    initials: "M",
    name: "Marcus T",
    daysLapsed: 34,
    value: 195,
    status: "active",
    score: 71,
    touchpoints: [
      { day: 9, type: "sms" }, { day: 12, type: "reply" },
      { day: 8, type: "sms" },
    ],
  },
];

const SEQUENCE_STEPS_RECENT: SequenceStep[] = [
  { day: "Day 0", label: "Check-in" },
  { day: "Day 1", label: "Value" },
  { day: "Day 3", label: "Recurring" },
  { day: "Day 7", label: "Urgency" },
];

const SEQUENCE_STEPS_LAPSED: SequenceStep[] = [
  { day: "Day 0", label: "Re-intro" },
  { day: "Day 2", label: "Offer" },
  { day: "Day 5", label: "Social proof" },
  { day: "Day 10", label: "Final push" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  sub,
  trend,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub?: string;
  trend?: "up" | "neutral";
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start justify-between shadow-sm hover:shadow-md transition-shadow group">
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
      <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-gray-100 transition-colors">
        {icon}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const map: Record<LeadStatus, { label: string; className: string }> = {
    needs_attention: { label: "Needs attention", className: "bg-red-50 text-red-600 border border-red-100" },
    queued: { label: "Queued", className: "bg-gray-100 text-gray-500 border border-gray-200" },
    follow_up_due: { label: "Follow-up due", className: "bg-amber-50 text-amber-600 border border-amber-100" },
    active: { label: "Active", className: "bg-emerald-50 text-emerald-600 border border-emerald-100" },
    booked: { label: "Booked", className: "bg-blue-50 text-blue-600 border border-blue-100" },
  };
  const { label, className } = map[status];
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${className}`}>
      {label}
    </span>
  );
}

function TouchpointDot({ type }: { type: "sms" | "reply" | "ai" | "call" }) {
  const colors: Record<string, string> = {
    sms: "bg-blue-400",
    reply: "bg-emerald-400",
    ai: "bg-violet-400",
    call: "bg-amber-400",
  };
  return <span className={`w-2 h-2 rounded-full inline-block ${colors[type]}`} />;
}

function LeadCard({ lead }: { lead: Lead }) {
  const days = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const byDay = days.map(d => lead.touchpoints.filter(t => t.day === d));
  const bottomDots = lead.touchpoints.slice(0, 4);

  return (
    <div className="border-b border-gray-50 last:border-0 py-3 px-1 hover:bg-gray-50/60 rounded-xl transition-colors cursor-pointer group">
      <div className="flex items-center gap-3 mb-2">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
          {lead.initials}
        </div>
        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{lead.name}</span>
            <span className="text-xs text-gray-400">{lead.daysLapsed}d · ${lead.value}</span>
            <StatusBadge status={lead.status} />
          </div>
        </div>
        {/* Score */}
        <div className="flex-shrink-0 text-right">
          <span className={`text-sm font-bold ${lead.score >= 80 ? "text-emerald-600" : lead.score >= 70 ? "text-amber-600" : "text-gray-500"}`}>
            {lead.score}
          </span>
        </div>
      </div>

      {/* Timeline dots */}
      <div className="ml-11">
        <div className="flex items-end gap-[6px]">
          {days.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-[2px]" style={{ width: 14 }}>
              <span className="text-[9px] text-gray-300">{d}</span>
              {byDay[i].length > 0 ? (
                <div className="flex flex-col gap-[2px]">
                  {byDay[i].map((t, j) => <TouchpointDot key={j} type={t.type} />)}
                </div>
              ) : (
                <span className="w-2 h-2" />
              )}
            </div>
          ))}
        </div>
        {/* Bottom row dots */}
        <div className="flex gap-1 mt-1">
          {bottomDots.map((t, i) => <TouchpointDot key={i} type={t.type} />)}
        </div>
      </div>
    </div>
  );
}

function PrioritySegmentRow({ seg, onMessage }: { seg: PrioritySegment; onMessage: () => void }) {
  const urgencyDot: Record<string, string> = {
    high: "bg-emerald-400",
    medium: "bg-amber-400",
    low: "bg-violet-400",
  };
  return (
    <div className="flex items-center justify-between py-4 border-b border-gray-50 last:border-0 group hover:bg-gray-50/50 rounded-xl px-2 -mx-2 transition-colors">
      <div className="flex items-center gap-3">
        <div className={`w-1.5 h-8 rounded-full ${urgencyDot[seg.urgency]}`} />
        <div>
          <p className="font-semibold text-gray-900 text-sm">{seg.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{seg.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-gray-700 w-6 text-right">{seg.count}</span>
        <Button
          size="sm"
          className="bg-gray-900 hover:bg-gray-700 text-white text-xs px-3 py-1.5 h-auto rounded-lg font-medium shadow-sm"
          onClick={onMessage}
        >
          Message
        </Button>
      </div>
    </div>
  );
}

function DeliverabilityPanel() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 text-base">Deliverability</h3>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
          Healthy
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>Daily cap</span>
            <span className="font-semibold text-gray-700">50</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gray-900 rounded-full" style={{ width: "96%" }} />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>Similarity risk</span>
            <span className="font-semibold text-gray-700">18</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-gray-900 rounded-full" style={{ width: "36%" }} />
          </div>
        </div>

        <div className="flex items-start gap-2 pt-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-600 font-medium">Avoid links in first-touch messages</p>
        </div>
      </div>

      {/* AI health indicators */}
      <div className="mt-4 pt-4 border-t border-gray-50 space-y-2">
        {[
          { label: "Opt-out rate", value: "0.8%", ok: true },
          { label: "Spam reports", value: "0", ok: true },
          { label: "Response rate", value: "39%", ok: true },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{item.label}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-700">{item.value}</span>
              {item.ok
                ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                : <AlertTriangle className="w-3 h-3 text-amber-500" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AIRecommendationPanel({ lead }: { lead: Lead }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(
    `Hey ${lead.name.split(" ")[0]} — we can set you up on a simple recurring plan with priority scheduling so you never have to think about it again. Want me to show options?`
  );
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    setSent(true);
    setTimeout(() => setSent(false), 2000);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-2 mb-3">
        <div className="w-6 h-6 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-3.5 h-3.5 text-violet-500" />
        </div>
        <div>
          <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wider">AI Recommendation</p>
          <p className="font-bold text-gray-900 text-base leading-tight mt-0.5">Recurring Framing Offer</p>
        </div>
      </div>

      {/* Message */}
      {editing ? (
        <textarea
          className="w-full text-sm text-gray-700 leading-relaxed border border-gray-200 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-200 mb-3"
          rows={4}
          value={msg}
          onChange={e => setMsg(e.target.value)}
        />
      ) : (
        <p className="text-sm text-gray-600 leading-relaxed mb-4 bg-gray-50 rounded-xl p-3 border border-gray-100">
          {msg}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold h-9 rounded-xl shadow-sm"
          onClick={handleSend}
        >
          {sent ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
          {sent ? "Sent!" : "Send"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs font-semibold h-9 rounded-xl border-gray-200"
          onClick={() => setEditing(!editing)}
        >
          <Edit3 className="w-3.5 h-3.5 mr-1.5" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs font-semibold h-9 rounded-xl border-gray-200"
        >
          <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
          Strategy
        </Button>
      </div>

      {/* AI reasoning */}
      <div className="mt-3 pt-3 border-t border-gray-50">
        <p className="text-[10px] text-gray-400 leading-relaxed">
          <span className="font-semibold text-violet-400">Why this message:</span> {lead.name.split(" ")[0]} has booked 3× in the past 6 months. Recurring framing increases LTV by 2.4× for this segment.
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReactivationEngine() {
  const [sequenceTab, setSequenceTab] = useState<SequenceTab>("recent");
  const [selectedLead, setSelectedLead] = useState<Lead>(LEADS[0]);
  const [leadSearch, setLeadSearch] = useState("");
  const [runningToday, setRunningToday] = useState(false);

  const filteredLeads = LEADS.filter(l =>
    l.name.toLowerCase().includes(leadSearch.toLowerCase())
  );

  const sequenceSteps = sequenceTab === "recent" ? SEQUENCE_STEPS_RECENT : SEQUENCE_STEPS_LAPSED;

  return (
    <div className="min-h-screen bg-[#F8F9FB]">
      <AdminHeader activeTab="reactivation" />

      <div className="max-w-[1400px] mx-auto px-6 py-6">

        {/* ── Page Header ── */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Reactivation Engine</h1>
              <div className="w-5 h-5 rounded-md bg-violet-100 flex items-center justify-center">
                <Sparkles className="w-3 h-3 text-violet-500" />
              </div>
            </div>
            <p className="text-sm text-gray-400">AI SMS lifecycle — precise, paced, and revenue-first</p>
          </div>
          <Button
            className={`h-10 px-5 rounded-xl font-semibold text-sm shadow-md transition-all ${
              runningToday
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-gray-900 hover:bg-gray-700 text-white"
            }`}
            onClick={() => setRunningToday(!runningToday)}
          >
            {runningToday ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Running</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> Run Today</>
            )}
          </Button>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Messages"
            value="48 / 50"
            icon={<Clock className="w-4 h-4" />}
            sub="2 remaining today"
          />
          <StatCard
            label="Replies"
            value="39%"
            icon={<TrendingUp className="w-4 h-4" />}
            sub="+4% vs last week"
            trend="up"
          />
          <StatCard
            label="Revenue"
            value="$1,420"
            icon={<DollarSign className="w-4 h-4" />}
            sub="This campaign cycle"
          />
          <StatCard
            label="Deliverability"
            value="97"
            icon={<ShieldCheck className="w-4 h-4" />}
            sub="Score out of 100"
          />
        </div>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-[1fr_360px] gap-5">

          {/* LEFT COLUMN */}
          <div className="space-y-5">

            {/* AI Priority Queue */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-gray-900">AI Priority Queue</h2>
                  <div className="w-5 h-5 rounded-md bg-emerald-50 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-emerald-500" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="w-7 h-7 rounded-lg border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-50 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button className="w-7 h-7 rounded-lg border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-50 transition-colors">
                    <Filter className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="divide-y divide-gray-50">
                {PRIORITY_SEGMENTS.map(seg => (
                  <PrioritySegmentRow
                    key={seg.id}
                    seg={seg}
                    onMessage={() => {}}
                  />
                ))}
              </div>

              {/* AI insight strip */}
              <div className="mt-4 pt-4 border-t border-gray-50 flex items-start gap-2">
                <div className="w-5 h-5 rounded-md bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-3 h-3 text-violet-500" />
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">
                  <span className="font-semibold text-violet-500">AI insight:</span> High Intent segment has 3× higher booking rate when messaged before 11am. Schedule for tomorrow morning for best results.
                </p>
              </div>
            </div>

            {/* Lead Pipeline */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Lead Pipeline</h2>
                <button className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
                  View all <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-5 gap-3">
                {PIPELINE_STAGES.map((stage, i) => {
                  const widths = [100, 85, 47.5, 27.5, 15];
                  const colors = [
                    "bg-gray-100 text-gray-600",
                    "bg-blue-50 text-blue-600",
                    "bg-violet-50 text-violet-600",
                    "bg-amber-50 text-amber-600",
                    "bg-emerald-50 text-emerald-600",
                  ];
                  const barColors = ["bg-gray-300", "bg-blue-300", "bg-violet-400", "bg-amber-400", "bg-emerald-500"];
                  return (
                    <div key={stage.id} className="flex flex-col items-center gap-2">
                      <div className={`w-full rounded-xl px-3 py-2.5 text-center ${colors[i]} cursor-pointer hover:opacity-80 transition-opacity`}>
                        <p className="text-xs font-semibold">{stage.label}</p>
                        <p className="text-xl font-bold mt-0.5">{stage.count}</p>
                      </div>
                      {/* Mini bar */}
                      <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${barColors[i]} rounded-full`} style={{ width: `${widths[i]}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Funnel conversion hint */}
              <div className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
                <Activity className="w-3.5 h-3.5" />
                <span>New → Booked conversion: <span className="font-semibold text-gray-600">15%</span> · Industry avg: 8%</span>
                <ArrowUpRight className="w-3 h-3 text-emerald-500" />
              </div>
            </div>

            {/* Sequences */}
            <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Sequences</h2>
                <button className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors">
                  Edit sequences <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Tab toggle */}
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
                {(["recent", "lapsed"] as SequenceTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSequenceTab(tab)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      sequenceTab === tab
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Steps */}
              <div className="grid grid-cols-4 gap-3">
                {sequenceSteps.map((step, i) => (
                  <div
                    key={i}
                    className="relative border border-gray-100 rounded-xl p-3 hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer group"
                  >
                    {/* Connector line */}
                    {i < sequenceSteps.length - 1 && (
                      <div className="absolute right-0 top-1/2 translate-x-full -translate-y-1/2 w-3 h-px bg-gray-200 z-10" />
                    )}
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{step.day}</p>
                    <p className="text-sm font-semibold text-gray-800 mt-1">{step.label}</p>
                    <div className="mt-2 w-5 h-1 rounded-full bg-gray-200 group-hover:bg-violet-300 transition-colors" />
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-4">

            {/* Leads Panel */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
                <h3 className="font-bold text-gray-900 text-base">Leads</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
                    <Input
                      className="h-7 pl-7 pr-3 text-xs rounded-lg border-gray-100 bg-gray-50 w-28 focus:w-36 transition-all"
                      placeholder="Search"
                      value={leadSearch}
                      onChange={e => setLeadSearch(e.target.value)}
                    />
                  </div>
                  <button className="w-7 h-7 rounded-lg border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-50 transition-colors">
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Score legend */}
              <div className="flex items-center gap-3 px-4 py-2 bg-gray-50/50 border-b border-gray-50">
                {[
                  { color: "bg-blue-400", label: "SMS" },
                  { color: "bg-emerald-400", label: "Reply" },
                  { color: "bg-violet-400", label: "AI" },
                  { color: "bg-amber-400", label: "Call" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${item.color}`} />
                    <span className="text-[10px] text-gray-400">{item.label}</span>
                  </div>
                ))}
              </div>

              <div className="px-3 py-1 max-h-[480px] overflow-y-auto">
                {filteredLeads.map(lead => (
                  <div key={lead.id} onClick={() => setSelectedLead(lead)}>
                    <LeadCard lead={lead} />
                  </div>
                ))}
              </div>
            </div>

            {/* AI Recommendation */}
            <AIRecommendationPanel lead={selectedLead} />

            {/* Deliverability */}
            <DeliverabilityPanel />

          </div>
        </div>
      </div>
    </div>
  );
}
