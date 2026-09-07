import { Check, MapPin, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import "./customer-portal-review.css";

const CHIPS = ["On time", "Super thorough", "Friendly team", "Great attention to detail", "Spotless results", "Went above & beyond", "Easy to communicate with", "Would book again"] as const;
type ReviewScreen = "rating" | "chips" | "generating" | "pick" | "edit" | "low" | "four" | "celebrate";

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(parsed);
}

function formatTime(value: string | null) {
  if (!value) return "Time pending";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(parsed);
}

function initialScreen(job: { customerRating: number | null; drafts: string[]; reviewDraftText: string | null }): ReviewScreen {
  if (job.customerRating === null) return "rating";
  if (job.customerRating <= 3) return "low";
  if (job.customerRating === 4) return "four";
  if (job.reviewDraftText) return "edit";
  return job.drafts.length === 3 ? "pick" : "chips";
}

export default function CustomerPortalReview() {
  const utils = trpc.useUtils();
  const review = trpc.customerPortalReview.getLatest.useQuery(undefined, { retry: 1, throwOnError: false });
  const submitRating = trpc.customerPortalReview.submitRating.useMutation();
  const generateDrafts = trpc.customerPortalReview.generateDrafts.useMutation();
  const chooseDraft = trpc.customerPortalReview.chooseDraft.useMutation();
  const recordThumbtackAction = trpc.customerPortalReview.recordThumbtackAction.useMutation();
  const [screen, setScreen] = useState<ReviewScreen>("rating");
  const [selectedRating, setSelectedRating] = useState(0);
  const [chips, setChips] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<string[]>([]);
  const [editor, setEditor] = useState("");
  const [error, setError] = useState("");
  const job = review.data?.job ?? null;
  const details = useMemo(() => job ? [job.bedrooms ? `${job.bedrooms} bed` : null, job.bathrooms ? `${job.bathrooms} bath` : null, job.frequency].filter(Boolean).join(" · ") : "", [job]);

  useEffect(() => {
    if (!job) return;
    setScreen(initialScreen(job));
    setSelectedRating(job.customerRating ?? 0);
    setDrafts(job.drafts);
    setEditor(job.reviewDraftText ?? "");
  }, [job?.id]);

  if (review.isLoading) return <main className="mib-review-page"><div className="mib-review-loading">Loading your completed cleaning…</div></main>;
  if (review.isError) return <main className="mib-review-page"><section className="mib-review-empty"><h1>Reviews are temporarily unavailable.</h1><button type="button" onClick={() => review.refetch()}>Try again</button></section></main>;
  if (!job) return <main className="mib-review-page"><section className="mib-review-empty"><Sparkles /><h1>No completed cleaning is ready for review yet.</h1><p>Once your team marks a cleaning complete, your review will appear here.</p><a href="/my-home">Return to My Home</a></section></main>;

  const handleRating = async (rating: number) => {
    setError(""); setSelectedRating(rating);
    try {
      await submitRating.mutateAsync({ leadflowJobId: job.id, rating });
      await utils.customerPortalReview.getLatest.invalidate();
      setScreen(rating === 5 ? "chips" : rating === 4 ? "four" : "low");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Your rating could not be saved."); }
  };
  const writeReview = async () => {
    setError(""); setScreen("generating");
    try {
      const result = await generateDrafts.mutateAsync({ leadflowJobId: job.id, chips: chips as (typeof CHIPS)[number][], freeText: note.trim() || undefined });
      setDrafts(result.drafts); setScreen("pick"); await utils.customerPortalReview.getLatest.invalidate();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "We could not prepare your review."); setScreen("chips"); }
  };
  const pickDraft = async (index: number) => {
    setError("");
    try { const result = await chooseDraft.mutateAsync({ leadflowJobId: job.id, draftIndex: index + 1 }); setEditor(result.draft); setScreen("edit"); } catch (reason) { setError(reason instanceof Error ? reason.message : "That review option is unavailable."); }
  };
  const copyAndOpen = async () => {
    setError("");
    try {
      await navigator.clipboard?.writeText(editor);
      const result = await recordThumbtackAction.mutateAsync({ leadflowJobId: job.id, draftText: editor });
      window.open(result.thumbtackReviewUrl, "_blank", "noopener,noreferrer");
      setScreen("celebrate");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "We could not open Thumbtack. Please try again."); }
  };
  const toggleChip = (chip: string) => setChips(current => current.includes(chip) ? current.filter(item => item !== chip) : [...current, chip]);

  return <main className="mib-review-page"><div className="mib-review-shell">
    <header className="mib-review-hero"><div className="mib-review-hero-copy"><img src="/manus-storage/mib-logo-final_1a34a6c1.png" alt="Maids in Black" /><h1>Thanks for having<br />us today!</h1><p>We hope you love your clean.</p></div><div className="mib-review-photo"><img src="/manus-storage/customer-review-cleaner-hero-clean_1439c1cc.png" alt="A Maids in Black cleaner at work" /></div></header>
    <section className="mib-review-summary" aria-label="Completed appointment details"><div className="mib-review-details"><div className="mib-review-detail"><span className="mib-review-tile">▣</span><div><small>Appointment details</small><strong>{formatDate(job.jobDate)}</strong><span>{formatTime(job.serviceDateTime)}</span></div></div><div className="mib-review-detail"><span className="mib-review-tile"><MapPin /></span><div><small>Address</small><strong>{job.jobAddress || "Service address"}</strong></div></div><div className="mib-review-detail"><span className="mib-review-tile">✦</span><div><small>Service</small><strong>{job.serviceName || "Home cleaning"}</strong><span>{details || "Completed cleaning"}</span></div></div></div><div className="mib-review-complete"><span><Check /></span><div><strong>Completed</strong><p>Your home is clean<br />and complete.</p></div></div></section>
    {screen === "rating" && <section className="mib-review-card"><small>Leave a review</small><h2>How did {job.customerName.split(" ")[0] || "your"}&apos;s team do today?</h2><p>Your feedback helps us keep delivering an amazing experience.</p><div className="mib-review-tip">💰&nbsp; A 5-star review gets your team a $50 tip</div><div className="mib-review-stars" role="group" aria-label="Choose a rating">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} className={value <= selectedRating ? "selected" : ""} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => void handleRating(value)} disabled={submitRating.isPending}>★</button>)}</div><em>Tap a star to rate</em>{error && <b className="mib-review-error">{error}</b>}<button className="mib-review-submit" type="button" disabled>Submit review</button></section>}
    {screen === "chips" && <section className="mib-review-flow"><div className="mib-review-flow-icon">🌟</div><h2>Amazing! What stood out?</h2><p>Pick all that apply — we&apos;ll write your review</p><div className="mib-review-chips">{CHIPS.map(chip => <button type="button" className={chips.includes(chip) ? "selected" : ""} key={chip} onClick={() => toggleChip(chip)}>{chip}</button>)}</div><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Anything else you want to mention? (optional)" /><button className="mib-review-primary" type="button" disabled={!chips.length && !note.trim()} onClick={() => void writeReview()}>✨ Write My Review</button><button className="mib-review-link" type="button" onClick={() => setScreen("celebrate")}>Skip for now</button>{error && <b className="mib-review-error">{error}</b>}</section>}
    {screen === "generating" && <section className="mib-review-flow"><div className="mib-review-spinner">✨</div><h2>Crafting your review...</h2><p>Personalizing 3 options just for you</p></section>}
    {screen === "pick" && <section className="mib-review-flow"><h2>Pick a review to share</h2><p>Tap one to customize it</p><div className="mib-review-drafts">{drafts.map((draft, index) => <button type="button" key={draft} onClick={() => void pickDraft(index)}><b>#{index + 1}</b><span>{draft}</span></button>)}</div><button className="mib-review-link" type="button" onClick={() => setScreen("chips")}>← Start over</button>{error && <b className="mib-review-error">{error}</b>}</section>}
    {screen === "edit" && <section className="mib-review-flow"><h2>Edit if you&apos;d like</h2><p>Then copy it and paste into Thumbtack</p><textarea value={editor} onChange={event => setEditor(event.target.value)} maxLength={2_000} /><button className="mib-review-primary" type="button" disabled={!editor.trim() || recordThumbtackAction.isPending} onClick={() => void copyAndOpen()}>📋 Copy &amp; Open Thumbtack</button><button className="mib-review-link" type="button" onClick={() => setScreen("pick")}>← Choose a different draft</button>{error && <b className="mib-review-error">{error}</b>}</section>}
    {screen === "low" && <section className="mib-review-flow"><div className="mib-review-flow-icon">🙏</div><h2>Thanks for the feedback</h2><p>We appreciate your honesty. Our team will follow up shortly.</p><button className="mib-review-link" type="button" onClick={() => setScreen("rating")}>Change rating</button></section>}
    {screen === "four" && <section className="mib-review-flow"><div className="mib-review-flow-icon">🌟</div><h2>Thank you, {job.customerName.split(" ")[0] || "there"}!</h2><p>We&apos;re glad you had a great experience. See you next time! 🖤</p></section>}
    {screen === "celebrate" && <section className="mib-review-flow"><div className="mib-review-flow-icon">🌟</div><h2>Thank you, {job.customerName.split(" ")[0] || "there"}!</h2><p>{selectedRating === 5 ? "We appreciate you supporting your cleaning team." : "We appreciate you taking a moment to share your feedback."}</p>{selectedRating === 5 && <button className="mib-review-primary" type="button" onClick={() => setScreen("chips")}>✨ Write a Thumbtack Review</button>}</section>}
  </div></main>;
}
