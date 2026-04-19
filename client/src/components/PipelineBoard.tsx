/**
 * PipelineBoard — Stage 1 UI (seed data)
 * Self-contained pipeline board with seed data, Flow Mode, and detail panel.
 * Stage 2 will replace seed data with real tRPC queries.
 */
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  CalendarDays,
  MoreHorizontal,
  AlertCircle,
  CheckCircle2,
  Flame,
  Clock3,
  Inbox,
  MapPin,
  X,
  DollarSign,
  TrendingUp,
  Zap,
  ArrowUpRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PipelineLead = {
  id: number;
  name: string;
  service: string;
  price: number;
  state: string;
  source: string;
  beds: number;
  baths: number;
  lastContact: string;
  age: string;
  nextAction: string;
  phone: string;
  address: string;
  timeline: string[];
  note: string;
};

// ── Seed data ─────────────────────────────────────────────────────────────────

const SEED: Record<string, PipelineLead[]> = {
  new: [
    { id: 1, name: "Izzy A.", service: "Standard Cleaning", price: 149, state: "new", source: "Website Form", beds: 2, baths: 1, lastContact: "Never contacted", age: "1m ago", nextAction: "Reply in under 5 min", phone: "(202) 555-0121", address: "Navy Yard, DC", timeline: ["Lead created", "AI enriched profile", "Ready for first response"], note: "Asked for Friday or Saturday afternoon." },
    { id: 2, name: "Audrey M.", service: "Move-In / Move-Out", price: 289, state: "warm", source: "Instant Quote Widget", beds: 3, baths: 2, lastContact: "Quoted 12 min ago", age: "18m ago", nextAction: "Follow up with urgency", phone: "(703) 555-0187", address: "Arlington, VA", timeline: ["Lead created", "Quote generated", "Viewed pricing twice"], note: "Moving out Sunday. Wants supplies included." },
    { id: 3, name: "Kevin R.", service: "Deep Cleaning", price: 339, state: "hot", source: "Yelp", beds: 4, baths: 3, lastContact: "Replied 2 min ago", age: "25m ago", nextAction: "Call now to close", phone: "(301) 555-0199", address: "Bethesda, MD", timeline: ["Lead created", "SMS sent", "Customer replied: can you do tomorrow?"], note: "Strong buying intent. Asked about arrival window." },
  ],
  quoted: [
    { id: 4, name: "John D.", service: "Standard Cleaning", price: 239, state: "hot", source: "Website Form", beds: 3, baths: 2, lastContact: "Quote sent 35 min ago", age: "1h ago", nextAction: "Nudge before quote cools", phone: "(571) 555-0104", address: "Alexandria, VA", timeline: ["Lead created", "Quote sent", "Opened quote page twice"], note: "Mentioned recurring if first clean goes well." },
    { id: 5, name: "Sarah L.", service: "Move-Out Cleaning", price: 419, state: "warm", source: "Google LSA", beds: 4, baths: 4, lastContact: "Awaiting response", age: "3h ago", nextAction: "Offer last slot today", phone: "(240) 555-0174", address: "Silver Spring, MD", timeline: ["Lead created", "Called by AI", "Quote text delivered"], note: "Needs receipt for landlord." },
  ],
  follow: [
    { id: 6, name: "Gregory C.", service: "Deep Cleaning", price: 329, state: "risk", source: "Website Form", beds: 2, baths: 2, lastContact: "No reply for 18h", age: "1d ago", nextAction: "Rescue with discount", phone: "(202) 555-0162", address: "Capitol Hill, DC", timeline: ["Lead created", "Quote sent", "2 follow-ups unanswered"], note: "Mentioned budget concerns." },
    { id: 7, name: "Melissa P.", service: "Recurring Cleaning", price: 189, state: "warm", source: "Reactivation SMS", beds: 2, baths: 2, lastContact: "Asked about every-2-weeks", age: "6h ago", nextAction: "Push recurring plan", phone: "(202) 555-0132", address: "Dupont Circle, DC", timeline: ["Old customer reactivated", "Positive reply", "Needs schedule options"], note: "Had 3 prior cleans. Good revival candidate." },
  ],
  booked: [
    { id: 8, name: "Amy S.", service: "Move-Out Cleaning", price: 329, state: "booked", source: "Yelp", beds: 3, baths: 2, lastContact: "Booked for tomorrow 9:00 AM", age: "Today", nextAction: "Send tracking link", phone: "(703) 555-0118", address: "Falls Church, VA", timeline: ["Lead created", "Quote sent", "Booked", "Confirmation delivered"], note: "Wants inside fridge add-on." },
    { id: 9, name: "Danielle F.", service: "Standard Cleaning", price: 169, state: "booked", source: "Website Form", beds: 2, baths: 1, lastContact: "Booked for Friday 1:00 PM", age: "Today", nextAction: "Offer recurring upsell", phone: "(301) 555-0139", address: "Rockville, MD", timeline: ["Lead created", "SMS conversation", "Booked", "Deposit captured"], note: "First-time customer. Good recurring candidate." },
  ],
};

