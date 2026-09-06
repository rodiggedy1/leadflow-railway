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

function JobDrawer({
  job, language, onClose, onComplete, onCall,
}: { job: PortalJob; language: "en" | "es" | "pt"; onClose: () => void; onComplete: () => void; onCall: () => void }) {
  const utils = trpc.useUtils();
  const [etaOpen, setEtaOpen] = useState(false);
  const [arrivalConfirm, setArrivalConfirm] = useState(false);
  const [completeConfirm, setCompleteConfirm] = useState(false);
  const [selectedEta, setSelectedEta] = useState<EtaChoice>(30);
  const [response, setResponse] = useState<"great" | "touchup" | "issue">("great");
  const [feedback, setFeedback] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pendingPhotoType, setPendingPhotoType] = useState<"before" | "after">("before");
  const signatureRef = useRef<HTMLCanvasElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoInputId = `cleaner-job-photo-${job.portalJobKey.replace(":", "-")}`;
  const checklistQuery = trpc.cleanerIsolated.getChecklistForLanguage.useQuery({ portalJobKey: job.portalJobKey, lang: language }, { staleTime: 300_000, throwOnError: false });
  const notesQuery = trpc.cleanerIsolated.getNotesForLanguage.useQuery({ portalJobKey: job.portalJobKey, lang: language }, { staleTime: 300_000, throwOnError: false });
  const etaMutation = trpc.cleanerIsolated.setEta.useMutation({
    throwOnError: false,
    onSuccess: () => { utils.cleanerIsolated.getMyJobsToday.invalidate(); utils.cleanerIsolated.getMyJobsWeek.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const arrivedMutation = trpc.cleanerIsolated.markArrived.useMutation({
    throwOnError: false,
    onSuccess: () => { utils.cleanerIsolated.getMyJobsToday.invalidate(); utils.cleanerIsolated.getMyJobsWeek.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const startMutation = trpc.cleanerIsolated.markStarted.useMutation({
    throwOnError: false,
    onSuccess: () => { utils.cleanerIsolated.getMyJobsToday.invalidate(); utils.cleanerIsolated.getMyJobsWeek.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const proxyMutation = trpc.cleanerIsolated.getProxyNumber.useMutation({
    throwOnError: false,
    onSuccess: ({ proxyNumber }) => { window.location.href = `tel:${proxyNumber}`; },
    onError: error => toast.error(error.message),
  });
  const uploadMutation = trpc.cleanerIsolated.uploadPhoto.useMutation({ throwOnError: false, onError: error => toast.error(error.message) });
  const signatureMutation = trpc.cleanerIsolated.saveSignature.useMutation({ throwOnError: false, onError: error => toast.error(error.message) });
  const notHomeMutation = trpc.cleanerIsolated.saveNotHome.useMutation({ throwOnError: false, onError: error => toast.error(error.message) });
  const checklistMutation = trpc.cleanerIsolated.toggleChecklistItem.useMutation({ throwOnError: false, onSuccess: () => { checklistQuery.refetch(); utils.cleanerIsolated.getMyJobsToday.invalidate(); }, onError: error => toast.error(error.message) });
  const completeMutation = trpc.cleanerIsolated.markComplete.useMutation({
    throwOnError: false,
    onSuccess: () => { utils.cleanerIsolated.getMyJobsToday.invalidate(); utils.cleanerIsolated.getMyJobsWeek.invalidate(); utils.cleanerIsolated.myJobsRange.invalidate(); onComplete(); },
    onError: error => toast.error(error.message),
  });

  const callClient = () => proxyMutation.mutate({ portalJobKey: job.portalJobKey });
  const setEta = () => etaMutation.mutate({
    portalJobKey: job.portalJobKey, minutes: selectedEta,
  }, { onSuccess: () => { setEtaOpen(false); toast.success(`ETA sent: ${formatEta(selectedEta)}`); } });
  const confirmArrived = () => arrivedMutation.mutate({ portalJobKey: job.portalJobKey }, { onSuccess: () => { setArrivalConfirm(false); toast.success("Arrival recorded"); } });
  const startJob = () => startMutation.mutate({ portalJobKey: job.portalJobKey }, { onSuccess: () => toast.success("Job started") });
  const uploadPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter(file => file.size <= 7 * 1024 * 1024);
    if (files.length === 0) return;
    setUploading(true);
    for (const [index, file] of files.entries()) {
      const preview = URL.createObjectURL(file);
      setPhotos(previous => [...previous, preview]);
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = reject; reader.readAsDataURL(file);
      });
      await uploadMutation.mutateAsync({ portalJobKey: job.portalJobKey, filename: file.name, mimeType: file.type || "image/jpeg", base64Data: dataBase64, photoType: index === 0 ? pendingPhotoType : "after" });
    }
    setUploading(false);
    event.target.value = "";
  };
  const saveSignoff = async () => {
    const signature = signatureRef.current?.toDataURL("image/png") ?? "";
    if (!signature || signature === "data:,") { toast.error("Please collect the customer signature first."); return; }
    await signatureMutation.mutateAsync({ portalJobKey: job.portalJobKey, signatureBase64: signature.split(",")[1] ?? "", customerResponse: response, customerNotes: feedback.trim() || undefined });
    setCompleteConfirm(true);
  };
  const markComplete = () => completeMutation.mutate({ portalJobKey: job.portalJobKey });
  const clearSignature = () => { const canvas = signatureRef.current; const ctx = canvas?.getContext("2d"); if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); };

  return (
    <div className="cp-drawer-backdrop" onClick={onClose}>
      <aside className="cp-drawer" onClick={event => event.stopPropagation()} aria-label={`Details for ${job.customerName}`}>
        <header className="cp-drawer__header"><div><span className="cp-eyebrow">{ordinal(job.jobIndex)} job · Today</span><h2>{job.customerName}</h2><p>{serviceLabel(job)} · {job.time}</p></div><button className="cp-icon-button" onClick={onClose} aria-label="Close job details"><X size={20} /></button></header>
        <section className="cp-detail-block cp-detail-block--address"><MapPin size={20} /><div><span>Service address</span><strong>{job.address || "Address pending"}</strong></div></section>
        <section className="cp-action-grid">
          <button className="cp-btn cp-btn--subtle" onClick={callClient} disabled={proxyMutation.isPending}><Phone size={16} />{proxyMutation.isPending ? "Connecting…" : "Call client"}</button>
          <button className="cp-btn cp-btn--subtle" onClick={() => openDirections(job.address)}><Navigation size={16} />Directions</button>
          <button className="cp-btn cp-btn--dark" onClick={() => setEtaOpen(true)}><Clock3 size={16} />Set ETA</button>
          <button className="cp-btn cp-btn--arrived" onClick={() => setArrivalConfirm(true)}><CheckCircle2 size={16} />I’ve arrived</button>
          <button className="cp-btn cp-btn--primary cp-action-grid__wide" onClick={startJob} disabled={startMutation.isPending}><CheckCircle2 size={16} />Start job</button>
        </section>
        <section className="cp-detail-block"><h3>Service scope</h3><div className="cp-tags"><span>{job.bathrooms} bathroom{job.bathrooms === 1 ? "" : "s"}</span>{job.extras.map(extra => <span key={extra}>{extra.replaceAll("_", " ")}</span>)}</div></section>
        {(notesQuery.data?.customerNotes || notesQuery.data?.staffNotes || job.customerNotes || job.staffNotes) && <section className="cp-detail-block"><h3>Visit notes</h3>{(notesQuery.data?.customerNotes ?? job.customerNotes) && <p><b>Customer:</b> {notesQuery.data?.customerNotes ?? job.customerNotes}</p>}{(notesQuery.data?.staffNotes ?? job.staffNotes) && <p><b>Team:</b> {notesQuery.data?.staffNotes ?? job.staffNotes}</p>}</section>}
        <section className="cp-detail-block"><div className="cp-block-heading"><div><h3>Cleaning checklist</h3><p>Mark each completed task using your existing job checklist.</p></div></div>{checklistQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" size={16} />Loading checklist…</div> : checklistQuery.data?.items.length ? <div className="cp-checklist">{checklistQuery.data.items.map((item, index) => <button key={`${index}-${item.text}`} className={item.checked ? "is-done" : ""} onClick={() => checklistMutation.mutate({ portalJobKey: job.portalJobKey, itemIndex: index, checked: !item.checked })}><span>{item.checked && <Check size={14} />}</span>{item.text}</button>)}</div> : <p className="cp-muted">No checklist has been added to this job.</p>}</section>
        <section className="cp-detail-block"><div className="cp-block-heading"><div><h3>Before & after photos</h3><p>Select visit-condition and finished-result images from your photo library.</p></div><label htmlFor={photoInputId} className="cp-btn cp-btn--subtle cp-btn--small" aria-disabled={uploading} onClick={event => { if (uploading) event.preventDefault(); else setPendingPhotoType("before"); }}>{uploading ? <Loader2 className="cp-spin" size={15} /> : <Camera size={15} />}Add before photo</label></div><input id={photoInputId} className="cp-hidden-input" ref={photoInputRef} type="file" accept="image/*" multiple onChange={uploadPhotos} disabled={uploading} />
          <div className="cp-photo-grid"><label htmlFor={photoInputId} className="cp-photo-tile" aria-disabled={uploading} onClick={event => { if (uploading) event.preventDefault(); else setPendingPhotoType("before"); }}><ImagePlus size={20} /><span>Before</span></label><label htmlFor={photoInputId} className="cp-photo-tile cp-photo-tile--after" aria-disabled={uploading} onClick={event => { if (uploading) event.preventDefault(); else setPendingPhotoType("after"); }}><ImagePlus size={20} /><span>After</span></label>{photos.map((url, index) => <img key={url} src={url} className="cp-photo-preview" alt={`Uploaded job photo ${index + 1}`} />)}</div>
        </section>
        <section className="cp-detail-block cp-signoff"><span className="cp-eyebrow">Customer sign-off</span><h3>How did everything look?</h3><p>Let the customer select a response, then sign.</p><div className="cp-feedback-options">{(["great", "touchup", "issue"] as const).map(value => <button key={value} className={response === value ? "is-selected" : ""} onClick={() => setResponse(value)}>{value === "great" ? "Looks great" : value === "touchup" ? "Needs touch-up" : "Report issue"}</button>)}</div><textarea value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="Optional note from the customer" maxLength={2000} /><SignaturePad canvasRef={signatureRef} /><div className="cp-signature-row"><button className="cp-link-button" onClick={clearSignature}>Clear signature</button><span>Customer signs here</span></div><button className="cp-btn cp-btn--primary cp-btn--wide" onClick={saveSignoff} disabled={signatureMutation.isPending}>{signatureMutation.isPending ? <Loader2 className="cp-spin" size={16} /> : <CheckCircle2 size={16} />}Save customer sign-off</button><button className="cp-link-button" onClick={() => notHomeMutation.mutate({ portalJobKey: job.portalJobKey }, { onSuccess: () => setCompleteConfirm(true) })}>Customer was not home</button></section>
      </aside>
      {etaOpen && <div className="cp-modal-backdrop" onClick={() => setEtaOpen(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Arrival update</span><h3>Set arrival ETA</h3><p>The client will receive the selected arrival time.</p><div className="cp-eta-options">{ETA_CHOICES.map(minutes => <button key={minutes} onClick={() => setSelectedEta(minutes)} className={selectedEta === minutes ? "is-selected" : ""}>{minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 hour" : minutes === 120 ? "2 hours" : `${minutes / 60} hrs`}</button>)}</div><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setEtaOpen(false)}>Cancel</button><button className="cp-btn cp-btn--primary" onClick={setEta} disabled={etaMutation.isPending}>Send ETA</button></div></div></div>}
      {arrivalConfirm && <div className="cp-modal-backdrop" onClick={() => setArrivalConfirm(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Confirm arrival</span><h3>Tell the client you’ve arrived?</h3><p>This will send the existing arrival update and start this job’s in-progress status.</p><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setArrivalConfirm(false)}>Cancel</button><button className="cp-btn cp-btn--arrived" onClick={confirmArrived} disabled={arrivedMutation.isPending}>Mark arrived</button></div></div></div>}
      {completeConfirm && <div className="cp-modal-backdrop" onClick={() => setCompleteConfirm(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Job completion</span><h3>Mark this job complete?</h3><p>This uses the current completion flow, including the existing pay calculation and client follow-up.</p><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setCompleteConfirm(false)}>Not yet</button><button className="cp-btn cp-btn--primary" onClick={markComplete} disabled={completeMutation.isPending}>{completeMutation.isPending ? <Loader2 className="cp-spin" size={16} /> : "Complete job"}</button></div></div></div>}
    </div>
  );
}

function AvailabilityDialog({ open, schedule, onClose }: { open: boolean; schedule?: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number } | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [days, setDays] = useState<Record<(typeof WEEK_DAYS)[number], boolean>>({ Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false, Sun: false });
  const [note, setNote] = useState("");
  const scheduleMutation = trpc.cleanerIsolated.submitWeeklySchedule.useMutation({ throwOnError: false, onSuccess: () => { utils.cleanerIsolated.portalData.invalidate(); toast.success("Availability saved"); onClose(); }, onError: error => toast.error(error.message) });
  useEffect(() => {
    if (!schedule || !open) return;
    setDays({ Mon: schedule.mon === 1, Tue: schedule.tue === 1, Wed: schedule.wed === 1, Thu: schedule.thu === 1, Fri: schedule.fri === 1, Sat: schedule.sat === 1, Sun: schedule.sun === 1 });
  }, [open, schedule]);
  if (!open) return null;
  return <div className="cp-modal-backdrop" onClick={onClose}><div className="cp-modal cp-modal--wide" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Availability</span><h3>Set weekly availability</h3><p>This updates the existing team schedule and next-day availability record.</p><div className="cp-week-days">{WEEK_DAYS.map(day => <button key={day} className={days[day] ? "is-selected" : ""} onClick={() => setDays(current => ({ ...current, [day]: !current[day] }))}>{day}</button>)}</div><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Optional note for dispatch" /><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={onClose}>Cancel</button><button className="cp-btn cp-btn--primary" disabled={scheduleMutation.isPending} onClick={() => scheduleMutation.mutate({ mon: days.Mon ? 1 : 0, tue: days.Tue ? 1 : 0, wed: days.Wed ? 1 : 0, thu: days.Thu ? 1 : 0, fri: days.Fri ? 1 : 0, sat: days.Sat ? 1 : 0, sun: days.Sun ? 1 : 0, note: note.trim() || null })}>Save availability</button></div></div></div>;
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
  const utils = trpc.useUtils();
  const [page, setPage] = useState<NavPage>("today");
  const [selectedJob, setSelectedJob] = useState<PortalJob | null>(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const todayDate = useMemo(() => etDate(), []);
  const weekStart = useMemo(() => mondayEtDate(), []);
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: 1, throwOnError: false });
  const todayQuery = trpc.cleanerIsolated.getMyJobsToday.useQuery(undefined, { enabled: !!meQuery.data, retry: 1, throwOnError: false });
  const weekQuery = trpc.cleanerIsolated.getMyJobsWeek.useQuery(undefined, { enabled: !!meQuery.data && page === "jobs", staleTime: 60_000, throwOnError: false });
  const portalDataQuery = trpc.cleanerIsolated.portalData.useQuery(undefined, { enabled: !!meQuery.data, staleTime: 300_000, throwOnError: false });
  const teamScheduleQuery = trpc.cleanerIsolated.getMyTeamSchedule.useQuery(undefined, { enabled: !!meQuery.data && page === "schedule", staleTime: 300_000, throwOnError: false });
  const payQuery = trpc.cleanerIsolated.myJobsRange.useQuery({ from: weekStart, to: todayDate }, { enabled: !!meQuery.data && page === "earnings", staleTime: 60_000, throwOnError: false });
  const logoutMutation = trpc.cleaner.logout.useMutation({ throwOnError: false, onSuccess: () => window.location.replace("/cleaner") });
  const languageMutation = trpc.cleaner.updateLanguage.useMutation({ throwOnError: false, onError: error => toast.error(error.message) });
  const proxyMutation = trpc.cleanerIsolated.getProxyNumber.useMutation({ throwOnError: false, onSuccess: ({ proxyNumber }) => { window.location.href = `tel:${proxyNumber}`; }, onError: error => toast.error(error.message) });

  const jobs = (todayQuery.data ?? []) as PortalJob[];
  const activeJobs = jobs.filter(job => !jobIsComplete(job));
  const nextJob = activeJobs[0] ?? jobs[0] ?? null;
  const weekJobs = (weekQuery.data ?? []) as WeekJob[];
  const payJobs = (payQuery.data ?? []) as Array<{ id: number; customerName?: string | null; jobDate?: string | null; finalPay?: string | null; basePay?: string | null; bookingStatus?: string | null }>;
  const paidJobs = payJobs.filter(job => job.bookingStatus === "completed");
  const completedPay = paidJobs.reduce((sum, job) => sum + Number(job.finalPay ?? job.basePay ?? 0), 0);
  const pendingPay = jobs.filter(job => !jobIsComplete(job)).reduce((sum, job) => sum + (job.basePay ?? 0), 0);
  const initial = meQuery.data?.name?.trim().slice(0, 1).toUpperCase() || "C";
  const firstName = meQuery.data?.name?.split(" ")[0] || "there";
  const callClient = (job: PortalJob) => proxyMutation.mutate({ portalJobKey: job.portalJobKey });
  const completeAndClose = () => { setSelectedJob(null); utils.cleanerIsolated.getMyJobsToday.invalidate(); };

  if (meQuery.isLoading || (meQuery.data && todayQuery.isLoading)) return <div className="cp-loading"><Loader2 className="cp-spin" size={30} />Loading your workday…</div>;
  if (meQuery.isError) return <div className="cp-loading"><div><p>We could not reach your Cleaner Portal right now.</p><button className="cp-btn cp-btn--subtle" onClick={() => window.location.reload()}>Try again</button></div></div>;
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
          <div className="cp-layout"><section className="cp-panel"><div className="cp-panel-title"><div><span className="cp-eyebrow">Today’s route</span><h2>Assigned jobs</h2></div><button className="cp-text-action" onClick={() => setPage("jobs")}>View all <ChevronRight size={15} /></button></div>{jobs.length === 0 ? <div className="cp-empty">No active jobs are assigned today.</div> : jobs.map(job => <JobCard key={job.portalJobKey} job={job} onOpen={() => setSelectedJob(job)} onCall={() => callClient(job)} />)}</section><aside className="cp-side-stack"><section className="cp-panel"><span className="cp-eyebrow">Route</span><h3>Today’s drive</h3><div className="cp-route-list">{jobs.map(job => <div key={job.portalJobKey}><span className="cp-route-dot" /><p><b>{job.customerName}</b><small>{job.address || "Address pending"}</small></p><time>{job.time}</time></div>)}</div></section><section className="cp-panel"><span className="cp-eyebrow">Shift status</span><h3>{portalDataQuery.data?.tomorrowAvailability.submitted ? "Availability saved" : "Set tomorrow’s availability"}</h3><p className="cp-muted">Keep dispatch up to date with your current weekly schedule.</p><button className="cp-btn cp-btn--subtle cp-btn--wide" onClick={() => setAvailabilityOpen(true)}>Set availability</button></section></aside></div>
        </section>}
        {page === "jobs" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">My work</span><h1>My jobs</h1><p>Your current workweek, using your existing assigned job list.</p></div></div><div className="cp-panel cp-job-list">{weekQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading assigned jobs…</div> : weekJobs.length === 0 ? <div className="cp-empty">No upcoming jobs this week.</div> : weekJobs.map(job => <div className="cp-week-job" key={job.portalJobKey}><div className="cp-week-job__date"><b>{job.dateLabel === "today" ? "Today" : job.jobDate}</b><small>{job.time}</small></div><div><StatusPill job={job} /><h3>{job.customerName} · {serviceLabel(job)}</h3><p><MapPin size={14} />{job.address || "Address pending"}</p></div>{job.dateLabel === "today" && <button className="cp-btn cp-btn--primary cp-btn--small" onClick={() => { const todayJob = jobs.find(item => item.portalJobKey === job.portalJobKey); if (todayJob) setSelectedJob(todayJob); }}>Open</button>}</div>)}</div></section>}
        {page === "schedule" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Schedule</span><h1>Your availability</h1><p>Set the workdays that dispatch should use for your team schedule.</p></div><button className="cp-btn cp-btn--primary" onClick={() => setAvailabilityOpen(true)}>Set availability</button></div><div className="cp-panel cp-schedule-card"><CalendarDays size={25} /><h2>{teamScheduleQuery.data?.teamName ? `${teamScheduleQuery.data.teamName} schedule` : "Weekly availability"}</h2><p>Your existing weekly schedule and next-day availability check-in stay in one place.</p>{teamScheduleQuery.data?.schedule && <div className="cp-schedule-days">{WEEK_DAYS.map(day => <span key={day} className={teamScheduleQuery.data?.schedule?.[day.toLowerCase() as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"] === 1 ? "is-working" : ""}>{day}</span>)}</div>}<button className="cp-btn cp-btn--primary" onClick={() => setAvailabilityOpen(true)}>Update availability</button></div></section>}
        {page === "earnings" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Earnings</span><h1>Your earnings</h1><p>Amounts shown here come from the existing job and payroll records.</p></div></div><div className="cp-money-grid"><article><span>Completed this week</span><strong>{formatMoney(completedPay)}</strong><small>{paidJobs.length} completed job{paidJobs.length === 1 ? "" : "s"}</small></article><article><span>Scheduled today</span><strong>{formatMoney(pendingPay)}</strong><small>{activeJobs.length} active job{activeJobs.length === 1 ? "" : "s"}</small></article><article><span>Current streak</span><strong>{portalDataQuery.data?.streakInfo.currentStreak ?? 0}</strong><small>Completed-job streak</small></article></div><div className="cp-panel"><h2>Recent work</h2>{payQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading earnings…</div> : paidJobs.length === 0 ? <div className="cp-empty">No completed jobs in this week’s current range.</div> : paidJobs.slice().reverse().map(job => <div className="cp-earn-row" key={job.id}><div><b>{job.customerName || "Customer"}</b><span>{job.jobDate}</span></div><strong>{formatMoney(job.finalPay ?? job.basePay)}</strong></div>)}</div></section>}
        {page === "contact" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Contact</span><h1>Client contact</h1><p>For a current job, use the existing masked Call client flow.</p></div></div><div className="cp-panel cp-contact-panel"><Phone size={26} /><h2>Call a current client</h2><p>Open a job to call its client through the existing protected phone proxy. There is no separate cleaner message inbox to duplicate here.</p>{nextJob && <button className="cp-btn cp-btn--primary" onClick={() => callClient(nextJob)}>Call {nextJob.customerName}</button>}</div></section>}
        {page === "profile" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Profile</span><h1>Cleaner profile</h1><p>Your authenticated portal account.</p></div></div><div className="cp-profile-grid"><section className="cp-panel"><h2>Contact</h2><dl><div><dt>Name</dt><dd>{meQuery.data.name}</dd></div><div><dt>Phone</dt><dd>{meQuery.data.phone || "Not available"}</dd></div></dl></section><section className="cp-panel"><h2>Portal language</h2><p className="cp-muted">Use your saved language preference.</p><div className="cp-language-buttons">{(["en", "es", "pt"] as const).map(language => <button key={language} className={meQuery.data?.language === language ? "is-selected" : ""} onClick={() => languageMutation.mutate({ language })}>{language === "en" ? "English" : language === "es" ? "Español" : "Português"}</button>)}</div></section><section className="cp-panel"><h2>Session</h2><button className="cp-btn cp-btn--subtle" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}><LogOut size={16} />Log out</button></section></div></section>}
      </main>
    </div>
    <AvailabilityDialog open={availabilityOpen} schedule={teamScheduleQuery.data?.schedule} onClose={() => setAvailabilityOpen(false)} />
    {selectedJob && <JobDrawer job={selectedJob} language={meQuery.data.language as "en" | "es" | "pt"} onClose={() => setSelectedJob(null)} onComplete={completeAndClose} onCall={() => callClient(selectedJob)} />}
  </div>;
}

export default CleanerPortalConnected;
