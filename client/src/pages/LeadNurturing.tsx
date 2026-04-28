/**
 * LeadNurturing — Sequence Control Center
 * AI Lead Nurturing Engine — pixel-perfect UI from spec.
 * UI-only phase: all data is static/placeholder.
 */
import { useState } from "react";
import AdminHeader from "@/components/AdminHeader";

export default function LeadNurturing() {
  const [activePanel, setActivePanel] = useState<"message" | "segment" | null>(null);
  const [activeSegment, setActiveSegment] = useState("Hot");
  const [activeStep, setActiveStep] = useState({
    label: "Holding a spot",
    time: "+53 min",
    phase: "Phase 1 · Speed-to-Lead",
  });

  const phases = [
    {
      key: "p1",
      name: "Phase 1 · Speed-to-Lead",
      window: "0–24 hrs",
      color: "from-emerald-500/20 to-green-500/5",
      border: "border-emerald-200",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      steps: [
        { label: "Instant response", time: "0 min", status: "done" },
        { label: "Nudge", time: "+12 min", status: "done" },
        { label: "Holding a spot", time: "+53 min", status: "active" },
        { label: "Urgency", time: "+2.5 hrs", status: "queued" },
        { label: "Soft reset", time: "7:15 pm", status: "queued" },
      ],
    },
    {
      key: "p2",
      name: "Phase 2 · Close Window",
      window: "Day 2–3",
      color: "from-sky-500/20 to-cyan-500/5",
      border: "border-sky-200",
      badge: "bg-sky-50 text-sky-700 border-sky-200",
      steps: [
        { label: "Fresh start", time: "9:00 am", status: "queued" },
        { label: "Simple CTA", time: "1:30 pm", status: "queued" },
        { label: "Scarcity / last call", time: "6:00 pm", status: "queued" },
      ],
    },
    {
      key: "p3",
      name: "Phase 3 · High-Intent Follow-Up",
      window: "Day 4–7",
      color: "from-violet-500/20 to-fuchsia-500/5",
      border: "border-violet-200",
      badge: "bg-violet-50 text-violet-700 border-violet-200",
      steps: [
        { label: "Day 4 follow-up", time: "Day 4", status: "queued" },
        { label: "Day 6 follow-up", time: "Day 6", status: "queued" },
        { label: "Offer-based touch", time: "Day 7", status: "queued" },
      ],
    },
    {
      key: "p4",
      name: "Phase 4 · Reactivation",
      window: "Week 2–4",
      color: "from-amber-500/20 to-orange-500/5",
      border: "border-amber-200",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
      steps: [
        { label: "Still need help this week?", time: "Day 10", status: "queued" },
        { label: "Value-based reminder", time: "Day 14", status: "queued" },
        { label: "Social proof / reassurance", time: "Day 18", status: "queued" },
        { label: "Offer / limited opening", time: "Day 21", status: "queued" },
        { label: "Breakup text", time: "Day 30", status: "queued" },
      ],
    },
  ];

  const leads = [
    {
      name: "Sarah Mitchell",
      source: "Thumbtack",
      service: "Deep Clean",
      intent: "High intent",
      ai: "Running",
      phase: "Phase 1",
      phaseLabel: "Speed-to-Lead",
      step: "Holding a spot",
      nextAt: "in 34 min",
      owner: "AI",
      health: "Hot",
      reply: "Viewed quote · no reply",
      revenue: "$420",
      score: 92,
    },
    {
      name: "David Brooks",
      source: "Yelp",
      service: "Move-out",
      intent: "High intent",
      ai: "Running",
      phase: "Phase 2",
      phaseLabel: "Close Window",
      step: "Simple CTA",
      nextAt: "1:30 pm",
      owner: "AI",
      health: "Warm",
      reply: "Replied once · went quiet",
      revenue: "$560",
      score: 81,
    },
    {
      name: "Priya Shah",
      source: "Website",
      service: "Recurring",
      intent: "Medium intent",
      ai: "Waiting",
      phase: "Phase 3",
      phaseLabel: "High-Intent Follow-Up",
      step: "Day 6 follow-up",
      nextAt: "tomorrow",
      owner: "AI",
      health: "Warm",
      reply: "Asked about pricing",
      revenue: "$300/mo",
      score: 74,
    },
    {
      name: "Angela Reed",
      source: "Facebook Lead",
      service: "Standard Clean",
      intent: "Low response",
      ai: "Needs human",
      phase: "Phase 4",
      phaseLabel: "Reactivation",
      step: "Offer / limited opening",
      nextAt: "Day 21",
      owner: "CSR",
      health: "At risk",
      reply: "Negative timing friction",
      revenue: "$280",
      score: 49,
    },
    {
      name: "Marcus Green",
      source: "Google LSA",
      service: "One-time clean",
      intent: "Fresh lead",
      ai: "Queued",
      phase: "Phase 1",
      phaseLabel: "Speed-to-Lead",
      step: "Instant response",
      nextAt: "now",
      owner: "AI",
      health: "Hot",
      reply: "New submission",
      revenue: "$260",
      score: 95,
    },
    {
      name: "Emily Parker",
      source: "Referral",
      service: "Apartment clean",
      intent: "Price shopper",
      ai: "Running",
      phase: "Phase 4",
      phaseLabel: "Reactivation",
      step: "Breakup text",
      nextAt: "Day 30",
      owner: "AI",
      health: "Cooling",
      reply: "No response for 12 days",
      revenue: "$220",
      score: 38,
    },
  ];

  const queue = [
    { title: "Send AI message", count: 18, tone: "emerald" },
    { title: "Needs human takeover", count: 6, tone: "rose" },
    { title: "Offer eligible", count: 11, tone: "amber" },
    { title: "Booked from sequence", count: 9, tone: "sky" },
  ];

  const activity = [
    { time: "11:02 am", event: "AI sent 'holding a spot' to Sarah Mitchell", type: "ai" },
    { time: "10:47 am", event: "Marcus Green entered Phase 1 from Google LSA", type: "lead" },
    { time: "10:16 am", event: "Angela Reed flagged for human rescue after negative sentiment", type: "human" },
    { time: "9:58 am", event: "David Brooks advanced to Phase 2 after no reply on Day 1", type: "system" },
  ];

  const statusClass: Record<string, string> = {
    done: "bg-slate-900 text-white border-slate-900",
    active: "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-600/20",
    queued: "bg-white text-slate-700 border-slate-200",
  };

  const chipClass: Record<string, string> = {
    Hot: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Warm: "bg-amber-50 text-amber-700 border-amber-200",
    Cooling: "bg-slate-100 text-slate-700 border-slate-200",
    "At risk": "bg-rose-50 text-rose-700 border-rose-200",
  };

  const aiClass: Record<string, string> = {
    Running: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Queued: "bg-sky-50 text-sky-700 border-sky-200",
    Waiting: "bg-amber-50 text-amber-700 border-amber-200",
    "Needs human": "bg-rose-50 text-rose-700 border-rose-200",
  };

  const queueTone: Record<string, string> = {
    emerald: "from-emerald-500/15 to-emerald-500/5 border-emerald-200",
    rose: "from-rose-500/15 to-rose-500/5 border-rose-200",
    amber: "from-amber-500/15 to-amber-500/5 border-amber-200",
    sky: "from-sky-500/15 to-sky-500/5 border-sky-200",
  };

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <AdminHeader activeTab="lead-nurturing" />

      <div className="mx-auto max-w-[1600px] p-5 lg:p-6">
        <div className="rounded-[28px] border border-white/70 bg-white/80 shadow-[0_12px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="border-b border-slate-200/80 px-6 py-5 lg:px-7">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  AI Lead Nurturing Engine
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 lg:text-3xl">
                  Sequence Control Center
                </h1>
                <p className="mt-1 text-sm text-slate-600 lg:text-[15px]">
                  World-class visibility into every lead, every follow-up, and every handoff across the full 30-day SMS sequence.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-medium text-slate-500">Active leads in sequence</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight">146</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-medium text-slate-500">Booked from nurture</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight">23</div>
                </div>
                <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5">
                  New automation rule
                </button>
              </div>
            </div>
          </div>

          {/* ── Two-column body ──────────────────────────────────────────── */}
          <div className="grid gap-5 p-5 lg:grid-cols-[1.2fr_0.8fr] lg:p-6">
            {/* ── Left column ─────────────────────────────────────────── */}
            <div className="space-y-5">
              {/* KPI queue cards */}
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {queue.map((item) => (
                  <div
                    key={item.title}
                    className={`rounded-[24px] border bg-gradient-to-br p-4 shadow-sm ${queueTone[item.tone]}`}
                  >
                    <div className="text-sm font-medium text-slate-600">{item.title}</div>
                    <div className="mt-2 flex items-end justify-between">
                      <div className="text-3xl font-semibold tracking-tight text-slate-950">{item.count}</div>
                      <div className="rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        Live
                      </div>
                    </div>
                  </div>
                ))}
              </section>

              {/* Sequence map */}
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Sequence map</h2>
                    <p className="text-sm text-slate-500">See exactly where leads are, what fired, and what AI will send next.</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-medium">
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">146 active</div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">42 in Phase 1</div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">18 touching today</div>
                  </div>
                </div>

                {/* Segment lane buttons */}
                <div className="mb-5 grid gap-3 xl:grid-cols-4">
                  {[
                    { name: "Hot", sub: "Fast movers · high intent", count: 28, tone: "border-emerald-200 bg-emerald-50/70 text-emerald-700" },
                    { name: "Price Shopper", sub: "Sensitive to price framing", count: 31, tone: "border-amber-200 bg-amber-50/70 text-amber-700" },
                    { name: "Ghosted", sub: "No reply after early sequence", count: 22, tone: "border-slate-200 bg-slate-50 text-slate-700" },
                    { name: "Reactivation Gold", sub: "Older leads likely to revive", count: 19, tone: "border-violet-200 bg-violet-50/70 text-violet-700" },
                  ].map((lane) => (
                    <button
                      key={lane.name}
                      onClick={() => { setActiveSegment(lane.name); setActivePanel("segment"); }}
                      className={`rounded-[22px] border px-4 py-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm cursor-pointer active:scale-[0.98] ${lane.tone}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{lane.name}</div>
                          <div className="mt-1 text-xs opacity-80">{lane.sub}</div>
                        </div>
                        <div className="text-2xl font-semibold tracking-tight">{lane.count}</div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Phase cards */}
                <div className="grid gap-4 xl:grid-cols-2">
                  {phases.map((phase) => (
                    <div
                      key={phase.key}
                      className={`rounded-[24px] border bg-gradient-to-br p-4 ${phase.border} ${phase.color}`}
                    >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold tracking-tight text-slate-950">{phase.name}</div>
                          <div className="mt-1 text-sm text-slate-600">{phase.window}</div>
                        </div>
                        <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${phase.badge}`}>
                          {phase.steps.length} touches
                        </div>
                      </div>

                      <div className="space-y-3">
                        {phase.steps.map((step, idx) => (
                          <div key={idx} className="flex items-center gap-3">
                            <div className={`flex h-10 min-w-[92px] items-center justify-center rounded-2xl border text-xs font-semibold ${statusClass[step.status]}`}>
                              {step.time}
                            </div>
                            <button
                              onClick={() => {
                                setActiveStep({ label: step.label, time: step.time, phase: phase.name });
                                setActivePanel("message");
                              }}
                              className="flex-1 rounded-2xl border border-white/70 bg-white/85 px-4 py-3 text-left shadow-sm transition hover:border-slate-300 hover:bg-white cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-slate-800">{step.label}</div>
                                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                                  {step.status}
                                </div>
                              </div>
                              <div className="mt-1 text-xs text-slate-500">Click to inspect or edit the text for this outreach</div>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Lead progression table */}
              <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Lead progression table</h2>
                    <p className="text-sm text-slate-500">The operating view for AI status, next touch, ownership, and recovery.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">All leads</button>
                    <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">Needs human</button>
                    <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">Offer eligible</button>
                    <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">Booked</button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-[0.14em] text-slate-500">
                        <th className="px-5 py-3 font-semibold">Lead</th>
                        <th className="px-4 py-3 font-semibold">Current phase</th>
                        <th className="px-4 py-3 font-semibold">Current step</th>
                        <th className="px-4 py-3 font-semibold">Next touch</th>
                        <th className="px-4 py-3 font-semibold">AI</th>
                        <th className="px-4 py-3 font-semibold">Health</th>
                        <th className="px-4 py-3 font-semibold">Owner</th>
                        <th className="px-5 py-3 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((lead) => (
                        <tr key={lead.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                          <td className="px-5 py-4 align-top">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                                {lead.name.split(" ").map((v) => v[0]).join("")}
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{lead.name}</div>
                                <div className="mt-1 text-xs text-slate-500">{lead.source} · {lead.service}</div>
                                <div className="mt-2 text-xs text-slate-600">{lead.reply}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="text-sm font-medium text-slate-800">{lead.phase}</div>
                            <div className="mt-1 text-xs text-slate-500">{lead.phaseLabel}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="text-sm font-medium text-slate-800">{lead.step}</div>
                            <div className="mt-1 text-xs text-slate-500">Lead score {lead.score}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="text-sm font-semibold text-slate-900">{lead.nextAt}</div>
                            <div className="mt-1 text-xs text-slate-500">{lead.intent}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${aiClass[lead.ai]}`}>
                              {lead.ai}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${chipClass[lead.health]}`}>
                              {lead.health}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top text-sm text-slate-700">{lead.owner}</td>
                          <td className="px-5 py-4 align-top text-sm font-semibold text-slate-900">{lead.revenue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            {/* ── Right column ────────────────────────────────────────── */}
            <div className="space-y-5">
              {/* Selected lead panel */}
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Selected lead</h2>
                    <p className="text-sm text-slate-500">AI orchestration + manual takeover controls</p>
                  </div>
                  <button className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                    Open full thread
                  </button>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">SM</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">Sarah Mitchell</div>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          Hot lead
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">Thumbtack · Deep Clean · Submitted 58 minutes ago</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs font-medium text-slate-500">Current phase</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">Phase 1 · Speed-to-Lead</div>
                    </div>
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs font-medium text-slate-500">Next AI action</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">Urgency text in 34 min</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {/* Timeline */}
                  <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-900">Timeline</div>
                      <div className="text-xs text-slate-500">AI + human events</div>
                    </div>
                    <div className="space-y-3">
                      {[
                        { side: "left", tag: "Lead submitted", text: "Thumbtack request received for a deep clean in DC.", time: "10:21 am" },
                        { side: "right", tag: "AI sent", text: "Hi Sarah — thanks for reaching out. We can help. What day were you hoping for?", time: "10:21 am" },
                        { side: "right", tag: "AI sent", text: "Just checking in — I can still hold a team if you want me to.", time: "10:34 am" },
                        { side: "right", tag: "Queued", text: "Urgency touch scheduled: 'Afternoon is filling up — want me to reserve a spot?'", time: "12:02 pm" },
                      ].map((item, i) => (
                        <div key={i} className={`flex ${item.side === "right" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-2xl border p-3 ${item.side === "right" ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`}>
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              <span>{item.tag}</span>
                              <span>•</span>
                              <span>{item.time}</span>
                            </div>
                            <div className="mt-1 text-sm text-slate-800">{item.text}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Outreach detail */}
                  <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-900">Outreach detail (click any step above to load message)</div>
                      <div className="text-xs text-slate-500">Step template editor</div>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      {["Instant response", "Nudge", "Holding a spot", "Urgency", "Soft reset"].map((item, idx) => (
                        <button
                          key={item}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${idx === 2 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">AI context used</div>
                        <div className="mt-2 text-sm text-slate-700">Source: Thumbtack · Service: Deep clean · City: DC · Intent score: 92 · No reply after 2 prior touches</div>
                      </div>

                      <button
                        onClick={() => setActivePanel("message")}
                        className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Message text</div>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">Open editor →</span>
                        </div>
                        <div className="min-h-[140px] rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
                          Hey Sarah — just a heads up, our afternoon is filling up pretty quickly. If you still want help with the deep clean, I can hold a spot for you before it gets taken. Want me to reserve one?
                        </div>
                      </button>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Trigger</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">No reply after "holding a spot"</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Send time</div>
                          <div className="mt-2 text-sm font-medium text-slate-900">+2.5 hours from submission</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Next best actions */}
                  <div className="rounded-[22px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-slate-900">Next best actions</div>
                      <div className="text-xs text-slate-500">AI suggestions</div>
                    </div>
                    <div className="grid gap-2">
                      {[
                        "Let AI send urgency text",
                        "Switch to human and call now",
                        "Offer 10% close incentive",
                        "Pause sequence for 24 hrs",
                      ].map((action) => (
                        <button
                          key={action}
                          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-800 transition hover:border-slate-300 hover:bg-white"
                        >
                          <span>{action}</span>
                          <span className="text-slate-400">→</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Live activity */}
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Live activity</h2>
                    <p className="text-sm text-slate-500">Everything the system is doing right now</p>
                  </div>
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    AI online
                  </div>
                </div>
                <div className="space-y-3">
                  {activity.map((item) => (
                    <div key={item.event} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${item.type === "ai" ? "bg-emerald-500" : item.type === "human" ? "bg-rose-500" : item.type === "lead" ? "bg-sky-500" : "bg-slate-400"}`} />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-800">{item.event}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Automation logic */}
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold tracking-tight">Automation logic</h2>
                  <p className="text-sm text-slate-500">How the sequence thinks before it fires</p>
                </div>
                <div className="space-y-3">
                  {[
                    ["No reply after instant response", "Send Nudge at +12 min"],
                    ["Opened quote but silent", "Use 'holding a spot' framing"],
                    ["Positive signal + no booking", "Offer exact time CTA"],
                    ["Negative sentiment or objection", "Route to human rescue"],
                  ].map(([a, b]) => (
                    <div key={a} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Trigger</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{a}</div>
                      <div className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Action</div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{b}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {/* ── Slide-out panel overlay ──────────────────────────────────────── */}
      {activePanel && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm">
          {/* Backdrop click to close */}
          <button
            aria-label="Close panel overlay"
            onClick={() => setActivePanel(null)}
            className="absolute inset-0 cursor-default"
          />

          <aside className="relative h-full w-full max-w-[560px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
            {/* Sticky header */}
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-6 py-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    {activePanel === "message" ? "Message editor" : "Segment lane"}
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                    {activePanel === "message" ? activeStep.label : activeSegment}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {activePanel === "message"
                      ? `${activeStep.phase} · ${activeStep.time}`
                      : "Filter, inspect, and tune this lead segment."}
                  </p>
                </div>
                <button
                  onClick={() => setActivePanel(null)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            {activePanel === "message" ? (
              <div className="space-y-5 p-6">
                {/* Editable message */}
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Editable message</div>
                      <div className="text-xs text-slate-500">This is what AI will send for this outreach step.</div>
                    </div>
                    <button className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">Save changes</button>
                  </div>
                  <textarea
                    className="min-h-[170px] w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-slate-400"
                    defaultValue="Hey Sarah — just a heads up, our afternoon is filling up pretty quickly. If you still want help with the deep clean, I can hold a spot for you before it gets taken. Want me to reserve one?"
                  />
                </div>

                {/* Reply rate / booking rate */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[22px] border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Reply rate</div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight text-emerald-800">39%</div>
                    <div className="mt-1 text-xs text-emerald-700">+8% vs default message</div>
                  </div>
                  <div className="rounded-[22px] border border-sky-200 bg-sky-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-700">Booking rate</div>
                    <div className="mt-2 text-3xl font-semibold tracking-tight text-sky-800">14%</div>
                    <div className="mt-1 text-xs text-sky-700">From leads that reached this step</div>
                  </div>
                </div>

                {/* A/B variants */}
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">A/B variants</div>
                      <div className="text-xs text-slate-500">Test different angles without rebuilding the sequence.</div>
                    </div>
                    <button className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">Add variant</button>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["A · Urgency", "Afternoon spots are almost full — want me to hold one for you?", "Winning"],
                      ["B · Convenience", "We bring everything and can handle the whole clean in one visit. Want me to check times?", "Testing"],
                      ["C · Direct CTA", "Would 9am or 1pm work better if we can fit you in?", "Paused"],
                    ].map(([name, copy, status]) => (
                      <button key={name} className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-slate-300 hover:bg-white">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{name}</div>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">{status}</span>
                        </div>
                        <div className="mt-2 text-sm leading-5 text-slate-700">{copy}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Personalization tokens */}
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Personalization tokens</div>
                  <div className="flex flex-wrap gap-2">
                    {["{{first_name}}", "{{service}}", "{{city}}", "{{preferred_day}}", "{{quote_price}}", "{{open_slots}}", "{{source}}"].map((token) => (
                      <button key={token} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white">
                        {token}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trigger + guardrails */}
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Trigger + guardrails</div>
                  <div className="space-y-3">
                    {[
                      ["Trigger", "No reply after previous touch"],
                      ["Send timing", activeStep.time],
                      ["Do not send if", "Lead replied, booked, opted out, or human paused sequence"],
                      ["Escalate if", "Negative sentiment, pricing objection, or 3+ no-reply touches"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
                        <div className="mt-1 text-sm font-medium text-slate-900">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sticky footer */}
                <div className="sticky bottom-0 -mx-6 border-t border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10">Apply to all leads in this step</button>
                    <button className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Regenerate with AI</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5 p-6">
                {/* Segment summary */}
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">{activeSegment} segment</div>
                  <p className="mt-1 text-sm text-slate-600">This lane filters the control center to leads matching the segment behavior.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs text-slate-500">Leads</div>
                      <div className="mt-1 text-2xl font-semibold">28</div>
                    </div>
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs text-slate-500">Reply rate</div>
                      <div className="mt-1 text-2xl font-semibold">44%</div>
                    </div>
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs text-slate-500">Booked</div>
                      <div className="mt-1 text-2xl font-semibold">9</div>
                    </div>
                  </div>
                </div>

                {/* Segment logic */}
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Recommended segment logic</div>
                  <div className="space-y-3">
                    {[
                      ["Hot", "Fresh lead, high-value job, viewed quote, or replied positively"],
                      ["Price Shopper", "Asked about cost, discount, cheaper option, or comparison shopping"],
                      ["Ghosted", "No response after Day 1 or after 3+ SMS touches"],
                      ["Reactivation Gold", "Older lead with high job value or prior positive signal"],
                    ].map(([name, logic]) => (
                      <button
                        key={name}
                        onClick={() => setActiveSegment(name)}
                        className={`w-full rounded-2xl border p-3 text-left transition hover:border-slate-300 ${activeSegment === name ? "border-slate-900 bg-slate-950 text-white" : "border-slate-200 bg-slate-50 text-slate-800"}`}
                      >
                        <div className="text-sm font-semibold">{name}</div>
                        <div className={`mt-1 text-xs ${activeSegment === name ? "text-slate-300" : "text-slate-500"}`}>{logic}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10">Apply segment filter</button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
