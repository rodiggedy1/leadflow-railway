import { MapPin, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import "./customer-portal-review.css";

const CHIPS = ["On time", "Super thorough", "Friendly team", "Great attention to detail", "Spotless results", "Went above & beyond", "Easy to communicate with", "Would book again"] as const;
type ReviewScreen = "rating" | "chips" | "generating" | "pick" | "edit" | "low" | "four" | "celebrate";
const DC_NIGHT_MAP_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/dc-night-map_7cb31538.jpg";
const COMPLETION_STEPS = ["Confirmed", "On the Way", "Arrived", "Cleaning", "Done"] as const;

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

  if (review.isLoading) return <DarkState icon="✦" title="Loading your completed clean…" detail="Getting your review ready." />;
  if (review.isError) return <DarkState icon="!" title="Reviews are temporarily unavailable." detail="Please try again in a moment." action={<button type="button" onClick={() => review.refetch()}>Try again</button>} />;
  if (!job) return <DarkState icon="✦" title="No completed cleaning is ready for review yet." detail="Once your team marks a cleaning complete, your review will appear here." action={<a href="/my-home">Return to My Home</a>} />;

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

  const firstName = job.customerName.split(" ")[0] || "there";
  const teamDisplay = job.teamName ?? "Your Team";
  return <main className="min-h-screen bg-[#0a0a0a] text-white font-sans">
    <header className="relative h-52 overflow-hidden">
      <img src={DC_NIGHT_MAP_URL} alt="Washington DC" className="h-full w-full object-cover opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#0a0a0a]" />
      <div className="absolute inset-0 flex items-center justify-center"><div className="relative"><div className="h-5 w-5 rounded-full bg-white shadow-2xl shadow-emerald-400/40" /><div className="absolute inset-0 animate-ping rounded-full bg-white/40" /></div></div>
      <div className="absolute left-4 right-4 top-4 flex items-center justify-between"><div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-sm backdrop-blur-sm">🧹</span><span className="text-sm font-semibold tracking-wide text-white/80">Maids in Black</span></div><span className="text-xs text-white/40">Live Tracker</span></div>
    </header>
    <div className="mx-auto -mt-2 w-full max-w-md space-y-4 px-4 pb-8">
      <section className="rounded-2xl border border-white/5 bg-[#141414] p-5 shadow-lg shadow-emerald-400/40"><div className="flex items-start gap-4"><span className="mt-0.5 text-3xl leading-none">✨</span><div><p className="text-lg font-bold text-emerald-300">All Done!</p><p className="mt-0.5 text-sm text-white/50">Your home is sparkling clean</p></div></div></section>
      <section className="rounded-2xl border border-white/5 bg-[#141414] p-5" aria-label="Completed appointment progress"><div className="relative flex items-center justify-between"><div className="absolute left-8 right-8 top-4 h-0.5 bg-emerald-500/60" />{COMPLETION_STEPS.map((label, index) => <div key={label} className="z-10 flex flex-col items-center gap-1.5"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">✓</span><span className="text-[10px] font-medium tracking-wide text-white/60">{label}</span></div>)}</div></section>
      <section className="space-y-4 rounded-2xl border border-white/5 bg-[#141414] p-5" aria-label="Completed appointment details"><h2 className="text-xs font-semibold uppercase tracking-widest text-white/40">Your Appointment</h2><div className="space-y-3">
        <AppointmentDetail icon="👥" label="Team" value={teamDisplay} />
        <AppointmentDetail icon="📅" label="Date" value={formatDate(job.jobDate)} />
        <AppointmentDetail icon="🕐" label="Scheduled Time" value={formatTime(job.serviceDateTime)} />
        <AppointmentDetail icon={<MapPin className="h-4 w-4" />} label="Address" value={job.jobAddress || "Service address"} />
        <AppointmentDetail icon="🧽" label="Service" value={job.serviceName || "Home cleaning"} detail={details || "Completed cleaning"} />
      </div></section>
      {screen === "rating" && <DarkReviewCard><p className="mb-4 text-sm font-medium uppercase tracking-wide text-white/70">How was your clean?</p><p className="mb-4 text-sm text-white/50">Your feedback helps us improve.</p><div className="mb-3 flex justify-center gap-2" role="group" aria-label="Choose a rating">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} className={`select-none text-4xl transition-all duration-150 ${value <= selectedRating ? "scale-110 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" : "text-white/20"}`} aria-label={`${value} star${value === 1 ? "" : "s"}`} onClick={() => void handleRating(value)} disabled={submitRating.isPending}>★</button>)}</div><p className="text-xs text-white/40">Tap a star to rate</p>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}</DarkReviewCard>}
      {screen === "chips" && <DarkReviewCard><div className="mb-4 text-4xl">🌟</div><h2 className="text-xl font-semibold">Amazing! What stood out?</h2><p className="mt-2 text-sm text-white/50">Pick all that apply — we&apos;ll write your review</p><div className="mt-6 flex flex-wrap justify-center gap-2">{CHIPS.map(chip => <button type="button" className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${chips.includes(chip) ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-300" : "border-white/20 bg-white/5 text-white/70"}`} key={chip} onClick={() => toggleChip(chip)}>{chip}</button>)}</div><textarea className="mt-5 min-h-28 w-full resize-y rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-amber-400/60 focus:outline-none" value={note} onChange={event => setNote(event.target.value)} maxLength={500} placeholder="Anything else you want to mention? (optional)" /><button className="mt-5 w-full rounded-xl bg-amber-400 py-3 text-sm font-semibold tracking-wide text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!chips.length && !note.trim()} onClick={() => void writeReview()}>✨ Write My Review</button><button className="mt-4 text-sm text-white/50 underline decoration-white/30 underline-offset-4" type="button" onClick={() => setScreen("celebrate")}>Skip for now</button>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}</DarkReviewCard>}
      {screen === "generating" && <DarkReviewCard><div className="mx-auto mb-5 grid h-16 w-16 animate-spin place-items-center rounded-full border-2 border-white/10 border-t-emerald-400 text-2xl">✨</div><h2 className="text-xl font-semibold">Crafting your review...</h2><p className="mt-2 text-sm text-white/50">Personalizing 3 options just for you</p></DarkReviewCard>}
      {screen === "pick" && <DarkReviewCard><h2 className="text-xl font-semibold">Pick a review to share</h2><p className="mt-2 text-sm text-white/50">Tap one to customize it</p><div className="mt-6 grid gap-3 text-left">{drafts.map((draft, index) => <button type="button" key={draft} className="rounded-2xl border border-white/15 bg-white/5 p-4 text-left transition-colors hover:border-amber-400/50" onClick={() => void pickDraft(index)}><b className="text-sm text-amber-400">#{index + 1}</b><span className="mt-2 block text-sm leading-6 text-white/75">{draft}</span></button>)}</div><button className="mt-5 text-sm text-white/50 underline decoration-white/30 underline-offset-4" type="button" onClick={() => setScreen("chips")}>← Start over</button>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}</DarkReviewCard>}
      {screen === "edit" && <DarkReviewCard><h2 className="text-xl font-semibold">Edit if you&apos;d like</h2><p className="mt-2 text-sm text-white/50">Then copy it and paste into Thumbtack</p><textarea className="mt-5 min-h-36 w-full resize-y rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm leading-6 text-white focus:border-amber-400/60 focus:outline-none" value={editor} onChange={event => setEditor(event.target.value)} maxLength={2_000} /><button className="mt-5 w-full rounded-xl bg-amber-400 py-3 text-sm font-semibold tracking-wide text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!editor.trim() || recordThumbtackAction.isPending} onClick={() => void copyAndOpen()}>📋 Copy &amp; Open Thumbtack</button><button className="mt-4 text-sm text-white/50 underline decoration-white/30 underline-offset-4" type="button" onClick={() => setScreen("pick")}>← Choose a different draft</button>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}</DarkReviewCard>}
      {screen === "low" && <DarkReviewCard><div className="mb-4 text-4xl">🙏</div><h2 className="text-xl font-semibold">Thanks for the feedback</h2><p className="mt-2 text-sm text-white/50">We appreciate your honesty. Our team will follow up shortly.</p><button className="mt-5 text-sm text-white/50 underline decoration-white/30 underline-offset-4" type="button" onClick={() => setScreen("rating")}>Change rating</button></DarkReviewCard>}
      {screen === "four" && <DarkReviewCard><div className="mb-4 text-4xl">🌟</div><h2 className="text-xl font-semibold">Thank you, {firstName}!</h2><p className="mt-2 text-sm text-white/50">We&apos;re glad you had a great experience. See you next time! 🖤</p></DarkReviewCard>}
      {screen === "celebrate" && <DarkReviewCard><div className="mb-4 text-4xl">🌟</div><h2 className="text-xl font-semibold">Thank you, {firstName}!</h2><p className="mt-2 text-sm text-white/50">{selectedRating === 5 ? "We appreciate you supporting your cleaning team." : "We appreciate you taking a moment to share your feedback."}</p>{selectedRating === 5 && <button className="mt-5 w-full rounded-xl bg-amber-400 py-3 text-sm font-semibold tracking-wide text-black transition-colors hover:bg-amber-300" type="button" onClick={() => setScreen("chips")}>✨ Write a Thumbtack Review</button>}</DarkReviewCard>}
      <footer className="pb-4 pt-2 text-center text-xs text-white/20">Questions? Text us at <a href="tel:+12028885362" className="text-white/40 underline">(202) 888-5362</a></footer>
    </div>
  </main>;
}

function DarkReviewCard({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/5 bg-[#141414] p-5 text-center">{children}</section>;
}

function AppointmentDetail({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return <div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-base">{icon}</span><div className="min-w-0 text-left"><p className="text-xs text-white/40">{label}</p><p className="truncate text-sm font-semibold text-white">{value}</p>{detail && <p className="mt-0.5 text-xs text-white/40">{detail}</p>}</div></div>;
}

function DarkState({ icon, title, detail, action }: { icon: string; title: string; detail: string; action?: React.ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a] px-8 text-center text-white"><span className="text-4xl">{icon}</span><h1 className="text-lg font-semibold">{title}</h1><p className="max-w-sm text-sm text-white/40">{detail}</p>{action && <div className="[&_a]:rounded-xl [&_a]:bg-amber-400 [&_a]:px-4 [&_a]:py-3 [&_a]:text-sm [&_a]:font-semibold [&_a]:text-black [&_a]:no-underline [&_button]:rounded-xl [&_button]:bg-amber-400 [&_button]:px-4 [&_button]:py-3 [&_button]:text-sm [&_button]:font-semibold [&_button]:text-black">{action}</div>}</main>;
}
