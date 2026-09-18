import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleEllipsis,
  Clock3,
  Filter,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ConversationDrawer, type Session as LeadSession } from "./AgentDashboard";
import { InterviewRecordingCard, VideoInterviewCard } from "./HiringPipeline";
import "./hiring-admin-dashboard-review.css";
import "./hiring-admin-exact-live.css";

type HiringStage = "new" | "screening" | "interview" | "onboarding";
type PipelineTab = "all" | HiringStage | "active";

type Applicant = {
  id: number;
  initials: string;
  name: string;
  applied: string;
  location: string;
  services: string[];
  stage: string;
  column: HiringStage | null;
  experience?: string | null;
  score?: number | null;
  phone?: string | null;
  email?: string | null;
  streetAddress?: string | null;
  apt?: string | null;
  zip?: string | null;
  hasCleaning?: boolean | null;
  hasBankAccount?: boolean | null;
  isAuthorized?: boolean | null;
  consentBackground?: boolean | null;
  hasApplicationVideo?: boolean;
  hasInterviewVideo?: boolean;
  applicationVideoUrl?: string | null;
  interviewVideoUrl?: string | null;
  interviewCallId?: string | null;
};

type StageOverride = { column: HiringStage | null; stage: string };
type SmsPending = { id: number; name: string; stage: string; column: HiringStage | null };

const STAGES: Array<{ id: HiringStage; title: string; tone: "blue" | "amber" | "violet" | "green"; description: string; liveStage: string }> = [
  { id: "new", title: "New", tone: "blue", description: "Application submitted", liveStage: "Application Submitted" },
  { id: "screening", title: "Screening", tone: "amber", description: "Initial review", liveStage: "AI Interview" },
  { id: "interview", title: "Interview", tone: "violet", description: "Candidate conversation", liveStage: "Real Interview" },
  { id: "onboarding", title: "Onboarding", tone: "green", description: "Ready for activation", liveStage: "Background Check" },
];

const LIVE_STAGE_ORDER = [
  "Application Submitted",
  "AI Interview",
  "Real Interview",
  "Background Check",
  "Paid Test Clean",
  "Onboarding",
  "Active",
] as const;

const LIVE_COVERAGE_SERVICES = [
  [Sparkles, "Cleaning", ["Home cleaning", "Cleaning"], "covered"],
  [BriefcaseBusiness, "Lawn Care", ["Lawn & yard care", "Lawn Care"], "warning"],
  [UsersRound, "Junk Removal", ["Junk removal", "Junk Removal"], "danger"],
  [CalendarDays, "Moving Help", ["Moving help", "Moving Help"], "warning"],
  [UserRoundCheck, "Handyman", ["Handyman visit", "Handyman"], "warning"],
  [ShieldCheck, "Pressure Washing", ["Pressure washing", "Pressure Washing"], "danger"],
  [BriefcaseBusiness, "TV Mounting", ["TV mounting"], "warning"],
  [UserRoundCheck, "Furniture Assembly", ["Furniture assembly"], "danger"],
] as const;

function columnForStage(stage: string): HiringStage | null {
  if (stage === "Application Submitted") return "new";
  if (stage === "AI Interview") return "screening";
  if (stage === "Real Interview") return "interview";
  if (["Background Check", "Paid Test Clean", "Onboarding"].includes(stage)) return "onboarding";
  return null;
}

function relativeAppliedAt(value: number | undefined): string {
  if (!value) return "Applied recently";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)} minutes ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hours ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

function stageTone(stage: HiringStage) {
  return STAGES.find((item) => item.id === stage)?.tone ?? "blue";
}

function stageForColumn(column: HiringStage): string {
  return STAGES.find((stage) => stage.id === column)?.liveStage ?? "Application Submitted";
}

function canMoveBetween(from: HiringStage, to: HiringStage) {
  const fromIndex = STAGES.findIndex((stage) => stage.id === from);
  const toIndex = STAGES.findIndex((stage) => stage.id === to);
  return fromIndex >= 0 && toIndex >= 0 && Math.abs(fromIndex - toIndex) === 1;
}

