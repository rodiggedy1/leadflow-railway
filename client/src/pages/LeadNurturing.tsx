/**
 * LeadNurturing — Sequence Control Center
 * AI Lead Nurturing Engine — KPI cards and lead progression table wired to real tRPC data.
 * Sequence map, activity feed, and automation logic remain illustrative.
 */
import { useState, useMemo, useEffect } from "react";
import AdminHeader from "@/components/AdminHeader";
import { trpc } from "@/lib/trpc";

// ── Step metadata (mirrors nurtureSequence.ts NURTURE_STEPS) ─────────────────
const STEP_META: Record<number, { label: string; phase: 1 | 2 | 3 | 4 }> = {
  3:  { label: "Holding a spot",     phase: 1 },
  4:  { label: "Urgency",            phase: 1 },
  5:  { label: "Soft reset",         phase: 1 },
  6:  { label: "Fresh start",        phase: 2 },
  7:  { label: "Simple CTA",         phase: 2 },
  8:  { label: "Last call",          phase: 2 },
  9:  { label: "Value reminder",     phase: 2 },
  10: { label: "Circle back",        phase: 3 },
  11: { label: "Timing opener",      phase: 3 },
  12: { label: "First-time offer",   phase: 3 },
  13: { label: "Still need help?",   phase: 4 },
  14: { label: "Convenience reframe",phase: 4 },
  15: { label: "Trust signal",       phase: 4 },
  16: { label: "Schedule gap fill",  phase: 4 },
  17: { label: "Breakup text",       phase: 4 },
};

const PHASE_NAMES: Record<1 | 2 | 3 | 4, string> = {
  1: "Speed-to-Lead",
  2: "Close Window",
  3: "High-Intent Follow-Up",
  4: "Reactivation",
};

function getStepLabel(step: number): string {
  return STEP_META[step]?.label ?? `Step ${step}`;
}
function getPhaseNum(step: number): 1 | 2 | 3 | 4 {
  return STEP_META[step]?.phase ?? 1;
}
function getPhaseName(step: number): string {
  return PHASE_NAMES[getPhaseNum(step)];
}

function formatNextSendAt(date: Date | string | null): string {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return "overdue";
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffHr = Math.round(diffMs / 3600000);
  if (diffHr < 24) return `in ${diffHr}h`;
  const diffDays = Math.round(diffMs / 86400000);
  return `in ${diffDays}d`;
}

