import { useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleEllipsis,
  CircleUserRound,
  ClipboardCheck,
  Droplets,
  Filter,
  Hammer,
  House,
  Leaf,
  MapPin,
  Megaphone,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ConversationDrawer, type Session as LeadSession } from "./AgentDashboard";
import { InterviewRecordingCard, VideoInterviewCard } from "./HiringPipeline";
import "./hiring-admin-review.css";

const navItems = [
  [House, "Dashboard"],
  [CalendarDays, "Bookings"],
  [CircleUserRound, "Customers"],
  [UsersRound, "Teams"],
  [BriefcaseBusiness, "Services"],
  [Megaphone, "Marketing"],
  [UsersRound, "Hiring"],
  [Building2, "Reports"],
  [Settings, "Settings"],
] as const;

const metrics = [
  [UsersRound, "126", "Total applicants", "slate"],
  [UsersRound, "42", "New applicants", "blue"],
  [CircleUserRound, "34", "In review", "amber"],
  [ClipboardCheck, "12", "Interviews", "violet"],
  [ShieldCheck, "8", "Onboarding", "green"],
  [UsersRound, "94", "Active providers", "emerald"],
] as const;

const services = [
  [Sparkles, "Cleaning", "61 applicants", "42 active", "Well covered", "covered"],
  [Leaf, "Lawn Care", "23 applicants", "11 active", "Need 4 more", "warning"],
  [Trash2, "Junk Removal", "14 applicants", "6 active", "Need people", "danger"],
  [Package, "Moving Help", "18 applicants", "8 active", "Need 3 more", "warning"],
  [Hammer, "Handyman", "12 applicants", "5 active", "Need 2 more", "warning"],
  [Droplets, "Pressure Washing", "9 applicants", "4 active", "Need people", "danger"],
] as const;

const columns = [
  {
    title: "New",
    count: "42 applicants",
    tone: "new",
    applicants: [
      ["JD", "Jordan Davis", "12 minutes ago", "Washington, DC", ["Cleaning", "Junk Removal", "+1"]],
      ["SM", "Sam Miles", "2 hours ago", "Alexandria, VA", ["Lawn Care", "Pressure Washing"]],
      ["TC", "Taylor Carter", "4 hours ago", "Arlington, VA", ["Cleaning", "Moving Help"]],
      ["AP", "Avery Price", "6 hours ago", "Bethesda, MD", ["Cleaning", "Handyman"]],
    ],
  },
  {
    title: "Screening",
    count: "18 applicants",
    tone: "screening",
    applicants: [
      ["MK", "Morgan Kim", "1 day ago", "Silver Spring, MD", ["Cleaning", "Lawn Care"]],
      ["LS", "Logan Smith", "1 day ago", "Washington, DC", ["Cleaning", "Junk Removal"]],
      ["RB", "Riley Brown", "2 days ago", "Hyattsville, MD", ["Moving Help", "Junk Removal"]],
      ["CW", "Casey Wilson", "2 days ago", "Fairfax, VA", ["Lawn Care", "Pressure Washing"]],
    ],
  },
  {
    title: "Interview",
    count: "12 applicants",
    tone: "interview",
    applicants: [
      ["KW", "Kai Ward", "Today 2:00 PM", "Washington, DC", ["Moving Help", "Junk Removal"]],
      ["JA", "Jamie Allen", "Today 3:30 PM", "Alexandria, VA", ["Cleaning", "Handyman"]],
      ["DP", "Drew Park", "Tomorrow 10:00 AM", "Rockville, MD", ["Lawn Care", "Pressure Washing"]],
      ["ET", "Emery Turner", "Tomorrow 1:00 PM", "Bethesda, MD", ["Cleaning", "Junk Removal"]],
    ],
  },
  {
    title: "Onboarding",
    count: "8 applicants",
    tone: "onboarding",
    applicants: [
      ["RP", "Reese Patel", "1 day ago", "Washington, DC", ["Cleaning"]],
      ["JM", "Jordan Martinez", "2 days ago", "Alexandria, VA", ["Lawn Care", "Junk Removal"]],
      ["AL", "Alex Lee", "2 days ago", "Arlington, VA", ["Moving Help", "Handyman"]],
      ["NS", "Nico Scott", "3 days ago", "Silver Spring, MD", ["Cleaning", "Pressure Washing"]],
    ],
  },
] as const;

