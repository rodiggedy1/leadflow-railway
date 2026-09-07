import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  CalendarDays, Camera, Check, CheckCircle2, ChevronRight,
  Clock3, FileText, ImagePlus, Loader2, LogOut, MapPin,
  Menu, MessageCircle, Navigation, Phone, Sparkles, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import "./cleaner-portal-connected.css";
import "./cleaner-portal-messages.css";
import "./cleaner-portal-earnings.css";
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

type EarningsJob = {
  id: string;
  customerName: string;
  jobDate: string;
  status: string;
  finalPay: number;
};

type PayWeekSummary = {
  start: string;
  end: string;
  totalPay: number;
  completedJobs: number;
  jobs: EarningsJob[];
};

type NavPage = "today" | "jobs" | "schedule" | "earnings" | "contact" | "profile";
type PayWeekKey = "current" | "previous";
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

function formatPayWeekDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatPortalDayAndDate(value: string, short = false) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: short ? "short" : "long",
    month: short ? "short" : "long",
    day: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
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

type BookingMessage = { id: number; senderRole: string; body: string; notificationStatus: string; createdAt: Date | string };

const QUICK_MESSAGES = ["We're on our way.", "Running late", "We've arrived.", "Job complete", "Access issue", "Custom message"] as const;

function ContactClientPanel({ job, onClose, onCall }: { job: PortalJob; onClose: () => void; onCall: () => void }) {
  const [draft, setDraft] = useState("");
  const threadQuery = trpc.cleanerPortalMessages.getForJob.useQuery({ portalJobKey: job.portalJobKey }, { retry: 0, throwOnError: false });
  const sendMessage = trpc.cleanerPortalMessages.send.useMutation({
    throwOnError: false,
    onSuccess: async (result) => {
      setDraft("");
      await threadQuery.refetch();
      result.notificationSent ? toast.success("Message saved and customer notified.") : toast.warning(result.notificationError || "Message saved, but the customer notification could not be sent.");
    },
    onError: error => toast.error(error.message || "Message could not be sent."),
  });
  const messages = (threadQuery.data ?? []) as BookingMessage[];
  const chooseQuickMessage = (value: string) => setDraft(value === "Custom message" ? "" : value);
  return <div className="cp-contact-backdrop" onClick={onClose}>
    <aside className="cp-contact-drawer" onClick={event => event.stopPropagation()} aria-label={`Message ${job.customerName}`}>
      <header><div><span className="cp-eyebrow">Contact client</span><h2>Message {job.customerName}</h2><p>{serviceLabel(job)} · {job.time}</p></div><button className="cp-icon-button" type="button" onClick={onClose} aria-label="Close message panel"><X size={20} /></button></header>
      <section className="cp-contact-summary"><MapPin size={18} /><div><b>{job.customerName}</b><span>{job.address || "Address pending"}</span></div></section>
      <section className="cp-contact-quick"><div className="cp-contact-section-title"><h3>Quick messages</h3><small>Choose one to edit</small></div><div>{QUICK_MESSAGES.map(message => <button type="button" key={message} onClick={() => chooseQuickMessage(message)}><MessageCircle size={16} />{message}</button>)}</div></section>
      <section className="cp-contact-thread"><div className="cp-contact-section-title"><h3>Conversation</h3><small>Saved with this booking</small></div>{threadQuery.isLoading ? <p className="cp-muted">Loading messages…</p> : threadQuery.isError ? <p className="cp-muted">Messages could not be loaded.</p> : messages.length ? <div className="cp-contact-bubbles">{messages.map(message => <article className={message.senderRole === "customer" ? "is-customer" : "is-team"} key={message.id}><p>{message.body}</p><small>{message.senderRole === "customer" ? job.customerName : "Your team"}</small></article>)}</div> : <p className="cp-muted">No messages on this booking yet.</p>}</section>
      <form className="cp-contact-compose" onSubmit={event => { event.preventDefault(); if (draft.trim()) sendMessage.mutate({ portalJobKey: job.portalJobKey, body: draft.trim() }); }}><label htmlFor={`contact-message-${job.portalJobKey}`}>Message {job.customerName}</label><textarea id={`contact-message-${job.portalJobKey}`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={1_000} placeholder="Type a message…" /><p>{job.customerName.split(" ")[0] || "The client"} will receive a Maids in Black text with this message and can reply in My Home.</p><button className="cp-btn cp-btn--primary cp-btn--wide" type="submit" disabled={!draft.trim() || sendMessage.isPending}>{sendMessage.isPending ? "Sending…" : "Send message"}</button></form>
      <button className="cp-btn cp-btn--subtle cp-btn--wide cp-contact-call" type="button" onClick={onCall}><Phone size={16} />Call client</button>
    </aside>
  </div>;
}

function JobCard({ job, onOpen, onContact, tomorrowLabel }: { job: PortalJob; onOpen?: () => void; onContact?: () => void; tomorrowLabel?: string }) {
  const complete = jobIsComplete(job);
  const isTomorrow = Boolean(tomorrowLabel);
  return (
    <article className={`cp-job-card ${complete ? "cp-job-card--complete" : ""}${isTomorrow ? " cp-job-card--tomorrow" : ""}`}>
      {tomorrowLabel && <span className="cp-job-card__tomorrow-label"><CalendarDays size={13} />Tomorrow · {tomorrowLabel}</span>}
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
          <div className="cp-job-card__payment"><span>Team payment</span><strong>{formatMoney(job.basePay)}</strong></div>
        </div>
      </div>
      <div className="cp-job-card__actions">
        {!isTomorrow && !complete && <button className="cp-btn cp-btn--subtle" onClick={onContact}><MessageCircle size={15} />Contact client</button>}
        <button className="cp-btn cp-btn--subtle" onClick={() => openDirections(job.address)}><Navigation size={15} />Directions</button>
        {!isTomorrow && onOpen && <button className="cp-btn cp-btn--primary" onClick={onOpen}>{complete ? "View job" : "Open job"}<ChevronRight size={15} /></button>}
      </div>
    </article>
  );
}

function SignaturePad({ canvasRef, onDraw }: { canvasRef: RefObject<HTMLCanvasElement | null>; onDraw: () => void }) {
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
    onDraw();
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

function JobDrawer({ job, onClose, onProgress, onContact }: { job: PortalJob; onClose: () => void; onProgress: (progress: { jobStatus: string; etaTimestamp: number | null; etaTimeStr: string | null }) => void; onContact: () => void }) {
  const [etaOpen, setEtaOpen] = useState(false);
  const [arrivalConfirm, setArrivalConfirm] = useState(false);
  const [selectedEta, setSelectedEta] = useState<EtaChoice>(30);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoType, setPendingPhotoType] = useState<"before" | "after">("before");
  const [activePhotoType, setActivePhotoType] = useState<"before" | "after" | null>(null);
  const [localPhotoPreviews, setLocalPhotoPreviews] = useState<Array<{ url: string; photoType: "before" | "after" }>>([]);
  const [satisfaction, setSatisfaction] = useState<"great" | "touchup" | "issue" | null>(null);
  const [signoffNotes, setSignoffNotes] = useState("");
  const [signoffSaved, setSignoffSaved] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [completionConfirm, setCompletionConfirm] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const progressQuery = trpc.cleanerPortalProgress.getForJob.useQuery({ portalJobKey: job.portalJobKey }, { retry: 0, throwOnError: false });
  const photosQuery = trpc.cleanerPortalPhotos.getForJob.useQuery({ portalJobKey: job.portalJobKey }, { retry: 0, throwOnError: false });
  const setEtaMutation = trpc.cleanerPortalProgress.setEta.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); setEtaOpen(false); result.customerNotified ? toast.success("ETA recorded and client notified.") : toast.warning(result.notificationError ? "ETA recorded, but the client message could not be sent." : "ETA recorded. No customer phone is on this booking."); }, onError: error => toast.error(error.message || "The ETA could not be recorded.") });
  const arrivedMutation = trpc.cleanerPortalProgress.markArrived.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); setArrivalConfirm(false); result.customerNotified ? toast.success("Arrival recorded and client notified.") : toast.warning(result.notificationError ? "Arrival recorded, but the client message could not be sent." : "Arrival recorded. No customer phone is on this booking."); }, onError: error => toast.error(error.message || "Arrival could not be recorded.") });
  const startMutation = trpc.cleanerPortalProgress.startJob.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); toast.success("Job started."); }, onError: error => toast.error(error.message || "The job could not be started.") });
  const uploadMutation = trpc.cleanerPortalPhotos.uploadPhoto.useMutation({ throwOnError: false, onError: error => toast.error(error.message || "Photo upload failed.") });
  const signoffQuery = trpc.cleanerPortalSignoff.getForJob.useQuery({ portalJobKey: job.portalJobKey }, { retry: 0, throwOnError: false });
  const saveSignatureMutation = trpc.cleanerPortalSignoff.saveSignature.useMutation({ throwOnError: false, onSuccess: async () => { await signoffQuery.refetch(); setSignoffSaved(true); setCompletionConfirm(true); toast.success("Customer sign-off saved."); }, onError: error => toast.error(error.message || "Customer sign-off could not be saved.") });
  const saveNotHomeMutation = trpc.cleanerPortalSignoff.saveNotHome.useMutation({ throwOnError: false, onSuccess: async () => { await signoffQuery.refetch(); setSignoffSaved(true); setCompletionConfirm(true); toast.success("Customer not-home status saved."); }, onError: error => toast.error(error.message || "Customer status could not be saved.") });
  const completeMutation = trpc.cleanerPortalSignoff.completeAfterSignoff.useMutation({ throwOnError: false, onSuccess: result => { onProgress(result); setCompletionConfirm(false); toast.success("Job marked complete."); onClose(); }, onError: error => toast.error(error.message || "The job could not be completed.") });
  const actionUnavailable = progressQuery.isLoading || progressQuery.isError;
  const actionPending = setEtaMutation.isPending || arrivedMutation.isPending || startMutation.isPending;
  const uploading = uploadMutation.isPending;
  const signoffUnavailable = signoffQuery.isLoading || signoffQuery.isError;
  const signoffPending = saveSignatureMutation.isPending || saveNotHomeMutation.isPending;
  const photoInputId = `cleaner-photo-${job.portalJobKey}`;
  const progress = progressQuery.data;
  const displayedJob = progress ? { ...job, jobStatus: progress.jobStatus } : job;
  const savedPhotos = photosQuery.data ?? [];
  const beforePhotoUrls = [
    ...savedPhotos.filter(photo => photo.photoType === "before").map(photo => photo.thumbnailUrl ?? photo.photoUrl),
    ...localPhotoPreviews.filter(photo => photo.photoType === "before").map(photo => photo.url),
  ];
  const afterPhotoUrls = [
    ...savedPhotos.filter(photo => photo.photoType !== "before").map(photo => photo.thumbnailUrl ?? photo.photoUrl),
    ...localPhotoPreviews.filter(photo => photo.photoType === "after").map(photo => photo.url),
  ];
  const choosePhotoGroup = (photoType: "before" | "after") => {
    if (uploading) return;
    setPendingPhotoType(photoType);
    setActivePhotoType(photoType);
    photoInputRef.current?.click();
  };
  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };
  const saveCustomerSignoff = () => {
    if (!satisfaction || signoffPending) return;
    const dataUrl = signatureCanvasRef.current?.toDataURL("image/png") ?? "";
    const signatureBase64 = dataUrl.split(",")[1];
    if (!signatureBase64) return;
    saveSignatureMutation.mutate({ portalJobKey: displayedJob.portalJobKey, signatureBase64, customerResponse: satisfaction, customerNotes: signoffNotes.trim() || undefined });
  };
  const uploadPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const photoType = pendingPhotoType;
    for (const file of files) {
      const preview = URL.createObjectURL(file);
      setLocalPhotoPreviews(previous => [...previous, { url: preview, photoType }]);
      try {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await uploadMutation.mutateAsync({
          portalJobKey: displayedJob.portalJobKey,
          filename: file.name,
          mimeType: file.type || "image/jpeg",
          dataBase64,
          photoType,
        });
        setLocalPhotoPreviews(previous => previous.filter(item => item.url !== preview));
        await photosQuery.refetch();
      } catch {
        // The mutation already presents the established photo-specific error toast.
        setLocalPhotoPreviews(previous => previous.filter(item => item.url !== preview));
      }
    }
    event.target.value = "";
  };
  return <>
    <div className="cp-drawer-backdrop" onClick={onClose}>
      <aside className="cp-drawer" onClick={event => event.stopPropagation()} aria-label={`Details for ${displayedJob.customerName}`}>
        <header className="cp-drawer__header"><div><span className="cp-eyebrow">{ordinal(displayedJob.jobIndex)} job · Today</span><h2>{displayedJob.customerName}</h2><p>{serviceLabel(displayedJob)} · {displayedJob.time}</p></div><button className="cp-icon-button" onClick={onClose} aria-label="Close job details"><X size={20} /></button></header>
        <section className="cp-detail-block cp-detail-block--address"><MapPin size={20} /><div><span>Service address</span><strong>{displayedJob.address || "Address pending"}</strong></div></section>
        <section className="cp-action-grid">
          <button className="cp-btn cp-btn--subtle" onClick={onContact}><MessageCircle size={16} />Contact client</button>
          <button className="cp-btn cp-btn--subtle" onClick={() => openDirections(displayedJob.address)}><Navigation size={16} />Directions</button>
          <button className="cp-btn cp-btn--dark" disabled={actionUnavailable || actionPending} onClick={() => setEtaOpen(true)}><Clock3 size={16} />Set ETA</button>
          <button className="cp-btn cp-btn--arrived" disabled={actionUnavailable || actionPending} onClick={() => setArrivalConfirm(true)}><CheckCircle2 size={16} />I’ve arrived</button>
          <button className="cp-btn cp-btn--primary cp-action-grid__wide" disabled={actionUnavailable || actionPending} onClick={() => startMutation.mutate({ portalJobKey: displayedJob.portalJobKey })}><CheckCircle2 size={16} />Start job</button>
        </section>
        {progressQuery.isError && <section className="cp-detail-block"><p className="cp-muted">ETA, arrival, and start are temporarily unavailable. Your job list is still available.</p></section>}
        <section className="cp-detail-block"><h3>Service scope</h3><div className="cp-tags"><span>{displayedJob.bathrooms} bathroom{displayedJob.bathrooms === 1 ? "" : "s"}</span>{displayedJob.extras.map(extra => <span key={extra}>{extra.replaceAll("_", " ")}</span>)}</div></section>
        {displayedJob.customerNotes && <section className="cp-detail-block"><h3>Visit notes</h3><p><b>Customer:</b> {displayedJob.customerNotes}</p></section>}
        <section className="cp-detail-block"><div className="cp-block-heading"><div><h3>Cleaning checklist</h3><p>Checklist actions will be enabled after portal visibility is confirmed.</p></div></div><p className="cp-muted">No checklist has been added to this job.</p></section>
        <section className="cp-detail-block"><div className="cp-block-heading"><div><h3>Before & after photos</h3><p>Select visit-condition and finished-result images from your photo library.</p></div></div><input id={photoInputId} className="cp-hidden-input" ref={photoInputRef} type="file" accept="image/*" multiple onChange={uploadPhotos} disabled={uploading} />
          {photosQuery.isError && <p className="cp-muted">Saved photos could not be loaded. You can keep working on this job.</p>}
          <div className="cp-photo-groups">
            {(["before", "after"] as const).map(photoType => {
              const isBefore = photoType === "before";
              const label = isBefore ? "Before" : "After";
              const detail = isBefore ? "visit condition" : "finished result";
              const photoUrls = isBefore ? beforePhotoUrls : afterPhotoUrls;
              return <section key={photoType} className={`cp-photo-group cp-photo-group--${photoType}`}><header className="cp-photo-group__head"><h4>{label} <small>({detail})</small></h4><span>{photoUrls.length} photo{photoUrls.length === 1 ? "" : "s"}</span></header><div className="cp-photo-group__grid"><button type="button" className={`cp-photo-tile cp-photo-tile--${photoType} ${activePhotoType === photoType ? "is-selected" : ""}`} aria-pressed={activePhotoType === photoType} disabled={uploading} onClick={() => choosePhotoGroup(photoType)}>{uploading && activePhotoType === photoType ? <Loader2 className="cp-spin" size={20} /> : <ImagePlus size={20} />}<span>Add photo</span></button>{photoUrls.map((url, index) => <img key={url} src={url} className="cp-photo-preview" alt={`${label} job photo ${index + 1}`} />)}</div>{activePhotoType === photoType && <p className="cp-photo-selection-state" role="status">{uploading ? `Uploading ${label.toLowerCase()} photos…` : `${label} selected — choose photos from your library.`}</p>}</section>;
            })}
          </div>
        </section>
        <section className="cp-detail-block cp-signoff"><span className="cp-eyebrow">Customer sign-off</span><h3>How did everything look?</h3>{signoffQuery.isError ? <p className="cp-muted">Customer sign-off is temporarily unavailable. Your job and photos remain available.</p> : signoffQuery.data || signoffSaved ? <><p className="cp-muted">Customer sign-off is saved for this visit.</p><button className="cp-btn cp-btn--primary cp-btn--wide" disabled={completeMutation.isPending} onClick={() => setCompletionConfirm(true)}><CheckCircle2 size={16} />Mark job complete</button><button className="cp-btn cp-btn--subtle cp-btn--wide" onClick={onClose}>Close job details</button></> : <><p>Ask the customer before recording their response and signature.</p><div className="cp-feedback-options">{([{ value: "great", label: "Looks great" }, { value: "touchup", label: "Needs touch-up" }, { value: "issue", label: "Report issue" }] as const).map(option => <button type="button" key={option.value} className={satisfaction === option.value ? "is-selected" : ""} disabled={signoffUnavailable || signoffPending} onClick={() => setSatisfaction(option.value)}>{option.label}</button>)}</div><textarea value={signoffNotes} onChange={event => setSignoffNotes(event.target.value)} disabled={signoffUnavailable || signoffPending} placeholder="Optional note from the customer" /><SignaturePad canvasRef={signatureCanvasRef} onDraw={() => setHasSignature(true)} /><div className="cp-signature-row"><span>Customer signature</span><button type="button" className="cp-link-button" disabled={signoffUnavailable || signoffPending} onClick={clearSignature}>Clear signature</button></div><button className="cp-btn cp-btn--primary cp-btn--wide" disabled={!satisfaction || !hasSignature || signoffUnavailable || signoffPending} onClick={saveCustomerSignoff}><CheckCircle2 size={16} />{signoffPending ? "Saving…" : "Save customer sign-off"}</button><button type="button" className="cp-link-button" disabled={signoffUnavailable || signoffPending} onClick={() => saveNotHomeMutation.mutate({ portalJobKey: displayedJob.portalJobKey })}>Customer was not home</button></>}</section>
      </aside>
    </div>
    {etaOpen && <div className="cp-modal-backdrop" onClick={() => setEtaOpen(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Arrival update</span><h3>Set arrival ETA</h3><p>The client will receive the selected arrival time.</p><div className="cp-eta-options">{ETA_CHOICES.map(minutes => <button key={minutes} onClick={() => setSelectedEta(minutes)} className={selectedEta === minutes ? "is-selected" : ""}>{formatEta(minutes)}</button>)}</div><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setEtaOpen(false)}>Cancel</button><button className="cp-btn cp-btn--primary" onClick={() => setEtaMutation.mutate({ portalJobKey: displayedJob.portalJobKey, minutes: selectedEta })} disabled={setEtaMutation.isPending}>Send ETA</button></div></div></div>}
    {arrivalConfirm && <div className="cp-modal-backdrop" onClick={() => setArrivalConfirm(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Confirm arrival</span><h3>Tell the client you’ve arrived?</h3><p>This will record your arrival and message the client.</p><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setArrivalConfirm(false)}>Cancel</button><button className="cp-btn cp-btn--arrived" onClick={() => arrivedMutation.mutate({ portalJobKey: displayedJob.portalJobKey })} disabled={arrivedMutation.isPending}>Mark arrived</button></div></div></div>}
    {completionConfirm && <div className="cp-modal-backdrop" onClick={() => setCompletionConfirm(false)}><div className="cp-modal" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Complete job</span><h3>Mark this job complete?</h3><p>The customer sign-off is saved. This will complete the job in the Cleaner Portal and close these details.</p><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={() => setCompletionConfirm(false)}>Cancel</button><button className="cp-btn cp-btn--primary" onClick={() => completeMutation.mutate({ portalJobKey: displayedJob.portalJobKey })} disabled={completeMutation.isPending}>{completeMutation.isPending ? "Completing…" : "Mark complete"}</button></div></div></div>}
  </>;
}

function AvailabilityDialog({ open, schedule, onClose, onSave, saving }: { open: boolean; schedule?: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number } | null; onClose: () => void; onSave: (values: { mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number; note: string | null }) => void; saving: boolean }) {
  const [days, setDays] = useState<Record<(typeof WEEK_DAYS)[number], boolean>>({ Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false, Sun: false });
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!schedule || !open) return;
    setDays({ Mon: schedule.mon === 1, Tue: schedule.tue === 1, Wed: schedule.wed === 1, Thu: schedule.thu === 1, Fri: schedule.fri === 1, Sat: schedule.sat === 1, Sun: schedule.sun === 1 });
  }, [open, schedule]);
  if (!open) return null;
  return <div className="cp-modal-backdrop" onClick={onClose}><div className="cp-modal cp-modal--wide" onClick={event => event.stopPropagation()}><span className="cp-eyebrow">Availability</span><h3>Set weekly availability</h3><p>Choose the days your team is available. Dispatch will use this weekly schedule.</p><div className="cp-week-days">{WEEK_DAYS.map(day => <button key={day} className={days[day] ? "is-selected" : ""} disabled={saving} onClick={() => setDays(current => ({ ...current, [day]: !current[day] }))}>{day}</button>)}</div><textarea value={note} disabled={saving} onChange={event => setNote(event.target.value)} placeholder="Optional note for dispatch" /><div className="cp-modal__actions"><button className="cp-btn cp-btn--subtle" onClick={onClose} disabled={saving}>Close</button><button className="cp-btn cp-btn--primary" disabled={saving} onClick={() => onSave({ mon: Number(days.Mon), tue: Number(days.Tue), wed: Number(days.Wed), thu: Number(days.Thu), fri: Number(days.Fri), sat: Number(days.Sat), sun: Number(days.Sun), note: note.trim() || null })}>{saving ? "Saving…" : "Save availability"}</button></div></div></div>;
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
  const [routeDay, setRouteDay] = useState<"today" | "tomorrow">("today");
  const [selectedJob, setSelectedJob] = useState<PortalJob | null>(null);
  const [contactJob, setContactJob] = useState<PortalJob | null>(null);
  const [selectedPayWeek, setSelectedPayWeek] = useState<PayWeekKey>("current");
  const [progressByJobKey, setProgressByJobKey] = useState<Record<string, { jobStatus: string; etaTimestamp: number | null; etaTimeStr: string | null }>>({});
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const utils = trpc.useUtils();
  const todayDate = useMemo(() => etDate(), []);
  const tomorrowDate = useMemo(() => etDate(1), []);
  const meQuery = trpc.cleaner.me.useQuery(undefined, { retry: 1, throwOnError: false });
  const todayQuery = trpc.cleanerPortalReadOnly.getMyJobsToday.useQuery(undefined, { enabled: !!meQuery.data, retry: 1, throwOnError: false });
  const tomorrowQuery = trpc.cleanerPortalReadOnly.getMyJobsTomorrow.useQuery(undefined, { enabled: !!meQuery.data && page === "today" && routeDay === "tomorrow", retry: 1, throwOnError: false });
  const weekQuery = trpc.cleanerPortalReadOnly.getMyJobsWeek.useQuery(undefined, { enabled: !!meQuery.data && page === "jobs", staleTime: 60_000, throwOnError: false });
  const portalDataQuery = trpc.cleaner.portalData.useQuery(undefined, { enabled: !!meQuery.data, staleTime: 300_000, throwOnError: false });
  const teamScheduleQuery = trpc.cleanerPortalReadOnly.getMyTeamSchedule.useQuery(undefined, { enabled: !!meQuery.data, staleTime: 300_000, throwOnError: false });
  const earningsQuery = trpc.cleanerPortalReadOnly.getMyEarnings.useQuery(undefined, { enabled: !!meQuery.data && page === "earnings", staleTime: 60_000, throwOnError: false });
  const logoutMutation = trpc.cleaner.logout.useMutation({ throwOnError: false, onSuccess: () => window.location.replace("/cleaner") });
  const languageMutation = trpc.cleaner.updateLanguage.useMutation({ throwOnError: false, onError: error => toast.error(error.message) });
  const availabilityMutation = trpc.cleanerPortalAvailability.submitWeeklySchedule.useMutation({ throwOnError: false, onSuccess: async () => { await Promise.all([utils.cleanerPortalReadOnly.getMyTeamSchedule.invalidate(), utils.cleaner.portalData.invalidate()]); toast.success("Availability saved."); setAvailabilityOpen(false); }, onError: error => toast.error(error.message || "Availability could not be saved.") });

  const jobs = (((routeDay === "tomorrow" ? tomorrowQuery.data : todayQuery.data) ?? []) as PortalJob[]).map(job => ({ ...job, ...progressByJobKey[job.portalJobKey] }));
  const activeJobs = jobs.filter(job => !jobIsComplete(job));
  const nextJob = activeJobs[0] ?? jobs[0] ?? null;
  const viewingTomorrow = routeDay === "tomorrow";
  const displayedDate = viewingTomorrow ? tomorrowDate : todayDate;
  const displayedDayLabel = viewingTomorrow ? "Tomorrow" : "Today";
  const displayedDateLabel = formatPortalDayAndDate(displayedDate);
  const routeLoading = viewingTomorrow && tomorrowQuery.isLoading;
  const routeError = viewingTomorrow && tomorrowQuery.isError;
  const weekJobs = (weekQuery.data ?? []) as WeekJob[];
  const currentPayWeek = earningsQuery.data?.current as PayWeekSummary | undefined;
  const previousPayWeek = earningsQuery.data?.previous as PayWeekSummary | undefined;
  const displayedPayWeek = selectedPayWeek === "current" ? currentPayWeek : previousPayWeek;
  const displayedPayWeekLabel = selectedPayWeek === "current" ? "Current pay week" : "Previous pay week";
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
        {page === "today" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">{displayedDayLabel} · {displayedDateLabel}</span><h1>{viewingTomorrow ? "Tomorrow’s work." : `Good day, ${firstName}.`}</h1><p>{routeLoading ? "Loading tomorrow’s assigned jobs…" : activeJobs.length ? `You have ${activeJobs.length} active job${activeJobs.length === 1 ? "" : "s"} ${viewingTomorrow ? "tomorrow" : "today"}.` : jobs.length ? `${displayedDayLabel}’s jobs are complete.` : `No jobs assigned for ${viewingTomorrow ? "tomorrow" : "today"}.`}</p></div><div className="cp-head-actions"><button className="cp-btn cp-btn--subtle" onClick={() => setAvailabilityOpen(true)}><CalendarDays size={16} />Set availability</button></div></div>
          <div className="cp-day-switcher" role="tablist" aria-label="Job day"><button type="button" role="tab" aria-selected={!viewingTomorrow} className={!viewingTomorrow ? "is-active" : ""} onClick={() => setRouteDay("today")}>Today</button><button type="button" role="tab" aria-selected={viewingTomorrow} className={viewingTomorrow ? "is-active" : ""} onClick={() => setRouteDay("tomorrow")}>Tomorrow <span>· {formatPortalDayAndDate(tomorrowDate, true)}</span></button></div>
          {!viewingTomorrow && nextJob && <div className="cp-hero"><div><span className="cp-live">{jobIsComplete(nextJob) ? "DAY COMPLETE" : "NEXT JOB"}</span><h2>{jobIsComplete(nextJob) ? "Great work today." : `${ordinal(nextJob.jobIndex)} job is ready`}</h2><p>{nextJob.customerName} · {serviceLabel(nextJob)} · {nextJob.address}</p><div className="cp-hero-actions"><button className="cp-btn cp-btn--primary" onClick={() => setSelectedJob(nextJob)}>{jobIsComplete(nextJob) ? "Review job" : `View ${ordinal(nextJob.jobIndex).toLowerCase()} job`}<ChevronRight size={16} /></button><button className="cp-btn cp-btn--subtle" onClick={() => openDirections(nextJob.address)}><Navigation size={16} />Directions</button></div></div><div className="cp-hero-side"><span>Assigned jobs</span><strong>{jobs.length}</strong><small>{activeJobs.length} active today</small></div></div>}
          {routeLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading tomorrow’s assigned jobs…</div> : routeError ? <div className="cp-empty">Tomorrow’s assigned jobs could not be loaded. <button className="cp-text-action" onClick={() => tomorrowQuery.refetch()}>Try again</button></div> : <div className="cp-layout"><section className="cp-panel"><div className="cp-panel-title"><div><span className="cp-eyebrow">{displayedDayLabel}’s route</span><h2>Assigned jobs</h2></div><button className="cp-text-action" onClick={() => setPage("jobs")}>View all <ChevronRight size={15} /></button></div>{jobs.length === 0 ? <div className="cp-empty">No active jobs are assigned for {viewingTomorrow ? "tomorrow" : "today"}.</div> : jobs.map(job => <JobCard key={job.portalJobKey} job={job} tomorrowLabel={viewingTomorrow ? formatPortalDayAndDate(job.jobDate) : undefined} onOpen={() => setSelectedJob(job)} onContact={() => setContactJob(job)} />)}</section><aside className="cp-side-stack"><section className="cp-panel"><span className="cp-eyebrow">Route</span><h3>{displayedDayLabel}’s drive</h3><div className="cp-route-list">{jobs.map(job => <div key={job.portalJobKey}><span className="cp-route-dot" /><p><b>{job.customerName}</b><small>{job.address || "Address pending"}</small></p><time>{job.time}</time></div>)}</div></section><section className="cp-panel"><span className="cp-eyebrow">Shift status</span><h3>{portalDataQuery.data?.tomorrowAvailability.submitted ? "Availability saved" : "Set tomorrow’s availability"}</h3><p className="cp-muted">Keep dispatch up to date with your current weekly schedule.</p><button className="cp-btn cp-btn--subtle cp-btn--wide" onClick={() => setAvailabilityOpen(true)}>Set availability</button></section></aside></div>}
        </section>}
        {page === "jobs" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">My work</span><h1>My jobs</h1><p>Your current workweek, using your existing assigned job list.</p></div></div><div className="cp-panel cp-job-list">{weekQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading assigned jobs…</div> : weekQuery.isError ? <div className="cp-empty">Your assigned jobs could not be loaded.</div> : weekJobs.length === 0 ? <div className="cp-empty">No upcoming jobs this week.</div> : weekJobs.map(job => <div className="cp-week-job" key={job.portalJobKey}><div className="cp-week-job__date"><b>{job.dateLabel === "today" ? "Today" : job.jobDate}</b><small>{job.time}</small></div><div><StatusPill job={job} /><h3>{job.customerName} · {serviceLabel(job)}</h3><p><MapPin size={14} />{job.address || "Address pending"}</p></div>{job.dateLabel === "today" && <button className="cp-btn cp-btn--primary cp-btn--small" onClick={() => { const todayJob = jobs.find(item => item.portalJobKey === job.portalJobKey); if (todayJob) setSelectedJob(todayJob); }}>Open</button>}</div>)}</div></section>}
        {page === "schedule" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Schedule</span><h1>Your availability</h1><p>Set the workdays that dispatch should use for your team schedule.</p></div><button className="cp-btn cp-btn--primary" onClick={() => setAvailabilityOpen(true)}>Set availability</button></div><div className="cp-panel cp-schedule-card"><CalendarDays size={25} /><h2>{teamScheduleQuery.data?.teamName ? `${teamScheduleQuery.data.teamName} schedule` : "Weekly availability"}</h2><p>Your existing weekly schedule and next-day availability check-in stay in one place.</p>{teamScheduleQuery.data?.schedule && <div className="cp-schedule-days">{WEEK_DAYS.map(day => <span key={day} className={teamScheduleQuery.data?.schedule?.[day.toLowerCase() as "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"] === 1 ? "is-working" : ""}>{day}</span>)}</div>}<button className="cp-btn cp-btn--primary" onClick={() => setAvailabilityOpen(true)}>Update availability</button></div></section>}
        {page === "earnings" && <section>
          <div className="cp-page-head"><div><span className="cp-eyebrow">Earnings</span><h1>Your earnings</h1><p>Calculated with the current Team Pay formula. Pay weeks run Sunday through Saturday.</p></div></div>
          {earningsQuery.isLoading ? <div className="cp-loading-inline"><Loader2 className="cp-spin" />Loading earnings…</div> : earningsQuery.isError ? <div className="cp-empty">Your earnings could not be loaded. Please try again.</div> : <>
            <div className="cp-money-grid">
              <button type="button" className={selectedPayWeek === "current" ? "is-selected" : ""} onClick={() => setSelectedPayWeek("current")} aria-pressed={selectedPayWeek === "current"}><span>Current pay week</span><strong>{formatMoney(currentPayWeek?.totalPay)}</strong><small>{currentPayWeek ? `${formatPayWeekDate(currentPayWeek.start)} – ${formatPayWeekDate(currentPayWeek.end)}` : ""}</small><em>View jobs</em></button>
              <button type="button" className={selectedPayWeek === "previous" ? "is-selected" : ""} onClick={() => setSelectedPayWeek("previous")} aria-pressed={selectedPayWeek === "previous"}><span>Previous pay week</span><strong>{formatMoney(previousPayWeek?.totalPay)}</strong><small>{previousPayWeek ? `${formatPayWeekDate(previousPayWeek.start)} – ${formatPayWeekDate(previousPayWeek.end)}` : ""}</small><em>View jobs</em></button>
              <article><span>Current streak</span><strong>{portalDataQuery.data?.streakInfo.currentStreak ?? 0}</strong><small>Completed-job streak</small></article>
            </div>
            <div className="cp-panel">
              <div className="cp-panel-title"><div><span className="cp-eyebrow">Pay-week jobs</span><h2>{displayedPayWeekLabel}</h2></div>{displayedPayWeek && <span className="cp-muted">{formatPayWeekDate(displayedPayWeek.start)} – {formatPayWeekDate(displayedPayWeek.end)}</span>}</div>
              {displayedPayWeek?.jobs.length ? displayedPayWeek.jobs.map(job => <div className="cp-earn-row" key={job.id}><div><b>{job.customerName || "Customer"}</b><span>{formatPayWeekDate(job.jobDate)} · {statusLabel(job.status)}</span></div><strong>{formatMoney(job.finalPay)}</strong></div>) : <div className="cp-empty">No jobs in this pay week.</div>}
            </div>
          </>}
        </section>}
        {page === "contact" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Contact</span><h1>Client contact</h1><p>For a current job, use the existing masked Call client flow.</p></div></div><div className="cp-panel cp-contact-panel"><Phone size={26} /><h2>Call a current client</h2><p>Open a job to call its client through the existing protected phone proxy. There is no separate cleaner message inbox to duplicate here.</p>{nextJob && <button className="cp-btn cp-btn--primary" onClick={() => callClient(nextJob)}>Call {nextJob.customerName}</button>}</div></section>}
        {page === "profile" && <section><div className="cp-page-head"><div><span className="cp-eyebrow">Profile</span><h1>Cleaner profile</h1><p>Your authenticated portal account.</p></div></div><div className="cp-profile-grid"><section className="cp-panel"><h2>Contact</h2><dl><div><dt>Name</dt><dd>{meQuery.data.name}</dd></div><div><dt>Phone</dt><dd>{meQuery.data.phone || "Not available"}</dd></div></dl></section><section className="cp-panel"><h2>Portal language</h2><p className="cp-muted">Use your saved language preference.</p><div className="cp-language-buttons">{(["en", "es", "pt"] as const).map(language => <button key={language} className={meQuery.data?.language === language ? "is-selected" : ""} onClick={() => languageMutation.mutate({ language })}>{language === "en" ? "English" : language === "es" ? "Español" : "Português"}</button>)}</div></section><section className="cp-panel"><h2>Session</h2><button className="cp-btn cp-btn--subtle" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}><LogOut size={16} />Log out</button></section></div></section>}
      </main>
    </div>
    <AvailabilityDialog open={availabilityOpen} schedule={teamScheduleQuery.data?.schedule} onClose={() => setAvailabilityOpen(false)} onSave={values => availabilityMutation.mutate(values)} saving={availabilityMutation.isPending} />
    {selectedJob && <JobDrawer job={{ ...selectedJob, ...progressByJobKey[selectedJob.portalJobKey] }} onClose={() => setSelectedJob(null)} onProgress={progress => setProgressByJobKey(current => ({ ...current, [selectedJob.portalJobKey]: progress }))} onContact={() => setContactJob(selectedJob)} />}
    {contactJob && <ContactClientPanel job={{ ...contactJob, ...progressByJobKey[contactJob.portalJobKey] }} onClose={() => setContactJob(null)} onCall={callClient} />}
  </div>;
}

export default CleanerPortalConnected;