function ApplicantCard({
  applicant,
  selected,
  dragEnabled,
  overlay = false,
  onSelect,
  onMove,
}: {
  applicant: Applicant;
  selected: boolean;
  dragEnabled: boolean;
  overlay?: boolean;
  onSelect: () => void;
  onMove: (stage: HiringStage) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `applicant:${applicant.id}`,
    data: { applicant },
    disabled: !dragEnabled || overlay || !applicant.column,
  });
  const moveTargets = applicant.column ? STAGES.filter((stage) => canMoveBetween(applicant.column!, stage.id)) : [];
  const videoCount = Number(Boolean(applicant.hasApplicationVideo)) + Number(Boolean(applicant.hasInterviewVideo));
  const tone = applicant.column ? stageTone(applicant.column) : "blue";

  return (
    <article
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      className={`hadr-applicant ${selected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""} ${overlay ? "is-overlay" : ""}`}
      style={overlay ? undefined : { transform: CSS.Translate.toString(transform) }}
    >
      <div className="hadr-applicant-head">
        <span className={`hadr-avatar hadr-avatar--${tone}`}>{applicant.initials}</span>
        <div><strong>{applicant.name}</strong><small>{applicant.applied}</small></div>
        {dragEnabled && moveTargets.length > 0 ? (
          <div className="hadr-card-menu" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" aria-label={`Move ${applicant.name}`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}><CircleEllipsis size={16} /></button>
            {menuOpen && <div className="hadr-card-menu-popover" role="menu">{moveTargets.map((stage) => <button type="button" key={stage.id} role="menuitem" onClick={() => { setMenuOpen(false); onMove(stage.id); }}>Move to {stage.title}</button>)}</div>}
          </div>
        ) : <MoreHorizontal size={16} />}
      </div>
      <p><MapPin size={12} />{applicant.location}</p>
      <div className="hadr-chip-row">
        {applicant.services.map((service) => <span key={service}>{service}</span>)}
        {videoCount > 0 && <span className="hadr-video-indicator" aria-label={`${videoCount} candidate video${videoCount === 1 ? "" : "s"}`}><Video size={12} />{videoCount}</span>}
      </div>
    </article>
  );
}

