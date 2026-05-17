/**
 * LeadOps — Revenue Radar
 * Lead Ops subpage inside OpsChat. UI-first mockup on preview branch.
 */
import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Bell,
  Phone,
  MessageSquare,
  Clock,
  DollarSign,
  Send,
  MapPin,
  Sparkles,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Users,
  MoreHorizontal,
  ShieldCheck,
  Target,
  Timer,
  Star,
  ArrowUpRight,
  Bot,
  ClipboardList,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_LEADS = [
  {
    id: 1,
    name: "Payal K.",
    source: "Thumbtack",
    service: "Standard Cleaning",
    location: "Arlington, VA",
    details: "2 bed / 2 bath",
    ageSeconds: 68,
    status: "unclaimed" as const,
    value: 229,
    confidence: 84,
    urgency: "critical" as const,
    requested: "Today or tomorrow",
    owner: null,
    lastTouch: "No outreach yet",
    phone: "703-xxx-0184",
  },
  {
    id: 2,
    name: "Tyrique J.",
    source: "Yelp",
    service: "Move-out Cleaning",
    location: "Washington, DC",
    details: "1 bed / 1 bath + oven/fridge",
    ageSeconds: 236,
    status: "claimed" as const,
    value: 199,
    confidence: 78,
    urgency: "hot" as const,
    requested: "Friday morning",
    owner: "Madison",
    lastTouch: "SMS sent 2m ago",
    phone: "202-xxx-4420",
  },
  {
    id: 3,
    name: "Niesha M.",
    source: "Thumbtack",
    service: "Deep Cleaning",
    location: "Manassas, VA",
    details: "Kitchen, bathrooms, living area",
    ageSeconds: 612,
    status: "awaiting_reply" as const,
    value: 349,
    confidence: 91,
    urgency: "hot" as const,
    requested: "May 7-9",
    owner: "Rizalina",
    lastTouch: "Follow-up due now",
    phone: "703-xxx-7912",
  },
  {
    id: 4,
    name: "Sarah M.",
    source: "Website Quote",
    service: "Recurring Cleaning",
    location: "Alexandria, VA",
    details: "3 bed / 2.5 bath",
    ageSeconds: 1820,
    status: "quoted" as const,
    value: 278,
    confidence: 69,
    urgency: "warm" as const,
    requested: "Next week",
    owner: "Carlos",
    lastTouch: "Viewed quote 4m ago",
    phone: "571-xxx-2201",
  },
  {
    id: 5,
    name: "Amanda R.",
    source: "Google Ads",
    service: "Standard Cleaning",
    location: "Bethesda, MD",
    details: "4 bed / 3 bath",
    ageSeconds: 4200,
    status: "follow_up" as const,
    value: 318,
    confidence: 73,
    urgency: "warm" as const,
    requested: "Saturday",
    owner: "Ashley",
    lastTouch: "No reply after quote",
    phone: "301-xxx-6544",
  },
];

const MOCK_TEAM = [
  { name: "Madison",  initials: "M", state: "Calling Tyrique",         avg: "42s avg",    booked: 5, color: "bg-violet-100 text-violet-700" },
  { name: "Rizalina", initials: "R", state: "Handling sensitive lead",  avg: "58s avg",    booked: 3, color: "bg-orange-100 text-orange-700" },
  { name: "Carlos",   initials: "C", state: "Quote follow-up",          avg: "1m 14s avg", booked: 4, color: "bg-blue-100 text-blue-700"   },
  { name: "Ashley",   initials: "A", state: "Watching queue",           avg: "39s avg",    booked: 6, color: "bg-emerald-100 text-emerald-700" },
];

