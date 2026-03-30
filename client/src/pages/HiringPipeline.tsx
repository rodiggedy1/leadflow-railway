/**
 * HiringPipeline — Cleaner hiring pipeline UI
 * Pixel-perfect match to the provided design screenshots.
 * Data is static/mock for now; will be wired to backend in a future phase.
 */
import { useState } from "react";
import {
  User,
  MessageSquare,
  Phone,
  CheckCircle2,
  Search,
  ChevronRight,
  Car,
  Calendar,
  MapPin,
  Shield,
  Zap,
  Filter,
  XCircle,
  Clock,
  Star,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage =
  | "Application Submitted"
  | "AI Interview"
  | "Real Interview"
  | "Background Check"
  | "Paid Test Clean"
  | "Onboarding"
  | "Active";

interface Candidate {
  id: number;
  initials: string;
  name: string;
  subtitle: string;
  transport: "Car" | "No car" | "Transit";
  zip: string;
  stage: Stage;
  score: number;
  tag?: string;
  availability?: string;
  aiSummary?: string;
  scores?: {
    communication: number;
    reliability: number;
    quality: number;
    professionalism: number;
  };
  checklistStatus?: {
    applicationSubmitted: "done" | "pending" | "in-progress";
    aiInterviewStarted: "done" | "pending" | "in-progress";
    aiInterviewCompleted: "done" | "pending" | "in-progress";
    nudgeScheduled: "done" | "pending" | "in-progress";
  };
  notes?: string[];
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_CANDIDATES: Candidate[] = [
  {
    id: 1,
    initials: "TB",
    name: "Tiana Brooks",
    subtitle: "Application only",
    transport: "Car",
    zip: "20032",
    stage: "Application Submitted",
    score: 74,
    aiSummary: "Strong application with good attention to detail. No prior professional cleaning experience but eager to learn.",
    scores: { communication: 74, reliability: 68, quality: 70, professionalism: 72 },
    checklistStatus: { applicationSubmitted: "done", aiInterviewStarted: "pending", aiInterviewCompleted: "pending", nudgeScheduled: "pending" },
    notes: ["Applied via job board", "Available weekdays"],
  },
  {
    id: 2,
    initials: "KR",
    name: "Kevin Reed",
    subtitle: "No pro experience",
    transport: "No car",
    zip: "20003",
    stage: "AI Interview",
    score: 63,
    tag: "Needs review",
    availability: "Mon–Fri",
    aiSummary: "Friendly and coachable but low signal on reliability and independent transport.",
    scores: { communication: 71, reliability: 55, quality: 60, professionalism: 66 },
    checklistStatus: { applicationSubmitted: "done", aiInterviewStarted: "done", aiInterviewCompleted: "in-progress", nudgeScheduled: "done" },
    notes: ["Good attitude", "No car currently", "May work as backup / team placement"],
  },
  {
    id: 3,
    initials: "MS",
    name: "Maria Santos",
    subtitle: "3 years residential",
    transport: "Car",
    zip: "20011",
    stage: "Real Interview",
    score: 89,
    tag: "A Player",
    aiSummary: "Highly experienced residential cleaner. Strong references, reliable transport, excellent communication.",
    scores: { communication: 91, reliability: 88, quality: 90, professionalism: 87 },
    checklistStatus: { applicationSubmitted: "done", aiInterviewStarted: "done", aiInterviewCompleted: "done", nudgeScheduled: "done" },
    notes: ["3 years residential experience", "Strong references"],
  },
  {
    id: 4,
    initials: "JL",
    name: "Jasmine Lee",
    subtitle: "5 years contract cleaning",
    transport: "Car",
    zip: "20019",
    stage: "Background Check",
    score: 93,
    tag: "Fast-track",
    aiSummary: "Top-tier candidate. 5 years contract cleaning, own supplies, excellent availability.",
    scores: { communication: 95, reliability: 92, quality: 94, professionalism: 91 },
    checklistStatus: { applicationSubmitted: "done", aiInterviewStarted: "done", aiInterviewCompleted: "done", nudgeScheduled: "done" },
    notes: ["5 years contract cleaning", "Own supplies"],
  },
  {
    id: 5,
    initials: "AT",
    name: "Ashley Turner",
    subtitle: "1 year Airbnb turns",
    transport: "Car",
    zip: "22201",
    stage: "Paid Test Clean",
    score: 81,
    tag: "Ready for test clean",
    aiSummary: "Solid Airbnb turnaround experience. Punctual and detail-oriented.",
    scores: { communication: 82, reliability: 80, quality: 83, professionalism: 79 },
    checklistStatus: { applicationSubmitted: "done", aiInterviewStarted: "done", aiInterviewCompleted: "done", nudgeScheduled: "done" },
    notes: ["1 year Airbnb turns", "Punctual"],
  },
  {
    id: 6,
    initials: "DC",
    name: "David Cole",
    subtitle: "2 years move-out cleans",
    transport: "Car",
    zip: "22314",
    stage: "Onboarding",
    score: 86,
    tag: "Hire pending",
    aiSummary: "Experienced move-out specialist. Ready to onboard pending paperwork.",
    scores: { communication: 85, reliability: 87, quality: 88, professionalism: 84 },
    checklistStatus: { applicationSubmitted: "done", aiInterviewStarted: "done", aiInterviewCompleted: "done", nudgeScheduled: "done" },
    notes: ["2 years move-out cleans", "Paperwork in progress"],
  },
];

const STAGES: Stage[] = [
  "Application Submitted",
  "AI Interview",
  "Real Interview",
  "Background Check",
  "Paid Test Clean",
  "Onboarding",
  "Active",
];

// Badge color per stage — matches the screenshot's colored dots
const STAGE_BADGE: Record<Stage, { bg: string; text: string }> = {
  "Application Submitted": { bg: "#e0e7ff", text: "#4f46e5" },
  "AI Interview":          { bg: "#ede9fe", text: "#7c3aed" },
  "Real Interview":        { bg: "#dbeafe", text: "#2563eb" },
  "Background Check":      { bg: "#fef3c7", text: "#d97706" },
  "Paid Test Clean":       { bg: "#fee2e2", text: "#dc2626" },
  "Onboarding":            { bg: "#d1fae5", text: "#059669" },
  "Active":                { bg: "#dcfce7", text: "#16a34a" },
};

const AUTOMATIONS = [
  { icon: <MessageSquare className="w-4 h-4 text-purple-500" />, title: "AI interview nudge", desc: "15 min after apply if not started", status: "Live" },
  { icon: <Zap className="w-4 h-4 text-blue-500" />, title: "Fast-track interview link", desc: "Auto-send to A players over 80", status: "Live" },
  { icon: <Shield className="w-4 h-4 text-amber-500" />, title: "Background check request", desc: "Triggered after passing real interview", status: "Live" },
  { icon: <Star className="w-4 h-4 text-orange-400" />, title: "Paid test clean reminders", desc: "24h and 1h before scheduled clean", status: "Live" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Strong", color: "#059669" };
  if (score >= 60) return { label: "Watch", color: "#d97706" };
  return { label: "Flag", color: "#dc2626" };
}

function ChecklistIcon({ status }: { status: "done" | "pending" | "in-progress" }) {
  if (status === "done") return <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />;
  if (status === "in-progress") return <Clock className="w-5 h-5" style={{ color: "#f59e0b" }} />;
  return <CheckCircle2 className="w-5 h-5 text-gray-200" />;
}

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
      <div className="h-full rounded-full bg-gray-900" style={{ width: `${value}%` }} />
    </div>
  );
}

// ── Candidate Card (inside a stage column) ────────────────────────────────────

function CandidateCard({
  candidate,
  isSelected,
  onClick,
}: {
  candidate: Candidate;
  isSelected: boolean;
  onClick: () => void;
}) {
  const hasTransport = candidate.transport !== "No car";

  return (
    <div
      onClick={onClick}
      className="rounded-2xl border cursor-pointer transition-all p-4"
      style={{
        backgroundColor: "#ffffff",
        borderColor: isSelected ? "#0f172a" : "#e5e7eb",
        boxShadow: isSelected ? "0 0 0 1.5px #0f172a" : "none",
      }}
    >
      {/* Name row */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
          style={{ backgroundColor: "#e2e8f0", color: "#475569" }}
        >
          {candidate.initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-bold text-base text-gray-900 leading-tight">{candidate.name}</span>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 ml-1" />
          </div>
          <p className="text-sm text-gray-400 mt-0.5">{candidate.subtitle}</p>
        </div>
      </div>

      {/* Pills row */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {hasTransport && (
          <span
            className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border"
            style={{ borderColor: "#e5e7eb", color: "#374151", backgroundColor: "#f9fafb" }}
          >
            <Car className="w-3.5 h-3.5" />
            Car
          </span>
        )}
        <span
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border"
          style={{ borderColor: "#e5e7eb", color: "#374151", backgroundColor: "#f9fafb" }}
        >
          ZIP {candidate.zip}
        </span>
      </div>

      {/* Tag + Score row */}
      {(candidate.tag || candidate.score) && (
        <div className="flex items-center justify-between mt-3">
          {candidate.tag ? (
            <span className="text-sm text-gray-400">{candidate.tag}</span>
          ) : (
            <span />
          )}
          <span className="text-base font-bold text-gray-900">Score {candidate.score}</span>
        </div>
      )}
    </div>
  );
}

// ── Stage Card (the large rounded container) ──────────────────────────────────

function StageCard({
  stage,
  candidates,
  selectedId,
  onSelect,
}: {
  stage: Stage;
  candidates: Candidate[];
  selectedId: number | null;
  onSelect: (c: Candidate) => void;
}) {
  const badge = STAGE_BADGE[stage];

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: "#f8fafc", borderColor: "#e5e7eb" }}
    >
      {/* Stage header */}
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="font-bold text-base text-gray-900">{stage}</p>
          <p className="text-sm text-gray-400 mt-0.5">
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
          </p>
        </div>
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ backgroundColor: badge.bg, color: badge.text }}
        >
          {candidates.length}
        </span>
      </div>

      {/* Candidate cards */}
      <div className="mt-3 space-y-3">
        {candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-center text-sm text-gray-300" style={{ borderColor: "#e5e7eb" }}>
            No candidates here.
          </div>
        ) : (
          candidates.map(c => (
            <CandidateCard
              key={c.id}
              candidate={c}
              isSelected={selectedId === c.id}
              onClick={() => onSelect(c)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Candidate Detail Panel ────────────────────────────────────────────────────

function CandidateDetail({ candidate }: { candidate: Candidate | null }) {
  const [notes, setNotes] = useState(candidate?.notes ?? []);

  if (!candidate) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-sm">
        <User className="w-8 h-8 mb-2 opacity-30" />
        Click any candidate to inspect the workflow.
      </div>
    );
  }

  const cl = candidate.checklistStatus;
  const sc = candidate.scores;
  const badge = STAGE_BADGE[candidate.stage];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold shrink-0"
            style={{ backgroundColor: "#e2e8f0", color: "#475569" }}
          >
            {candidate.initials}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-bold text-gray-900">{candidate.name}</h3>
              <span
                className="px-2 py-0.5 rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: "#0f172a" }}
              >
                Score {candidate.score}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
              <span className="flex items-center gap-1">
                <Car className="w-3.5 h-3.5" />
                {candidate.transport}
              </span>
              {candidate.availability && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {candidate.availability}
                </span>
              )}
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                ZIP {candidate.zip}
              </span>
            </div>
          </div>
        </div>
        <span
          className="px-2.5 py-1 rounded-full text-xs font-semibold shrink-0"
          style={{ backgroundColor: badge.bg, color: badge.text }}
        >
          {candidate.stage}
        </span>
      </div>

      {/* AI Summary */}
      {candidate.aiSummary && (
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-1">AI summary</p>
          <p className="text-sm text-gray-600 leading-relaxed">{candidate.aiSummary}</p>
        </div>
      )}

      {/* Score grid */}
      {sc && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {[
            { label: "Communication", value: sc.communication },
            { label: "Reliability", value: sc.reliability },
            { label: "Quality", value: sc.quality },
            { label: "Professionalism", value: sc.professionalism },
          ].map(({ label, value }) => {
            const { label: lbl, color } = scoreLabel(value);
            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">{label}</span>
                  <span className="text-xs font-semibold" style={{ color }}>{lbl}</span>
                </div>
                <ScoreBar value={value} />
                <span className="text-xs text-gray-400">{value}/100</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pipeline checklist */}
      {cl && (
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-2">Pipeline checklist</p>
          <div className="space-y-0">
            {[
              { label: "Application submitted", status: cl.applicationSubmitted },
              { label: "AI interview started", status: cl.aiInterviewStarted },
              { label: "AI interview completed", status: cl.aiInterviewCompleted },
              { label: "Nudge scheduled", status: cl.nudgeScheduled },
            ].map(({ label, status }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-100">
                <span className="text-sm text-gray-700">{label}</span>
                <ChecklistIcon status={status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interviewer notes */}
      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Interviewer notes</p>
        <div className="space-y-2">
          {(notes.length > 0 ? notes : [""]).map((note, i) => (
            <input
              key={i}
              type="text"
              value={note}
              onChange={e => {
                const updated = [...notes];
                updated[i] = e.target.value;
                setNotes(updated);
              }}
              placeholder="Add a note…"
              className="w-full border-b border-gray-200 py-1.5 text-sm text-gray-700 bg-transparent outline-none focus:border-gray-400 transition-colors"
            />
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          className="col-span-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#0f172a" }}
        >
          Advance stage
        </button>
        <button
          className="col-span-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
          style={{ borderColor: "#e5e7eb", color: "#374151" }}
        >
          Send message
        </button>
        <button
          className="col-span-1 py-2.5 rounded-xl text-sm font-semibold border transition-colors hover:bg-gray-50"
          style={{ borderColor: "#e5e7eb", color: "#374151" }}
        >
          Book interview
        </button>
        <button
          className="col-span-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "#ef4444" }}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

const FILTER_TABS = [
  "All",
  "Application Submitted",
  "AI Interview",
  "Real Interview",
  "Background Check",
  "Paid Test Clean",
  "Onboarding",
  "Active",
] as const;
type FilterTab = (typeof FILTER_TABS)[number];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HiringPipeline() {
  const [filterTab, setFilterTab] = useState<FilterTab>("All");
  const [search, setSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(MOCK_CANDIDATES[1]);

  const filteredCandidates = MOCK_CANDIDATES.filter(c => {
    const matchesTab = filterTab === "All" || c.stage === filterTab;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.zip.includes(q) ||
      c.subtitle.toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  const visibleStages: Stage[] =
    filterTab === "All" ? STAGES : ([filterTab] as Stage[]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f8fafc", fontFamily: "Inter, sans-serif" }}>
      {/* ── Top header ── */}
      <div className="px-6 pt-8 pb-4" style={{ backgroundColor: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
        <div className="max-w-[1400px] mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border"
              style={{ borderColor: "#e5e7eb", color: "#6b7280", backgroundColor: "#f9fafb" }}
            >
              <Zap className="w-3 h-3" /> Hiring OS
            </span>
          </div>

          {/* Title row */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Cleaner hiring pipeline</h1>
              <p className="text-sm text-gray-500 mt-1 max-w-xl">
                A fast, filter-heavy flow for contractor hiring: application → AI interview → real interview → trust check →
                paid test clean → onboarding.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search candidates, zip, experience…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 rounded-xl border text-sm outline-none focus:ring-2 focus:ring-gray-200 transition-all"
                  style={{ borderColor: "#e5e7eb", width: 280, backgroundColor: "#f9fafb" }}
                />
              </div>
              <button
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#0f172a" }}
              >
                Re-engage drop-offs
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[
              { label: "Applications today", value: "38", sub: "+18% from yesterday", icon: <User className="w-5 h-5 text-gray-400" /> },
              { label: "AI interviews completed", value: "22", sub: "58% completion rate", icon: <MessageSquare className="w-5 h-5 text-gray-400" /> },
              { label: "Interviews in motion", value: "4", sub: "3 scheduled today", icon: <Phone className="w-5 h-5 text-gray-400" /> },
              { label: "Hires this week", value: "4", sub: "2 pending onboarding", icon: <CheckCircle2 className="w-5 h-5 text-gray-400" /> },
            ].map(({ label, value, sub, icon }) => (
              <div
                key={label}
                className="rounded-2xl border p-4"
                style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="text-3xl font-extrabold text-gray-900 mt-1">{value}</p>
                    <p className="text-xs text-gray-400 mt-1">{sub}</p>
                  </div>
                  <div className="mt-1">{icon}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Body: Pipeline board + Detail panel ── */}
      <div className="max-w-[1400px] mx-auto px-6 py-6 flex gap-6 items-start">

        {/* ── Pipeline board ── */}
        <div
          className="flex-1 rounded-2xl border p-6 min-w-0"
          style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
        >
          {/* Board header row */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-1">
            <div className="shrink-0">
              <h2 className="text-xl font-bold text-gray-900">Pipeline board</h2>
              <p className="text-sm text-gray-400 mt-0.5 max-w-[180px] leading-snug">
                Click any lane or candidate to inspect the workflow.
              </p>
            </div>

            {/* Filter pill tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-wrap">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap border transition-all"
                  style={
                    filterTab === tab
                      ? { backgroundColor: "#0f172a", color: "#ffffff", borderColor: "#0f172a" }
                      : { backgroundColor: "#ffffff", color: "#374151", borderColor: "#e5e7eb" }
                  }
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Scroll indicator bar */}
          <div className="mt-3 mb-5 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#f1f5f9" }}>
            <div className="h-full w-1/3 rounded-full" style={{ backgroundColor: "#cbd5e1" }} />
          </div>

          {/* 2-column grid of stage cards */}
          <div className="grid grid-cols-2 gap-4">
            {visibleStages.map(stage => (
              <StageCard
                key={stage}
                stage={stage}
                candidates={filteredCandidates.filter(c => c.stage === stage)}
                selectedId={selectedCandidate?.id ?? null}
                onSelect={c => setSelectedCandidate(c)}
              />
            ))}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="w-[340px] shrink-0 space-y-4">
          {/* Candidate detail */}
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
          >
            <div className="mb-3">
              <h2 className="text-lg font-bold text-gray-900">Candidate detail</h2>
              <p className="text-xs text-gray-400">Click around the board to switch profiles.</p>
            </div>
            <CandidateDetail candidate={selectedCandidate} />
          </div>

          {/* Automations */}
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-3">Automations</h2>
            <div className="space-y-3">
              {AUTOMATIONS.map(a => (
                <div key={a.title} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: "#f8fafc" }}
                  >
                    {a.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{a.title}</p>
                    <p className="text-xs text-gray-400 truncate">{a.desc}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-500 shrink-0">{a.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Decision rules */}
          <div
            className="rounded-2xl border p-5"
            style={{ backgroundColor: "#ffffff", borderColor: "#e5e7eb" }}
          >
            <h2 className="text-lg font-bold text-gray-900 mb-3">Decision rules</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#10b981" }} />
                <p className="text-sm text-gray-700">
                  <strong>80+ score:</strong> send interview booking instantly.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <Filter className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                <p className="text-sm text-gray-700">
                  <strong>60–79:</strong> hold for manager review or batch interview.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
                <p className="text-sm text-gray-700">
                  <strong>Below 60:</strong> reject or save as backup pool.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
