import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  CalendarDays, Camera, Check, CheckCircle2, ChevronRight,
  Clock3, FileText, ImagePlus, Loader2, LogOut, MapPin,
  Menu, MessageCircle, Navigation, Phone, Sparkles, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./cleaner-portal-connected.css";
import "./cleaner-portal-login.css";

type PortalJob = {
  portalJobKey: string;
  customerName: string;
  customerPhone: string;
  address: string;
  time: string;
  jobDate: string;
  serviceDateTime: string;
  bathrooms: number;
  extras: string[];
  checklistItems: Array<{ text: string; checked: boolean }>;
  bookingStatus: string;
  jobStatus: string;
  jobIndex: number;
  totalJobsToday: number;
  basePay: number | null;
  customerNotes: string | null;
  staffNotes: string | null;
};

type WeekJob = {
  portalJobKey: string;
  customerName: string;
  address: string;
  time: string;
  jobDate: string;
  dateLabel: string;
  bathrooms: number;
  extras: string[];
  jobStatus: string;
  bookingStatus: string;
  basePay: number | null;
};

type NavPage = "today" | "jobs" | "schedule" | "earnings" | "contact" | "profile";
type EtaChoice = 10 | 20 | 30 | 45 | 60 | 75 | 90 | 120;

const ETA_CHOICES: EtaChoice[] = [10, 20, 30, 45, 60, 75, 90, 120];
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function etDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  const [month, day, year] = formatted.split("/");
  return `${year}-${month}-${day}`;
}

function mondayEtDate() {
  const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const mondayOffset = (etNow.getDay() + 6) % 7;
  etNow.setDate(etNow.getDate() - mondayOffset);
  return `${etNow.getFullYear()}-${String(etNow.getMonth() + 1).padStart(2, "0")}-${String(etNow.getDate()).padStart(2, "0")}`;
}

function ordinal(index: number) {
  const words = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
  return words[index - 1] ?? `Job ${index}`;
}

function serviceLabel(job: PortalJob | WeekJob) {
  if ((job.extras ?? []).includes("move_in_move_out")) return "Move-out cleaning";
  if ((job.extras ?? []).length > 0) return "Home cleaning with extras";
  return "Home cleaning";
}

function jobIsComplete(job: PortalJob | WeekJob) {
  return job.bookingStatus === "completed" || job.jobStatus === "completed";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    assigned: "Confirmed", on_the_way: "On the way", arrived: "Arrived",
    in_progress: "In progress", finishing_up: "Finishing up", wrapping_up: "Wrapping up", completed: "Complete",
  };
  return labels[status] ?? "Confirmed";
}

function formatEta(minutes: number) {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes === 60) return "1 hour";
  return `${Math.floor(minutes / 60)} hour ${minutes % 60} minutes`;
}

function formatMoney(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "$0.00";
}

function parseTime(value: string) {
  return value || "Time pending";
}

function openDirections(address: string) {
  window.open(`https://maps.google.com/?daddr=${encodeURIComponent(address)}&travelmode=driving`, "_blank", "noopener,noreferrer");
}

function JobSequenceBadge({ job }: { job: PortalJob | WeekJob }) {
  return <span className="cp-sequence">{ordinal("jobIndex" in job ? job.jobIndex : 1)} job</span>;
}

function StatusPill({ job }: { job: PortalJob | WeekJob }) {
  const complete = jobIsComplete(job);
  return <span className={`cp-status cp-status--${complete ? "complete" : "active"}`}>{complete ? "Complete" : statusLabel(job.jobStatus)}</span>;
}