function formatSource(src: string | null): string {
  if (!src) return "Unknown";
  const map: Record<string, string> = {
    "bark-sms": "Bark",
    "thumbtack": "Thumbtack",
    "thumbtack-sms": "Thumbtack",
    "yelp-sms": "Yelp",
    "email": "Google Ads",
    "voice": "AI Voice",
    "form": "Quote Form",
    "manual": "Manual",
    "newsource": "New Source",
  };
  return map[src] ?? src;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

// ── Status filter type ────────────────────────────────────────────────────────
type StatusFilter = "active" | "paused" | "done" | "all";

export default function LeadNurturing() {
  const [activePanel, setActivePanel] = useState<"message" | "segment" | null>(null);
  const [activeSegment, setActiveSegment] = useState("Hot");
  const [activeStep, setActiveStep] = useState({
    label: "Holding a spot",
    time: "+53 min",
    phase: "Phase 1 · Speed-to-Lead",
    script: "I can hold a spot for you, but spots go fast. Want me to check what's open this week?",
    stepNum: 3,
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<number | null>(null);

  // ── Script editor state ─────────────────────────────────────────────────
  const [scriptText, setScriptText] = useState("");
  const utils = trpc.useUtils();

  // ── tRPC queries ─────────────────────────────────────────────────────────
  const { data: customScripts } = trpc.nurture.getScripts.useQuery(undefined, { staleTime: 60_000 });
  const saveScriptMutation = trpc.nurture.saveScript.useMutation({
    onSuccess: () => utils.nurture.getScripts.invalidate(),
  });
  const testSendMutation = trpc.nurture.testSend.useMutation();
  // Reset test send state when the active step changes
  useEffect(() => {
    testSendMutation.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep?.stepNum]);
  const pauseMutation = trpc.nurture.end.useMutation({
    onSuccess: () => utils.nurture.enrollments.invalidate(),
  });
  const resumeMutation = trpc.nurture.resume.useMutation({
    onSuccess: () => utils.nurture.enrollments.invalidate(),
  });
  const { data: stats, isLoading: statsLoading } = trpc.nurture.stats.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const { data: enrollmentsData, isLoading: enrollmentsLoading } = trpc.nurture.enrollments.useQuery(
    { status: statusFilter, limit: 50, offset: 0 },
    { refetchInterval: 30_000 }
  );

  const enrollments = enrollmentsData?.rows ?? [];
  const total = enrollmentsData?.total ?? 0;

  // Selected enrollment
  const selectedEnrollment = useMemo(
    () => enrollments.find((e) => e.id === selectedEnrollmentId) ?? null,
    [enrollments, selectedEnrollmentId]
  );

  // Session detail for timeline (only fetch when a lead is selected)
  const selectedSessionId = selectedEnrollment?.sessionId ?? null;
  const { data: sessionDetail } = trpc.nurture.sessionDetail.useQuery(
    { sessionId: selectedSessionId! },
    { enabled: selectedSessionId !== null, refetchInterval: 15_000 }
  );

  // ── Derived stats ─────────────────────────────────────────────────────────
  const activeCount = stats?.active ?? 0;
  const pausedCount = stats?.paused ?? 0;
  const doneCount = stats?.done ?? 0;
  const totalCount = stats?.total ?? 0;

  // Count how many active enrollments are in Phase 1 (steps 3-5)
  const phase1Count = enrollments.filter(
    (e) => e.status === "active" && getPhaseNum(e.nextStep) === 1
  ).length;

  // ── Static data (sequence map, activity, automation) ─────────────────────
  const phases = [
    {
      key: "p1",
      name: "Phase 1 · Speed-to-Lead",
      window: "0–24 hrs",
      color: "from-emerald-500/20 to-green-500/5",
      border: "border-emerald-200",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      steps: [
        { stepNum: 1, label: "Instant response", time: "0 min", status: "done", script: "Hey {{first_name}}, this is Madison from Maids in Black 👋 Just got your request for {{service}}. What day were you hoping to get this done?" },
        { stepNum: 2, label: "Nudge", time: "+12 min", status: "done", script: "Just checking — we may be able to help with {{service}} this week. Did you have a day in mind?" },
        { stepNum: 3, label: "Holding a spot", time: "+53 min", status: "active", script: "I can hold a spot for you, but spots go fast. Want me to check what's open this week?" },
        { stepNum: 4, label: "Urgency", time: "+2.5 hrs", status: "queued", script: "Heads up — openings this week are filling up fast. Want me to check what's left before they're gone?" },
        { stepNum: 5, label: "Soft reset", time: "7:15 pm", status: "queued", script: "No worries if today got busy — happens to everyone. I can check what's open tomorrow or later this week if that works better?" },
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
        { stepNum: 6, label: "Fresh start", time: "9:00 am", status: "queued", script: "Morning {{first_name}} — still need the cleaning done? I've got the schedule in front of me." },
        { stepNum: 7, label: "Simple CTA", time: "1:30 pm", status: "queued", script: "Would morning or evening work better if we can fit you in?" },
        { stepNum: 8, label: "Last call", time: "6:00 pm", status: "queued", script: "Last message for today — we're almost full this week. Want me to grab you one of the last spots?" },
        { stepNum: 9, label: "Value reminder", time: "Day 3", status: "queued", script: "Just so you know — we bring everything and handle the full home in one visit. No prep needed on your end. Want me to check times?" },
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
        { stepNum: 10, label: "Circle back", time: "Day 4", status: "queued", script: "Hey {{first_name}} — still looking to get the cleaning done, or did you already sort it out?" },
        { stepNum: 11, label: "Timing opener", time: "Day 6", status: "queued", script: "If timing was the issue, we still have a few spots open this week. Want me to check what works for you?" },
        { stepNum: 12, label: "First-time offer", time: "Day 7", status: "queued", script: "We had a couple openings come up — if you book this week I can take something off for a first-time clean. Want me to check times?" },
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
        { stepNum: 13, label: "Still need help?", time: "Day 10", status: "queued", script: "Hey {{first_name}}, still need help with the cleaning this week, or should I close this out for now?" },
        { stepNum: 14, label: "Convenience reframe", time: "Day 14", status: "queued", script: "Quick one — you don't have to be home, we bring everything, and the whole place gets done in one visit. Want me to check what's open?" },
        { stepNum: 15, label: "Trust signal", time: "Day 18", status: "queued", script: "Totally get it if you're still deciding — we're insured, background-checked, and our team cleans homes like yours every week. Want me to send a couple times?" },
        { stepNum: 16, label: "Schedule gap fill", time: "Day 21", status: "queued", script: "We had a few last-minute openings come up — if you still want the cleaning done, I can check if one of them works for you." },
        { stepNum: 17, label: "Breakup text", time: "Day 30", status: "queued", script: "Hey {{first_name}}, I'll close this out for now so I'm not bugging you. If you still need help with the cleaning later, just reply here and I'll check the schedule 👍" },
      ],
    },
  ];

  const activity = [
    { time: "Live", event: `${activeCount} leads actively in nurture sequence`, type: "system" },
    { time: "Live", event: `${pausedCount} leads paused (human takeover)`, type: "human" },
    { time: "All time", event: `${doneCount} leads completed or exited the sequence`, type: "ai" },
    { time: "Config", event: "SMS sends are DISABLED — kill switch active (NURTURE_SMS_ENABLED = false)", type: "system" },
  ];

  // ── Style maps ────────────────────────────────────────────────────────────
  const statusClass: Record<string, string> = {
    done: "bg-slate-900 text-white border-slate-900",
    active: "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-600/20",
    queued: "bg-white text-slate-700 border-slate-200",
  };

  const enrollmentStatusClass: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paused: "bg-amber-50 text-amber-700 border-amber-200",
    done: "bg-slate-100 text-slate-600 border-slate-200",
  };

  const queueTone: Record<string, string> = {
    emerald: "from-emerald-500/15 to-emerald-500/5 border-emerald-200",
    rose: "from-rose-500/15 to-rose-500/5 border-rose-200",
    amber: "from-amber-500/15 to-amber-500/5 border-amber-200",
    sky: "from-sky-500/15 to-sky-500/5 border-sky-200",
  };

  const filterTabs: { label: string; value: StatusFilter }[] = [
    { label: "Active", value: "active" },
    { label: "Paused", value: "paused" },
    { label: "Done", value: "done" },
    { label: "All", value: "all" },
  ];

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <AdminHeader activeTab="lead-nurturing" />

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:py-6">
        <div className="rounded-[28px] border border-white/70 bg-white/80 shadow-[0_12px_50px_rgba(15,23,42,0.08)] backdrop-blur">
          {/* ── Page header ─────────────────────────────────────────────── */}
          <div className="border-b border-slate-200/80 px-6 py-5 lg:px-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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
                  <div className="mt-1 text-2xl font-semibold tracking-tight">
                    {statsLoading ? <span className="text-slate-300">—</span> : activeCount}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="text-xs font-medium text-slate-500">Completed sequence</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight">
                    {statsLoading ? <span className="text-slate-300">—</span> : doneCount}
                  </div>
                </div>
                <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5">
                  New automation rule
                </button>
              </div>
            </div>
          </div>

          {/* ── Two-column body ──────────────────────────────────────────── */}
          <div className="grid gap-5 p-5 lg:grid-cols-[3fr_2fr] lg:p-6">
            {/* ── Left column ─────────────────────────────────────────── */}
            <div className="space-y-5">
              {/* KPI queue cards — wired to real stats */}
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  { title: "Active in sequence", count: activeCount, tone: "emerald" },
                  { title: "Paused (human takeover)", count: pausedCount, tone: "amber" },
                  { title: "Completed / exited", count: doneCount, tone: "sky" },
                  { title: "Total enrolled (all time)", count: totalCount, tone: "rose" },
                ].map((item) => (
                  <div
                    key={item.title}
                    className={`rounded-[24px] border bg-gradient-to-br p-4 shadow-sm ${queueTone[item.tone]}`}
                  >
                    <div className="text-sm font-medium text-slate-600">{item.title}</div>
                    <div className="mt-2 flex items-end justify-between">
                      <div className="text-3xl font-semibold tracking-tight text-slate-950">
                        {statsLoading ? <span className="text-slate-300">—</span> : item.count}
                      </div>
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
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">
                      {statsLoading ? "— active" : `${activeCount} active`}
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">
                      {enrollmentsLoading ? "— in Phase 1" : `${phase1Count} in Phase 1`}
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">
                      SMS disabled
                    </div>
                  </div>
                </div>

                {/* Segment lane buttons */}
                <div className="mb-5 grid gap-3 xl:grid-cols-4">
                  {[
                    { name: "Hot", sub: "Fast movers · high intent", count: "—", tone: "border-emerald-200 bg-emerald-50/70 text-emerald-700" },
                    { name: "Price Shopper", sub: "Sensitive to price framing", count: "—", tone: "border-amber-200 bg-amber-50/70 text-amber-700" },
                    { name: "Ghosted", sub: "No reply after early sequence", count: "—", tone: "border-slate-200 bg-slate-50 text-slate-700" },
                    { name: "Reactivation Gold", sub: "Older leads likely to revive", count: "—", tone: "border-violet-200 bg-violet-50/70 text-violet-700" },
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
                                const override = customScripts?.find((s) => s.step === step.stepNum);
                                const resolvedScript = override?.body ?? step.script ?? "";
                                setActiveStep({ label: step.label, time: step.time, phase: phase.name, script: resolvedScript, stepNum: step.stepNum });
                                setScriptText(resolvedScript);
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

              {/* Lead progression table — wired to real enrollments */}
              <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Lead progression table</h2>
                    <p className="text-sm text-slate-500">
                      {total > 0 ? `${total} enrollment${total !== 1 ? "s" : ""}` : "No enrollments"} · click a row to inspect
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {filterTabs.map((tab) => (
                      <button
                        key={tab.value}
                        onClick={() => { setStatusFilter(tab.value); setSelectedEnrollmentId(null); }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                          statusFilter === tab.value
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {tab.label}
                        {tab.value === "active" && stats ? ` (${stats.active})` : ""}
                        {tab.value === "paused" && stats ? ` (${stats.paused})` : ""}
                        {tab.value === "done" && stats ? ` (${stats.done})` : ""}
                        {tab.value === "all" && stats ? ` (${stats.total})` : ""}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  {enrollmentsLoading ? (
                    <div className="flex items-center justify-center py-12 text-sm text-slate-400">
                      Loading enrollments…
                    </div>
                  ) : enrollments.length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-sm text-slate-400">
                      No {statusFilter === "all" ? "" : statusFilter} enrollments found.
                    </div>
                  ) : (
                    <table className="min-w-full text-left">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase tracking-[0.14em] text-slate-500">
                          <th className="px-5 py-3 font-semibold">Lead</th>
                          <th className="px-4 py-3 font-semibold">Phase</th>
                          <th className="px-4 py-3 font-semibold">Current step</th>
                          <th className="px-4 py-3 font-semibold">Next touch</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Source</th>
                          <th className="px-5 py-3 font-semibold">Enrolled</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enrollments.map((enrollment) => {
                          const phaseNum = getPhaseNum(enrollment.nextStep);
                          const phaseName = getPhaseName(enrollment.nextStep);
                          const stepLabel = getStepLabel(enrollment.nextStep);
                          const isSelected = enrollment.id === selectedEnrollmentId;
                          const displayName = enrollment.sessionLeadName ?? enrollment.leadFirstName ?? "Unknown";
                          const initials = getInitials(displayName);
                          const enrolledDate = enrollment.enrolledAt
                            ? new Date(enrollment.enrolledAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : "—";

                          return (
                            <tr
                              key={enrollment.id}
                              onClick={() => setSelectedEnrollmentId(isSelected ? null : enrollment.id)}
                              className={`border-b border-slate-100 last:border-0 cursor-pointer transition ${
                                isSelected ? "bg-slate-100" : "hover:bg-slate-50/60"
                              }`}
                            >
                              <td className="px-5 py-4 align-top">
                                <div className="flex items-start gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                                    {initials}
                                  </div>
                                  <div>
                                    <div className="text-sm font-semibold text-slate-900">{displayName}</div>
                                    <div className="mt-1 text-xs text-slate-500">{enrollment.leadPhone}</div>
                                    {enrollment.serviceType && (
                                      <div className="mt-1 text-xs text-slate-400">{enrollment.serviceType}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-4 align-top">
                                <div className="text-sm font-medium text-slate-800">Phase {phaseNum}</div>
                                <div className="mt-1 text-xs text-slate-500">{phaseName}</div>
                              </td>
                              <td className="px-4 py-4 align-top">
                                <div className="text-sm font-medium text-slate-800">{stepLabel}</div>
                                <div className="mt-1 text-xs text-slate-500">Step {enrollment.nextStep} of 17</div>
                              </td>
                              <td className="px-4 py-4 align-top">
                                <div className={`text-sm font-semibold ${
                                  enrollment.status === "paused" ? "text-amber-600" : "text-slate-900"
                                }`}>
                                  {enrollment.status === "paused"
                                    ? "Paused"
                                    : enrollment.status === "done"
                                    ? enrollment.endReason ?? "done"
                                    : formatNextSendAt(enrollment.nextSendAt)}
                                </div>
                                {enrollment.lastStepSent != null && (
                                  <div className="mt-1 text-xs text-slate-500">
                                    Last: step {enrollment.lastStepSent}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-4 align-top">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${enrollmentStatusClass[enrollment.status] ?? ""}`}>
                                  {enrollment.status}
                                </span>
                              </td>
                              <td className="px-4 py-4 align-top text-sm text-slate-700">
                                {formatSource(enrollment.sessionSource)}
                              </td>
                              <td className="px-5 py-4 align-top text-sm text-slate-500">
                                {enrolledDate}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>
            </div>

            {/* ── Right column ────────────────────────────────────────── */}
            <div className="space-y-5 min-w-0 overflow-hidden">
              {/* Selected lead panel */}
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight">Selected lead</h2>
                    <p className="text-sm text-slate-500 whitespace-nowrap">AI orchestration + manual takeover controls</p>
                  </div>
                  <button className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
                    Open full thread
                  </button>
                </div>

                {selectedEnrollment ? (
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">
                        {getInitials(selectedEnrollment.sessionLeadName ?? selectedEnrollment.leadFirstName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {selectedEnrollment.sessionLeadName ?? selectedEnrollment.leadFirstName ?? "Unknown"}
                          </div>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${enrollmentStatusClass[selectedEnrollment.status]}`}>
                            {selectedEnrollment.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500 truncate">
                          {formatSource(selectedEnrollment.sessionSource)} · {selectedEnrollment.serviceType ?? "Unknown service"} · {selectedEnrollment.leadPhone}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white bg-white p-3">
                        <div className="text-xs font-medium text-slate-500">Current phase</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          Phase {getPhaseNum(selectedEnrollment.nextStep)} · {getPhaseName(selectedEnrollment.nextStep)}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white bg-white p-3">
                        <div className="text-xs font-medium text-slate-500">Next AI action</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedEnrollment.status === "paused"
                            ? "Paused — awaiting manual resume"
                            : selectedEnrollment.status === "done"
                            ? `Ended: ${selectedEnrollment.endReason ?? "done"}`
                            : `${getStepLabel(selectedEnrollment.nextStep)} ${formatNextSendAt(selectedEnrollment.nextSendAt)}`}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white bg-white p-3">
                        <div className="text-xs font-medium text-slate-500">Step</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {getStepLabel(selectedEnrollment.nextStep)} (step {selectedEnrollment.nextStep})
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white bg-white p-3">
                        <div className="text-xs font-medium text-slate-500">Enrolled</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {selectedEnrollment.enrolledAt
                            ? new Date(selectedEnrollment.enrolledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                            : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Next best actions */}
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Actions</div>
                      {selectedEnrollment.status === "paused" && (
                        <button
                          disabled={resumeMutation.isPending}
                          onClick={() => resumeMutation.mutate({ sessionId: selectedEnrollment.sessionId })}
                          className="flex w-full items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                        >
                          <span>{resumeMutation.isPending ? "Resuming..." : "Resume sequence (re-enroll)"}</span>
                          <span className="text-emerald-500">→</span>
                        </button>
                      )}
                      {selectedEnrollment.status === "active" && (
                        <button
                          disabled={pauseMutation.isPending}
                          onClick={() => pauseMutation.mutate({ enrollmentId: selectedEnrollment.id, reason: "manual" })}
                          className="flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
                        >
                          <span>{pauseMutation.isPending ? "Pausing..." : "Pause sequence (human takeover)"}</span>
                          <span className="text-amber-500">→</span>
                        </button>
                      )}
                      <button
                        disabled={pauseMutation.isPending}
                        onClick={() => pauseMutation.mutate({ enrollmentId: selectedEnrollment.id, reason: "manual" })}
                        className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-800 transition hover:border-slate-300 hover:bg-white disabled:opacity-50"
                      >
                        <span>End sequence manually</span>
                        <span className="text-slate-400">→</span>
                      </button>
                    </div>

                    {/* Timeline */}
                    <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-slate-900">Timeline</div>
                        <div className="text-xs text-slate-400">AI + human events</div>
                      </div>
                      <div className="space-y-2">
                        {sessionDetail?.createdAt && (
                          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                              Lead submitted
                              {" · "}
                              {new Date(sessionDetail.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            </div>
                            <div className="mt-1 text-sm text-slate-700">
                              {formatSource(sessionDetail.leadSource)} request received
                              {sessionDetail.serviceType ? " for " + sessionDetail.serviceType.toLowerCase() : ""}.
                            </div>
                          </div>
                        )}

                        {(sessionDetail?.messages ?? []).map((msg, i) => {
                          const isAI = msg.role === "assistant";
                          const isCustomer = msg.role === "user" || msg.role === "customer";
                          const isNurture = msg.source === "nurture";
                          if (!isAI && !isCustomer) return null;
                          const timeStr = msg.ts
                            ? new Date(msg.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                            : "";
                          const label = isNurture
                            ? ("Nurture step " + msg.nurtureStep)
                            : isAI
                            ? "AI sent"
                            : "Customer replied";
                          return (
                            <div
                              key={i}
                              className={
                                "rounded-2xl border px-3 py-2.5 " +
                                (isCustomer
                                  ? "border-slate-100 bg-slate-50"
                                  : isNurture
                                  ? "ml-4 border-violet-100 bg-violet-50/60"
                                  : "ml-4 border-sky-100 bg-sky-50/60")
                              }
                            >
                              <div
                                className={
                                  "text-[10px] font-semibold uppercase tracking-[0.12em] " +
                                  (isCustomer ? "text-slate-400" : isNurture ? "text-violet-500" : "text-sky-500")
                                }
                              >
                                {label}{timeStr ? " · " + timeStr : ""}
                              </div>
                              <div className="mt-1 text-sm text-slate-700 line-clamp-3">{msg.content}</div>
                            </div>
                          );
                        })}

                        {selectedEnrollment.status === "active" && (
                          <div className="ml-4 rounded-2xl border border-amber-100 bg-amber-50/60 px-3 py-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-500">
                              Queued
                              {selectedEnrollment.nextSendAt
                                ? " · " + new Date(selectedEnrollment.nextSendAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                : ""}
                            </div>
                            <div className="mt-1 text-sm text-slate-700">
                              {getStepLabel(selectedEnrollment.nextStep)} scheduled
                            </div>
                          </div>
                        )}

                        {!sessionDetail && (
                          <div className="py-4 text-center text-xs text-slate-400">Loading timeline...</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-6 text-center">
                    <div className="text-sm text-slate-500">Click any row in the lead table to inspect that enrollment here.</div>
                  </div>
                )}
              </section>

              {/* Live activity */}
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Live activity</h2>
                    <p className="text-sm text-slate-500">Everything the system is doing right now</p>
                  </div>
                  <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    SMS disabled
                  </div>
                </div>
                <div className="space-y-3">
                  {activity.map((item, i) => (
                    <div key={i} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
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
                    ["Lead books", "End sequence immediately"],
                    ["STOP / UNSUBSCRIBE keyword", "End sequence, record opt-out"],
                    ["Human takeover (aiMode=1)", "Pause sequence until manually resumed"],
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
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        disabled={testSendMutation.isPending}
                        onClick={() => {
                          testSendMutation.mutate({ step: activeStep.stepNum, body: scriptText || activeStep.script });
                        }}
                      >
                        {testSendMutation.isPending ? "Sending..." : testSendMutation.isSuccess ? "Sent ✓" : "Test send"}
                      </button>
                      <button
                        className="rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        disabled={saveScriptMutation.isPending}
                        onClick={() => {
                          if (activeStep.stepNum >= 3) {
                            saveScriptMutation.mutate({ step: activeStep.stepNum, body: scriptText || activeStep.script });
                          }
                        }}
                      >
                        {saveScriptMutation.isPending ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    key={activeStep.label}
                    className="min-h-[170px] w-full resize-none rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-slate-400"
                    value={scriptText || activeStep.script}
                    onChange={(e) => setScriptText(e.target.value)}
                  />
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

                {/* Personalization tokens */}
                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Personalization tokens</div>
                  <div className="flex flex-wrap gap-2">
                    {["{{first_name}}", "{{service}}", "{{preferred_day_or_this_week}}", "{{slot_1}}", "{{slot_2}}"].map((token) => (
                      <button key={token} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white">
                        {token}
                      </button>
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
                      <div className="mt-1 text-2xl font-semibold">—</div>
                    </div>
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs text-slate-500">Reply rate</div>
                      <div className="mt-1 text-2xl font-semibold">—</div>
                    </div>
                    <div className="rounded-2xl border border-white bg-white p-3">
                      <div className="text-xs text-slate-500">Booked</div>
                      <div className="mt-1 text-2xl font-semibold">—</div>
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
