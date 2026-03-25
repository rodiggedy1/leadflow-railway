/**
 * Reactivation Engine — AI SMS lifecycle dashboard
 * World-class AI-first design: precise, paced, revenue-first
 */
import { useState, useEffect, useRef } from "react";
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
  X,
  Phone,
  Brain,
  ChevronDown,
  Timer,
  RotateCcw,
  MessageCircle,
  Cpu,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LineChart,
  Line,
} from "recharts";

// ── Chart Data ───────────────────────────────────────────────────────────────

const DAILY_DATA = [
  { day: "Mar 15", bookings: 2, revenue: 340, messages: 18, replies: 7 },
  { day: "Mar 16", bookings: 1, revenue: 160, messages: 12, replies: 4 },
  { day: "Mar 17", bookings: 3, revenue: 520, messages: 22, replies: 10 },
  { day: "Mar 18", bookings: 0, revenue: 0,   messages: 8,  replies: 2 },
  { day: "Mar 19", bookings: 4, revenue: 680, messages: 30, replies: 14 },
  { day: "Mar 20", bookings: 2, revenue: 310, messages: 20, replies: 8 },
  { day: "Mar 21", bookings: 5, revenue: 890, messages: 35, replies: 16 },
  { day: "Mar 22", bookings: 3, revenue: 420, messages: 25, replies: 11 },
  { day: "Mar 23", bookings: 6, revenue: 1020, messages: 40, replies: 19 },
  { day: "Mar 24", bookings: 4, revenue: 760, messages: 32, replies: 15 },
  { day: "Mar 25", bookings: 2, revenue: 340, messages: 22, replies: 9, today: true },
];

type ChartMetric = "revenue" | "bookings";