function JobCard({ job, onOpen, onCall }: { job: PortalJob; onOpen: () => void; onCall: () => void }) {
  const complete = jobIsComplete(job);
  return (
    <article className={`cp-job-card ${complete ? "cp-job-card--complete" : ""}`}>
      <div className="cp-job-card__head">
        <div className="cp-timebox"><b>{parseTime(job.time).replace(" ", "\n")}</b></div>
        <div className="cp-job-card__main">
          <div className="cp-job-card__title-line"><h3>{job.customerName}</h3><StatusPill job={job} /></div>
          <p className="cp-job-card__service">{serviceLabel(job)}</p>
          <p className="cp-job-card__address"><MapPin size={14} />{job.address || "Address pending"}</p>
          <div className="cp-tags">
            <JobSequenceBadge job={job} />
            <span>{job.bathrooms} bath{job.bathrooms === 1 ? "" : "s"}</span>
            {(job.extras ?? []).slice(0, 2).map(extra => <span key={extra}>{extra.replaceAll("_", " ")}</span>)}
          </div>
        </div>
      </div>
      <div className="cp-job-card__actions">
        {!complete && <button className="cp-btn cp-btn--subtle" onClick={onCall}><Phone size={15} />Call client</button>}
        <button className="cp-btn cp-btn--subtle" onClick={() => openDirections(job.address)}><Navigation size={15} />Directions</button>
        <button className="cp-btn cp-btn--primary" onClick={onOpen}>{complete ? "View job" : "Open job"}<ChevronRight size={15} /></button>
      </div>
    </article>
  );
}

function SignaturePad({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }) {
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    drawing.current = true;
    lastPoint.current = point(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !lastPoint.current) return;
    const current = point(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!current || !ctx) return;
    ctx.beginPath(); ctx.moveTo(lastPoint.current.x, lastPoint.current.y); ctx.lineTo(current.x, current.y);
    ctx.strokeStyle = "#3a271f"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke(); lastPoint.current = current;
  };
  return <canvas className="cp-signature" ref={canvasRef} width={1000} height={260} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drawing.current = false; lastPoint.current = null; }} onPointerLeave={() => { drawing.current = false; lastPoint.current = null; }} />;
}

