/**
 * EmailInbox — Customer support + sales email inbox
 * Four-column layout: thread sidebar · email viewer · customer data panel
 * UI-only prototype — no backend wired yet
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Mail, Calendar, Users, BarChart2, Settings, Search,
  Paperclip, Image, Link2, Zap, Send, X, ChevronRight,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type ThreadType = "hot" | "booked" | "quote";

interface Thread {
  id: number;
  type: ThreadType;
  initials: string;
  name: string;
  email: string;
  subject: string;
  time: string;
  tag: string;
  msg: string;
  reply: string;
  stats: string[];
  plan: string;
  jobs: string[];
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const THREADS: Thread[] = [
  {
    id: 0,
    type: "hot",
    initials: "KW",
    name: "Katherine Williams",
    email: "katherine@email.com",
    subject: "Question about deep cleaning",
    time: "9:42 AM",
    tag: "HOT LEAD",
    msg: `Hi Maids in Black,\n\nI have a 5 bedroom / 5 bathroom house, around 5,000 sq ft. I need a deep cleaning this week and want to know what is included before I book.\n\nHome: 5 bed / 5 bath\nService: Deep cleaning\nExtras: fridge, oven, baseboards\nPreferred: Friday morning\n\nCan you help me get a price and confirm availability?`,
    reply: `Hi Katherine,\n\nThanks for reaching out. For a 5 bedroom / 5 bathroom home around 5,000 sq ft, a deep clean usually includes kitchen, bathrooms, dusting, floors, baseboards, detail work, and heavier buildup areas. Fridge and oven can be added as extras.\n\nWe do have Friday morning availability. I can get this locked in for you now — would 9:00 AM work?`,
    stats: ["$620 est.", "5 bed / 5 bath", "5,000 sq ft"],
    plan: "New quote",
    jobs: ["Deep clean quote", "Fridge + oven add-on", "Friday 9:00 AM requested"],
  },
  {
    id: 1,
    type: "booked",
    initials: "MJ",
    name: "Michael Johnson",
    email: "michael@company.com",
    subject: "Move-out clean confirmation",
    time: "Yesterday",
    tag: "BOOKED",
    msg: `Hey team,\n\nJust confirming the move-out clean for tomorrow. Please make sure the oven, fridge, cabinets, and baseboards are included.\n\nAccess code is 4421.`,
    reply: `Hi Michael,\n\nYou're all set. Your move-out clean is confirmed for tomorrow, and we have oven, fridge, cabinets, and baseboards noted on the job.\n\nWe'll message when the team is on the way.`,
    stats: ["$299", "Move-out", "Tomorrow"],
    plan: "Confirmed job",
    jobs: ["Tomorrow 1:00 PM", "Access code saved", "Extras confirmed"],
  },
  {
    id: 2,
    type: "quote",
    initials: "AP",
    name: "Angela Perez",
    email: "angela@email.com",
    subject: "Recurring cleaning estimate",
    time: "Mon",
    tag: "QUOTE",
    msg: `Hello,\n\nI'm interested in monthly cleaning for a 3 bed / 2 bath home in Arlington. Can you send pricing and what is included?`,
    reply: `Hi Angela,\n\nFor a 3 bed / 2 bath monthly cleaning, most homes land around $180–$220 depending on condition and exact scope. Standard recurring service includes bathrooms, kitchen, dusting, floors, trash, and general tidying.\n\nWhat day were you thinking for the first cleaning?`,
    stats: ["$200 est.", "3 bed / 2 bath", "Monthly"],
    plan: "Recurring lead",
    jobs: ["Arlington VA", "Monthly cadence", "Needs first date"],
  },
];

// ── Badge styles ───────────────────────────────────────────────────────────────

const tagStyles: Record<ThreadType, string> = {
  hot: "bg-rose-50 text-rose-700 border-rose-100",
  booked: "bg-emerald-50 text-emerald-700 border-emerald-100",
  quote: "bg-amber-50 text-amber-700 border-amber-100",
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ThreadItem({
  thread,
  active,
  onClick,
}: {
  thread: Thread;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3.5 rounded-2xl border transition-all mb-2",
        active
          ? "border-blue-200 bg-blue-50/60 shadow-sm"
          : "border-transparent bg-white hover:bg-slate-50"
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-semibold text-sm text-slate-800 leading-snug line-clamp-1">
          {thread.subject}
        </span>
        <span className="text-xs text-slate-400 shrink-0 mt-0.5">{thread.time}</span>
      </div>
      <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
        <span className="font-semibold text-slate-600">{thread.name}</span> ·{" "}
        {thread.msg.slice(0, 80)}…
      </p>
      <span
        className={cn(
          "inline-block mt-2 text-[10px] font-black px-2 py-1 rounded-full border",
          tagStyles[thread.type]
        )}
      >
        {thread.tag}
      </span>
    </button>
  );
}

function CustomerPanel({ thread }: { thread: Thread }) {
  return (
    <div className="p-5 overflow-y-auto h-full">
      {/* Customer header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-black text-sm shrink-0">
          {thread.initials}
        </div>
        <div>
          <p className="font-bold text-sm text-slate-800">{thread.name}</p>
          <p className="text-xs text-slate-400">{thread.email}</p>
        </div>
      </div>

      {/* Plan card */}
      <div className="border border-slate-200 rounded-2xl p-4 mb-4 bg-white">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Cleaning customer data
        </p>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-sm text-slate-800">{thread.plan}</p>
            <p className="text-xs text-slate-400 mt-0.5">Maids in Black</p>
          </div>
          <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-1 rounded-full">
            ACTIVE
          </span>
        </div>
      </div>

      {/* Home profile */}
      <div className="border border-slate-200 rounded-2xl p-4 mb-4 bg-white">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Home profile
        </p>
        <div className="grid grid-cols-3 gap-2">
          {thread.stats.map((s) => (
            <div key={s} className="bg-slate-50 rounded-xl p-3">
              <p className="font-bold text-sm text-slate-800">{s}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Customer data</p>
            </div>
          ))}
        </div>
      </div>

      {/* Job details */}
      <div className="border border-slate-200 rounded-2xl p-4 mb-4 bg-white">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Job details
        </p>
        <div className="space-y-3">
          {thread.jobs.map((j, k) => (
            <div
              key={j}
              className="flex items-center justify-between border-t border-slate-100 pt-3 first:border-0 first:pt-0"
            >
              <span className="text-sm text-slate-700 flex items-center gap-2">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    k === 2 ? "bg-red-500" : "bg-emerald-500"
                  )}
                />
                {j}
              </span>
              <button className="text-xs font-bold border border-slate-200 rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-50 transition-colors">
                Open
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Automation */}
      <div className="border border-slate-200 rounded-2xl p-4 bg-white">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
          Automation
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors">
            Create follow-up
          </button>
          <button className="text-xs font-bold border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50 transition-colors">
            Send quote link
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type ReplyMode = "reply" | "note" | "sms";
type FilterTab = "all" | "hot" | "booked" | "quote";