// ── Style maps ────────────────────────────────────────────────────────────────

const COLUMN_META: Record<string, { title: string; subtitle: string; accent: string; hint: string }> = {
  new:    { title: "New Leads",  subtitle: "Fastest response wins", accent: "from-blue-500/20 to-cyan-500/10",    hint: "3 uncontacted • 1 replied" },
  quoted: { title: "Quoted",     subtitle: "Quotes cooling down",   accent: "from-emerald-500/20 to-lime-500/10", hint: "2 viewed pricing recently" },
  follow: { title: "Follow Up",  subtitle: "Revenue at risk",       accent: "from-amber-500/20 to-orange-500/10", hint: "1 overdue • 1 warm" },
  booked: { title: "Booked",     subtitle: "Jobs ready to run",     accent: "from-violet-500/20 to-fuchsia-500/10", hint: "2 confirmations sent" },
};

const STATE_STYLES: Record<string, { chip: string; rail: string; label: string; Icon: React.ElementType }> = {
  new:    { chip: "bg-blue-50 text-blue-700 border-blue-200",     rail: "bg-blue-500",    label: "New",     Icon: Inbox },
  warm:   { chip: "bg-amber-50 text-amber-700 border-amber-200",  rail: "bg-amber-500",   label: "Warm",    Icon: Clock3 },
  hot:    { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", rail: "bg-emerald-500", label: "Hot", Icon: Flame },
  risk:   { chip: "bg-rose-50 text-rose-700 border-rose-200",     rail: "bg-rose-500",    label: "At Risk", Icon: AlertCircle },
  booked: { chip: "bg-violet-50 text-violet-700 border-violet-200", rail: "bg-violet-500", label: "Booked", Icon: CheckCircle2 },
};

const DATE_VIEWS = ["Today", "This Week", "This Month", "Custom"] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function LeadCard({ lead, isSelected, onSelect }: { lead: PipelineLead; isSelected: boolean; onSelect: (l: PipelineLead) => void }) {
  const s = STATE_STYLES[lead.state] ?? STATE_STYLES.new;
  return (
    <motion.button
      layout
      whileHover={{ y: -3, scale: 1.01 }}
      whileTap={{ scale: 0.995 }}
      onClick={() => onSelect(lead)}
      className={[
        "group relative w-full overflow-hidden rounded-[22px] border bg-white p-0 text-left shadow-[0_1px_2px_rgba(16,24,40,.04),0_10px_28px_rgba(16,24,40,.06)] transition-all",
        isSelected ? "border-slate-900 ring-2 ring-slate-900/5" : "border-slate-200 hover:border-slate-300",
      ].join(" ")}
    >
      <div className={["absolute inset-y-0 left-0 w-1.5", s.rail].join(" ")} />
      <div className="p-4 pl-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[15px] font-semibold tracking-tight text-slate-900">{lead.name}</div>
              <span className={["inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold", s.chip].join(" ")}>
                <s.Icon className="h-3 w-3" />
                {s.label}
              </span>
            </div>
            <div className="mt-1 text-sm text-slate-500">{lead.service}</div>
          </div>
          <button className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" onClick={e => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[28px] font-semibold tracking-tight text-slate-950">${lead.price}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <span>{lead.beds} bd</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{lead.baths} ba</span>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Source</div>
            <div className="mt-0.5 text-xs font-semibold text-slate-700">{lead.source}</div>
          </div>
        </div>
        <div className="mb-3 rounded-2xl bg-slate-50 px-3 py-2.5">
          <div className="text-[11px] text-slate-400">{lead.lastContact}</div>
          <div className="mt-1 text-sm font-medium text-slate-800">{lead.nextAction}</div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <MapPin className="h-3 w-3" />
            {lead.address}
          </div>
          <div className="text-xs text-slate-400">{lead.age}</div>
        </div>
      </div>
    </motion.button>
  );
}

function Column({ type, leads, selectedLead, onSelect }: { type: string; leads: PipelineLead[]; selectedLead: PipelineLead | null; onSelect: (l: PipelineLead) => void }) {
  const meta = COLUMN_META[type];
  const totalValue = leads.reduce((s, l) => s + l.price, 0);
  return (
    <div className="flex w-[280px] shrink-0 flex-col gap-3">
      <div className={["rounded-[20px] bg-gradient-to-br p-3.5", meta.accent].join(" ")}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">{meta.title}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{meta.subtitle}</div>
          </div>
          <div className="rounded-xl bg-white/70 px-2.5 py-1 text-sm font-semibold text-slate-900 shadow-sm">
            {leads.length}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-slate-500">{meta.hint}</div>
          <div className="text-[11px] font-semibold text-slate-700">${totalValue.toLocaleString()}</div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} isSelected={selectedLead?.id === lead.id} onSelect={onSelect} />
        ))}
      </AnimatePresence>
      {leads.length === 0 && (
        <div className="flex h-24 items-center justify-center rounded-[20px] border-2 border-dashed border-slate-200 text-sm text-slate-400">
          No leads
        </div>
      )}
    </div>
  );
}