const detailServices = [
  [Sparkles, "Cleaning", "cleaning"],
  [Truck, "Junk Removal", "junk"],
  [Package, "Moving Help", "moving"],
] as const;

const detailFacts = [
  ["Experience", "4 years"],
  ["Transportation", "Yes"],
  ["Own equipment", "Yes"],
  ["Service area", "20 miles"],
  ["Weekends", "Yes"],
];

const progress = [
  ["Application", "complete"],
  ["Identity verification", "complete"],
  ["Background check", "complete"],
  ["Interview", "active"],
  ["Service verification", "future"],
  ["Onboarding", "future"],
] as const;

type ReviewColumn = "new" | "screening" | "interview" | "onboarding";
type ReviewTab = "all" | ReviewColumn | "active";

type ReviewApplicant = {
  id: number;
  initials: string;
  name: string;
  applied: string;
  location: string;
  tags: string[];
  column: ReviewColumn;
  stage: string;
  phone?: string | null;
  email?: string | null;
  experience?: string | null;
  score?: number | null;
  createdAt?: number;
  interviewCallId?: string | null;
  streetAddress?: string | null;
  apt?: string | null;
  zip?: string | null;
  hasCleaning?: boolean | null;
  hasBankAccount?: boolean | null;
  isAuthorized?: boolean | null;
  consentBackground?: boolean | null;
  videoUrl?: string | null;
  interviewVideoUrl?: string | null;
};

const LIVE_STAGE_ORDER = [
  "Application Submitted",
  "AI Interview",
  "Real Interview",
  "Background Check",
  "Paid Test Clean",
  "Onboarding",
  "Active",
] as const;