type Lead = typeof MOCK_LEADS[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: Lead["status"] }) {
  const styles: Record<Lead["status"], string> = {
    unclaimed:     "bg-rose-50 text-rose-700 border-rose-200",
    claimed:       "bg-blue-50 text-blue-700 border-blue-200",
    awaiting_reply:"bg-amber-50 text-amber-700 border-amber-200",
    quoted:        "bg-purple-50 text-purple-700 border-purple-200",
    follow_up:     "bg-slate-50 text-slate-700 border-slate-200",
  };
  const labels: Record<Lead["status"], string> = {
    unclaimed:     "Needs claim",
    claimed:       "Claimed",
    awaiting_reply:"Reply due",
    quoted:        "Quote viewed",
    follow_up:     "Follow-up",
  };
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-bold", styles[status])}>
      {labels[status]}
    </span>
  );
}

function LeadCard({ lead, active, onClick }: { lead: Lead; active: boolean; onClick: (l: Lead) => void }) {
  const isCritical = lead.urgency === "critical";
  return (
    <motion.button
      layout
      onClick={() => onClick(lead)}
      whileHover={{ y: -2 }}
      className={cn(
        "w-full text-left rounded-3xl border p-4 transition shadow-sm",
        active
          ? "border-slate-900 bg-white shadow-xl"
          : isCritical
          ? "border-rose-200 bg-rose-50/70"
          : "border-slate-200 bg-white hover:shadow-lg"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isCritical && <Flame className="h-4 w-4 text-rose-500 shrink-0" />}
            <h3 className="truncate text-base font-black text-slate-950">{lead.name}</h3>
          </div>
          <p className="mt-1 text-sm font-medium text-slate-500">{lead.service}</p>
        </div>
        <StatusPill status={lead.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-white/80 p-3 border border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Age</div>
          <div className={cn("mt-1 font-black", isCritical ? "text-rose-600" : "text-slate-900")}>
            {formatAge(lead.ageSeconds)}
          </div>
        </div>
        <div className="rounded-2xl bg-white/80 p-3 border border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Value</div>
          <div className="mt-1 font-black text-slate-900">${lead.value}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-950 px-3 py-2 text-white">
        <div className="text-xs font-semibold opacity-70">{lead.source}</div>
        <div className="text-xs font-bold">{lead.confidence}% close fit</div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        <MapPin className="h-4 w-4 shrink-0" />
        <span className="truncate">{lead.location}</span>
      </div>
    </motion.button>
  );
}

function MetricCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-2xl bg-slate-100 p-2"><Icon className="h-5 w-5 text-slate-700" /></div>
        <ArrowUpRight className="h-4 w-4 text-slate-400" />
      </div>
      <div className="mt-4 text-3xl font-black tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-sm font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeadOps() {
  const [activeLead, setActiveLead] = useState<Lead>(MOCK_LEADS[0]);
  const [filterTab, setFilterTab] = useState<"Hot" | "Follow-up" | "Booked">("Hot");
  const [composer, setComposer] = useState(
    "Hi Payal, this is Madison from Maids in Black 👍 I just saw your Thumbtack request and can help with the standard cleaning. What day were you hoping to get this done?"
  );

  const filtered = useMemo(() => MOCK_LEADS, []);

  return (
    <div className="flex h-full overflow-hidden bg-slate-100 text-slate-950">
      {/* ── Left panel: lead list ─────────────────────────────────────────── */}
      <aside className="w-[340px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Lead Ops</p>
            <h1 className="mt-0.5 text-2xl font-black tracking-tight">Revenue Radar</h1>
          </div>
          <button className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm hover:bg-slate-50">
            <Bell className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="mb-4 rounded-3xl border border-slate-200 bg-slate-50 p-1.5">
          <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 shadow-sm">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Search leads, phones, cities"
            />
          </div>
        </div>

        {/* Metrics */}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <MetricCard icon={AlertTriangle} label="Unclaimed"    value="3"   sub="2 near SLA breach"    />
          <MetricCard icon={Timer}         label="Avg Response" value="48s" sub="Today, all sources"   />
          <MetricCard icon={CheckCircle2}  label="Booked"       value="12"  sub="$3,642 revenue"       />
          <MetricCard icon={Target}        label="Close Rate"   value="41%" sub="+8% vs last week"     />
        </div>

        {/* Filter tabs */}
        <div className="mb-3 flex rounded-2xl bg-slate-100 p-1">
          {(["Hot", "Follow-up", "Booked"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setFilterTab(item)}
              className={cn(
                "flex-1 rounded-xl px-3 py-2 text-sm font-bold transition",
                filterTab === item ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-900"
              )}
            >
              {item}
            </button>
          ))}
        </div>

        {/* Lead cards */}
        <div className="space-y-3 pb-6">
          {filtered.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              active={lead.id === activeLead.id}
              onClick={setActiveLead}
            />
          ))}
        </div>
      </aside>

      {/* ── Center + right: lead detail ──────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Detail header */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white">
              {activeLead.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black tracking-tight">{activeLead.name}</h2>
                <StatusPill status={activeLead.status} />
              </div>
              <p className="mt-0.5 text-sm font-medium text-slate-500">
                {activeLead.service} • {activeLead.details} • {activeLead.location}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-right">
              <div className="text-[10px] font-black uppercase tracking-wide text-rose-400">SLA Timer</div>
              <div className="text-lg font-black text-rose-600">0:52</div>
            </div>
            <button className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 font-black text-white shadow-lg hover:scale-[1.02] text-sm">
              <Phone className="h-4 w-4" /> Call
            </button>
            <button className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 font-black shadow-sm hover:bg-slate-50 text-sm">
              <MessageSquare className="h-4 w-4" /> Text
            </button>
            <button className="rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm hover:bg-slate-50">
              <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Detail body */}
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_340px] overflow-hidden">
          {/* Center content */}
          <section className="overflow-y-auto p-5">
            {/* Stats row */}
            <div className="mb-5 grid grid-cols-4 gap-3">
              {[
                ["Lead Source", activeLead.source],
                ["Est. Value",  `$${activeLead.value}`],
                ["Close Fit",   `${activeLead.confidence}%`],
                ["Owner",       activeLead.owner ?? "None"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{k}</p>
                  <p className="mt-2 text-xl font-black">{v}</p>
                </div>
              ))}
            </div>

            {/* AI Next Best Action */}
            <div className="mb-5 rounded-[28px] bg-[#071026] p-5 text-white shadow-2xl">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-white/50">
                    <Sparkles className="h-3.5 w-3.5" /> AI Next Best Action
                  </div>
                  <h3 className="text-2xl font-black">Claim + text in under 60 seconds</h3>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
                    This is a hot lead with no owner yet. Send the first text now, then call if they do not respond within 90 seconds.
                  </p>
                </div>
                <button className="rounded-2xl bg-white px-4 py-2.5 font-black text-slate-950 hover:scale-[1.02] text-sm shrink-0">
                  Auto Execute
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { icon: Phone,        title: "Call Now",       desc: "Best for high-intent Thumbtack leads." },
                  { icon: Send,         title: "Send AI Text",   desc: "Personal first response is ready."     },
                  { icon: ClipboardList,title: "Create Quote",   desc: "Use property details and source data." },
                ].map(({ icon: Icon, title, desc }) => (
                  <button key={title} className="rounded-3xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10 transition">
                    <Icon className="mb-3 h-5 w-5" />
                    <div className="font-black text-sm">{title}</div>
                    <p className="mt-1 text-xs text-white/60">{desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation + details */}
            <div className="grid grid-cols-[1fr_280px] gap-4">
              {/* Conversation */}
              <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-black">Lead Conversation</h3>
                    <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                      <Radio className="h-3 w-3" /> Live
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  <div className="max-w-[75%] rounded-3xl bg-slate-100 p-4">
                    <div className="mb-1 text-xs font-bold text-slate-400">Thumbtack request</div>
                    <p className="text-sm leading-6">Looking for a standard cleaning. Prefer texting in the app. Need availability soon.</p>
                  </div>
                  <div className="ml-auto max-w-[78%] rounded-3xl bg-slate-950 p-4 text-white">
                    <div className="mb-1 text-xs font-bold text-white/50">AI draft</div>
                    <p className="text-sm leading-6">{composer}</p>
                  </div>
                </div>

                <div className="border-t border-slate-200 p-4">
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    className="h-24 w-full resize-none rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-slate-400"
                  />
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold hover:bg-slate-50">
                        <Bot className="mr-1.5 inline h-3.5 w-3.5" />Rewrite
                      </button>
                      <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold hover:bg-slate-50">Add urgency</button>
                      <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold hover:bg-slate-50">Softer tone</button>
                    </div>
                    <button className="flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 font-black text-white text-sm">
                      <Send className="h-4 w-4" /> Send
                    </button>
                  </div>
                </div>
              </div>

              {/* Right detail cards */}
              <div className="space-y-3">
                <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-base font-black">Lead Details</h3>
                  {[
                    ["Phone",      activeLead.phone],
                    ["Requested",  activeLead.requested],
                    ["Property",   activeLead.details],
                    ["Last touch", activeLead.lastTouch],
                  ].map(([k, v]) => (
                    <div key={k} className="mb-2.5 flex justify-between gap-4 text-sm">
                      <span className="font-bold text-slate-400">{k}</span>
                      <span className="text-right font-semibold">{v}</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-[28px] border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    <h3 className="font-black text-sm">Escalation Rule</h3>
                  </div>
                  <p className="text-xs leading-5 text-amber-800">
                    If not claimed in 60 seconds, notify manager and trigger auto-text.
                  </p>
                  <button className="mt-3 rounded-2xl bg-amber-600 px-3 py-1.5 text-xs font-black text-white">
                    Enable auto-response
                  </button>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-base font-black">Quick Actions</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {["Claim", "Quote", "Book", "Follow-up", "Assign", "Close"].map((action) => (
                      <button key={action} className="rounded-2xl bg-slate-100 px-3 py-2.5 text-xs font-black hover:bg-slate-200 transition">
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Right panel: Live Team */}
          <aside className="overflow-y-auto border-l border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Sales Floor</p>
                <h3 className="mt-0.5 text-xl font-black">Live Team</h3>
              </div>
              <button className="rounded-2xl bg-slate-950 p-2.5 text-white">
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5 space-y-3">
              {MOCK_TEAM.map((member) => (
                <div key={member.name} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl font-black text-sm", member.color)}>
                      {member.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-black text-sm">{member.name}</h4>
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
                      </div>
                      <p className="truncate text-xs text-slate-500">{member.state}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-2xl bg-white p-2.5">
                      <div className="font-black">{member.avg}</div>
                      <div className="text-slate-400">response</div>
                    </div>
                    <div className="rounded-2xl bg-white p-2.5">
                      <div className="font-black">{member.booked}</div>
                      <div className="text-slate-400">booked</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Today's performance */}
            <div className="rounded-[28px] bg-slate-950 p-4 text-white shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-black">Today</h3>
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="space-y-3">
                {[
                  ["Speed-to-lead",    "92%", 92],
                  ["Quote sent rate",  "84%", 84],
                  ["Booked from leads","41%", 41],
                ].map(([label, pct, width]) => (
                  <div key={label as string}>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span>{label}</span>
                      <span className="font-black">{pct}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/10">
                      <div className="h-2.5 rounded-full bg-white" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent wins */}
            <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 font-black">Recent Wins</h3>
              {[
                "Amanda R. booked recurring",
                "Carlos recovered Yelp lead",
                "Madison beat SLA by 41s",
              ].map((win) => (
                <div key={win} className="mb-2.5 flex items-center gap-3 text-sm">
                  <Star className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="font-semibold">{win}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
