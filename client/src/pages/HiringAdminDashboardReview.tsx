import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import "./hiring-admin-dashboard-review.css";

type HiringStage = "new" | "screening" | "interview" | "onboarding" | "rejected";
type PipelineTab = "all" | "new" | "screening" | "interview" | "onboarding" | "active";

type Applicant = {
  id: number;
  initials: string;
  name: string;
  applied: string;
  location: string;
  services: string[];
  stage: HiringStage;
  experience: string;
  score: number;
  hasApplicationVideo?: boolean;
  hasInterviewVideo?: boolean;
};

const STAGES: Array<{ id: Exclude<HiringStage, "rejected">; title: string; tone: "blue" | "amber" | "violet" | "green"; description: string }> = [
  { id: "new", title: "New", tone: "blue", description: "Application submitted" },
  { id: "screening", title: "Screening", tone: "amber", description: "Initial review" },
  { id: "interview", title: "Interview", tone: "violet", description: "Candidate conversation" },
  { id: "onboarding", title: "Onboarding", tone: "green", description: "Ready for activation" },
];

const INITIAL_APPLICANTS: Applicant[] = [
  { id: 1, initials: "JD", name: "Jordan Davis", applied: "12 minutes ago", location: "Washington, DC", services: ["Cleaning", "Junk Removal", "+1"], stage: "new", experience: "4 years", score: 91, hasApplicationVideo: true },
  { id: 2, initials: "SM", name: "Sam Miles", applied: "2 hours ago", location: "Alexandria, VA", services: ["Lawn Care", "Pressure Washing"], stage: "new", experience: "3 years", score: 84 },
  { id: 3, initials: "TC", name: "Taylor Carter", applied: "4 hours ago", location: "Arlington, VA", services: ["Cleaning", "Moving Help"], stage: "new", experience: "5 years", score: 88 },
  { id: 4, initials: "AP", name: "Avery Price", applied: "6 hours ago", location: "Bethesda, MD", services: ["Cleaning", "Handyman"], stage: "new", experience: "2 years", score: 79 },
  { id: 5, initials: "MK", name: "Morgan Kim", applied: "1 day ago", location: "Silver Spring, MD", services: ["Cleaning", "Lawn Care"], stage: "screening", experience: "4 years", score: 87 },
  { id: 6, initials: "LS", name: "Logan Smith", applied: "1 day ago", location: "Washington, DC", services: ["Cleaning", "Junk Removal"], stage: "screening", experience: "6 years", score: 86, hasApplicationVideo: true },
  { id: 7, initials: "RB", name: "Riley Brown", applied: "2 days ago", location: "Hyattsville, MD", services: ["Moving Help", "Junk Removal"], stage: "screening", experience: "3 years", score: 82 },
  { id: 8, initials: "CW", name: "Casey Wilson", applied: "2 days ago", location: "Fairfax, VA", services: ["Lawn Care", "Pressure Washing"], stage: "screening", experience: "5 years", score: 89 },
  { id: 9, initials: "KW", name: "Kai Ward", applied: "Today 2:00 PM", location: "Washington, DC", services: ["Moving Help", "Junk Removal"], stage: "interview", experience: "5 years", score: 93, hasInterviewVideo: true },
  { id: 10, initials: "JA", name: "Jamie Allen", applied: "Today 3:30 PM", location: "Alexandria, VA", services: ["Cleaning", "Handyman"], stage: "interview", experience: "4 years", score: 90, hasApplicationVideo: true },
  { id: 11, initials: "DP", name: "Drew Park", applied: "Tomorrow 10:00 AM", location: "Rockville, MD", services: ["Lawn Care", "Pressure Washing"], stage: "interview", experience: "3 years", score: 85 },
  { id: 12, initials: "ET", name: "Emery Turner", applied: "Tomorrow 1:00 PM", location: "Bethesda, MD", services: ["Cleaning", "Junk Removal"], stage: "interview", experience: "6 years", score: 94, hasInterviewVideo: true },
  { id: 13, initials: "RP", name: "Reese Patel", applied: "1 day ago", location: "Washington, DC", services: ["Cleaning"], stage: "onboarding", experience: "7 years", score: 95 },
  { id: 14, initials: "JM", name: "Jordan Martinez", applied: "2 days ago", location: "Alexandria, VA", services: ["Lawn Care", "Junk Removal"], stage: "onboarding", experience: "5 years", score: 92 },
  { id: 15, initials: "AL", name: "Alex Lee", applied: "2 days ago", location: "Arlington, VA", services: ["Moving Help", "Handyman"], stage: "onboarding", experience: "4 years", score: 90 },
  { id: 16, initials: "NS", name: "Nico Scott", applied: "3 days ago", location: "Silver Spring, MD", services: ["Cleaning", "Pressure Washing"], stage: "onboarding", experience: "3 years", score: 86 },
];