function reviewColumnForStage(stage: string): ReviewColumn | null {
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

function StaticControl({ children, dark = false, onClick, disabled = false }: { children: ReactNode; dark?: boolean; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled || !onClick} aria-disabled={disabled || !onClick} className={dark ? "hiring-review-control hiring-review-control--dark" : "hiring-review-control"}>{children}</button>;
}

export function HiringAdminWorkspace({ live = false }: { live?: boolean }) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ReviewTab>("all");
  const [selectedId, setSelectedId] = useState<number | null>(live ? null : 1);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [detailTab, setDetailTab] = useState("Overview");
  const [drawerSession, setDrawerSession] = useState<LeadSession | null>(null);
  const [smsPending, setSmsPending] = useState<{ id: number; name: string; stage: string } | null>(null);
  const candidatesQuery = trpc.hiring.getCandidates.useQuery(undefined, { enabled: live, staleTime: 0, refetchOnWindowFocus: true });
  const statsQuery = trpc.hiring.getPipelineStats.useQuery(undefined, { enabled: live, staleTime: 30_000, refetchOnWindowFocus: true });
  const updateStageMutation = trpc.hiring.updateStage.useMutation({ onSuccess: () => candidatesQuery.refetch() });
  const trpcUtils = trpc.useUtils();

  const liveApplicants = useMemo<ReviewApplicant[]>(() => {
    if (!live) return [];
    return ((candidatesQuery.data ?? []) as any[]).map((candidate) => {
      const stage = String(candidate.stage ?? "Application Submitted");
      const column = reviewColumnForStage(stage);
      return {
        id: candidate.id,
        initials: `${candidate.firstName?.[0] ?? "?"}${candidate.lastName?.[0] ?? "?"}`.toUpperCase(),
        name: `${candidate.firstName ?? ""} ${candidate.lastName ?? ""}`.trim() || "Applicant",
        applied: relativeAppliedAt(candidate.createdAt),
        location: [candidate.city, candidate.state].filter(Boolean).join(", ") || "Location not provided",
        tags: Array.isArray(candidate.specialties) ? candidate.specialties : [],
        column: column ?? "new",
        stage,
        phone: candidate.phone ?? null,
        email: candidate.email ?? null,
        experience: candidate.experience ?? null,
        score: candidate.aiScore ?? null,
        createdAt: candidate.createdAt,
        interviewCallId: candidate.interviewCallId ?? null,
        streetAddress: candidate.streetAddress ?? null,
        apt: candidate.apt ?? null,
        zip: candidate.zip ?? null,
        hasCleaning: candidate.hasCleaning ?? null,
        hasBankAccount: candidate.hasBankAccount ?? null,
        isAuthorized: candidate.isAuthorized ?? null,
        consentBackground: candidate.consentBackground ?? null,
        videoUrl: candidate.videoUrl ?? null,
        interviewVideoUrl: candidate.interviewVideoUrl ?? null,
      };
    });
  }, [candidatesQuery.data, live]);

  const staticApplicants = useMemo<ReviewApplicant[]>(() => columns.flatMap((column, columnIndex) => column.applicants.map(([initials, name, applied, location, tags], applicantIndex) => ({
    id: columnIndex * 10 + applicantIndex + 1,
    initials,
    name,
    applied,
    location,
    tags: [...tags],
    column: column.tone,
    stage: column.title,
  }))), []);

  const applicants = live ? liveApplicants : staticApplicants;
  const visibleApplicants = applicants.filter((applicant) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [applicant.name, applicant.location, ...applicant.tags].join(" ").toLowerCase().includes(query);
    const matchesTab = activeTab === "all" || (activeTab === "active" ? applicant.stage === "Active" : applicant.column === activeTab);
    return matchesSearch && matchesTab;
  });
  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedId) ?? (live ? applicants[0] : applicants.find((applicant) => applicant.name === "Jordan Davis"));
  const liveStats = statsQuery.data;
  const activeApplicantCount = liveApplicants.filter((applicant) => applicant.stage === "Active").length;
  const reviewMetrics = live ? [
    [UsersRound, String(liveStats?.totalApplications ?? applicants.length), "Total applicants", "slate"],
    [UsersRound, String(liveApplicants.filter((applicant) => applicant.column === "new").length), "New applicants", "blue"],
    [CircleUserRound, String(liveApplicants.filter((applicant) => applicant.column === "screening").length), "In review", "amber"],
    [ClipboardCheck, String(liveApplicants.filter((applicant) => applicant.column === "interview").length), "Interviews", "violet"],
    [ShieldCheck, String(liveApplicants.filter((applicant) => applicant.column === "onboarding").length), "Onboarding", "green"],
    [UsersRound, String(activeApplicantCount), "Active providers", "emerald"],
  ] as const : metrics;

  const coverageServices = live ? services.map(([Icon, title, _applicants, _active, _status, tone]) => {
    const normalized = title.toLowerCase();
    const applicantCount = liveApplicants.filter((applicant) => applicant.tags.some((tag) => tag.toLowerCase().includes(normalized === "lawn care" ? "lawn" : normalized === "moving help" ? "moving" : normalized === "pressure washing" ? "pressure" : normalized === "junk removal" ? "junk" : normalized))).length;
    return [Icon, title, `${applicantCount} applicant${applicantCount === 1 ? "" : "s"}`, "— active", "—", tone] as const;
  }) : services;

  const reviewColumns: Array<{ title: string; count: string; tone: ReviewColumn }> = [
    { title: "New", count: `${visibleApplicants.filter((applicant) => applicant.column === "new").length} applicants`, tone: "new" },
    { title: "Screening", count: `${visibleApplicants.filter((applicant) => applicant.column === "screening").length} applicants`, tone: "screening" },
    { title: "Interview", count: `${visibleApplicants.filter((applicant) => applicant.column === "interview").length} applicants`, tone: "interview" },
    { title: "Onboarding", count: `${visibleApplicants.filter((applicant) => applicant.column === "onboarding").length} applicants`, tone: "onboarding" },
  ];

  const handleMessage = async () => {
    if (!live || !selectedApplicant?.phone) return;
    const { sessionId } = await trpcUtils.hiring.getSessionByPhone.fetch({ phone: selectedApplicant.phone }).catch(() => ({ sessionId: null }));
    if (sessionId) {
      const session = await trpcUtils.leads.getById.fetch({ id: sessionId }).catch(() => null);
      if (session) {
        setDrawerSession(session as unknown as LeadSession);
        return;
      }
    }
    const rawPhone = selectedApplicant.phone.replace(/[^\d]/g, "");
    const e164 = rawPhone.length === 10 ? `+1${rawPhone}` : `+${rawPhone}`;
    setDrawerSession({ id: 0, leadPhone: e164, leadName: selectedApplicant.name, stage: "UNHANDLED", quotedPrice: null, serviceType: null, bedrooms: null, bathrooms: null, extras: null, selectedSlot: null, address: null, messageHistory: "[]", assignedAgentId: null, assignedAgentName: null, lastCalledAt: null, lastCalledByAgentName: null, isBooked: 0, bookedAt: null, bookedByAgentName: null, bookedAmount: null, internalNotes: null, aiMode: 0, barkQA: null, leadSource: null, createdAt: new Date(), updatedAt: new Date() } as unknown as LeadSession);
  };

  const handleAdvance = () => {
    if (!live || !selectedApplicant) return;
    const currentIndex = LIVE_STAGE_ORDER.indexOf(selectedApplicant.stage as (typeof LIVE_STAGE_ORDER)[number]);
    const nextStage = LIVE_STAGE_ORDER[currentIndex + 1];
    if (!nextStage) return;
    const smsStages = ["Real Interview", "Background Check", "Paid Test Clean", "Onboarding"];
    if (smsStages.includes(nextStage) && selectedApplicant.phone) {
      updateStageMutation.mutate({ id: selectedApplicant.id, stage: nextStage, sendSmsNotification: false });
      setSmsPending({ id: selectedApplicant.id, name: selectedApplicant.name.split(" ")[0] ?? selectedApplicant.name, stage: nextStage });
      return;
    }
    updateStageMutation.mutate({ id: selectedApplicant.id, stage: nextStage, sendSmsNotification: true });
  };

  const handleReject = () => {
    if (!live || !selectedApplicant || !window.confirm(`Reject ${selectedApplicant.name}?`)) return;
    updateStageMutation.mutate({ id: selectedApplicant.id, stage: "Rejected", sendSmsNotification: true });
  };

  const progressForSelected = selectedApplicant ? [
    ["Application", "complete"],
    ["Identity verification", "future"],
    ["Background check", "future"],
    ["Interview", selectedApplicant.interviewCallId ? "complete" : selectedApplicant.stage === "AI Interview" ? "active" : "future"],
    ["Service verification", "future"],
    ["Onboarding", selectedApplicant.stage === "Active" ? "complete" : selectedApplicant.stage === "Onboarding" ? "active" : "future"],
  ] as const : progress;

  return (
    <div className="hiring-admin-review">
      {!live && <div className="hiring-review-notice" role="note"><Sparkles size={14} /> Review-only concept · Static sample applicants · No hiring workflow is connected</div>}
      <aside className="hiring-review-sidebar">
        <div className="hiring-review-wordmark"><strong>Good Joe</strong><span>Consider it handled.</span></div>
        <nav aria-label="Hiring admin review navigation">
          {navItems.map(([Icon, label]) => <a href="#hiring-review" key={label} className={label === "Hiring" ? "is-active" : ""}><Icon size={18} />{label}</a>)}
        </nav>
        <div className="hiring-review-sidebar__user"><span>RG</span><div><strong>Rohan Gilkes</strong><small>Owner</small></div><ChevronDown size={15} /></div>
      </aside>

      <main className="hiring-review-workspace" id="hiring-review">
        <header className="hiring-review-header">
          <div><h1>Hiring</h1><p>Build your service network.</p></div>
          <div className="hiring-review-header__actions">
            <label className="hiring-review-search"><Search size={16} /><input aria-label="Search applicants" placeholder="Search applicants…" value={live ? search : undefined} onChange={live ? (event) => setSearch(event.target.value) : undefined} readOnly={!live} /></label>
            <StaticControl dark onClick={live ? () => { window.location.assign("/apply"); } : undefined}><Plus size={17} /> Add applicant</StaticControl>
            <button type="button" aria-disabled="true" className="hiring-review-icon-button"><Bell size={19} /><i /></button>
            <span className="hiring-review-avatar hiring-review-avatar--header">RG</span>
          </div>
        </header>

        <section className="hiring-review-kpis" aria-label="Illustrative hiring summary">
          {reviewMetrics.map(([Icon, value, label, tone]) => <article className="hiring-review-kpi" key={label}><span className={`hiring-review-kpi__icon hiring-review-kpi__icon--${tone}`}><Icon size={19} /></span><div><strong>{value}</strong><small>{label}</small></div></article>)}
        </section>

        <section className="hiring-review-coverage hiring-review-surface" aria-labelledby="coverage-title">
          <div className="hiring-review-section-heading"><h2 id="coverage-title">Service coverage</h2><div><span>View by:</span><StaticControl>All locations <ChevronDown size={15} /></StaticControl></div><StaticControl><Settings size={15} /> Manage targets</StaticControl></div>
          <div className="hiring-review-services">
            {coverageServices.map(([Icon, title, applicants, active, status, tone]) => <button type="button" aria-disabled="true" className="hiring-review-service" key={title}><span className={`hiring-review-service__icon hiring-review-service__icon--${tone}`}><Icon size={22} /></span><strong>{title}</strong><small>{applicants}</small><small>{active}</small><em className={`hiring-review-coverage-status hiring-review-coverage-status--${tone}`}><i />{status}</em></button>)}
          </div>
        </section>

        <section className="hiring-review-pipeline hiring-review-surface" aria-labelledby="pipeline-title">
          <div className="hiring-review-pipeline__toolbar">
            <div className="hiring-review-tabs">{([['all', 'All'], ['new', 'New'], ['screening', 'Screening'], ['interview', 'Interview'], ['onboarding', 'Onboarding'], ['active', 'Active']] as const).map(([value, label]) => <button className={activeTab === value ? "is-active" : ""} type="button" aria-disabled={!live} onClick={live ? () => setActiveTab(value) : undefined} key={value}>{label} <span>({value === "all" ? applicants.length : value === "active" ? activeApplicantCount : applicants.filter((applicant) => applicant.column === value).length})</span></button>)}</div>
            <div className="hiring-review-pipeline__filters"><StaticControl>Sort: Newest <ChevronDown size={14} /></StaticControl><StaticControl><Filter size={15} /> Filters</StaticControl></div>
          </div>
          <h2 id="pipeline-title" className="sr-only">Applicant pipeline</h2>
          <div className="hiring-review-kanban">
            {reviewColumns.map((column) => <section className={`hiring-review-column hiring-review-column--${column.tone}`} key={column.title}><header><span className="hiring-review-column__dot" /><div><h3>{column.title}</h3><small>{column.count}</small></div></header><div className="hiring-review-column__cards">{visibleApplicants.filter((applicant) => applicant.column === column.tone).map((applicant) => <article onClick={live ? () => { setSelectedId(applicant.id); setDrawerOpen(true); setDetailTab("Overview"); } : undefined} className={`hiring-review-applicant-card ${selectedApplicant?.id === applicant.id && drawerOpen ? "is-selected" : ""}`} key={applicant.id}><div className="hiring-review-applicant-card__top"><span className={`hiring-review-avatar hiring-review-avatar--${column.tone}`}>{applicant.initials}</span><div><strong>{applicant.name}</strong><small>{applicant.applied}</small></div><CircleEllipsis size={17} /></div><p><MapPin size={12} />{applicant.location}</p><div className="hiring-review-chip-row">{applicant.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></article>)}</div></section>)}
          </div>
        </section>
      </main>

      {drawerOpen && selectedApplicant && <aside className="hiring-review-drawer" aria-label="Selected applicant details">
        <button type="button" onClick={live ? () => setDrawerOpen(false) : undefined} aria-disabled={!live} className="hiring-review-drawer__close"><X size={20} /></button>
        <div className="hiring-review-drawer__profile"><span className="hiring-review-avatar hiring-review-avatar--selected">{selectedApplicant.initials}</span><div><h2>{selectedApplicant.name}</h2><p><MapPin size={14} />{selectedApplicant.location}</p><span className="hiring-review-strong"><Sparkles size={12} /> {selectedApplicant.score !== null && selectedApplicant.score !== undefined && selectedApplicant.score >= 80 ? "Strong applicant" : "Applicant"}</span></div></div>
        <p className="hiring-review-drawer__applied">Applied {selectedApplicant.applied}</p>
        <div className="hiring-review-drawer__tabs">{["Overview", "Application", "Notes", "Activity"].map((tab) => <button className={detailTab === tab ? "is-active" : ""} type="button" onClick={live ? () => setDetailTab(tab) : undefined} aria-disabled={!live} key={tab}>{tab}</button>)}</div>
        {detailTab === "Overview" && <>
          <section className="hiring-review-drawer__section"><div className="hiring-review-drawer__section-head"><h3>Services applied for</h3><StaticControl>Edit</StaticControl></div><div className="hiring-review-detail-services">{selectedApplicant.tags.map((title, index) => { const [Icon, , tone] = detailServices[index % detailServices.length]; return <span className={`hiring-review-detail-chip hiring-review-detail-chip--${tone}`} key={title}><Icon size={14} />{title}</span>; })}</div></section>
          {(selectedApplicant.videoUrl || selectedApplicant.interviewVideoUrl) && <section className="hiring-review-drawer__section"><h3>Candidate videos</h3><div className="mt-3 grid gap-3">{selectedApplicant.videoUrl && <VideoInterviewCard videoUrl={selectedApplicant.videoUrl} />}{selectedApplicant.interviewVideoUrl && <InterviewRecordingCard videoUrl={selectedApplicant.interviewVideoUrl} candidateId={selectedApplicant.id} />}</div></section>}
          <section className="hiring-review-drawer__section"><h3>Basic information</h3><dl className="hiring-review-facts">{(live ? [["Experience", selectedApplicant.experience || "Not provided"], ["Email", selectedApplicant.email || "Not provided"], ["Transportation", "Not provided"], ["Own equipment", "Not provided"], ["Weekends", "Not provided"]] : detailFacts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>
          <section className="hiring-review-drawer__section"><div className="hiring-review-drawer__section-head"><h3>Hiring progress</h3><a href={live ? `/interview/${selectedApplicant.id}` : "#hiring-review"} target={live ? "_blank" : undefined} rel={live ? "noopener noreferrer" : undefined}>View details</a></div><ol className="hiring-review-stepper">{progressForSelected.map(([label, tone]) => <li className={`hiring-review-stepper__item hiring-review-stepper__item--${tone}`} key={label}><span>{tone === "future" ? "" : <CircleCheck size={14} />}</span><p>{label}</p></li>)}</ol></section>
          <section className="hiring-review-drawer__section"><div className="hiring-review-drawer__section-head"><h3>Team notes</h3><StaticControl>Add note</StaticControl></div><article className="hiring-review-note"><span className="hiring-review-avatar hiring-review-avatar--note">—</span><div><header><strong>No saved notes</strong><small>Notes are not connected in this design yet.</small></header><p>No team note is displayed without a saved record.</p></div></article></section>
        </>}
        {detailTab === "Application" && <section className="hiring-review-drawer__section"><h3>Application</h3><dl className="hiring-review-facts"><div><dt>Email</dt><dd>{selectedApplicant.email || "Not provided"}</dd></div><div><dt>Address</dt><dd>{[selectedApplicant.streetAddress, selectedApplicant.apt, selectedApplicant.location, selectedApplicant.zip].filter(Boolean).join(", ") || "Not provided"}</dd></div><div><dt>Experience</dt><dd>{selectedApplicant.experience || "Not provided"}</dd></div><div><dt>Cleaning experience</dt><dd>{selectedApplicant.hasCleaning === null || selectedApplicant.hasCleaning === undefined ? "Not provided" : selectedApplicant.hasCleaning ? "Yes" : "No"}</dd></div><div><dt>Bank account</dt><dd>{selectedApplicant.hasBankAccount === null || selectedApplicant.hasBankAccount === undefined ? "Not provided" : selectedApplicant.hasBankAccount ? "Yes" : "No"}</dd></div><div><dt>Work authorized</dt><dd>{selectedApplicant.isAuthorized === null || selectedApplicant.isAuthorized === undefined ? "Not provided" : selectedApplicant.isAuthorized ? "Yes" : "No"}</dd></div><div><dt>Background consent</dt><dd>{selectedApplicant.consentBackground === null || selectedApplicant.consentBackground === undefined ? "Not provided" : selectedApplicant.consentBackground ? "Yes" : "No"}</dd></div></dl></section>}
        {detailTab === "Notes" && <section className="hiring-review-drawer__section"><h3>Team notes</h3><article className="hiring-review-note"><span className="hiring-review-avatar hiring-review-avatar--note">—</span><div><header><strong>No saved notes</strong><small>Notes are not connected in this design yet.</small></header><p>No team note is displayed without a saved record.</p></div></article></section>}
        {detailTab === "Activity" && <section className="hiring-review-drawer__section"><h3>Activity</h3><article className="hiring-review-note"><span className="hiring-review-avatar hiring-review-avatar--note">•</span><div><header><strong>Application submitted</strong><small>{selectedApplicant.applied}</small></header><p>Current stage: {selectedApplicant.stage}</p></div></article></section>}
        <footer className="hiring-review-drawer__actions"><StaticControl dark onClick={live ? handleAdvance : undefined} disabled={updateStageMutation.isPending || selectedApplicant.stage === "Active"}>Advance <span>→</span></StaticControl><div><StaticControl onClick={live ? handleMessage : undefined}>Message</StaticControl><StaticControl onClick={live ? handleReject : undefined} disabled={updateStageMutation.isPending}>Reject</StaticControl><StaticControl><CircleEllipsis size={17} /></StaticControl></div></footer>
      </aside>}
      {drawerSession && <ConversationDrawer session={drawerSession} onClose={() => setDrawerSession(null)} currentAgentId={0} />}
      {smsPending && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"><div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full mx-4"><div className="flex items-start gap-3 mb-4"><div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0"><MessageSquare className="w-5 h-5 text-amber-600" /></div><div><h3 className="text-base font-bold text-slate-900">Send SMS to {smsPending.name}?</h3><p className="text-sm text-slate-500 mt-1">Notify them about moving to <span className="font-semibold text-slate-700">{smsPending.stage}</span>.</p></div></div><div className="flex gap-3"><button onClick={() => { updateStageMutation.mutate({ id: smsPending.id, stage: smsPending.stage, sendSmsNotification: true }); setSmsPending(null); }} className="flex-1 bg-[#E8735A] hover:bg-[#d4614a] text-white font-semibold text-sm rounded-xl py-2.5 transition-colors">Yes, send SMS</button><button onClick={() => setSmsPending(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl py-2.5 transition-colors">Skip</button></div></div></div>}
    </div>
  );
}

export default function HiringAdminReview() {
  return <HiringAdminWorkspace />;
}