function RevenueChart() {
  const [metric, setMetric] = useState<ChartMetric>("revenue");

  const totalRevenue = DAILY_DATA.reduce((s, d) => s + d.revenue, 0);
  const totalBookings = DAILY_DATA.reduce((s, d) => s + d.bookings, 0);
  const avgRevenue = Math.round(totalRevenue / DAILY_DATA.length);
  const bestDay = DAILY_DATA.reduce((best, d) => d.revenue > best.revenue ? d : best, DAILY_DATA[0]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = DAILY_DATA.find(x => x.day === label);
    if (!d) return null;
    return (
      <div className="bg-gray-900 text-white rounded-xl px-3.5 py-3 shadow-xl text-xs min-w-[140px]">
        <p className="font-semibold text-gray-300 mb-2">{label}{d.today ? " · Today" : ""}</p>
        <div className="space-y-1.5">
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Revenue</span>
            <span className="font-bold text-emerald-400">${d.revenue.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Bookings</span>
            <span className="font-bold text-white">{d.bookings}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">Reply rate</span>
            <span className="font-bold text-violet-300">{d.messages > 0 ? Math.round((d.replies / d.messages) * 100) : 0}%</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-lg font-bold text-gray-900">Performance</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">Last 11 days</span>
          </div>
          <p className="text-xs text-gray-400">Bookings and revenue attributed to this campaign</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(["revenue", "bookings"] as ChartMetric[]).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                metric === m ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total Revenue", value: `$${totalRevenue.toLocaleString()}`, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Total Bookings", value: String(totalBookings), color: "text-gray-900", bg: "bg-gray-50" },
          { label: "Avg / Day", value: `$${avgRevenue.toLocaleString()}`, color: "text-violet-600", bg: "bg-violet-50" },
          { label: "Best Day", value: bestDay.day, color: "text-amber-600", bg: "bg-amber-50" },
        ].map(kpi => (
          <div key={kpi.label} className={`${kpi.bg} rounded-xl px-3.5 py-2.5`}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{kpi.label}</p>
            <p className={`text-lg font-bold mt-0.5 ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="relative">
        {metric === "revenue" ? (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={DAILY_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                tickFormatter={v => v.replace("Mar ", "")} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                tickFormatter={v => `$${v}`} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#e2e8f0", strokeWidth: 1 }} />
              <ReferenceLine x={"Mar 25"} stroke="#6366f1" strokeDasharray="4 4" strokeWidth={1.5}
                label={{ value: "Today", position: "top", fontSize: 9, fill: "#6366f1", fontWeight: 600 }} />
              <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revenueGrad)"
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (payload.today) return <circle key={payload.day} cx={cx} cy={cy} r={5} fill="#6366f1" stroke="white" strokeWidth={2} />;
                  if (payload.revenue === bestDay.revenue) return <circle key={payload.day} cx={cx} cy={cy} r={4} fill="#10b981" stroke="white" strokeWidth={2} />;
                  return <circle key={payload.day} cx={cx} cy={cy} r={0} fill="transparent" />;
                }}
                activeDot={{ r: 5, fill: "#10b981", stroke: "white", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={DAILY_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                tickFormatter={v => v.replace("Mar ", "")} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f8fafc" }} />
              <ReferenceLine x={"Mar 25"} stroke="#6366f1" strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar dataKey="bookings" radius={[6, 6, 0, 0]} maxBarSize={32}>
                {DAILY_DATA.map((entry, i) => (
                  <Cell key={i}
                    fill={entry.today ? "#6366f1" : entry.bookings >= 5 ? "#1e293b" : entry.bookings >= 3 ? "#475569" : "#cbd5e1"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex items-center gap-5 mt-3 pt-3 border-t border-gray-50">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full bg-emerald-500 inline-block" />
          <span className="text-[10px] text-gray-400">Revenue</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-[#1e293b] inline-block" />
          <span className="text-[10px] text-gray-400">High bookings</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#6366f1] inline-block" />
          <span className="text-[10px] text-gray-400">Today</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-gray-300" />
          <span className="text-[10px] text-gray-400">Hover bars for full breakdown</span>
        </div>
      </div>
    </div>
  );
}

// ── AI Activity Feed ──────────────────────────────────────────────────────────

const ACTIVITY_FEED = [
  { id: 1, type: "sent", text: "AI sent Sarah M a follow-up", time: "2m ago", color: "text-violet-500", bg: "bg-violet-50", icon: <Bot className="w-3 h-3" /> },
  { id: 2, type: "reply", text: "Marcus T replied", time: "8m ago", color: "text-emerald-600", bg: "bg-emerald-50", icon: <MessageCircle className="w-3 h-3" /> },
  { id: 3, type: "booked", text: "Priya R booked a cleaning", time: "23m ago", color: "text-blue-600", bg: "bg-blue-50", icon: <CheckCircle2 className="w-3 h-3" /> },
  { id: 4, type: "sent", text: "AI sent John D a re-intro", time: "41m ago", color: "text-violet-500", bg: "bg-violet-50", icon: <Bot className="w-3 h-3" /> },
  { id: 5, type: "analyzed", text: "AI re-scored 12 High Intent leads", time: "1h ago", color: "text-amber-600", bg: "bg-amber-50", icon: <Cpu className="w-3 h-3" /> },
];

function AIActivityFeed() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <h2 className="text-sm font-bold text-gray-900">AI Activity</h2>
          <span className="text-[10px] text-gray-400">Live</span>
        </div>
        <button className="text-[10px] text-gray-400 hover:text-gray-600 flex items-center gap-0.5 transition-colors">
          View all <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {ACTIVITY_FEED.map(item => (
          <div key={item.id} className="flex items-center gap-2 flex-shrink-0 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
            <div className={`w-5 h-5 rounded-lg ${item.bg} flex items-center justify-center ${item.color} flex-shrink-0`}>
              {item.icon}
            </div>
            <div>
              <p className="text-xs font-medium text-gray-700 whitespace-nowrap">{item.text}</p>
              <p className="text-[10px] text-gray-400">{item.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

type LeadStatus = "needs_attention" | "queued" | "follow_up_due" | "active" | "booked";
type SequenceTab = "recent" | "lapsed";
type PipelineStage = "new" | "contacted" | "engaged" | "quoted" | "booked";

interface SmsMessage {
  id: string;
  direction: "out" | "in";
  text: string;
  time: string;
  status?: "delivered" | "read" | "pending";
}

interface TimelineEvent {
  id: string;
  type: "sms_sent" | "reply" | "ai_analyzed" | "call" | "follow_up_queued" | "booked";
  label: string;
  detail: string;
  time: string;
}

interface Lead {
  id: string;
  initials: string;
  name: string;
  phone: string;
  daysLapsed: number;
  value: number;
  status: LeadStatus;
  score: number;
  segment: string;
  touchpoints: Array<{ day: number; type: "sms" | "reply" | "ai" | "call" }>;
  smsThread: SmsMessage[];
  timeline: TimelineEvent[];
  aiReasoning: {
    why: string;
    confidence: number;
    signals: string[];
    nextAction: string;
    nextActionIn: string;
    aiState: "acting" | "waiting" | "recycling";
    recycleIn?: string;
  };
  sparkline: number[];
}

interface PrioritySegment {
  id: string;
  label: string;
  description: string;
  count: number;
  color: string;
  icon: React.ReactNode;
  urgency: "high" | "medium" | "low";
  sparkline: number[];
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
    sparkline: [28, 32, 35, 31, 38, 42, 39],
  },
  {
    id: "reactivation_gold",
    label: "Reactivation Gold",
    description: "Repeat customers",
    count: 18,
    color: "amber",
    icon: <Star className="w-4 h-4" />,
    urgency: "medium",
    sparkline: [18, 22, 19, 25, 21, 28, 24],
  },
  {
    id: "long_lapsed",
    label: "Long Lapsed",
    description: "120+ days",
    count: 42,
    color: "violet",
    icon: <Clock className="w-4 h-4" />,
    urgency: "low",
    sparkline: [8, 10, 9, 12, 11, 14, 13],
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
    phone: "+1 (555) 201-4892",
    daysLapsed: 18,
    value: 220,
    status: "needs_attention",
    score: 82,
    segment: "High Intent",
    touchpoints: [
      { day: 8, type: "sms" }, { day: 8, type: "reply" },
      { day: 11, type: "ai" }, { day: 17, type: "call" },
      { day: 8, type: "sms" }, { day: 8, type: "sms" }, { day: 8, type: "ai" },
    ],
    sparkline: [60, 65, 70, 68, 75, 80, 82],
    smsThread: [
      { id: "1", direction: "out", text: "Hey Sarah! It's been a little while — we'd love to get your home sparkling again. Want to lock in a time this week?", time: "Mar 7, 10:02am", status: "read" },
      { id: "2", direction: "in", text: "Hey! Yes actually been meaning to reach out. What's availability look like next week?", time: "Mar 7, 10:18am" },
      { id: "3", direction: "out", text: "Great timing! We have Tuesday the 12th at 9am or Thursday the 14th at 1pm. Which works better for you?", time: "Mar 7, 10:20am", status: "read" },
      { id: "4", direction: "in", text: "Thursday works! Can we do 2pm instead?", time: "Mar 7, 11:05am" },
      { id: "5", direction: "out", text: "2pm Thursday is perfect. I'll get that locked in for you. You'll get a confirmation text the morning of 🏠", time: "Mar 7, 11:07am", status: "delivered" },
      { id: "6", direction: "out", text: "Hey Sarah — just a quick reminder your cleaning is tomorrow at 2pm. Let us know if anything changes!", time: "Mar 13, 9:00am", status: "read" },
    ],
    timeline: [
      { id: "t1", type: "sms_sent", label: "SMS sent", detail: "Initial reactivation message", time: "Mar 7, 10:02am" },
      { id: "t2", type: "reply", label: "Replied", detail: "Expressed interest in rebooking", time: "Mar 7, 10:18am" },
      { id: "t3", type: "ai_analyzed", label: "AI analyzed", detail: "High-intent signal detected, escalated to follow-up", time: "Mar 7, 10:19am" },
      { id: "t4", type: "sms_sent", label: "SMS sent", detail: "Availability offer sent", time: "Mar 7, 10:20am" },
      { id: "t5", type: "reply", label: "Replied", detail: "Confirmed Thursday 2pm", time: "Mar 7, 11:05am" },
      { id: "t6", type: "follow_up_queued", label: "Reminder queued", detail: "Day-before reminder scheduled", time: "Mar 7, 11:08am" },
      { id: "t7", type: "sms_sent", label: "Reminder sent", detail: "Day-before confirmation", time: "Mar 13, 9:00am" },
    ],
    aiReasoning: {
      why: "Sarah has booked 3× in the past 6 months with an average job value of $220. Her last booking was 18 days ago — within the high-intent reactivation window. She replied within 16 minutes on the last outreach, indicating strong engagement.",
      confidence: 87,
      signals: ["Replied in <20min on last outreach", "3 bookings in 6 months", "High avg job value ($220)", "No opt-out signals"],
      nextAction: "Send day-7 urgency message",
      nextActionIn: "2h 14m",
      aiState: "waiting",
      recycleIn: undefined,
    },
  },
  {
    id: "john",
    initials: "J",
    name: "John D",
    phone: "+1 (555) 384-7201",
    daysLapsed: 57,
    value: 180,
    status: "queued",
    score: 74,
    segment: "Reactivation Gold",
    touchpoints: [
      { day: 11, type: "sms" }, { day: 17, type: "reply" },
      { day: 8, type: "sms" }, { day: 8, type: "ai" },
    ],
    sparkline: [55, 58, 62, 60, 65, 70, 74],
    smsThread: [
      { id: "1", direction: "out", text: "Hi John! We haven't seen you in a while and wanted to check in. Ready to get your home looking great again?", time: "Mar 1, 11:00am", status: "read" },
      { id: "2", direction: "out", text: "Hey John — still thinking about it? We have a few spots open this week at a great rate for returning customers.", time: "Mar 5, 10:00am", status: "delivered" },
      { id: "3", direction: "in", text: "Yeah sorry been busy. Maybe next month?", time: "Mar 5, 2:14pm" },
      { id: "4", direction: "out", text: "Totally understand! I'll circle back in a few weeks. In the meantime, just reply 'book' anytime and we'll get you set up fast 👍", time: "Mar 5, 2:16pm", status: "read" },
    ],
    timeline: [
      { id: "t1", type: "sms_sent", label: "SMS sent", detail: "Initial reactivation — 57d lapsed", time: "Mar 1, 11:00am" },
      { id: "t2", type: "ai_analyzed", label: "AI analyzed", detail: "No reply — queued follow-up for day 4", time: "Mar 1, 11:01am" },
      { id: "t3", type: "sms_sent", label: "Follow-up sent", detail: "Returning customer offer", time: "Mar 5, 10:00am" },
      { id: "t4", type: "reply", label: "Replied", detail: "Soft defer — 'maybe next month'", time: "Mar 5, 2:14pm" },
      { id: "t5", type: "ai_analyzed", label: "AI analyzed", detail: "Defer signal — scheduled recycle in 14 days", time: "Mar 5, 2:15pm" },
      { id: "t6", type: "follow_up_queued", label: "Recycle queued", detail: "Next touch: Mar 19", time: "Mar 5, 2:16pm" },
    ],
    aiReasoning: {
      why: "John has booked twice in the past year. He soft-deferred ('maybe next month') which is a positive signal — not an opt-out. The AI classified this as a 14-day recycle candidate with a value-led message.",
      confidence: 68,
      signals: ["Soft defer (not opt-out)", "2 historical bookings", "Opened last 2 messages", "57d lapse — longer window"],
      nextAction: "Send recycle value message",
      nextActionIn: "14 days",
      aiState: "recycling",
      recycleIn: "14 days",
    },
  },
  {
    id: "priya",
    initials: "P",
    name: "Priya R",
    phone: "+1 (555) 492-0183",
    daysLapsed: 11,
    value: 260,
    status: "follow_up_due",
    score: 88,
    segment: "High Intent",
    touchpoints: [
      { day: 9, type: "sms" }, { day: 13, type: "reply" },
      { day: 8, type: "sms" }, { day: 8, type: "ai" },
    ],
    sparkline: [70, 74, 72, 78, 82, 85, 88],
    smsThread: [
      { id: "1", direction: "out", text: "Hey Priya! Hope you're well — it's been about 11 days since your last clean. Want to get back on the schedule?", time: "Mar 14, 9:30am", status: "read" },
      { id: "2", direction: "in", text: "Hi! Yes I've been meaning to. Can you send me pricing for a deep clean?", time: "Mar 14, 12:45pm" },
      { id: "3", direction: "out", text: "Of course! For your home size a deep clean is $260. It includes everything — baseboards, inside appliances, the works. Want me to get you booked?", time: "Mar 14, 12:47pm", status: "read" },
    ],
    timeline: [
      { id: "t1", type: "sms_sent", label: "SMS sent", detail: "High-intent reactivation", time: "Mar 14, 9:30am" },
      { id: "t2", type: "reply", label: "Replied", detail: "Requested pricing — strong buying signal", time: "Mar 14, 12:45pm" },
      { id: "t3", type: "ai_analyzed", label: "AI analyzed", detail: "Pricing request = high close probability. Escalated.", time: "Mar 14, 12:46pm" },
      { id: "t4", type: "sms_sent", label: "Quote sent", detail: "Deep clean quote $260", time: "Mar 14, 12:47pm" },
      { id: "t5", type: "follow_up_queued", label: "Follow-up queued", detail: "No reply in 24h — follow-up due now", time: "Mar 15, 12:47pm" },
    ],
    aiReasoning: {
      why: "Priya requested pricing — the strongest buying signal in the dataset. She hasn't replied to the quote in 24h. The AI is holding for a follow-up nudge before escalating to a call.",
      confidence: 91,
      signals: ["Requested pricing (top signal)", "Highest value lead ($260)", "11d lapse — fresh window", "Read receipt confirmed"],
      nextAction: "Send quote follow-up nudge",
      nextActionIn: "Now",
      aiState: "acting",
      recycleIn: undefined,
    },
  },
  {
    id: "marcus",
    initials: "M",
    name: "Marcus T",
    phone: "+1 (555) 610-9274",
    daysLapsed: 34,
    value: 195,
    status: "active",
    score: 71,
    segment: "Reactivation Gold",
    touchpoints: [
      { day: 9, type: "sms" }, { day: 12, type: "reply" },
      { day: 8, type: "sms" },
    ],
    sparkline: [50, 54, 58, 55, 62, 68, 71],
    smsThread: [
      { id: "1", direction: "out", text: "Hey Marcus! It's been about a month — we'd love to get your place looking fresh again. Any interest?", time: "Mar 10, 10:15am", status: "read" },
      { id: "2", direction: "in", text: "Sure, what's your soonest availability?", time: "Mar 10, 3:22pm" },
      { id: "3", direction: "out", text: "We have this Friday the 14th at 10am or Monday the 17th at 2pm. Which works?", time: "Mar 10, 3:24pm", status: "delivered" },
    ],
    timeline: [
      { id: "t1", type: "sms_sent", label: "SMS sent", detail: "34d lapse reactivation", time: "Mar 10, 10:15am" },
      { id: "t2", type: "reply", label: "Replied", detail: "Asked for availability", time: "Mar 10, 3:22pm" },
      { id: "t3", type: "ai_analyzed", label: "AI analyzed", detail: "Positive reply — sent availability options", time: "Mar 10, 3:23pm" },
      { id: "t4", type: "sms_sent", label: "Options sent", detail: "Two time slots offered", time: "Mar 10, 3:24pm" },
    ],
    aiReasoning: {
      why: "Marcus replied asking for availability — a clear booking intent signal. He hasn't confirmed a slot yet. The AI is waiting for a reply before sending a gentle nudge.",
      confidence: 74,
      signals: ["Asked for availability", "Replied same day", "34d lapse — mid-window", "2 prior bookings"],
      nextAction: "Send slot confirmation nudge",
      nextActionIn: "6h",
      aiState: "waiting",
      recycleIn: undefined,
    },
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

// ── Score Ring ────────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 12;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 80 ? "#10b981" : score >= 70 ? "#f59e0b" : "#6b7280";
  return (
    <div className="relative w-9 h-9 flex items-center justify-center flex-shrink-0">
      <svg width="36" height="36" className="-rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="#f1f5f9" strokeWidth="2.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-[10px] font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, sub, trend }: {
  label: string; value: string; icon: React.ReactNode; sub?: string; trend?: "up" | "neutral";
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
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${className}`}>{label}</span>;
}

function TouchpointDot({ type }: { type: "sms" | "reply" | "ai" | "call" }) {
  const colors: Record<string, string> = { sms: "bg-blue-400", reply: "bg-emerald-400", ai: "bg-violet-400", call: "bg-amber-400" };
  return <span className={`w-2 h-2 rounded-full inline-block ${colors[type]}`} />;
}

// ── Lead Depth Drawer ─────────────────────────────────────────────────────────

function LeadDepthDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [tab, setTab] = useState<"thread" | "timeline" | "reasoning">("thread");
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === "thread") {
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [tab, lead.id]);

  const timelineIcons: Record<TimelineEvent["type"], { icon: React.ReactNode; color: string; bg: string }> = {
    sms_sent: { icon: <Send className="w-3 h-3" />, color: "text-blue-600", bg: "bg-blue-50" },
    reply: { icon: <MessageCircle className="w-3 h-3" />, color: "text-emerald-600", bg: "bg-emerald-50" },
    ai_analyzed: { icon: <Cpu className="w-3 h-3" />, color: "text-violet-600", bg: "bg-violet-50" },
    call: { icon: <Phone className="w-3 h-3" />, color: "text-amber-600", bg: "bg-amber-50" },
    follow_up_queued: { icon: <Timer className="w-3 h-3" />, color: "text-gray-500", bg: "bg-gray-100" },
    booked: { icon: <CheckCircle2 className="w-3 h-3" />, color: "text-blue-600", bg: "bg-blue-50" },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />

      {/* Drawer */}
      <div
        className="relative w-[480px] bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
        style={{ animation: "slideInRight 0.28s cubic-bezier(0.22,1,0.36,1)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
            {lead.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-900">{lead.name}</p>
              <StatusBadge status={lead.status} />
            </div>
            <p className="text-xs text-gray-400">{lead.phone} · {lead.daysLapsed}d lapsed · ${lead.value} avg</p>
          </div>
          <ScoreRing score={lead.score} />
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors ml-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-5">
          {(["thread", "timeline", "reasoning"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-3 px-1 mr-5 text-xs font-semibold border-b-2 transition-all ${
                tab === t ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              {t === "thread" ? "SMS Thread" : t === "timeline" ? "Touch Timeline" : "AI Reasoning"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* SMS Thread */}
          {tab === "thread" && (
            <div className="p-5 space-y-3">
              {lead.smsThread.map(msg => (
                <div key={msg.id} className={`flex ${msg.direction === "out" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    msg.direction === "out"
                      ? "bg-gray-900 text-white rounded-br-sm"
                      : "bg-emerald-50 text-gray-800 border border-emerald-100 rounded-bl-sm"
                  }`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <div className={`flex items-center gap-1 mt-1 ${msg.direction === "out" ? "justify-end" : "justify-start"}`}>
                      <p className={`text-[10px] ${msg.direction === "out" ? "text-gray-400" : "text-gray-400"}`}>{msg.time}</p>
                      {msg.direction === "out" && msg.status && (
                        <span className={`text-[10px] ${msg.status === "read" ? "text-blue-400" : "text-gray-500"}`}>
                          {msg.status === "read" ? "Read" : msg.status === "delivered" ? "Delivered" : "Pending"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={threadEndRef} />

              {/* Reply input */}
              <div className="sticky bottom-0 pt-3 bg-white border-t border-gray-100 mt-4">
                <div className="flex gap-2">
                  <input
                    className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-200 placeholder:text-gray-300"
                    placeholder="Type a message..."
                  />
                  <Button size="sm" className="bg-gray-900 hover:bg-gray-700 text-white rounded-xl h-auto px-3.5">
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Timeline */}
          {tab === "timeline" && (
            <div className="p-5">
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[18px] top-0 bottom-0 w-px bg-gray-100" />
                <div className="space-y-4">
                  {lead.timeline.map((event, i) => {
                    const { icon, color, bg } = timelineIcons[event.type];
                    return (
                      <div key={event.id} className="flex gap-3 relative">
                        <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center ${color} flex-shrink-0 z-10 border-2 border-white`}>
                          {icon}
                        </div>
                        <div className="flex-1 pt-1.5 pb-4 border-b border-gray-50 last:border-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-gray-900">{event.label}</p>
                              <p className="text-xs text-gray-400 mt-0.5">{event.detail}</p>
                            </div>
                            <p className="text-[10px] text-gray-300 whitespace-nowrap flex-shrink-0">{event.time}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* AI Reasoning */}
          {tab === "reasoning" && (
            <div className="p-5 space-y-4">
              {/* Confidence */}
              <div className="bg-violet-50 rounded-2xl p-4 border border-violet-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-violet-500" />
                    <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">AI Confidence</p>
                  </div>
                  <span className="text-2xl font-bold text-violet-600">{lead.aiReasoning.confidence}%</span>
                </div>
                <div className="h-2 bg-violet-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${lead.aiReasoning.confidence}%` }} />
                </div>
              </div>

              {/* Why */}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Why this lead</p>
                <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-xl p-3 border border-gray-100">
                  {lead.aiReasoning.why}
                </p>
              </div>

              {/* Signals */}
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Signals detected</p>
                <div className="space-y-2">
                  {lead.aiReasoning.signals.map((sig, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <p className="text-sm text-gray-700">{sig}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next action */}
              <div className="bg-gray-900 rounded-2xl p-4 text-white">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Next AI action</p>
                <p className="font-bold text-white text-sm">{lead.aiReasoning.nextAction}</p>
                <p className="text-xs text-gray-400 mt-1">Scheduled in {lead.aiReasoning.nextActionIn}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ── AI State Panel (replaces AIRecommendationPanel) ───────────────────────────

function AIStatePanel({ lead }: { lead: Lead }) {
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState(
    `Hey ${lead.name.split(" ")[0]} — we can set you up on a simple recurring plan with priority scheduling so you never have to think about it again. Want me to show options?`
  );
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setMsg(`Hey ${lead.name.split(" ")[0]} — we can set you up on a simple recurring plan with priority scheduling so you never have to think about it again. Want me to show options?`);
    setSent(false);
    setEditing(false);
  }, [lead.id]);

  const handleSend = () => { setSent(true); setTimeout(() => setSent(false), 2000); };

  const stateConfig = {
    acting: { dot: "bg-emerald-400 animate-pulse", label: "AI is acting", labelColor: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
    waiting: { dot: "bg-amber-400 animate-pulse", label: "Waiting on reply", labelColor: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
    recycling: { dot: "bg-violet-400", label: "Recycling lead", labelColor: "text-violet-600", bg: "bg-violet-50", border: "border-violet-100" },
  };
  const state = stateConfig[lead.aiReasoning.aiState];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      {/* AI State Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0">
            <Bot className="w-3.5 h-3.5 text-violet-500" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${state.dot}`} />
              <p className={`text-xs font-bold ${state.labelColor}`}>{state.label}</p>
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{lead.name.split(" ")[0]}'s thread</p>
          </div>
        </div>
        <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-500">
          {lead.segment}
        </span>
      </div>

      {/* AI State Chips */}
      <div className="grid grid-cols-1 gap-2 mb-4">
        {lead.aiReasoning.aiState === "acting" && (
          <div className={`flex items-center gap-2 ${state.bg} border ${state.border} rounded-xl px-3 py-2`}>
            <Zap className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-emerald-700">Next action in {lead.aiReasoning.nextActionIn}</p>
              <p className="text-[10px] text-emerald-600">{lead.aiReasoning.nextAction}</p>
            </div>
          </div>
        )}
        {lead.aiReasoning.aiState === "waiting" && (
          <>
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              <Timer className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-700">Waiting on reply</p>
                <p className="text-[10px] text-amber-600">Next nudge in {lead.aiReasoning.nextActionIn}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
              <RotateCcw className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <p className="text-xs text-gray-500">Recycle if no reply in 7 days</p>
            </div>
          </>
        )}
        {lead.aiReasoning.aiState === "recycling" && (
          <div className="flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
            <RotateCcw className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-violet-700">Recycling in {lead.aiReasoning.recycleIn}</p>
              <p className="text-[10px] text-violet-600">Soft defer detected — value message queued</p>
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-gray-50 mb-4" />

      {/* Message preview */}
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Next message</p>
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
        <Button size="sm" className="flex-1 bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold h-9 rounded-xl shadow-sm" onClick={handleSend}>
          {sent ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
          {sent ? "Sent!" : "Send now"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-xs font-semibold h-9 rounded-xl border-gray-200" onClick={() => setEditing(!editing)}>
          <Edit3 className="w-3.5 h-3.5 mr-1.5" />
          Edit
        </Button>
        <Button size="sm" variant="outline" className="flex-1 text-xs font-semibold h-9 rounded-xl border-gray-200">
          <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
          Strategy
        </Button>
      </div>

      {/* AI reasoning footnote */}
      <div className="mt-3 pt-3 border-t border-gray-50">
        <p className="text-[10px] text-gray-400 leading-relaxed">
          <span className="font-semibold text-violet-400">Why this message:</span> {lead.aiReasoning.why.split(".")[0]}.
        </p>
      </div>
    </div>
  );
}

function DeliverabilityPanel() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 text-base">Deliverability</h3>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">Healthy</span>
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
              {item.ok ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <AlertTriangle className="w-3 h-3 text-amber-500" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrioritySegmentRow({ seg, onMessage }: { seg: PrioritySegment; onMessage: () => void }) {
  const urgencyDot: Record<string, string> = { high: "bg-emerald-400", medium: "bg-amber-400", low: "bg-violet-400" };
  const sparkData = seg.sparkline.map((v, i) => ({ v, i }));

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
        {/* 7-day reply rate sparkline */}
        <div className="w-16 h-8 opacity-60 group-hover:opacity-100 transition-opacity">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <Line type="monotone" dataKey="v" stroke={seg.urgency === "high" ? "#10b981" : seg.urgency === "medium" ? "#f59e0b" : "#8b5cf6"}
                strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <span className="text-sm font-bold text-gray-700 w-6 text-right">{seg.count}</span>
        <Button size="sm" className="bg-gray-900 hover:bg-gray-700 text-white text-xs px-3 py-1.5 h-auto rounded-lg font-medium shadow-sm" onClick={onMessage}>
          Message
        </Button>
      </div>
    </div>
  );
}

function LeadCard({ lead, selected, onClick }: { lead: Lead; selected: boolean; onClick: () => void }) {
  const days = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const byDay = days.map(d => lead.touchpoints.filter(t => t.day === d));
  const bottomDots = lead.touchpoints.slice(0, 4);

  return (
    <div
      onClick={onClick}
      className={`border-b border-gray-50 last:border-0 py-3 px-2 rounded-xl transition-all cursor-pointer group ${
        selected ? "bg-violet-50/60 border-l-2 border-l-violet-300 -ml-0.5" : "hover:bg-gray-50/60"
      }`}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
          {lead.initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{lead.name}</span>
            <span className="text-xs text-gray-400">{lead.daysLapsed}d · ${lead.value}</span>
            <StatusBadge status={lead.status} />
          </div>
        </div>
        <ScoreRing score={lead.score} />
      </div>
      <div className="ml-11">
        <div className="flex items-end gap-[6px]">
          {days.map((d, i) => (
            <div key={i} className="flex flex-col items-center gap-[2px]" style={{ width: 14 }}>
              <span className="text-[9px] text-gray-300">{d}</span>
              {byDay[i].length > 0 ? (
                <div className="flex flex-col gap-[2px]">
                  {byDay[i].map((t, j) => <TouchpointDot key={j} type={t.type} />)}
                </div>
              ) : <span className="w-2 h-2" />}
            </div>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          {bottomDots.map((t, i) => <TouchpointDot key={i} type={t.type} />)}
        </div>
      </div>
    </div>
  );
}

// ── Run Today Modal ──────────────────────────────────────────────────────────

const RUN_SEGMENTS = [
  {
    id: "high_intent",
    label: "High Intent",
    description: "Recent, high spend customers",
    count: 12,
    avgValue: 220,
    replyRate: 42,
    urgency: "high" as const,
    color: "emerald",
    icon: <Flame className="w-4 h-4" />,
    projectedBookings: 5,
    projectedRevenue: 1100,
  },
  {
    id: "reactivation_gold",
    label: "Reactivation Gold",
    description: "Repeat customers, 30–90 days lapsed",
    count: 18,
    avgValue: 180,
    replyRate: 35,
    urgency: "medium" as const,
    color: "amber",
    icon: <Star className="w-4 h-4" />,
    projectedBookings: 6,
    projectedRevenue: 1080,
  },
  {
    id: "long_lapsed",
    label: "Long Lapsed",
    description: "120+ days, win-back sequence",
    count: 42,
    avgValue: 140,
    replyRate: 18,
    urgency: "low" as const,
    color: "violet",
    icon: <Clock className="w-4 h-4" />,
    projectedBookings: 8,
    projectedRevenue: 1120,
  },
];

function RunTodayModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["high_intent", "reactivation_gold", "long_lapsed"]));
  const [confirming, setConfirming] = useState(false);

  const toggleSeg = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const activeSegs = RUN_SEGMENTS.filter(s => selected.has(s.id));
  const totalLeads = activeSegs.reduce((s, seg) => s + seg.count, 0);
  const totalProjectedRevenue = activeSegs.reduce((s, seg) => s + seg.projectedRevenue, 0);
  const totalProjectedBookings = activeSegs.reduce((s, seg) => s + seg.projectedBookings, 0);
  const avgReplyRate = activeSegs.length > 0
    ? Math.round(activeSegs.reduce((s, seg) => s + seg.replyRate, 0) / activeSegs.length)
    : 0;

  const urgencyBg: Record<string, string> = {
    high: "bg-emerald-50 border-emerald-200",
    medium: "bg-amber-50 border-amber-200",
    low: "bg-violet-50 border-violet-200",
  };
  const urgencyText: Record<string, string> = {
    high: "text-emerald-600",
    medium: "text-amber-600",
    low: "text-violet-600",
  };
  const urgencyDot: Record<string, string> = {
    high: "bg-emerald-400",
    medium: "bg-amber-400",
    low: "bg-violet-400",
  };

  const handleConfirm = () => {
    setConfirming(true);
    setTimeout(() => { onConfirm(); }, 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[3px]" />

      {/* Modal */}
      <div
        className="relative w-[560px] bg-white rounded-3xl shadow-2xl overflow-hidden"
        style={{ animation: "fadeScaleIn 0.22s cubic-bezier(0.22,1,0.36,1)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-xl bg-gray-900 flex items-center justify-center">
                  <Play className="w-3.5 h-3.5 text-white" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Run Today</h2>
              </div>
              <p className="text-sm text-gray-400">Review which segments will fire and confirm your send</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Segments */}
        <div className="px-6 py-4 space-y-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Select segments to include</p>
          {RUN_SEGMENTS.map(seg => {
            const active = selected.has(seg.id);
            return (
              <div
                key={seg.id}
                onClick={() => toggleSeg(seg.id)}
                className={`flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                  active ? urgencyBg[seg.urgency] : "bg-gray-50 border-gray-100 opacity-60"
                }`}
              >
                {/* Checkbox */}
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                  active ? "bg-gray-900 border-gray-900" : "border-gray-300 bg-white"
                }`}>
                  {active && <CheckCircle2 className="w-3 h-3 text-white" />}
                </div>

                {/* Urgency dot + label */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full ${urgencyDot[seg.urgency]}`} />
                  <div className={urgencyText[seg.urgency]}>{seg.icon}</div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{seg.label}</p>
                  <p className="text-xs text-gray-400">{seg.description}</p>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 flex-shrink-0 text-right">
                  <div>
                    <p className="text-sm font-bold text-gray-900">{seg.count}</p>
                    <p className="text-[10px] text-gray-400">leads</p>
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${urgencyText[seg.urgency]}`}>{seg.replyRate}%</p>
                    <p className="text-[10px] text-gray-400">reply rate</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-emerald-600">${seg.projectedRevenue.toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400">projected</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Projection Summary */}
        <div className="mx-6 mb-4 bg-gray-900 rounded-2xl p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Today's projection</p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Leads", value: String(totalLeads), color: "text-white" },
              { label: "Est. replies", value: `~${Math.round(totalLeads * avgReplyRate / 100)}`, color: "text-blue-300" },
              { label: "Est. bookings", value: `~${totalProjectedBookings}`, color: "text-violet-300" },
              { label: "Est. revenue", value: `$${totalProjectedRevenue.toLocaleString()}`, color: "text-emerald-400" },
            ].map(kpi => (
              <div key={kpi.label} className="text-center">
                <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{kpi.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
            <p className="text-[10px] text-gray-500">Messages will be paced throughout the day to protect deliverability. Daily cap: 50.</p>
          </div>
        </div>

        {/* AI Timing Tip */}
        <div className="mx-6 mb-5 flex items-start gap-2.5 bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
          <Bot className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-violet-700 leading-relaxed">
            <span className="font-semibold">AI timing tip:</span> High Intent segment converts 3× better before 11am. Consider scheduling for tomorrow morning if it's past 10am.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex gap-3">
          <Button
            variant="outline"
            className="flex-1 h-11 rounded-xl border-gray-200 text-sm font-semibold"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 h-11 rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-sm font-semibold shadow-md disabled:opacity-50"
            disabled={selected.size === 0 || confirming}
            onClick={handleConfirm}
          >
            {confirming ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Launching...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> Confirm & Run {totalLeads} leads</>
            )}
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes fadeScaleIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ReactivationEngine() {
  const [sequenceTab, setSequenceTab] = useState<SequenceTab>("recent");
  const [selectedLead, setSelectedLead] = useState<Lead>(LEADS[0]);
  const [leadSearch, setLeadSearch] = useState("");
  const [runningToday, setRunningToday] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);

  const filteredLeads = LEADS.filter(l => l.name.toLowerCase().includes(leadSearch.toLowerCase()));
  const sequenceSteps = sequenceTab === "recent" ? SEQUENCE_STEPS_RECENT : SEQUENCE_STEPS_LAPSED;

  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  };

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
              runningToday ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-gray-900 hover:bg-gray-700 text-white"
            }`}
            onClick={() => runningToday ? null : setShowRunModal(true)}
          >
            {runningToday ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Running</> : <><Play className="w-4 h-4 mr-2" /> Run Today</>}
          </Button>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Messages" value="48 / 50" icon={<Clock className="w-4 h-4" />} sub="2 remaining today" />
          <StatCard label="Replies" value="39%" icon={<TrendingUp className="w-4 h-4" />} sub="+4% vs last week" trend="up" />
          <StatCard label="Revenue" value="$1,420" icon={<DollarSign className="w-4 h-4" />} sub="This campaign cycle" />
          <StatCard label="Deliverability" value="97" icon={<ShieldCheck className="w-4 h-4" />} sub="Score out of 100" />
        </div>

        {/* ── Performance Chart ── */}
        <RevenueChart />

        {/* ── AI Activity Feed ── */}
        <AIActivityFeed />

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
                  <PrioritySegmentRow key={seg.id} seg={seg} onMessage={() => {}} />
                ))}
              </div>
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
                  const colors = ["bg-gray-100 text-gray-600", "bg-blue-50 text-blue-600", "bg-violet-50 text-violet-600", "bg-amber-50 text-amber-600", "bg-emerald-50 text-emerald-600"];
                  const barColors = ["bg-gray-300", "bg-blue-300", "bg-violet-400", "bg-amber-400", "bg-emerald-500"];
                  return (
                    <div key={stage.id} className="flex flex-col items-center gap-2">
                      <div className={`w-full rounded-xl px-3 py-2.5 text-center ${colors[i]} cursor-pointer hover:opacity-80 transition-opacity`}>
                        <p className="text-xs font-semibold">{stage.label}</p>
                        <p className="text-xl font-bold mt-0.5">{stage.count}</p>
                      </div>
                      <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${barColors[i]} rounded-full`} style={{ width: `${widths[i]}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
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
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit mb-4">
                {(["recent", "lapsed"] as SequenceTab[]).map(tab => (
                  <button key={tab} onClick={() => setSequenceTab(tab)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      sequenceTab === tab ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-3">
                {sequenceSteps.map((step, i) => (
                  <div key={i} className="relative border border-gray-100 rounded-xl p-3 hover:border-gray-200 hover:shadow-sm transition-all cursor-pointer group">
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
                <span className="ml-auto text-[10px] text-gray-300">Click to expand</span>
              </div>
              <div className="px-3 py-1 max-h-[480px] overflow-y-auto">
                {filteredLeads.map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    selected={selectedLead.id === lead.id}
                    onClick={() => handleLeadClick(lead)}
                  />
                ))}
              </div>
            </div>

            {/* AI State Panel */}
            <AIStatePanel lead={selectedLead} />

            {/* Deliverability */}
            <DeliverabilityPanel />

          </div>
        </div>
      </div>

      {/* Lead Depth Drawer */}
      {drawerOpen && (
        <LeadDepthDrawer lead={selectedLead} onClose={() => setDrawerOpen(false)} />
      )}

      {/* Run Today Modal */}
      {showRunModal && (
        <RunTodayModal
          onClose={() => setShowRunModal(false)}
          onConfirm={() => { setRunningToday(true); setShowRunModal(false); }}
        />
      )}
    </div>
  );
}