function PipelineColumn({
  stage,
  applicants,
  selectedId,
  activeStage,
  onSelect,
  onMove,
}: {
  stage: (typeof STAGES)[number];
  applicants: Applicant[];
  selectedId: number | null;
  activeStage: HiringStage | null;
  onSelect: (applicant: Applicant) => void;
  onMove: (applicant: Applicant, target: HiringStage) => void;
}) {
  const validTarget = !activeStage || canMoveBetween(activeStage, stage.id);
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}`, disabled: !validTarget });
  return (
    <section ref={setNodeRef} className={`hadr-column hadr-column--${stage.tone} ${isOver && validTarget ? "is-drop-target" : ""}`}>
      <header><span className="hadr-stage-dot" /><div><h3>{stage.title}</h3><small>{applicants.length} applicants</small></div></header>
      <p className="hadr-stage-description">{stage.description}</p>
      <div className="hadr-column-cards">{applicants.map((applicant) => <ApplicantCard key={applicant.id} applicant={applicant} selected={selectedId === applicant.id} dragEnabled onSelect={() => onSelect(applicant)} onMove={(target) => onMove(applicant, target)} />)}</div>
    </section>
  );
}

export default function HiringAdminExactLive() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<PipelineTab>("all");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState("Overview");
  const [activeApplicant, setActiveApplicant] = useState<Applicant | null>(null);
  const [stageOverrides, setStageOverrides] = useState<Record<number, StageOverride>>({});
  const [smsPending, setSmsPending] = useState<SmsPending | null>(null);
  const [drawerSession, setDrawerSession] = useState<LeadSession | null>(null);
  const justDraggedRef = useRef(false);
  const trpcUtils = trpc.useUtils();
  const candidatesQuery = trpc.hiring.getCandidates.useQuery(undefined, { staleTime: 0, refetchOnWindowFocus: true });
  const statsQuery = trpc.hiring.getPipelineStats.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  const updateStageMutation = trpc.hiring.updateStage.useMutation({ onSuccess: () => candidatesQuery.refetch() });
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const applicants = useMemo<Applicant[]>(() => ((candidatesQuery.data ?? []) as any[]).map((candidate) => {
    const stage = String(candidate.stage ?? "Application Submitted");
    const column = columnForStage(stage);
    const override = stageOverrides[candidate.id];
    return {
      id: candidate.id,
      initials: `${candidate.firstName?.[0] ?? "?"}${candidate.lastName?.[0] ?? "?"}`.toUpperCase(),
      name: `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim() || "Applicant",
      applied: relativeAppliedAt(candidate.createdAt),
      location: [candidate.city, candidate.state].filter(Boolean).join(", ") || "Location not provided",
      services: Array.isArray(candidate.specialties) ? candidate.specialties : [],
      stage: override?.stage ?? stage,
      column: override?.column ?? column,
      experience: candidate.experience ?? null,
      score: candidate.aiScore ?? null,
      phone: candidate.phone ?? null,
      email: candidate.email ?? null,
      streetAddress: candidate.streetAddress ?? null,
      apt: candidate.apt ?? null,
      zip: candidate.zip ?? null,
      hasCleaning: candidate.hasCleaning ?? null,
      hasBankAccount: candidate.hasBankAccount ?? null,
      isAuthorized: candidate.isAuthorized ?? null,
      consentBackground: candidate.consentBackground ?? null,
      hasApplicationVideo: Boolean(candidate.videoUrl),
      hasInterviewVideo: Boolean(candidate.interviewVideoUrl),
      applicationVideoUrl: candidate.videoUrl ?? null,
      interviewVideoUrl: candidate.interviewVideoUrl ?? null,
      interviewCallId: candidate.interviewCallId ?? null,
    };
  }), [candidatesQuery.data, stageOverrides]);

  const selectedServiceSpecialties = useMemo<readonly string[] | null>(() => {
    if (!selectedService) return null;
    return LIVE_COVERAGE_SERVICES.find(([, title]) => title === selectedService)?.[2] ?? null;
  }, [selectedService]);

  const filteredApplicants = useMemo(() => applicants.filter((applicant) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [applicant.name, applicant.location, ...applicant.services].join(" ").toLowerCase().includes(needle);
    const matchesService = !selectedServiceSpecialties || applicant.services.some((service) => selectedServiceSpecialties.includes(service));
    const matchesTab = tab === "all" || (tab === "active" ? applicant.stage === "Active" : applicant.column === tab);
    return matchesSearch && matchesService && matchesTab;
  }), [applicants, search, selectedServiceSpecialties, tab]);

  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedId) ?? null;
  const drawerApplicant = selectedApplicant && filteredApplicants.some((applicant) => applicant.id === selectedApplicant.id) ? selectedApplicant : null;
  const coverageServices = LIVE_COVERAGE_SERVICES.map(([Icon, title, specialties, tone]) => {
    const applicantCount = applicants.filter((applicant) => specialties.some((specialty) => applicant.services.includes(specialty))).length;
    return [Icon, title, `${applicantCount} applicant${applicantCount === 1 ? "" : "s"}`, "— active", "—", tone] as const;
  });
  const visibleCoverage = coverageExpanded ? coverageServices : coverageServices.slice(0, 6);
  const stats = statsQuery.data;
  const activeApplicantCount = applicants.filter((applicant) => applicant.stage === "Active").length;
  const metrics = [
    [UsersRound, String(stats?.totalApplications ?? applicants.length), "Total applicants", "slate"],
    [UsersRound, String(applicants.filter((applicant) => applicant.column === "new").length), "New applicants", "blue"],
    [UserRoundCheck, String(applicants.filter((applicant) => applicant.column === "screening").length), "In review", "amber"],
    [CalendarDays, String(applicants.filter((applicant) => applicant.column === "interview").length), "Interviews", "violet"],
    [ShieldCheck, String(applicants.filter((applicant) => applicant.column === "onboarding").length), "Onboarding", "green"],
    [UsersRound, String(activeApplicantCount), "Active providers", "emerald"],
  ] as const;

  const commitStageChange = (applicant: Applicant, targetStage: string, targetColumn: HiringStage | null, sendSmsNotification: boolean) => {
    setStageOverrides((overrides) => ({ ...overrides, [applicant.id]: { column: targetColumn, stage: targetStage } }));
    updateStageMutation.mutate({ id: applicant.id, stage: targetStage, sendSmsNotification }, {
      onError: () => setStageOverrides((overrides) => {
        const next = { ...overrides };
        delete next[applicant.id];
        return next;
      }),
      onSuccess: () => candidatesQuery.refetch(),
    });
  };

  const requestStageChange = (applicant: Applicant, targetStage: string, targetColumn: HiringStage | null) => {
    if (updateStageMutation.isPending || applicant.stage === targetStage) return;
    const notifiesBySms = ["Real Interview", "Background Check", "Paid Test Clean", "Onboarding"].includes(targetStage);
    if (notifiesBySms && applicant.phone) {
      setSmsPending({ id: applicant.id, name: applicant.name.split(" ")[0] || applicant.name, stage: targetStage, column: targetColumn });
      return;
    }
    commitStageChange(applicant, targetStage, targetColumn, false);
  };

  const requestColumnMove = (applicant: Applicant, target: HiringStage) => {
    if (updateStageMutation.isPending || !applicant.column || applicant.column === target || !canMoveBetween(applicant.column, target)) return;
    requestStageChange(applicant, stageForColumn(target), target);
  };

  const handleDragStart = (event: DragStartEvent) => setActiveApplicant((event.active.data.current?.applicant as Applicant | undefined) ?? null);
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveApplicant(null);
    justDraggedRef.current = true;
    window.setTimeout(() => { justDraggedRef.current = false; }, 180);
    const applicant = event.active.data.current?.applicant as Applicant | undefined;
    const target = String(event.over?.id ?? "").replace("stage:", "") as HiringStage;
    if (applicant && applicant.column && STAGES.some((stage) => stage.id === target) && canMoveBetween(applicant.column, target)) requestColumnMove(applicant, target);
  };

  const selectApplicant = (applicant: Applicant) => {
    if (justDraggedRef.current) return;
    setSelectedId(applicant.id);
    setDetailTab("Overview");
  };

  const handleAdvance = () => {
    if (!drawerApplicant) return;
    const index = LIVE_STAGE_ORDER.indexOf(drawerApplicant.stage as (typeof LIVE_STAGE_ORDER)[number]);
    const targetStage = LIVE_STAGE_ORDER[index + 1];
    if (!targetStage) return;
    requestStageChange(drawerApplicant, targetStage, columnForStage(targetStage));
  };

  const handleReject = () => {
    if (!drawerApplicant || !window.confirm(`Reject ${drawerApplicant.name}?`)) return;
    updateStageMutation.mutate({ id: drawerApplicant.id, stage: "Rejected", sendSmsNotification: true });
  };

  const handleMessage = async () => {
    if (!drawerApplicant?.phone) return;
    const { sessionId } = await trpcUtils.hiring.getSessionByPhone.fetch({ phone: drawerApplicant.phone }).catch(() => ({ sessionId: null }));
    if (sessionId) {
      const session = await trpcUtils.leads.getById.fetch({ id: sessionId }).catch(() => null);
      if (session) {
        setDrawerSession(session as unknown as LeadSession);
        return;
      }
    }
    const rawPhone = drawerApplicant.phone.replace(/[^\d]/g, "");
    const e164 = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
    setDrawerSession({ id: 0, leadPhone: e164, leadName: drawerApplicant.name, stage: "UNHANDLED", quotedPrice: null, serviceType: null, bedrooms: null, bathrooms: null, extras: null, selectedSlot: null, address: null, messageHistory: "[]", assignedAgentId: null, assignedAgentName: null, lastCalledAt: null, lastCalledByAgentName: null, isBooked: 0, bookedAt: null, bookedByAgentName: null, bookedAmount: null, internalNotes: null, aiMode: 0, barkQA: null, leadSource: null, createdAt: new Date(), updatedAt: new Date() } as unknown as LeadSession);
  };

  const progress = drawerApplicant ? [
    ["Application", "complete"],
    ["Identity verification", "future"],
    ["Background check", "future"],
    ["Interview", drawerApplicant.interviewCallId ? "complete" : drawerApplicant.stage === "AI Interview" ? "active" : "future"],
    ["Service verification", "future"],
    ["Onboarding", drawerApplicant.stage === "Active" ? "complete" : drawerApplicant.stage === "Onboarding" ? "active" : "future"],
  ] as const : [];

  return (
    <main className="hadr-page hadr-live-page">
      <header className="hadr-utility">
        <label className="hadr-search"><Search size={17} /><input aria-label="Search hiring applicants" placeholder="Search applicants…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
        <div><button type="button" onClick={() => window.location.assign("/apply")} className="hadr-add"><Plus size={16} /> Add applicant</button><button type="button" aria-label="Notifications" className="hadr-bell"><Bell size={18} /><i /></button><span className="hadr-owner">RG</span></div>
      </header>
      <div className="hadr-content">
        <section className="hadr-intro"><div><small>Hiring workspace · Live workspace</small><h1>Build your service network.</h1><p>Review candidate flow, coverage, and upcoming interview work in one place.</p></div><aside><Sparkles size={19} /><p>“A strong field team starts with a clear candidate path.”</p><small>— LeadFlow Hiring</small></aside></section>
        <p className="hadr-notice" role="status"><Sparkles size={13} />Live candidates use the existing hiring workflow.</p>
        <section className="hadr-kpis" aria-label="Hiring metrics">{metrics.map(([Icon, value, label, tone]) => <article key={label}><span className={`hadr-kpi-icon hadr-kpi-icon--${tone}`}><Icon size={19} /></span><div><strong>{value}</strong><small>{label}</small></div></article>)}</section>
        <section className="hadr-coverage hadr-surface" aria-labelledby="coverage-title"><header><div><span className="hadr-kicker">Network readiness</span><h2 id="coverage-title">Service coverage</h2><p>Coverage signals by service line</p></div><div className="hadr-coverage-actions"><button type="button" className="hadr-quiet-control">All locations <ChevronDown size={14} /></button><button type="button" className="hadr-quiet-control" onClick={() => setCoverageExpanded((expanded) => !expanded)}>{coverageExpanded ? "Show fewer" : `Show all (${coverageServices.length})`} <ChevronDown size={14} className={coverageExpanded ? "is-expanded" : ""} /></button><button type="button" className="hadr-quiet-control" aria-disabled="true"><Filter size={14} /> Manage targets</button></div></header><div className="hadr-coverage-grid">{visibleCoverage.map(([Icon, name, applicantsCount, active, status, tone]) => <button type="button" key={name} onClick={() => setSelectedService((value) => value === name ? null : name)} className={`hadr-coverage-card hadr-coverage-card--${tone} ${selectedService === name ? "is-selected" : ""}`}><span><Icon size={20} /></span><strong>{name}</strong><small>{applicantsCount} · {active}</small><em><i />{status}</em></button>)}</div></section>
        <section className="hadr-pipeline hadr-surface" aria-labelledby="pipeline-title"><header className="hadr-pipeline-head"><div><span className="hadr-kicker">Candidate flow</span><h2 id="pipeline-title">Applicant pipeline</h2></div><div className="hadr-pipeline-controls"><div className="hadr-tabs">{(["all", "new", "screening", "interview", "onboarding", "active"] as PipelineTab[]).map((item) => <button type="button" key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)} <span>({item === "all" ? filteredApplicants.length : item === "active" ? filteredApplicants.filter((applicant) => applicant.stage === "Active").length : filteredApplicants.filter((applicant) => applicant.column === item).length})</span></button>)}</div><button type="button" className="hadr-quiet-control" aria-disabled="true">Sort: Newest <ChevronDown size={14} /></button><button type="button" className="hadr-quiet-control" aria-disabled="true"><Filter size={14} /> Filters</button></div></header><DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveApplicant(null)}><div className="hadr-board">{STAGES.map((stage) => <PipelineColumn key={stage.id} stage={stage} applicants={filteredApplicants.filter((applicant) => applicant.column === stage.id)} selectedId={selectedId} activeStage={activeApplicant?.column ?? null} onSelect={selectApplicant} onMove={requestColumnMove} />)}</div><DragOverlay dropAnimation={null}>{activeApplicant ? <div className="hadr-drag-overlay"><ApplicantCard applicant={activeApplicant} selected={false} dragEnabled={false} overlay onSelect={() => {}} onMove={() => {}} /></div> : null}</DragOverlay></DndContext></section>
      </div>
      {drawerApplicant && <aside className="hadr-drawer" aria-label="Selected applicant details"><button type="button" aria-label="Close applicant detail" className="hadr-drawer-close" onClick={() => setSelectedId(null)}><X size={19} /></button><div className="hadr-drawer-profile"><span className={`hadr-avatar hadr-avatar--${drawerApplicant.column ? stageTone(drawerApplicant.column) : "blue"}`}>{drawerApplicant.initials}</span><div><h2>{drawerApplicant.name}</h2><p><MapPin size={13} />{drawerApplicant.location}</p><b><Sparkles size={12} />{drawerApplicant.score !== null && drawerApplicant.score !== undefined && drawerApplicant.score >= 80 ? "Strong applicant" : "Applicant"}{drawerApplicant.score !== null && drawerApplicant.score !== undefined ? ` · ${drawerApplicant.score}` : ""}</b></div></div><p className="hadr-applied">Applied {drawerApplicant.applied}</p><div className="hadr-drawer-tabs">{["Overview", "Application", "Notes", "Activity"].map((item) => <button type="button" key={item} className={detailTab === item ? "is-active" : ""} onClick={() => setDetailTab(item)}>{item}</button>)}</div>{detailTab === "Overview" && <><section><header><h3>Services applied for</h3><button type="button" aria-disabled="true">Edit</button></header><div className="hadr-detail-chips">{drawerApplicant.services.map((service) => <span key={service}>{service}</span>)}</div></section>{(drawerApplicant.applicationVideoUrl || drawerApplicant.interviewVideoUrl) && <section><h3>Candidate videos</h3><div className="hadr-live-video-list">{drawerApplicant.applicationVideoUrl && <VideoInterviewCard videoUrl={drawerApplicant.applicationVideoUrl} />}{drawerApplicant.interviewVideoUrl && <InterviewRecordingCard videoUrl={drawerApplicant.interviewVideoUrl} candidateId={drawerApplicant.id} />}</div></section>}<section><h3>Basic information</h3><dl><div><dt>Experience</dt><dd>{drawerApplicant.experience || "Not provided"}</dd></div><div><dt>Email</dt><dd>{drawerApplicant.email || "Not provided"}</dd></div><div><dt>Transportation</dt><dd>Not provided</dd></div><div><dt>Own equipment</dt><dd>Not provided</dd></div><div><dt>Weekends</dt><dd>Not provided</dd></div></dl></section><section><header><h3>Hiring progress</h3><a href={`/interview/${drawerApplicant.id}`} target="_blank" rel="noopener noreferrer">View details</a></header><ol className="hadr-stepper">{progress.map(([item, tone]) => <li key={item} className={tone === "complete" ? "is-complete" : tone === "active" ? "is-active" : ""}><span>{tone === "future" ? "" : <CheckCircle2 size={13} />}</span>{item}</li>)}</ol></section><section><header><h3>Team notes</h3><button type="button" aria-disabled="true">Add note</button></header><article className="hadr-empty-note"><span>—</span><div><strong>No saved notes</strong><small>Notes are not connected in this design.</small><p>No team note is displayed without a saved record.</p></div></article></section></>}{detailTab === "Application" && <section><h3>Application</h3><dl><div><dt>Email</dt><dd>{drawerApplicant.email || "Not provided"}</dd></div><div><dt>Address</dt><dd>{[drawerApplicant.streetAddress, drawerApplicant.apt, drawerApplicant.location, drawerApplicant.zip].filter(Boolean).join(", ") || "Not provided"}</dd></div><div><dt>Experience</dt><dd>{drawerApplicant.experience || "Not provided"}</dd></div><div><dt>Cleaning experience</dt><dd>{drawerApplicant.hasCleaning === null || drawerApplicant.hasCleaning === undefined ? "Not provided" : drawerApplicant.hasCleaning ? "Yes" : "No"}</dd></div><div><dt>Bank account</dt><dd>{drawerApplicant.hasBankAccount === null || drawerApplicant.hasBankAccount === undefined ? "Not provided" : drawerApplicant.hasBankAccount ? "Yes" : "No"}</dd></div><div><dt>Work authorized</dt><dd>{drawerApplicant.isAuthorized === null || drawerApplicant.isAuthorized === undefined ? "Not provided" : drawerApplicant.isAuthorized ? "Yes" : "No"}</dd></div><div><dt>Background consent</dt><dd>{drawerApplicant.consentBackground === null || drawerApplicant.consentBackground === undefined ? "Not provided" : drawerApplicant.consentBackground ? "Yes" : "No"}</dd></div></dl></section>}{detailTab === "Notes" && <section><h3>Team notes</h3><article className="hadr-empty-note"><span>—</span><div><strong>No saved notes</strong><small>Notes are not connected in this design.</small><p>No team note is displayed without a saved record.</p></div></article></section>}{detailTab === "Activity" && <section><h3>Activity</h3><article className="hadr-empty-note"><span>•</span><div><strong>Application submitted</strong><small>{drawerApplicant.applied}</small><p>Current stage: {drawerApplicant.stage}</p></div></article></section>}<footer><button type="button" className="hadr-primary-action" disabled={updateStageMutation.isPending || drawerApplicant.stage === "Active"} onClick={handleAdvance}>Advance <ArrowRight size={14} /></button><div><button type="button" onClick={handleMessage}><MessageSquare size={14} />Message</button><button type="button" disabled={updateStageMutation.isPending} onClick={handleReject}>Reject</button><button type="button" aria-label="More applicant actions" aria-disabled="true"><MoreHorizontal size={16} /></button></div></footer></aside>}
      {drawerSession && <ConversationDrawer session={drawerSession} onClose={() => setDrawerSession(null)} currentAgentId={0} />}
      {smsPending && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"><div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full mx-4"><div className="flex items-start gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0"><MessageSquare className="w-5 h-5 text-amber-600" /></div><div><h3 className="text-base font-bold text-slate-900">Send SMS to {smsPending.name}?</h3><p className="text-sm text-slate-500 mt-1">Notify them about moving to <span className="font-semibold text-slate-700">{smsPending.stage}</span>.</p></div></div><div className="flex gap-3"><button onClick={() => { const applicant = applicants.find((item) => item.id === smsPending.id); if (applicant) commitStageChange(applicant, smsPending.stage, smsPending.column, true); setSmsPending(null); }} className="flex-1 bg-[#E8735A] hover:bg-[#d4614a] text-white font-semibold text-sm rounded-xl py-2.5 transition-colors">Yes, send SMS</button><button onClick={() => { const applicant = applicants.find((item) => item.id === smsPending.id); if (applicant) commitStageChange(applicant, smsPending.stage, smsPending.column, false); setSmsPending(null); }} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl py-2.5 transition-colors">Skip</button><button onClick={() => setSmsPending(null)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel</button></div></div></div>}
    </main>
  );
}