const COVERAGE = [
  [Sparkles, "Cleaning", "61 applicants", "42 active", "Well covered", "covered"],
  [BriefcaseBusiness, "Lawn Care", "23 applicants", "11 active", "Need 4 more", "warning"],
  [UsersRound, "Junk Removal", "14 applicants", "6 active", "Need people", "danger"],
  [CalendarDays, "Moving Help", "18 applicants", "8 active", "Need 3 more", "warning"],
  [UserRoundCheck, "Handyman", "12 applicants", "5 active", "Need 2 more", "warning"],
  [ShieldCheck, "Pressure Washing", "9 applicants", "4 active", "Need people", "danger"],
  [BriefcaseBusiness, "TV Mounting", "8 applicants", "3 active", "Need 2 more", "warning"],
  [UserRoundCheck, "Furniture Assembly", "6 applicants", "2 active", "Need people", "danger"],
] as const;

function canMoveBetween(from: HiringStage, to: HiringStage) {
  const fromIndex = STAGES.findIndex((stage) => stage.id === from);
  const toIndex = STAGES.findIndex((stage) => stage.id === to);
  return fromIndex >= 0 && toIndex >= 0 && Math.abs(fromIndex - toIndex) === 1;
}

function stageTone(stage: HiringStage) {
  return STAGES.find((item) => item.id === stage)?.tone ?? "blue";
}

function ApplicantCard({ applicant, selected, dragEnabled, overlay = false, onSelect, onMove }: { applicant: Applicant; selected: boolean; dragEnabled: boolean; overlay?: boolean; onSelect: () => void; onMove: (stage: Exclude<HiringStage, "rejected">) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `applicant:${applicant.id}`, data: { applicant }, disabled: !dragEnabled || overlay });
  const moveTargets = STAGES.filter((stage) => canMoveBetween(applicant.stage, stage.id));
  const videoCount = Number(Boolean(applicant.hasApplicationVideo)) + Number(Boolean(applicant.hasInterviewVideo));

  return <article ref={setNodeRef} {...listeners} {...attributes} onClick={onSelect} className={`hadr-applicant ${selected ? "is-selected" : ""} ${isDragging ? "is-dragging" : ""} ${overlay ? "is-overlay" : ""}`} style={overlay ? undefined : { transform: CSS.Translate.toString(transform) }}>
    <div className="hadr-applicant-head"><span className={`hadr-avatar hadr-avatar--${stageTone(applicant.stage)}`}>{applicant.initials}</span><div><strong>{applicant.name}</strong><small>{applicant.applied}</small></div>{dragEnabled ? <div className="hadr-card-menu" onPointerDown={(event) => event.stopPropagation()}><button type="button" aria-label={`Move ${applicant.name}`} aria-expanded={menuOpen} onClick={(event) => { event.stopPropagation(); setMenuOpen((open) => !open); }}><CircleEllipsis size={16} /></button>{menuOpen && <div className="hadr-card-menu-popover" role="menu">{moveTargets.map((stage) => <button type="button" key={stage.id} role="menuitem" onClick={() => { setMenuOpen(false); onMove(stage.id); }}>Move to {stage.title}</button>)}</div>}</div> : <MoreHorizontal size={16} />}</div>
    <p><MapPin size={12} />{applicant.location}</p>
    <div className="hadr-chip-row">{applicant.services.map((service) => <span key={service}>{service}</span>)}{videoCount > 0 && <span className="hadr-video-indicator" aria-label={`${videoCount} static candidate video${videoCount === 1 ? "" : "s"}`}><Video size={12} />{videoCount}</span>}</div>
  </article>;
}