function DetailPanel({ lead, onClose }: { lead: PipelineLead; onClose: () => void }) {
  const s = STATE_STYLES[lead.state] ?? STATE_STYLES.new;
  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ type: "spring", stiffness: 400, damping: 35 }}
      className="w-[320px] shrink-0 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04),0_18px_40px_rgba(16,24,40,.12)]"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold tracking-tight text-slate-950">{lead.name}</div>
          <div className="mt-1 text-sm text-slate-500">{lead.service} · {lead.address}</div>
        </div>
        <button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-50">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Quote</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">${lead.price}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Status</div>
          <span className={["mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold", s.chip].join(" ")}>
            {s.label}
          </span>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Phone</div>
          <div className="mt-1 font-medium text-slate-700">{lead.phone}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Property</div>
          <div className="mt-1 font-medium text-slate-700">{lead.beds} bd / {lead.baths} ba</div>
        </div>
        <div className="col-span-2 rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Notes</div>
          <div className="mt-1 font-medium text-slate-700">{lead.note}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="mb-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">Timeline</div>
        {lead.timeline.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
            <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            {step}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function FlowMode({ lead, onNext }: { lead: PipelineLead; onNext: () => void }) {
  const s = STATE_STYLES[lead.state] ?? STATE_STYLES.new;
  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,.04),0_18px_40px_rgba(16,24,40,.08)]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Flow Mode</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">One lead. One decision.</div>
        </div>
        <span className={["inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold", s.chip].join(" ")}>
          {s.label}
        </span>
      </div>
      <div className="grid grid-cols-[1.3fr_.7fr] gap-5">
        <div className="rounded-[28px] bg-slate-950 p-6 text-white">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="text-3xl font-semibold tracking-tight">{lead.name}</div>
              <div className="mt-2 text-slate-300">{lead.service} · {lead.address}</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-slate-400">Estimated job</div>
              <div className="text-4xl font-semibold">${lead.price}</div>
            </div>
          </div>
          <div className="mb-5 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Last Contact</div>
              <div className="mt-2 text-sm font-medium">{lead.lastContact}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Source</div>
              <div className="mt-2 text-sm font-medium">{lead.source}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Property</div>
              <div className="mt-2 text-sm font-medium">{lead.beds} bd / {lead.baths} ba</div>
            </div>
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-[0.12em] text-slate-400">Recommended move</div>
            <div className="text-xl font-medium">{lead.nextAction}</div>
          </div>
        </div>
        <div className="space-y-3 rounded-[28px] border border-slate-200 bg-slate-50 p-4">
          <button className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-left text-white transition hover:bg-slate-800">
            <div className="text-sm font-semibold">Reply + lock appointment</div>
            <div className="mt-1 text-sm text-slate-300">Send confident SMS and ask 9am or 1pm.</div>
          </button>
          <button className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-left text-emerald-800 transition hover:bg-emerald-100">
            <div className="text-sm font-semibold">Book now</div>
            <div className="mt-1 text-sm text-emerald-700">Move to booked and prep confirmation.</div>
          </button>
          <button className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-slate-800 transition hover:bg-slate-100">
            <div className="text-sm font-semibold">Defer to follow-up</div>
            <div className="mt-1 text-sm text-slate-500">Queue a timed nudge if not ready.</div>
          </button>
          <button onClick={onNext} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-slate-800 transition hover:bg-slate-100">
            <div className="text-sm font-semibold">Next lead →</div>
            <div className="mt-1 text-sm text-slate-500">Move fast through your highest-value queue.</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PipelineBoard() {
  const [view, setView] = useState<"pipeline" | "flow">("pipeline");
  const [selectedLead, setSelectedLead] = useState<PipelineLead | null>(null);
  const [flowIndex, setFlowIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [dateView, setDateView] = useState<typeof DATE_VIEWS[number]>("Today");

  const allLeads = useMemo(() => Object.values(SEED).flat(), []);

  const filtered = useMemo(() => {
    if (!search.trim()) return SEED;
    const q = search.toLowerCase();
    const result: Record<string, PipelineLead[]> = {};
    for (const [col, leads] of Object.entries(SEED)) {
      result[col] = leads.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.service.toLowerCase().includes(q) ||
        l.address.toLowerCase().includes(q)
      );
    }
    return result;
  }, [search]);

  const totalLeads = allLeads.length;
  const totalPipeline = allLeads.reduce((s, l) => s + l.price, 0);
  const bookedValue = (SEED.booked ?? []).reduce((s, l) => s + l.price, 0);
  const hotCount = allLeads.filter(l => l.state === "hot").length;

  const flowLeads = allLeads.filter(l => l.state !== "booked");
  const currentFlowLead = flowLeads[flowIndex % Math.max(flowLeads.length, 1)];

  function handleSelectLead(lead: PipelineLead) {
    setSelectedLead(prev => prev?.id === lead.id ? null : lead);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Lead Pipeline</h2>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-lime-400 text-slate-900">Live</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date pills */}
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {DATE_VIEWS.map(d => (
              <button
                key={d}
                onClick={() => setDateView(d)}
                className={[
                  "px-3 py-1.5 rounded-xl text-sm font-medium transition-all",
                  dateView === d ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                {d}
              </button>
            ))}
            <button className="ml-1 rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50">
              <CalendarDays className="h-4 w-4" />
            </button>
          </div>
          {/* View toggle */}
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setView("pipeline")}
              className={["px-3 py-1.5 rounded-xl text-sm font-medium transition-all", view === "pipeline" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"].join(" ")}
            >
              Pipeline View
            </button>
            <button
              onClick={() => setView("flow")}
              className={["flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all", view === "flow" ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"].join(" ")}
            >
              <Zap className="h-3.5 w-3.5" />
              Flow Mode
            </button>
          </div>
        </div>
      </div>

      {/* ── Stat tiles ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Leads", value: totalLeads, sub: "in pipeline", icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Pipeline Value", value: `$${totalPipeline.toLocaleString()}`, sub: "total quoted", icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Booked Value", value: `$${bookedValue.toLocaleString()}`, sub: "confirmed jobs", icon: CheckCircle2, color: "text-violet-600", bg: "bg-violet-50" },
          { label: "Hot Leads", value: hotCount, sub: "ready to close", icon: Flame, color: "text-rose-600", bg: "bg-rose-50" },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-sm text-slate-500">{label}</div>
              <div className={["rounded-xl p-2", bg].join(" ")}>
                <Icon className={["h-4 w-4", color].join(" ")} />
              </div>
            </div>
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
            <div className="mt-1 text-xs text-slate-400">{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Search bar ── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search leads by name, service, or location…"
          className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 placeholder:text-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {/* ── Pipeline View ── */}
      {view === "pipeline" && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Object.entries(filtered).map(([type, leads]) => (
            <Column key={type} type={type} leads={leads} selectedLead={selectedLead} onSelect={handleSelectLead} />
          ))}
          <AnimatePresence>
            {selectedLead && (
              <DetailPanel lead={selectedLead} onClose={() => setSelectedLead(null)} />
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Flow Mode ── */}
      {view === "flow" && currentFlowLead && (
        <FlowMode
          lead={currentFlowLead}
          onNext={() => setFlowIndex(i => (i + 1) % flowLeads.length)}
        />
      )}
      {view === "flow" && flowLeads.length === 0 && (
        <div className="flex h-48 items-center justify-center rounded-[28px] border-2 border-dashed border-slate-200 text-slate-400">
          No active leads to work through
        </div>
      )}
    </div>
  );
}