function JobDrawer({ job, onClose, onProgress }: { job: PortalJob; onClose: () => void; onProgress: (progress: { jobStatus: string; etaTimestamp: number | null; etaTimeStr: string | null }) => void }) {
  const [etaOpen, setEtaOpen] = useState(false);
  const [arrivalConfirm, setArrivalConfirm] = useState(false);
  const [selectedEta, setSelectedEta] = useState<EtaChoice>(30);
  const progressQuery = trpc.cleanerPortalProgress.getForJob.useQuery({ portalJobKey: job.portalJobKey }, { retry: 0, throwOnError: false });
  const setEtaMutation = trpc.cleanerPortalProgress.setEta.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); setEtaOpen(false); result.customerNotified ? toast.success("ETA recorded and client notified.") : toast.warning(result.notificationError ? "ETA recorded, but the client message could not be sent." : "ETA recorded. No customer phone is on this booking."); }, onError: error => toast.error(error.message || "The ETA could not be recorded.") });
  const arrivedMutation = trpc.cleanerPortalProgress.markArrived.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); setArrivalConfirm(false); result.customerNotified ? toast.success("Arrival recorded and client notified.") : toast.warning(result.notificationError ? "Arrival recorded, but the client message could not be sent." : "Arrival recorded. No customer phone is on this booking."); }, onError: error => toast.error(error.message || "Arrival could not be recorded.") });
  const startMutation = trpc.cleanerPortalProgress.startJob.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); toast.success("Job started."); }, onError: error => toast.error(error.message || "The job could not be started.") });
  const actionUnavailable = progressQuery.isLoading || progressQuery.isError;
  const actionPending = setEtaMutation.isPending || arrivedMutation.isPending || startMutation.isPending;
  const progress = progressQuery.data;
  const displayedJob = progress ? { ...job, jobStatus: progress.jobStatus } : job;
  return <>
    <div className="cp-drawer-backdrop" onClick={onClose}>
      <aside className="cp-drawer" onClick={event => event.stopPropagation()} aria-label={`Details for ${displayedJob.customerName}`}>
        <header className="cp-drawer__header"><div><span className="cp-eyebrow">{ordinal(displayedJob.jobIndex)} job · Today</span><h2>{displayedJob.customerName}</h2><p>{serviceLabel(displayedJob)} · {displayedJob.time}</p></div><button className="cp-icon-button" onClick={onClose} aria-label="Close job details"><X size={20} /></button></header>
        <section className="cp-detail-block cp-detail-block--address"><MapPin size={20} /><div><span>Service address</span><strong>{displayedJob.address || "Address pending"}</strong></div></section>
        <section className="cp-action-grid">
          <button className="cp-btn cp-btn--subtle" disabled><Phone size={16} />Call client</button>
          <button className="cp-btn cp-btn--subtle" onClick={() => openDirections(displayedJob.address)}><Navigation size={16} />Directions</button>
          <button className="cp-btn cp-btn--dark" disabled={actionUnavailable || actionPending} onClick={() => setEtaOpen(true)}><Clock3 size={16} />Set ETA</button>
          <button className="cp-btn cp-btn--arrived" disabled={actionUnavailable || actionPending} onClick={() => setArrivalConfirm(true)}><CheckCircle2 size={16} />I’ve arrived</button>
          <button className="cp-btn cp-btn--primary cp-action-grid__wide" disabled={actionUnavailable || actionPending} onClick={() => startMutation.mutate({ portalJobKey: displayedJob.portalJobKey })}><CheckCircle2 size={16} />Start job</button>
        </section>
        {progressQuery.isError && <section className="cp-detail-block"><p className="cp-muted">ETA, arrival, and start are temporarily unavailable. Your job list is still available.</p></section>}
        <section className="cp-detail-block"><h3>Service scope</h3><div className="cp-tags"><span>{displayedJob.bathrooms} bathroom{displayedJob.bathrooms === 1 ? "" : "s"}</span>{displayedJob.extras.map(extra => <span key={extra}>{extra.replaceAll("_", " ")}</span>)}</div></section>
        {displayedJob.customerNotes && <section className="cp-detail-block"><h3>Visit notes</h3><p><b>Customer:</b> {displayedJob.customerNotes}</p></section>}
        <section className="cp-detail-block"><div className="cp-block-heading"><div><h3>Cleaning checklist</h3><p>Checklist actions will be enabled after portal visibility is confirmed.</p></div></div><p className="cp-muted">No checklist has been added to this job.</p></section>
        <section className="cp-detail-block"><div className="cp-block-heading"><div><h3>Before & after photos</h3><p>Photo actions will be enabled after portal visibility is confirmed.</p></div><button className="cp-btn cp-btn--subtle cp-btn--small" disabled><Camera size={15} />Add before photo</button></div>
          <div className="cp-photo-grid"><div className="cp-photo-tile" aria-disabled><ImagePlus size={20} /><span>Before</span></div><div className="cp-photo-tile cp-photo-tile--after" aria-disabled><ImagePlus size={20} /><span>After</span></div></div>
        </section>
        <section className="cp-detail-block cp-signoff"><span className="cp-eyebrow">Customer sign-off</span><h3>How did everything look?</h3><p>Customer sign-off will be enabled after portal visibility is confirmed.</p><div className="cp-feedback-options"><button disabled>Looks great</button><button disabled>Needs touch-up</button><button disabled>Report issue</button></div><textarea disabled placeholder="Optional note from the customer" /><button className="cp-btn cp-btn--primary cp-btn--wide" disabled><CheckCircle2 size={16} />Save customer sign-off</button></section>
      </aside>
    </div>
    {etaOpen && <div className="cp-modal-backdrop" onClick={() => setEtaOpen(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Arrival update</span><h3>Set arrival ETA</h3><p>The client will receive the selected arrival time.</p><div className="cp-eta-options">{ETA_CHOICES.map(minutes => <button key={minutes} onClick={() => setSelectedEta(minutes)} className={selectedEta === minutes ? "is-selected" : ""}>{formatEta(minutes)}</button>)}</div><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setEtaOpen(false)}>Cancel</button><button className="cp-btn cp-btn--primary" onClick={() => setEtaMutation.mutate({ portalJobKey: displayedJob.portalJobKey, minutes: selectedEta })} disabled={setEtaMutation.isPending}>Send ETA</button></div></div></div>}
    {arrivalConfirm && <div className="cp-modal-backdrop" onClick={() => setArrivalConfirm(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Confirm arrival</span><h3>Tell the client you’ve arrived?</h3><p>This will record your arrival and message the client.</p><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setArrivalConfirm(false)}>Cancel</button><button className="cp-btn cp-btn--arrived" onClick={() => arrivedMutation.mutate({ portalJobKey: displayedJob.portalJobKey })} disabled={arrivedMutation.isPending}>Mark arrived</button></div></div></div>}
  </>;
}

function AvailabilityDialog({ open, schedule, onClose }: { open: boolean; schedule?: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number } | null; onClose: () => void }) {
  const [days, setDays] = useState<Record<(typeof WEEK_DAYS)[number], boolean>>({ Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false, Sun: false });
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!schedule || !open) return;
    setDays({ Mon: schedule.mon === 1, Tue: schedule.tue === 1, Wed: schedule.wed === 1, Thu: schedule.thu === 1, Fri: schedule.fri === 1, Sat: schedule.sat === 1, Sun: schedule.sun === 1 });
  }, [open, schedule]);
  if (!open) return null;
  return <div className="cp-modal-backdrop" onClick={onClose}><div className="cp-modal cp-modal--wide" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Availability</span><h3>Set weekly availability</h3><p>Availability changes will be enabled after portal visibility is confirmed.</p><div className="cp-week-days">{WEEK_DAYS.map(day => <button key={day} className={days[day] ? "is-selected" : ""} disabled>{day}</button>)}</div><textarea value={note} disabled placeholder="Optional note for dispatch" /><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={onClose}>Close</button><button className="cp-btn cp-btn--primary" disabled>Save availability</button></div></div></div>;
}

function CleanerPortalLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = trpc.cleaner.login.useMutation({
    throwOnError: false,
    onSuccess: () => window.location.replace("/portal-v2"),
    onError: error => toast.error(error.message || "We could not sign you in."),
  });
  return <main className="cp-login"><section><span className="cp-logo">M</span><span className="cp-eyebrow">Maids in Black</span><h1>Cleaner Portal</h1><p>Sign in with your existing cleaner account. A Maids in Black sign-in link will continue to open your portal automatically.</p><form onSubmit={event => { event.preventDefault(); loginMutation.mutate({ email: email.trim(), password }); }}><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="cp-btn cp-btn--primary cp-btn--wide" disabled={loginMutation.isPending}>{loginMutation.isPending ? <Loader2 className="cp-spin" size={16} /> : "Sign in"}</button></form></section></main>;
}

function CleanerPortalConnected() {
  const [page, setPage] = useState<NavPage>("today");
  const [selectedJob, setSelectedJob] = useState<PortalJob | null>(null);
  const [progressByJobKey, setProgressByJobKey] = useState<Record<string, { jobStatus: string; etaTimestamp: number | null; etaTimeStr: string | null }>>({});
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const todayDate = useMemo(() => etDate(), []);
  const weekStart = useMemo(() => mondayEtDate(), []);
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: 1, throwOnError: false });
  const todayQuery = trpc.cleanerPortalReadOnly.getMyJobsToday.useQuery(undefined, { enabled: !!meQuery.data, retry: 1, throwOnError: false });
  const weekQuery = trpc.cleanerPortalReadOnly.getMyJobsWeek.useQuery(undefined, { enabled: !!meQuery.data && page === "jobs", staleTime: 60_000, throwOnError: false });
  const portalDataQuery = trpc.cleaner.portalData.useQuery(undefined, { enabled: !!meQuery.data, staleTime: 300_000, throwOnError: false });
  const teamScheduleQuery = trpc.cleanerPortalReadOnly.getMyTeamSchedule.useQuery(undefined, { enabled: !!meQuery.data && page === "schedule", staleTime: 300_000, throwOnError: false });
  const payQuery = trpc.cleanerPortalReadOnly.myJobsRange.useQuery({ from: weekStart, to: todayDate }, { enabled: !!meQuery.data && page === "earnings", staleTime: 60_000, throwOnError: false });
  const logoutMutation = trpc.cleaner.logout.useMutation({ throwOnError: false, onSuccess: () => window.location.replace("/cleaner") });
  const languageMutation = trpc.cleaner.updateLanguage.useMutation({ throwOnError: false, onError: error => toast.error(error.message) });

  const jobs = ((todayQuery.data ?? []) as PortalJob[]).map(job => ({ ...job, ...progressByJobKey[job.portalJobKey] }));
  const activeJobs = jobs.filter(job => !jobIsComplete(job));
  const nextJob = activeJobs[0] ?? jobs[0] ?? null;
  const weekJobs = (weekQuery.data ?? []) as WeekJob[];
  const payJobs = (payQuery.data ?? []) as Array<{ id: number; customerName?: string | null; jobDate?: string | null; finalPay?: string | null; basePay?: string | null; bookingStatus?: string | null }>;
  const paidJobs = payJobs.filter(job => job.bookingStatus === "completed");
  const completedPay = paidJobs.reduce((sum, job) => sum + Number(job.finalPay ?? job.basePay ?? 0), 0);
  const pendingPay = jobs.filter(job => !jobIsComplete(job)).reduce((sum, job) => sum + (job.basePay ?? 0), 0);
  const initial = meQuery.data?.name?.trim().slice(0, 1).toUpperCase() || "C";
  const firstName = meQuery.data?.name?.split(" ")[0] || "there";
  const callClient = () => toast.info("Client calling will be enabled after portal visibility is confirmed.");

  if (meQuery.isLoading || (meQuery.data && todayQuery.isLoading)) return <div className="cp-loading"><Loader2 className="cp-spin" size={30} />Loading your workday…</div>;
  if (meQuery.isError) return <div className="cp-loading"><div><p>We could not reach your Cleaner Portal right now.</p><button className="cp-btn cp-btn--subtle" onClick={() => window.location.reload()}>Try again</button></div></div>;
  if (todayQuery.isError) return <div className="cp-loading"><div><p>Your assigned jobs could not be loaded. Please try again.</p><button className="cp-btn cp-btn--subtle" onClick={() => todayQuery.refetch()}>Try again</button></div></div>;
  if (!meQuery.data) return <CleanerPortalLogin />;

  const navItems: Array<{ id: NavPage; label: string; icon: typeof CalendarDays }> = [
    { id: "today", label: "Today", icon: CalendarDays }, { id: "jobs", label: "My jobs", icon: FileText },
    { id: "schedule", label: "Schedule", icon: CalendarDays }, { id: "earnings", label: "Earnings", icon: Sparkles },
    { id: "contact", label: "Contact", icon: MessageCircle }, { id: "profile", label: "Profile", icon: UserRound },
  ];

  return <div className="cp-app">
    <header className="cp-topbar"><div className="cp-brand"><span className="cp-logo">M</span><span><b>Maids in Black</b><small>Cleaner Portal</small></span></div><div className="cp-user"><span className="cp-avatar">{initial}</span><span>{meQuery.data.name}</span><button className="cp-icon-button cp-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Portal menu"><Menu size={19} /></button>{menuOpen && <div className="cp-user-menu"><button onClick={() => logoutMutation.mutate()}><LogOut size={15} />Log out</button></div>}</div></header>
    <div className="cp-shell"><aside className="cp-nav"><nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setPage(id)} className={page === id ? "is-active" : ""}><Icon size={17} /><span>{label}</span></button>)}</nav></aside>
      <main className="cp-main">
        {page === "today" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Today · {todayDate}</span><h1>Good day, {firstName}.</h1><p>{activeJobs.length ? `You have ${activeJobs.length} active job${activeJobs.length === 1 ? "" : "s"} today.` : jobs.length ? "Today’s jobs are complete." : "No jobs assigned for today."}</p></div><div className="cp-head-actions"><button className="cp-btn cp-btn--subtle" onClick={() => setAvailabilityOpen(true)}><CalendarDays size={16} />Set availability</button></div></div>
          {nextJob && <div className="cp-hero"><div><span className="cp-live">{jobIsComplete(nextJob) ? "DAY COMPLETE" : "NEXT JOB"}</span><h2>{jobIsComplete(nextJob) ? "Great work today." : `${ordinal(nextJob.jobIndex)} job is ready`}</h2><p>{nextJob.customerName} · {serviceLabel(nextJob)} · {nextJob.address}</p><div className="cp-hero-actions"><button className="cp-btn cp-btn--primary" onClick={() => setSelectedJob(nextJob)}>{jobIsComplete(nextJob) ? "Review job" : `View ${ordinal(nextJob.jobIndex).toLowerCase()} job`}<ChevronRight size={16} /></button><button className="cp-btn cp-btn--subtle" onClick={() => openDirections(nextJob.address)}><Navigation size={16} />Directions</button></div></div><div className="cp-hero-side"><span>Assigned jobs</span><strong>{jobs.length}</strong><small>{activeJobs.length} active today</small></div></div>}
          <div className="cp-layout"><section className="cp-panel"><div className="cp-panel-title"><div><span className="cp-eyebrow">Today’s route</span><h2>Assigned jobs</h2></div><button className="cp-text-action" onClick={() => setPage("jobs")}>View all <ChevronRight size={15} /></button></div>{jobs.length === 0 ? <div className="cp-empty">No active jobs are assigned today.</div> : jobs.map(job => <JobCard key={job.portalJobKey} job={job} onOpen={() => setSelectedJob(job)} onCall={callClient} />)}</section><aside className="cp-side-stack"><section className="cp-panel"><span className="cp-eyebrow">Route</span><h3>Today’s drive</h3><div className="cp-route-list">{jobs.map(job => <div key={job.portalJobKey}><span className="cp-route-dot" /><p><b>{job.customerName}</b><small>{job.address || "Address pending"}</small></p><time>{job.time}</time></div>)}</div></section><section className="cp-panel"><span className="cp-eyebrow">Shift status</span><h3>{portalDataQuery.data?.tomorrowAvailability.submitted ? "Availability saved" : "Set tomorrow’s availability"}</h3><p className="cp-muted">Keep dispatch up to date with your current weekly schedule.</p><button className="cp-btn cp-btn--subtle cp-btn--wide" onClick={() => setAvailabilityOpen(true)}>Set availability</button></section></aside></div>
        </section>}
        {page === "jobs" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">My work</span><h1>My jobs</h1><p>Your current workweek, using your existing assigned job list.</p></div></div><div className="cp-panel cp-job-list">{weekQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading assigned jobs…</div> : weekQuery.isError ? <div className="cp-empty">Your assigned jobs could not be loaded.</div> : weekJobs.length === 0 ? <div className="cp-empty">No upcoming jobs this week.</div> : weekJobs.map(job => <div className="cp-week-job" key={job.portalJobKey}><div className="cp-week-job__date"><b>{job.dateLabel === "today" ? "Today" : job.jobDate}</b><small>{job.time}</small></div><div><StatusPill job={job} /><h3>{job.customerName} · {serviceLabel(job)}</h3><p><MapPin size={14} />{job.address || "Address pending"}</p></div>{job.dateLabel === "today" && <button className="cp-btn cp-btn--primary cp-btn--small" onClick={() => { const todayJob = jobs.find(item => item.portalJobKey === job.portalJobKey); if (todayJob) setSelectedJob(todayJob); }}>Open</button>}</div>)}</div></section>}
        {page === "schedule" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Schedule</span><h1>Your availability</h1><p>Set the workdays that dispatch should use for your team schedule.</p></div><button className="cp-btn cp-btn--primary" onClick={() => setAvailabilityOpen(true)}>Set availability</button></div><div className="cp-panel cp-schedule-card"><CalendarDays size={25} /><h2>{teamScheduleQuery.data?.teamName ? `${teamScheduleQuery.data.teamName} schedule` : "Weekly availability"}</h2><p>Your existing weekly schedule and next-day availability check-in stay in one place.</p>{teamScheduleQuery.data?.schedule && <div className="cp-schedule-days">{WEEK_DAYS.map(day => <span key={day} className={teamScheduleQuery.data?.schedule?.[day.toLowerCase() as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"] === 1 ? "is-working" : ""}>{day}</span>)}</div>}<button className="cp-btn cp-btn--primary" onClick={() => setAvailabilityOpen(true)}>Update availability</button></div></section>}
        {page === "earnings" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Earnings</span><h1>Your earnings</h1><p>Amounts shown here come from the existing job and payroll records.</p></div></div><div className="cp-money-grid"><article><span>Completed this week</span><strong>{formatMoney(completedPay)}</strong><small>{paidJobs.length} completed job{paidJobs.length === 1 ? "" : "s"}</small></article><article><span>Scheduled today</span><strong>{formatMoney(pendingPay)}</strong><small>{activeJobs.length} active job{activeJobs.length === 1 ? "" : "s"}</small></article><article><span>Current streak</span><strong>{portalDataQuery.data?.streakInfo.currentStreak ?? 0}</strong><small>Completed-job streak</small></article></div><div className="cp-panel"><h2>Recent work</h2>{payQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading earnings…</div> : paidJobs.length === 0 ? <div className="cp-empty">No completed jobs in this week’s current range.</div> : paidJobs.slice().reverse().map(job => <div className="cp-earn-row" key={job.id}><div><b>{job.customerName || "Customer"}</b><span>{job.jobDate}</span></div><strong>{formatMoney(job.finalPay ?? job.basePay)}</strong></div>)}</div></section>}
        {page === "contact" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Contact</span><h1>Client contact</h1><p>For a current job, use the existing masked Call client flow.</p></div></div><div className="cp-panel cp-contact-panel"><Phone size={26} /><h2>Call a current client</h2><p>Open a job to call its client through the existing protected phone proxy. There is no separate cleaner message inbox to duplicate here.</p>{nextJob && <button className="cp-btn cp-btn--primary" onClick={() => callClient(nextJob)}>Call {nextJob.customerName}</button>}</div></section>}
        {page === "profile" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Profile</span><h1>Cleaner profile</h1><p>Your authenticated portal account.</p></div></div><div className="cp-profile-grid"><section className="cp-panel"><h2>Contact</h2><dl><div><dt>Name</dt><dd>{meQuery.data.name}</dd></div><div><dt>Phone</dt><dd>{meQuery.data.phone || "Not available"}</dd></div></dl></section><section className="cp-panel"><h2>Portal language</h2><p className="cp-muted">Use your saved language preference.</p><div className="cp-language-buttons">{(["en", "es", "pt"] as const).map(language => <button key={language} className={meQuery.data?.language === language ? "is-selected" : ""} onClick={() => languageMutation.mutate({ language })}>{language === "en" ? "English" : language === "es" ? "Español" : "Português"}</button>)}</div></section><section className="cp-panel"><h2>Session</h2><button className="cp-btn cp-btn--subtle" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}><LogOut size={16} />Log out</button></section></div></section>}
      </main>
    </div>
    <AvailabilityDialog open={availabilityOpen} schedule={teamScheduleQuery.data?.schedule} onClose={() => setAvailabilityOpen(false)} />
    {selectedJob && <JobDrawer job={{ ...selectedJob, ...progressByJobKey[selectedJob.portalJobKey] }} onClose={() => setSelectedJob(null)} onProgress={progress => setProgressByJobKey(current => ({ ...current, [selectedJob.portalJobKey]: progress }))} />}
  </div>;
}

export default CleanerPortalConnected;
