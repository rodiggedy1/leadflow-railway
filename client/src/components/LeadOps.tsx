/**
 * LeadOps — Revenue Radar
 * Lead Ops subpage inside OpsChat. Wired to real data via leads.listForLeadOps.
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
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

// ── Types ─────────────────────────────────────────────────────────────────────

type RealLead = {
  id: number;
  name: string;
  phone: string;
  source: string;
  sourceRaw: string;
  service: string;
  bedrooms: string;
  bathrooms: string;
  stage: string;
  status: "unclaimed" | "awaiting_reply" | "replied" | "follow_up" | "booked";
  filterTag: "Hot" | "Follow-up" | "Booked";
  estimatedValue: number;
  confidence: number;
  ageMs: number;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
  lastOutboundAt: number | null;
  lastInboundAt: number | null;
  createdAt: Date | string;
  aiMode: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatLastTouch(lead: RealLead): string {
  if (lead.lastInboundAt) {
    const ago = Date.now() - lead.lastInboundAt;
    return `Customer replied ${formatAge(ago)} ago`;
  }
  if (lead.lastOutboundAt) {
    const ago = Date.now() - lead.lastOutboundAt;
    return `Outreach sent ${formatAge(ago)} ago`;
  }
  return "No outreach yet";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: RealLead["status"] }) {
  const styles: Record<RealLead["status"], string> = {
    unclaimed:     "bg-rose-50 text-rose-700 border-rose-200",
    awaiting_reply:"bg-amber-50 text-amber-700 border-amber-200",
    replied:       "bg-blue-50 text-blue-700 border-blue-200",
    follow_up:     "bg-slate-50 text-slate-700 border-slate-200",
    booked:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  const labels: Record<RealLead["status"], string> = {
    unclaimed:     "Needs claim",
    awaiting_reply:"Reply due",
    replied:       "New reply",
    follow_up:     "Follow-up",
    booked:        "Booked",
  };
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-bold", styles[status])}>
      {labels[status]}
    </span>
  );
}

function LeadCard({ lead, active, onClick }: { lead: RealLead; active: boolean; onClick: (l: RealLead) => void }) {
  const isCritical = lead.status === "unclaimed" && lead.ageMs < 120_000;
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
            {formatAge(lead.ageMs)}
          </div>
        </div>
        <div className="rounded-2xl bg-white/80 p-3 border border-slate-100">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Value</div>
          <div className="mt-1 font-black text-slate-900">${lead.estimatedValue}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-950 px-3 py-2 text-white">
        <div className="text-xs font-semibold opacity-70">{lead.source}</div>
        <div className="text-xs font-bold">{lead.confidence}% close fit</div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
        <Users className="h-4 w-4 shrink-0" />
        <span className="truncate">{lead.assignedAgentName ?? "Unassigned"}</span>
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
  const [activeLead, setActiveLead] = useState<RealLead | null>(null);
  const [filterTab, setFilterTab] = useState<"Hot" | "Follow-up" | "Booked">("Hot");
  const [search, setSearch] = useState("");
  const [composer, setComposer] = useState("");

  const { data: leads = [], isLoading, error } = trpc.leads.listForLeadOps.useQuery(undefined, {
    refetchInterval: 30_000, // refresh every 30s
  });

  // Set first lead as active once data loads
  React.useEffect(() => {
    if (leads.length > 0 && !activeLead) {
      setActiveLead(leads[0]);
      setComposer(
        `Hi ${leads[0].name.split(" ")[0]}, this is Madison from Maids in Black 👋 I just saw your ${leads[0].source} request and would love to help with ${leads[0].service}. What day works best for you?`
      );
    }
  }, [leads, activeLead]);

  const filtered = useMemo(() => {
    let list = leads.filter(l => l.filterTag === filterTab);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.service.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q)
      );
    }
    return list;
  }, [leads, filterTab, search]);

  // Metrics derived from real data
  const unclaimedCount = leads.filter(l => l.status === "unclaimed").length;
  const bookedCount    = leads.filter(l => l.status === "booked").length;
  const bookedRevenue  = leads.filter(l => l.status === "booked").reduce((s, l) => s + l.estimatedValue, 0);
  const closeRate      = leads.length > 0
    ? Math.round((bookedCount / leads.length) * 100)
    : 0;

  const handleSelectLead = (lead: RealLead) => {
    setActiveLead(lead);
    setComposer(
      `Hi ${lead.name.split(" ")[0]}, this is Madison from Maids in Black 👋 I just saw your ${lead.source} request and would love to help with ${lead.service}. What day works best for you?`
    );
  };

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
              placeholder="Search leads, phones, services"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Metrics */}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <MetricCard icon={AlertTriangle} label="Unclaimed"    value={String(unclaimedCount)} sub="Last 7 days"              />
          <MetricCard icon={Timer}         label="Avg Response" value="—"                       sub="Coming soon"              />
          <MetricCard icon={CheckCircle2}  label="Booked"       value={String(bookedCount)}     sub={`$${bookedRevenue.toLocaleString()} revenue`} />
          <MetricCard icon={Target}        label="Close Rate"   value={`${closeRate}%`}          sub="Last 7 days"              />
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
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {error && (
            <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">
              Failed to load leads. Please refresh.
            </div>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400">
              No {filterTab.toLowerCase()} leads in the last 7 days.
            </div>
          )}
          {filtered.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              active={activeLead?.id === lead.id}
              onClick={handleSelectLead}
            />
          ))}
        </div>
      </aside>

      {/* ── Center + right: lead detail ──────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!activeLead ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            {isLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : "Select a lead to view details"}
          </div>
        ) : (
          <>
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
                    {activeLead.service} • {activeLead.bedrooms}bd / {activeLead.bathrooms}ba • {activeLead.source}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {activeLead.status === "unclaimed" && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-right">
                    <div className="text-[10px] font-black uppercase tracking-wide text-rose-400">Age</div>
                    <div className="text-lg font-black text-rose-600">{formatAge(activeLead.ageMs)}</div>
                  </div>
                )}
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
                    ["Est. Value",  `$${activeLead.estimatedValue}`],
                    ["Close Fit",   `${activeLead.confidence}%`],
                    ["Owner",       activeLead.assignedAgentName ?? "None"],
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
                      <h3 className="text-2xl font-black">
                        {activeLead.status === "unclaimed"
                          ? "Claim + text in under 60 seconds"
                          : activeLead.status === "replied"
                          ? "Customer replied — respond now"
                          : activeLead.status === "follow_up"
                          ? "Follow-up is due"
                          : "Continue the conversation"}
                      </h3>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
                        {activeLead.status === "unclaimed"
                          ? "This lead has no owner yet. Send the first text now, then call if they don't respond within 90 seconds."
                          : activeLead.status === "replied"
                          ? "The customer replied. Respond quickly to keep momentum and close the booking."
                          : "Keep the conversation moving to convert this lead."}
                      </p>
                    </div>
                    <button className="rounded-2xl bg-white px-4 py-2.5 font-black text-slate-950 hover:scale-[1.02] text-sm shrink-0">
                      Auto Execute
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { icon: Phone,        title: "Call Now",       desc: "Best for high-intent leads." },
                      { icon: Send,         title: "Send AI Text",   desc: "Personal first response is ready." },
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

                {/* Conversation + details — stacked vertically */}
                <div className="flex flex-col gap-4">
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
                        <div className="mb-1 text-xs font-bold text-slate-400">{activeLead.source} request</div>
                        <p className="text-sm leading-6">
                          {activeLead.service} • {activeLead.bedrooms} bed / {activeLead.bathrooms} bath
                        </p>
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

                  {/* Detail cards — 3-column row below conversation */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                      <h3 className="mb-3 text-base font-black">Lead Details</h3>
                      {[
                        ["Phone",      activeLead.phone],
                        ["Property",   `${activeLead.bedrooms} bed / ${activeLead.bathrooms} bath`],
                        ["Stage",      activeLead.stage],
                        ["Last touch", formatLastTouch(activeLead)],
                      ].map(([k, v]) => (
                        <div key={k} className="mb-2.5 flex flex-col gap-0.5 text-sm">
                          <span className="font-bold text-slate-400">{k}</span>
                          <span className="font-semibold">{v}</span>
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

                {/* Team panel — still mocked; Layer 4 will wire real agent data */}
                <div className="mb-5 space-y-3">
                  {[
                    { name: "Madison",  initials: "M", state: "On lead queue",        avg: "—", booked: "—", color: "bg-violet-100 text-violet-700" },
                    { name: "Rizalina", initials: "R", state: "On lead queue",         avg: "—", booked: "—", color: "bg-orange-100 text-orange-700" },
                    { name: "Carlos",   initials: "C", state: "On lead queue",         avg: "—", booked: "—", color: "bg-blue-100 text-blue-700"   },
                    { name: "Ashley",   initials: "A", state: "On lead queue",         avg: "—", booked: "—", color: "bg-emerald-100 text-emerald-700" },
                  ].map((member) => (
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
                      ["Unclaimed leads", `${unclaimedCount}`, Math.min(unclaimedCount * 10, 100)],
                      ["Booked",          `${bookedCount}`,   Math.min(bookedCount * 10, 100)],
                      ["Close rate",      `${closeRate}%`,    closeRate],
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

                {/* Recent wins — still mocked */}
                <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 font-black">Recent Wins</h3>
                  <p className="text-xs text-slate-400">Coming in Layer 4 — real agent activity feed.</p>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