export default function EmailInbox() {
  const [selectedId, setSelectedId] = useState<number>(0);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [replyMode, setReplyMode] = useState<ReplyMode>("reply");
  const [replyText, setReplyText] = useState(THREADS[0].reply);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);

  const thread = THREADS.find((t) => t.id === selectedId) ?? THREADS[0];

  const filtered =
    filter === "all" ? THREADS : THREADS.filter((t) => t.type === filter);

  function selectThread(t: Thread) {
    setSelectedId(t.id);
    setReplyMode("reply");
    setReplyText(t.reply);
    setShowCustomerPanel(false);
  }

  function switchReplyMode(mode: ReplyMode) {
    setReplyMode(mode);
    if (mode === "note") {
      setReplyText(
        "Internal note: Customer looks high intent. Confirm scope, quote, and ask for 9am or 1pm."
      );
    } else if (mode === "sms") {
      setReplyText(
        `Hi ${thread.name.split(" ")[0]}, Madison from Maids in Black — we can help with the deep clean this week. Does Friday at 9am work?`
      );
    } else {
      setReplyText(thread.reply);
    }
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#f6f8fb] font-sans">
      {/* ── Rail nav ── */}
      <aside className="w-[72px] bg-white border-r border-slate-200 flex flex-col items-center py-5 gap-4 shrink-0">
        <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-sm">
          M
        </div>
        <nav className="flex flex-col gap-3 mt-2">
          {[
            { icon: <Mail className="w-5 h-5" />, active: true },
            { icon: <Calendar className="w-5 h-5" />, active: false },
            { icon: <Users className="w-5 h-5" />, active: false },
            { icon: <BarChart2 className="w-5 h-5" />, active: false },
            { icon: <Settings className="w-5 h-5" />, active: false },
          ].map((item, i) => (
            <button
              key={i}
              className={cn(
                "w-11 h-11 rounded-[14px] flex items-center justify-center transition-colors",
                item.active
                  ? "bg-blue-50 text-blue-600"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              )}
            >
              {item.icon}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Thread sidebar ── */}
      <aside className="w-[300px] bg-white border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
        <div className="p-5 pb-3">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-lg font-black text-slate-900">Maids Inbox</h1>
              <p className="text-xs text-slate-400">Customer support + sales</p>
            </div>
            <button className="bg-slate-900 text-white text-lg font-bold w-9 h-9 rounded-[14px] flex items-center justify-center hover:bg-slate-800 transition-colors">
              +
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search leads, clients, jobs…"
              className="pl-9 bg-slate-50 border-slate-200 rounded-[14px] text-sm h-10"
            />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-2 mt-3">
            {(["all", "hot", "booked", "quote"] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[11px] font-black capitalize transition-colors",
                  filter === tab
                    ? "bg-blue-100 text-blue-700"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {filtered.map((t) => (
            <ThreadItem
              key={t.id}
              thread={t}
              active={t.id === selectedId}
              onClick={() => selectThread(t)}
            />
          ))}
        </div>
      </aside>

      {/* ── Email viewer ── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Header */}
        <div className="h-[72px] bg-white border-b border-slate-200 flex items-center justify-between px-7 shrink-0">
          <h2 className="text-xl font-black text-slate-900 truncate mr-4">
            {thread.subject}
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs font-bold"
              onClick={() => setShowCustomerPanel(true)}
            >
              Customer Data
            </Button>
            <Button variant="outline" size="sm" className="text-xs font-bold">
              Snooze
            </Button>
            <Button variant="outline" size="sm" className="text-xs font-bold">
              Mark done
            </Button>
            <Button size="sm" className="text-xs font-bold bg-blue-600 hover:bg-blue-700">
              Assign
            </Button>
          </div>
        </div>

        {/* Email content */}
        <div className="flex-1 overflow-y-auto p-7">
          {/* Email card */}
          <div className="bg-white border border-slate-200 rounded-[18px] shadow-[0_18px_45px_rgba(22,34,51,0.08)] p-7 max-w-3xl mb-5">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-sm shrink-0">
                {thread.initials}
              </div>
              <div>
                <p className="font-bold text-sm text-slate-800">{thread.name}</p>
                <p className="text-xs text-slate-400">
                  {thread.email} · {thread.time}
                </p>
              </div>
            </div>
            <div className="text-[15px] text-slate-700 leading-relaxed whitespace-pre-wrap">
              {thread.msg}
            </div>
          </div>

          {/* Reply box */}
          <div className="bg-white border border-slate-200 rounded-[18px] shadow-[0_18px_45px_rgba(22,34,51,0.08)] max-w-3xl overflow-hidden">
            {/* Reply mode tabs */}
            <div className="flex border-b border-slate-200">
              {(["reply", "note", "sms"] as ReplyMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => switchReplyMode(mode)}
                  className={cn(
                    "px-5 py-3.5 text-sm font-black capitalize transition-colors border-b-2",
                    replyMode === mode
                      ? "text-blue-600 border-blue-600"
                      : "text-slate-500 border-transparent hover:text-slate-700"
                  )}
                >
                  {mode === "note" ? "Internal note" : mode === "sms" ? "SMS" : "Reply"}
                </button>
              ))}
            </div>

            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="border-0 rounded-none resize-none min-h-[180px] text-[15px] leading-relaxed text-slate-700 focus-visible:ring-0 p-5"
              placeholder="Write a reply…"
            />

            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
              <div className="flex items-center gap-3 text-slate-400">
                <button className="hover:text-slate-600 transition-colors">
                  <Paperclip className="w-4 h-4" />
                </button>
                <button className="hover:text-slate-600 transition-colors">
                  <Image className="w-4 h-4" />
                </button>
                <button className="hover:text-slate-600 transition-colors">
                  <Link2 className="w-4 h-4" />
                </button>
                <button className="hover:text-slate-600 transition-colors">
                  <Zap className="w-4 h-4" />
                </button>
              </div>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white font-black text-xs gap-1.5"
                onClick={() => alert("Prototype: message sent")}
              >
                <Send className="w-3.5 h-3.5" />
                Send ⌘+Enter
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* ── Customer data panel (desktop) ── */}
      <aside className="w-[340px] bg-white border-l border-slate-200 shrink-0 overflow-hidden hidden xl:flex flex-col">
        <CustomerPanel thread={thread} />
      </aside>

      {/* ── Customer data slide-over (mobile / medium screens) ── */}
      {showCustomerPanel && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/25 z-40 xl:hidden"
            onClick={() => setShowCustomerPanel(false)}
          />
          <div className="fixed right-0 top-0 h-full w-[380px] bg-white shadow-2xl z-50 xl:hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <p className="font-black text-sm text-slate-800">Customer Data</p>
              <button
                onClick={() => setShowCustomerPanel(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CustomerPanel thread={thread} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