function PipelineColumn({ stage, applicants, selectedId, activeStage, onSelect, onMove }: { stage: (typeof STAGES)[number]; applicants: Applicant[]; selectedId: number | null; activeStage: HiringStage | null; onSelect: (applicant: Applicant) => void; onMove: (applicant: Applicant, target: Exclude<HiringStage, "rejected">) => void }) {
  const validTarget = !activeStage || canMoveBetween(activeStage, stage.id);
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}`, disabled: !validTarget });
  return <section ref={setNodeRef} className={`hadr-column hadr-column--${stage.tone} ${isOver && validTarget ? "is-drop-target" : ""}`}>
    <header><span className="hadr-stage-dot" /><div><h3>{stage.title}</h3><small>{applicants.length} applicants</small></div></header>
    <p className="hadr-stage-description">{stage.description}</p>
    <div className="hadr-column-cards">{applicants.map((applicant) => <ApplicantCard key={applicant.id} applicant={applicant} selected={selectedId === applicant.id} dragEnabled onSelect={() => onSelect(applicant)} onMove={(target) => onMove(applicant, target)} />)}</div>
  </section>;
}

export default function HiringAdminDashboardReview() {
  const [applicants, setApplicants] = useState(INITIAL_APPLICANTS);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<PipelineTab>("all");
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailTab, setDetailTab] = useState("Overview");
  const [activeApplicant, setActiveApplicant] = useState<Applicant | null>(null);
  const [notice, setNotice] = useState("Static review workspace · no hiring workflow is connected");
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }), useSensor(KeyboardSensor));

  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedId) ?? null;
  const filteredApplicants = useMemo(() => applicants.filter((applicant) => {
    if (applicant.stage === "rejected") return false;
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [applicant.name, applicant.location, ...applicant.services].join(" ").toLowerCase().includes(needle);
    const matchesService = !selectedService || applicant.services.includes(selectedService);
    const matchesTab = tab === "all" || tab === "active" ? tab === "all" : applicant.stage === tab;
    return matchesSearch && matchesService && matchesTab;
  }), [applicants, search, selectedService, tab]);
  const drawerApplicant = selectedApplicant && filteredApplicants.some((applicant) => applicant.id === selectedApplicant.id) ? selectedApplicant : null;
  const visibleCoverage = coverageExpanded ? COVERAGE : COVERAGE.slice(0, 6);
  const metrics = [
    [UsersRound, "126", "Total applicants", "slate"],
    [UsersRound, "42", "New applicants", "blue"],
    [UserRoundCheck, "34", "In review", "amber"],
    [CalendarDays, "12", "Interviews", "violet"],
    [ShieldCheck, "8", "Onboarding", "green"],
    [UsersRound, "94", "Active providers", "emerald"],
  ] as const;

  const moveApplicant = (id: number, target: Exclude<HiringStage, "rejected">) => {
    const applicant = applicants.find((item) => item.id === id);
    if (!applicant || !canMoveBetween(applicant.stage, target)) return;
    setApplicants((current) => current.map((item) => item.id === id ? { ...item, stage: target } : item));
    setNotice(`${applicant.name} moved locally to ${STAGES.find((stage) => stage.id === target)?.title}. No hiring record changed.`);
  };
  const selectApplicant = (applicant: Applicant) => { setSelectedId(applicant.id); setDetailTab("Overview"); };
  const advanceApplicant = () => {
    if (!selectedApplicant) return;
    const index = STAGES.findIndex((stage) => stage.id === selectedApplicant.stage);
    const target = STAGES[index + 1]?.id;
    if (target) moveApplicant(selectedApplicant.id, target);
    else setNotice(`${selectedApplicant.name} is already at the final displayed stage. No hiring record changed.`);
  };
  const rejectApplicant = () => {
    if (!selectedApplicant) return;
    setApplicants((current) => current.map((applicant) => applicant.id === selectedApplicant.id ? { ...applicant, stage: "rejected" } : applicant));
    setNotice(`${selectedApplicant.name} was removed from this static board only. No hiring decision was sent or saved.`);
  };
  const handleDragStart = (event: DragStartEvent) => setActiveApplicant((event.active.data.current?.applicant as Applicant | undefined) ?? null);
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveApplicant(null);
    const applicant = event.active.data.current?.applicant as Applicant | undefined;
    const target = String(event.over?.id ?? "").replace("stage:", "") as Exclude<HiringStage, "rejected">;
    if (applicant && STAGES.some((stage) => stage.id === target)) moveApplicant(applicant.id, target);
  };
  const progress = ["Application", "Identity verification", "Background check", "Interview", "Service verification", "Onboarding"];
  const selectedStageIndex = Math.max(0, STAGES.findIndex((stage) => stage.id === selectedApplicant?.stage));

  return <main className="hadr-page" data-review-only="true">
    <header className="hadr-utility"><label className="hadr-search"><Search size={17} /><input aria-label="Search static hiring applicants" placeholder="Search applicants…" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label><div><button type="button" onClick={() => setNotice("Static preview only — no applicant was added.")} className="hadr-add"><Plus size={16} /> Add applicant</button><button type="button" aria-label="Static notifications" className="hadr-bell"><Bell size={18} /><i /></button><span className="hadr-owner">RG</span></div></header>
    <div className="hadr-content">
      <section className="hadr-intro"><div><small>Hiring workspace · Static preview</small><h1>Build your service network.</h1><p>Review candidate flow, coverage, and upcoming interview work in one place.</p></div><aside><Sparkles size={19} /><p>“A strong field team starts with a clear candidate path.”</p><small>— LeadFlow Hiring</small></aside></section>
      <p className="hadr-notice" role="status"><Sparkles size={13} />{notice}</p>
      <section className="hadr-kpis" aria-label="Static hiring metrics">{metrics.map(([Icon, value, label, tone]) => <article key={label}><span className={`hadr-kpi-icon hadr-kpi-icon--${tone}`}><Icon size={19} /></span><div><strong>{value}</strong><small>{label}</small></div></article>)}</section>
      <section className="hadr-coverage hadr-surface" aria-labelledby="coverage-title"><header><div><span className="hadr-kicker">Network readiness</span><h2 id="coverage-title">Service coverage</h2><p>Coverage signals by service line</p></div><div className="hadr-coverage-actions"><button type="button" className="hadr-quiet-control">All locations <ChevronDown size={14} /></button><button type="button" className="hadr-quiet-control" onClick={() => setCoverageExpanded((expanded) => !expanded)}>{coverageExpanded ? "Show fewer" : `Show all (${COVERAGE.length})`} <ChevronDown size={14} className={coverageExpanded ? "is-expanded" : ""} /></button><button type="button" className="hadr-quiet-control" onClick={() => setNotice("Static preview only — service targets are not editable here.")}><Filter size={14} /> Manage targets</button></div></header><div className="hadr-coverage-grid">{visibleCoverage.map(([Icon, name, applicantsCount, active, status, tone]) => <button type="button" key={name} onClick={() => setSelectedService((value) => value === name ? null : name)} className={`hadr-coverage-card hadr-coverage-card--${tone} ${selectedService === name ? "is-selected" : ""}`}><span><Icon size={20} /></span><strong>{name}</strong><small>{applicantsCount} · {active}</small><em><i />{status}</em></button>)}</div></section>
      <section className="hadr-pipeline hadr-surface" aria-labelledby="pipeline-title"><header className="hadr-pipeline-head"><div><span className="hadr-kicker">Candidate flow</span><h2 id="pipeline-title">Applicant pipeline</h2></div><div className="hadr-pipeline-controls"><div className="hadr-tabs">{(["all", "new", "screening", "interview", "onboarding", "active"] as PipelineTab[]).map((item) => <button type="button" key={item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)} <span>({item === "all" ? filteredApplicants.length : item === "active" ? 0 : filteredApplicants.filter((applicant) => applicant.stage === item).length})</span></button>)}</div><button type="button" className="hadr-quiet-control">Sort: Newest <ChevronDown size={14} /></button><button type="button" className="hadr-quiet-control"><Filter size={14} /> Filters</button></div></header><DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveApplicant(null)}><div className="hadr-board">{STAGES.map((stage) => <PipelineColumn key={stage.id} stage={stage} applicants={filteredApplicants.filter((applicant) => applicant.stage === stage.id)} selectedId={selectedId} activeStage={activeApplicant?.stage ?? null} onSelect={selectApplicant} onMove={(applicant, target) => moveApplicant(applicant.id, target)} />)}</div><DragOverlay dropAnimation={null}>{activeApplicant ? <div className="hadr-drag-overlay"><ApplicantCard applicant={activeApplicant} selected={false} dragEnabled={false} overlay onSelect={() => {}} onMove={() => {}} /></div> : null}</DragOverlay></DndContext></section>
    </div>
    {drawerApplicant && <aside className="hadr-drawer" aria-label="Selected static applicant details"><button type="button" aria-label="Close static applicant detail" className="hadr-drawer-close" onClick={() => setSelectedId(null)}><X size={19} /></button><div className="hadr-drawer-profile"><span className={`hadr-avatar hadr-avatar--${stageTone(drawerApplicant.stage)}`}>{drawerApplicant.initials}</span><div><h2>{drawerApplicant.name}</h2><p><MapPin size={13} />{drawerApplicant.location}</p><b><Sparkles size={12} />Strong applicant · {drawerApplicant.score}</b></div></div><p className="hadr-applied">Applied {drawerApplicant.applied}</p><div className="hadr-drawer-tabs">{["Overview", "Application", "Notes", "Activity"].map((item) => <button type="button" key={item} className={detailTab === item ? "is-active" : ""} onClick={() => setDetailTab(item)}>{item}</button>)}</div>{detailTab === "Overview" && <><section><header><h3>Services applied for</h3><button type="button" onClick={() => setNotice("Static preview only — services were not changed.")}>Edit</button></header><div className="hadr-detail-chips">{drawerApplicant.services.map((service) => <span key={service}>{service}</span>)}</div></section>{(drawerApplicant.hasApplicationVideo || drawerApplicant.hasInterviewVideo) && <section><h3>Candidate videos</h3><div className="hadr-video-list">{drawerApplicant.hasApplicationVideo && <button type="button" onClick={() => setNotice("Static preview only — no applicant video is loaded.")}><Video size={15} /><span><strong>Application video</strong><small>Static availability indicator</small></span><ArrowRight size={14} /></button>}{drawerApplicant.hasInterviewVideo && <button type="button" onClick={() => setNotice("Static preview only — no interview recording is loaded.")}><Video size={15} /><span><strong>Interview recording</strong><small>Static availability indicator</small></span><ArrowRight size={14} /></button>}</div></section>}<section><h3>Basic information</h3><dl><div><dt>Experience</dt><dd>{drawerApplicant.experience}</dd></div><div><dt>Transportation</dt><dd>Yes</dd></div><div><dt>Own equipment</dt><dd>Yes</dd></div><div><dt>Service area</dt><dd>20 miles</dd></div><div><dt>Weekends</dt><dd>Yes</dd></div></dl></section><section><header><h3>Hiring progress</h3><button type="button" onClick={() => setNotice("Static preview only — no applicant detail route was opened.")}>View details</button></header><ol className="hadr-stepper">{progress.map((item, index) => <li key={item} className={index <= selectedStageIndex + 1 ? "is-complete" : index === selectedStageIndex + 2 ? "is-active" : ""}><span>{index <= selectedStageIndex + 1 ? <CheckCircle2 size={13} /> : ""}</span>{item}</li>)}</ol></section><section><header><h3>Team notes</h3><button type="button" onClick={() => setNotice("Static preview only — no note was saved.")}>Add note</button></header><article className="hadr-empty-note"><span>—</span><div><strong>No saved notes</strong><small>Notes are not connected in this design.</small><p>No team note is displayed without a saved record.</p></div></article></section></>}{detailTab === "Application" && <section><h3>Application</h3><dl><div><dt>Service area</dt><dd>{drawerApplicant.location}</dd></div><div><dt>Experience</dt><dd>{drawerApplicant.experience}</dd></div><div><dt>Cleaning experience</dt><dd>Yes</dd></div><div><dt>Bank account</dt><dd>Yes</dd></div><div><dt>Work authorized</dt><dd>Yes</dd></div><div><dt>Background consent</dt><dd>Yes</dd></div></dl></section>}{detailTab === "Notes" && <section><h3>Team notes</h3><article className="hadr-empty-note"><span>—</span><div><strong>No saved notes</strong><small>Notes are not connected in this design.</small><p>No team note is displayed without a saved record.</p></div></article></section>}{detailTab === "Activity" && <section><h3>Activity</h3><article className="hadr-empty-note"><span>•</span><div><strong>Application submitted</strong><small>{drawerApplicant.applied}</small><p>Current static stage: {STAGES.find((stage) => stage.id === drawerApplicant.stage)?.title}</p></div></article></section>}<footer><button type="button" className="hadr-primary-action" onClick={advanceApplicant}>Advance <ArrowRight size={14} /></button><div><button type="button" onClick={() => setNotice(`Static preview only — no message was sent to ${drawerApplicant.name}.`)}><MessageSquare size={14} />Message</button><button type="button" onClick={rejectApplicant}>Reject</button><button type="button" aria-label="More static applicant actions" onClick={() => setNotice("Static preview only — no additional action is available.")}><MoreHorizontal size={16} /></button></div></footer></aside>}
  </main>;
}
