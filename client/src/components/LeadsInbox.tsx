/**
 * LeadsInbox — Revenue Workspace / Lead Journey
 * Purpose-built CS-style inbox for lead conversion.
 * Layout: dark rail + lead list (lanes/filters) + conversation thread + right panel
 *
 * UI-only for now — wired to static mock data until backend procedures are ready.
 */
import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Phone,
  RefreshCw,
  Pencil,
  CheckCircle2,
  Send,
  Flame,
  Calendar,
  DollarSign,
  RotateCcw,
  Zap,
  Clock,
  Star,
  TrendingUp,
  MessageSquare,
  ChevronRight,
  ChevronLeft,
  Users,
  Target,
  Sparkles,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Lane = "needs-me" | "ready-to-book" | "needs-price" | "reactivation";
type LeadFilter = "all" | "unread" | "campaign-reply" | "quote-viewed";

type LeadTag = {
  label: string;
  color: "purple" | "orange" | "blue" | "green" | "gray" | "rose";
};

type LeadMessage = {
  id: number;
  sender: "customer" | "agent" | "campaign" | "attention";
  senderName?: string;
  text: string;
  time: string;
  campaignName?: string;
  tags?: string[];
};

type Lead = {
  id: number;
  name: string;
  initials: string;
  lastMessage: string;
  time: string;
  lane: Lane;
  tags: LeadTag[];
  unread?: boolean;
  quote: string;
  service: string;
  frequency: string;
  daysSinceBooking: number;
  campaign: string;
  campaignType: string;
  campaignReplyTime: string;
  momentum: number;
  lifetimeValue: string;
  jobCount: number;
  preferredTeam: string;
  bookLikelihood: number;
  messages: LeadMessage[];
  nextBestAction: {
    title: string;
    description: string;
    suggestedReplies: string[];
  };
};

// ── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_LEADS: Lead[] = [
  {
    id: 1,
    name: "Jennifer Thompson",
    initials: "JT",
    lastMessage: "What times are open?",
    time: "now",
    lane: "needs-me",
    unread: true,
    tags: [
      { label: "Campaign reply", color: "purple" },
      { label: "Needs price", color: "orange" },
    ],
    quote: "$159",
    service: "Standard Clean",
    frequency: "One-time",
    daysSinceBooking: 218,
    campaign: "Tomorrow Slots",
    campaignType: "Reactivation campaign",
    campaignReplyTime: "42 minutes",
    momentum: 76,
    lifetimeValue: "$2,840",
    jobCount: 12,
    preferredTeam: "MaidsPlus",
    bookLikelihood: 76,
    nextBestAction: {
      title: "Provide specific price + two time options",
      description:
        "The lead has asked about price and availability. Remove uncertainty and create a clear booking decision.",
      suggestedReplies: [
        "Hi Jennifer! We have openings tomorrow at 9:00 AM or 1:00 PM. The price would be $159 with your discount. Which works better?",
        "I can hold tomorrow at 1:00 PM while we confirm.",
        "We recently helped another customer with a similar home and they loved the result.",
      ],
    },
    messages: [
      {
        id: 1,
        sender: "campaign",
        text: "Hi Jennifer, we have a few openings tomorrow and wanted to offer you first choice...",
        time: "2:41 PM",
        campaignName: "Tomorrow Slots",
        tags: ["Delivered", "Replied"],
      },
      {
        id: 2,
        sender: "customer",
        text: "How much is discount?",
        time: "3:23 PM",
      },
      {
        id: 3,
        sender: "agent",
        senderName: "Rizalina",
        text: "We're currently offering 20% off and have availability as soon as tomorrow.",
        time: "3:24 PM",
      },
      {
        id: 4,
        sender: "customer",
        text: "How much would it be for a 2 bedroom and 3 bathroom clean?",
        time: "4:27 PM",
      },
      {
        id: 5,
        sender: "agent",
        senderName: "Rohan",
        text: "We could do it tomorrow for $159.",
        time: "4:38 PM",
      },
      {
        id: 6,
        sender: "attention",
        text: "Customer asked for open times — Strong booking signal. Reply with two specific options.",
        time: "Now",
      },
    ],
  },
  {
    id: 2,
    name: "Dorothy Miles",
    initials: "DM",
    lastMessage: "Interested — asking about tomorrow",
    time: "4m",
    lane: "reactivation",
    tags: [
      { label: "Reactivation", color: "blue" },
      { label: "Waiting", color: "gray" },
    ],
    quote: "$214",
    service: "Deep Clean",
    frequency: "Monthly",
    daysSinceBooking: 145,
    campaign: "Spring Reactivation",
    campaignType: "Reactivation campaign",
    campaignReplyTime: "1 hour",
    momentum: 58,
    lifetimeValue: "$1,920",
    jobCount: 8,
    preferredTeam: "Team A",
    bookLikelihood: 58,
    nextBestAction: {
      title: "Send availability for tomorrow",
      description: "Lead is warm and asking about tomorrow. Send two specific time slots.",
      suggestedReplies: [
        "Hi Dorothy! We have tomorrow at 10 AM or 2 PM available. Which works for you?",
        "Happy to hold a slot for you — just let me know which time works best.",
      ],
    },
    messages: [
      {
        id: 1,
        sender: "campaign",
        text: "Hi Dorothy, spring is here — time for a fresh start! We have a special offer just for you...",
        time: "11:00 AM",
        campaignName: "Spring Reactivation",
        tags: ["Delivered", "Replied"],
      },
      {
        id: 2,
        sender: "customer",
        text: "Interested — do you have anything tomorrow?",
        time: "11:58 AM",
      },
    ],
  },
  {
    id: 3,
    name: "Marcus Lee",
    initials: "ML",
    lastMessage: "Can you do Saturday morning?",
    time: "11m",
    lane: "ready-to-book",
    tags: [
      { label: "Quote viewed", color: "green" },
      { label: "Hot", color: "orange" },
    ],
    quote: "$329",
    service: "Move-out Clean",
    frequency: "One-time",
    daysSinceBooking: 0,
    campaign: "Direct Lead",
    campaignType: "Direct inquiry",
    campaignReplyTime: "N/A",
    momentum: 84,
    lifetimeValue: "$329",
    jobCount: 1,
    preferredTeam: "Unassigned",
    bookLikelihood: 84,
    nextBestAction: {
      title: "Confirm Saturday availability and lock the booking",
      description: "Lead has viewed the quote twice and is asking about Saturday. High intent — confirm and close.",
      suggestedReplies: [
        "Yes! We have Saturday morning at 9 AM available. Want me to lock that in for you?",
        "Saturday works great — shall I send you a confirmation link?",
      ],
    },
    messages: [
      {
        id: 1,
        sender: "customer",
        text: "Hi, I need a move-out clean for my 3BR apartment.",
        time: "10:05 AM",
      },
      {
        id: 2,
        sender: "agent",
        senderName: "Rizalina",
        text: "Hi Marcus! We can do that for $329. I'll send you a quote link.",
        time: "10:07 AM",
      },
      {
        id: 3,
        sender: "customer",
        text: "Can you do Saturday morning?",
        time: "10:18 AM",
      },
    ],
  },
  {
    id: 4,
    name: "Sandra Pedro",
    initials: "SP",
    lastMessage: "I may need cleaning again.",
    time: "32m",
    lane: "reactivation",
    tags: [
      { label: "Winback", color: "purple" },
      { label: "VIP", color: "green" },
    ],
    quote: "$280",
    service: "Standard Clean",
    frequency: "Bi-weekly",
    daysSinceBooking: 218,
    campaign: "VIP Winback",
    campaignType: "VIP winback campaign",
    campaignReplyTime: "18 minutes",
    momentum: 72,
    lifetimeValue: "$5,600",
    jobCount: 24,
    preferredTeam: "MaidsPlus",
    bookLikelihood: 72,
    nextBestAction: {
      title: "Welcome back + offer preferred team",
      description: "VIP customer with 24 jobs. Offer their preferred team and a loyalty discount.",
      suggestedReplies: [
        "Sandra! So great to hear from you. MaidsPlus is available this week — want me to get you back on the schedule?",
        "Welcome back! As a VIP customer, I'd love to offer you a loyalty discount on your first cleaning back.",
      ],
    },
    messages: [
      {
        id: 1,
        sender: "campaign",
        text: "Hi Sandra, we miss you! It's been a while and we'd love to welcome you back...",
        time: "1:15 PM",
        campaignName: "VIP Winback",
        tags: ["Delivered", "Replied"],
      },
      {
        id: 2,
        sender: "customer",
        text: "I may need cleaning again.",
        time: "1:33 PM",
      },
    ],
  },
];

const LANES: { id: Lane; label: string; emoji: string; count: number }[] = [
  { id: "needs-me", label: "Needs Me", emoji: "🔥", count: 12 },
  { id: "ready-to-book", label: "Ready to Book", emoji: "📅", count: 9 },
  { id: "needs-price", label: "Needs Price", emoji: "💸", count: 6 },
  { id: "reactivation", label: "Reactivation", emoji: "🔁", count: 81 },
];

const FILTERS: { id: LeadFilter; label: string; count?: number }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread", count: 9 },
  { id: "campaign-reply", label: "Campaign reply" },
  { id: "quote-viewed", label: "Quote viewed" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAG_STYLES: Record<LeadTag["color"], string> = {
  purple: "bg-violet-50 text-violet-700 border-violet-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  gray: "bg-slate-100 text-slate-600 border-slate-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};

function MomentumBar({ value }: { value: number }) {
  const color =
    value >= 80
      ? "from-emerald-500 to-emerald-400"
      : value >= 60
      ? "from-violet-500 to-orange-400"
      : "from-slate-400 to-slate-300";
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
      <div
        className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-500`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface LeadsInboxProps {
  rail?: React.ReactNode;
}

export default function LeadsInbox({ rail }: LeadsInboxProps) {
  const [activeLane, setActiveLane] = useState<Lane>("needs-me");
  const [activeFilter, setActiveFilter] = useState<LeadFilter>("all");
  const [selectedLead, setSelectedLead] = useState<Lead>(MOCK_LEADS[0]);
  const [composerText, setComposerText] = useState(
    MOCK_LEADS[0].nextBestAction.suggestedReplies[0]
  );
  const [messages, setMessages] = useState<LeadMessage[]>(MOCK_LEADS[0].messages);
  const journeyRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (journeyRef.current) {
      journeyRef.current.scrollTop = journeyRef.current.scrollHeight;
    }
  }, [messages]);

  const filteredLeads = MOCK_LEADS.filter((l) => {
    if (activeFilter === "unread") return l.unread;
    if (activeFilter === "campaign-reply")
      return l.tags.some((t) => t.label.toLowerCase().includes("campaign"));
    if (activeFilter === "quote-viewed")
      return l.tags.some((t) => t.label.toLowerCase().includes("quote"));
    return true;
  });

  function handlePickLead(lead: Lead) {
    setSelectedLead(lead);
    setMessages(lead.messages);
    setComposerText(lead.nextBestAction.suggestedReplies[0]);
  }

  function handleSend() {
    if (!composerText.trim()) return;
    const newMsg: LeadMessage = {
      id: Date.now(),
      sender: "agent",
      senderName: "You",
      text: composerText,
      time: "now",
    };
    setMessages((prev) => [...prev, newMsg]);
    setComposerText("");
  }

  return (
    <div
      className="h-full overflow-hidden flex leads-inbox-scope"
      style={{
        color: "#101828",
        background: "transparent",
        padding: "20px",
        gap: "16px",
      }}
    >
      {/* ── Rail ── */}
      {rail && <div className="shrink-0">{rail}</div>}

      {/* ── Left: Lead List ── */}
      <Card
        className="rounded-[28px] overflow-hidden flex flex-col h-full py-0 gap-0 shrink-0"
        style={{
          width: 340,
          background: "#FCFCFD",
          border: "1px solid rgba(16,24,40,.06)",
          boxShadow: "0 10px 28px rgba(15,23,42,.05)",
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 shrink-0">
          <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-1">
            Revenue Workspace
          </p>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mb-3">
            Lead Journey
          </h1>
          {/* Search */}
          <div className="flex items-center gap-2 h-10 border border-slate-200 rounded-2xl px-3 text-slate-400 text-sm font-semibold bg-white">
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>Search leads, campaigns…</span>
          </div>
        </div>

        {/* Lanes */}
        <div className="grid grid-cols-2 gap-2 px-4 pb-3 shrink-0">
          {LANES.map((lane) => (
            <button
              key={lane.id}
              onClick={() => setActiveLane(lane.id)}
              className={cn(
                "border rounded-[18px] p-3 text-left font-black text-sm cursor-pointer transition-all",
                activeLane === lane.id
                  ? "bg-blue-50 border-blue-200 text-slate-900"
                  : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
              )}
            >
              <span className="text-base">{lane.emoji}</span>{" "}
              {lane.label}
              <span className="block text-slate-500 font-semibold text-[11px] mt-0.5">
                {lane.count} leads
              </span>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto shrink-0 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id)}
              className={cn(
                "border rounded-full px-3 py-1.5 text-[12px] font-black whitespace-nowrap transition-all",
                activeFilter === f.id
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
              )}
            >
              {f.label}
              {f.count ? ` ${f.count}` : ""}
            </button>
          ))}
        </div>

        {/* Lead List */}
        <ScrollArea className="flex-1 min-h-0 px-3 pb-4">
          <div className="flex flex-col gap-2">
            {filteredLeads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => handlePickLead(lead)}
                className={cn(
                  "w-full text-left p-4 rounded-[20px] border transition-all",
                  selectedLead.id === lead.id
                    ? "bg-white border-l-4 border-l-orange-400 border-orange-200 shadow-md"
                    : "bg-transparent border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm"
                )}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-black text-sm text-slate-900 flex items-center gap-1.5">
                    {lead.name}
                    {lead.unread && (
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                    )}
                  </span>
                  <span className="text-[11px] text-slate-400 font-bold shrink-0 ml-2">
                    {lead.time}
                  </span>
                </div>
                <p className="text-[13px] text-slate-500 mb-2 line-clamp-1">
                  {lead.lastMessage}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map((tag) => (
                    <span
                      key={tag.label}
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[11px] font-black border",
                        TAG_STYLES[tag.color]
                      )}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      {/* ── Center: Conversation Thread ── */}
      <Card
        className="rounded-[28px] overflow-hidden flex flex-col h-full py-0 gap-0 flex-1 min-w-0"
        style={{
          background: "linear-gradient(180deg,#FCFCFD 0%,#F8F9FC 100%)",
          border: "1px solid rgba(16,24,40,.06)",
          boxShadow: "0 8px 24px rgba(15,23,42,.05)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 shrink-0"
          style={{
            height: 80,
            borderBottom: "1px solid #e7eaf0",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shrink-0"
              style={{ background: "linear-gradient(135deg,#ff8a34,#ff4f81)" }}
            >
              {selectedLead.initials}
            </div>
            <div>
              <h2 className="font-black text-lg text-slate-900 leading-tight">
                {selectedLead.name}
              </h2>
              <p className="text-[13px] text-slate-500">
                {selectedLead.campaignType} · {selectedLead.campaign}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="w-10 h-10 border border-slate-200 rounded-[14px] bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 transition">
              <Phone className="w-4 h-4" />
            </button>
            <button className="w-10 h-10 border border-slate-200 rounded-[14px] bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 transition">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button className="w-10 h-10 border border-slate-200 rounded-[14px] bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 transition">
              <Pencil className="w-4 h-4" />
            </button>
            <button className="w-10 h-10 border border-slate-200 rounded-[14px] bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 transition">
              <CheckCircle2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Attention Banner */}
        <div
          className="flex items-center gap-3 px-5 py-3 shrink-0"
          style={{
            background: "linear-gradient(90deg,#fbf8ff,#fff)",
            borderBottom: "1px solid #eee",
          }}
        >
          <span
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-black border shrink-0",
              TAG_STYLES.orange
            )}
          >
            Needs attention
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-slate-900 leading-tight">
              {selectedLead.nextBestAction.title}
            </p>
            <p className="text-[12px] text-slate-500 mt-0.5">
              {selectedLead.nextBestAction.description}
            </p>
          </div>
          <div
            className="shrink-0 border border-slate-200 rounded-2xl px-3 py-2 bg-white"
            style={{ minWidth: 180 }}
          >
            <div className="flex justify-between text-[11px] font-black text-slate-700 mb-0.5">
              <span>Lead Momentum</span>
              <span>{selectedLead.momentum}%</span>
            </div>
            <MomentumBar value={selectedLead.momentum} />
          </div>
        </div>

        {/* Journey / Messages */}
        <div
          ref={journeyRef}
          className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
          style={{ background: "linear-gradient(180deg,#fcfcfd,#f8fafc)" }}
        >
          <div className="flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex gap-3"
                >
                  {/* Dot */}
                  <div
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5 z-10",
                      msg.sender === "campaign"
                        ? "bg-violet-100 text-violet-700"
                        : msg.sender === "agent"
                        ? "bg-slate-900 text-white"
                        : msg.sender === "attention"
                        ? "bg-orange-100 text-orange-700"
                        : "bg-blue-100 text-blue-700"
                    )}
                  >
                    {msg.sender === "campaign"
                      ? "✦"
                      : msg.sender === "agent"
                      ? (msg.senderName?.[0] ?? "R")
                      : msg.sender === "attention"
                      ? "!"
                      : "C"}
                  </div>

                  {/* Card */}
                  <div
                    className={cn(
                      "flex-1 border rounded-[18px] px-4 py-3",
                      msg.sender === "agent"
                        ? "bg-slate-900 border-slate-900 text-white max-w-[72%] ml-auto"
                        : msg.sender === "campaign"
                        ? "bg-violet-50 border-violet-100"
                        : msg.sender === "attention"
                        ? "bg-orange-50 border-orange-200"
                        : "bg-white border-slate-200"
                    )}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span
                        className={cn(
                          "text-[10px] font-black tracking-widest uppercase",
                          msg.sender === "agent"
                            ? "text-slate-400"
                            : "text-slate-400"
                        )}
                      >
                        {msg.sender === "campaign"
                          ? "Campaign"
                          : msg.sender === "agent"
                          ? (msg.senderName ?? "Agent")
                          : msg.sender === "attention"
                          ? "Attention event"
                          : "Customer"}
                      </span>
                      <span className="text-[10px] font-black tracking-widest uppercase text-slate-400">
                        {msg.time}
                      </span>
                    </div>
                    {msg.campaignName && (
                      <p className="font-black text-sm text-violet-800 mb-1">
                        {msg.campaignName}
                      </p>
                    )}
                    <p
                      className={cn(
                        "text-sm leading-relaxed",
                        msg.sender === "agent" ? "text-white" : "text-slate-600"
                      )}
                    >
                      {msg.text}
                    </p>
                    {msg.tags && (
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {msg.tags.map((t) => (
                          <span
                            key={t}
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-black border",
                              t === "Delivered"
                                ? TAG_STYLES.purple
                                : TAG_STYLES.green
                            )}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Composer */}
        <div
          className="shrink-0 px-5 py-4"
          style={{ borderTop: "1px solid #e7eaf0", background: "#fff" }}
        >
          {/* Suggested replies */}
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none mb-2">
            {selectedLead.nextBestAction.suggestedReplies.map((reply, i) => (
              <button
                key={i}
                onClick={() => setComposerText(reply)}
                className={cn(
                  "border rounded-full px-3 py-1.5 text-[12px] font-black whitespace-nowrap transition-all shrink-0",
                  composerText === reply
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"
                )}
              >
                {i === 0 ? "Specific price" : i === 1 ? "Soft lock" : "Social proof"}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
              }}
              placeholder="Type a message…"
              className="flex-1 h-16 border border-slate-200 rounded-[18px] px-4 py-3 text-sm resize-none font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-100 transition"
            />
            <button
              onClick={handleSend}
              className="shrink-0 px-5 rounded-full font-black text-sm text-white transition hover:opacity-90 active:scale-95"
              style={{ background: "#ff6b1a" }}
            >
              Send →
            </button>
          </div>
        </div>
      </Card>

      {/* ── Right: Context Panel ── */}
      <Card
        className="rounded-[28px] overflow-hidden flex flex-col h-full py-0 gap-0 shrink-0"
        style={{
          width: 300,
          background: "#FCFCFD",
          border: "1px solid rgba(16,24,40,.06)",
          boxShadow: "0 10px 28px rgba(15,23,42,.05)",
        }}
      >
        <ScrollArea className="flex-1 min-h-0 p-5">
          {/* Next Best Action */}
          <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
            Next Best Action
          </p>
          <div
            className="rounded-[20px] p-4 mb-4"
            style={{ background: "#101828", border: "1px solid #101828" }}
          >
            <span
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-black border mb-3 inline-block",
                TAG_STYLES.orange
              )}
            >
              Recommended
            </span>
            <h3 className="font-black text-white text-sm leading-snug mb-2">
              {selectedLead.nextBestAction.title}
            </h3>
            <p className="text-[13px] text-slate-400 leading-relaxed mb-3">
              {selectedLead.nextBestAction.description}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() =>
                  setComposerText(selectedLead.nextBestAction.suggestedReplies[0])
                }
                className="col-span-2 border-0 rounded-[14px] py-2.5 font-black text-sm text-white transition hover:opacity-90"
                style={{ background: "#ff6b1a" }}
              >
                Use response
              </button>
              <button className="border border-white/20 rounded-[14px] py-2 font-black text-xs text-white/80 hover:bg-white/10 transition">
                Call now
              </button>
              <button className="border border-white/20 rounded-[14px] py-2 font-black text-xs text-white/80 hover:bg-white/10 transition">
                Follow-up
              </button>
              <button className="col-span-2 border border-white/20 rounded-[14px] py-2 font-black text-xs text-white/80 hover:bg-white/10 transition">
                Close
              </button>
            </div>
          </div>

          {/* Lead Snapshot */}
          <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
            Lead Snapshot
          </p>
          <div className="border border-slate-200 rounded-[20px] p-4 mb-4 bg-white">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Quote", value: selectedLead.quote },
                { label: "Service", value: selectedLead.service },
                { label: "Frequency", value: selectedLead.frequency },
                {
                  label: "Last booking",
                  value:
                    selectedLead.daysSinceBooking === 0
                      ? "New"
                      : `${selectedLead.daysSinceBooking}d ago`,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="border border-slate-100 rounded-[14px] p-2.5 bg-slate-50/50"
                >
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {m.label}
                  </span>
                  <b className="block mt-1 text-sm font-black text-slate-900">
                    {m.value}
                  </b>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign Context */}
          <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
            Campaign Context
          </p>
          <div
            className="border rounded-[20px] p-4 mb-4"
            style={{ background: "#faf7ff", borderColor: "#e9d5ff" }}
          >
            <p className="text-[10px] font-black tracking-[.22em] uppercase text-violet-500 mb-1">
              Source Journey
            </p>
            <h3 className="font-black text-slate-900 text-sm mb-1">
              {selectedLead.campaign}
            </h3>
            <p className="text-[13px] text-slate-500">
              {selectedLead.campaignType} · customer replied in{" "}
              {selectedLead.campaignReplyTime}
            </p>
          </div>

          {/* Customer Intelligence */}
          <p className="text-[10px] font-black tracking-[.22em] uppercase text-slate-400 mb-3">
            Customer Intelligence
          </p>
          <div className="border border-slate-200 rounded-[20px] p-4 bg-white">
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Lifetime", value: selectedLead.lifetimeValue },
                { label: "Jobs", value: String(selectedLead.jobCount) },
                { label: "Preferred team", value: selectedLead.preferredTeam },
                {
                  label: "Book likelihood",
                  value: `${selectedLead.bookLikelihood}%`,
                },
              ].map((m) => (
                <div
                  key={m.label}
                  className="border border-slate-100 rounded-[14px] p-2.5 bg-slate-50/50"
                >
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {m.label}
                  </span>
                  <b className="block mt-1 text-sm font-black text-slate-900">
                    {m.value}
                  </b>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
