import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, RefreshCw, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { BulkSmsConfirmCard, type BulkSmsConfirmCardData } from "./BulkSmsConfirmCard";
import { toast } from "sonner";

type MoveKind = "protect_tomorrow" | "save_cancellation" | "fill_capacity" | "recover_qualified_leads" | "smart_upsell";
type Move = {
  id?: number;
  moveKey: string;
  kind: MoveKind;
  priority: "urgent" | "high" | "normal";
  headline: string;
  businessReason: string;
  impact: string;
  eligibleCount: number;
  excludedCount: number;
  excludedReasons: string[];
  recipients: Array<{ name: string; phone: string; reason: string }>;
  draftMessage?: string;
  targetDescription?: string;
  details?: string[];
  detailSections?: Array<{ heading: string; items: Array<{ key: string; label: string; resolved: boolean }> }>;
  remainingIssueCount?: number;
  completedIssueCount?: number;
  status: "ready" | "dismissed" | "sent" | "completed";
};

const kindLabel: Record<MoveKind, string> = {
  protect_tomorrow: "Protect tomorrow",
  save_cancellation: "Save cancellation",
  fill_capacity: "Fill capacity",
  recover_qualified_leads: "Recover leads",
  smart_upsell: "Smart upsell",
};
const kindTone: Record<MoveKind, { tint: string; ink: string; icon: React.ReactNode }> = {
  protect_tomorrow: { tint: "#fff1ee", ink: "#c2412d", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  save_cancellation: { tint: "#fff8e8", ink: "#a16207", icon: <Clock3 className="h-3.5 w-3.5" /> },
  fill_capacity: { tint: "#eef9f3", ink: "#15803d", icon: <ArrowUpRight className="h-3.5 w-3.5" /> },
  recover_qualified_leads: { tint: "#f1edff", ink: "#6d47cf", icon: <Users className="h-3.5 w-3.5" /> },
  smart_upsell: { tint: "#fff4e8", ink: "#b45309", icon: <Sparkles className="h-3.5 w-3.5" /> },
};

function MoveCard({ move, onReview, onDismiss, onRestore, onReviewItem, reviewItemPending }: { move: Move; onReview: () => void; onDismiss: () => void; onRestore: () => void; onReviewItem: (itemKey: string, resolved: boolean) => void; reviewItemPending: boolean }) {
  const tone = kindTone[move.kind];
  const canContact = move.status === "ready" && move.recipients.length > 0 && Boolean(move.draftMessage);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <article className="rounded-2xl border border-[#e8e2ef] bg-white p-3.5 shadow-[0_7px_22px_rgba(75,50,115,0.06)]">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl" style={{ background: tone.tint, color: tone.ink }}>{tone.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em]" style={{ color: tone.ink }}>{kindLabel[move.kind]}</span>
            {move.priority === "urgent" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-600">Priority</span>}
          </div>
          <h3 className="mt-0.5 text-[13px] font-bold leading-snug text-slate-800">{move.headline}</h3>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">{move.businessReason}</p>
      <div className="mt-3 rounded-xl border border-[#eee8f4] bg-[#fcfbff] px-3 py-2.5">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#846db4]">Likely impact</p>
        <p className="mt-0.5 text-[11px] font-semibold leading-relaxed text-slate-700">{move.impact}</p>
      </div>
      {(move.eligibleCount > 0 || move.excludedCount > 0) && (
        <div className="mt-3 flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f1edff] px-2 py-1 font-bold text-[#6d47cf]"><Users className="h-3 w-3" /> {move.eligibleCount} qualify</span>
          {move.excludedCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[#fff8e8] px-2 py-1 font-semibold text-[#a16207]"><ShieldCheck className="h-3 w-3" /> {move.excludedCount} protected</span>}
        </div>
      )}
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <button onClick={() => canContact ? onReview() : setDetailsOpen((value) => !value)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#7447f5] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#6437e5]">
          {canContact ? <Send className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />} {canContact ? "Review & send" : detailsOpen ? "Hide details" : "See details"}
        </button>
        {move.status === "ready" ? <button onClick={onDismiss} className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50">Not now</button> : move.status === "dismissed" ? <button onClick={onRestore} className="rounded-xl border border-[#d9caff] bg-[#faf8ff] px-3 py-2 text-[11px] font-bold text-[#6541cf] transition hover:bg-[#f1edff]">Bring back</button> : null}
      </div>
      {detailsOpen && <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600"><p className="mb-2 text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-400">Verified details</p>{move.detailSections?.length ? <div className="space-y-3">{move.detailSections.map((section) => { const pending = section.items.filter((item) => !item.resolved); const completed = section.items.filter((item) => item.resolved); return <section key={section.heading}><div className="mb-1 flex items-center justify-between gap-2"><p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#846db4]">{section.heading}</p>{move.kind === "protect_tomorrow" && <span className="text-[9px] font-bold text-slate-400">{pending.length} remaining</span>}</div>{pending.length > 0 && <ul className="space-y-1.5">{pending.map((item) => <li key={item.key} className="flex items-start gap-2"><span className="min-w-0 flex-1">• {item.label}</span>{move.kind === "protect_tomorrow" && move.status === "ready" && <button onClick={() => onReviewItem(item.key, true)} disabled={reviewItemPending} className="shrink-0 rounded-md border border-emerald-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50">Resolve</button>}</li>)}</ul>}{completed.length > 0 && <details className="mt-1.5"><summary className="cursor-pointer text-[10px] font-semibold text-emerald-700">Completed ({completed.length})</summary><ul className="mt-1.5 space-y-1.5">{completed.map((item) => <li key={item.key} className="flex items-start gap-2 text-slate-400"><span className="min-w-0 flex-1 line-through">• {item.label}</span>{move.kind === "protect_tomorrow" && (move.status === "ready" || move.status === "completed") && <button onClick={() => onReviewItem(item.key, false)} disabled={reviewItemPending} className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">Undo</button>}</li>)}</ul></details>}</section>; })}</div> : move.details?.length ? <ul className="space-y-1">{move.details.map((detail) => <li key={detail}>• {detail}</li>)}</ul> : <p>Madison has no additional verified detail for this move.</p>}</div>}
    </article>
  );
}

export function MadisonsMovesPanel() {
  const [tab, setTab] = useState<"ready" | "history">("ready");
  const [reviewing, setReviewing] = useState<Move | null>(null);
  const movesScrollRef = useRef<HTMLDivElement>(null);
  const reviewPanelRef = useRef<HTMLDivElement>(null);
  const movesQuery = trpc.madisonMoves.list.useQuery(undefined, { staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false });
  const historyQuery = trpc.madisonMoves.history.useQuery(undefined, { enabled: tab === "history", staleTime: 30_000 });
  const dismiss = trpc.madisonMoves.dismiss.useMutation({ onSuccess: () => { setReviewing(null); setTab("history"); movesQuery.refetch(); historyQuery.refetch(); } });
  const restore = trpc.madisonMoves.restore.useMutation({ onSuccess: () => { setTab("ready"); movesQuery.refetch(); historyQuery.refetch(); } });
  const reviewItem = trpc.madisonMoves.reviewProtectTomorrowItem.useMutation({ onSuccess: (result) => { if (result.completed) setTab("history"); toast.success(result.completed ? "All Protect Tomorrow items are reviewed." : "Item marked resolved."); movesQuery.refetch(); historyQuery.refetch(); }, onError: (error) => toast.error(error.message) });
  const sendMadisonMove = trpc.madisonMoves.send.useMutation();
  const moves = (movesQuery.data?.moves ?? []) as Move[];
  const stats = movesQuery.data?.stats ?? { moves: 0, recipients: 0, urgent: 0 };
  const history = (historyQuery.data ?? []) as Move[];
  const visible = tab === "ready" ? moves.filter((move) => move.status === "ready") : history;
  const reviewCard: BulkSmsConfirmCardData | null = reviewing?.draftMessage ? {
    targetDescription: reviewing.targetDescription ?? "qualified customers",
    recipients: reviewing.recipients.map(({ name, phone }) => ({ name, phone })),
    draftMessage: reviewing.draftMessage,
    audience: "customer",
    excludedCount: reviewing.excludedCount,
    excludedReasons: reviewing.excludedReasons,
  } : null;

  useEffect(() => {
    if (!reviewing) return;
    requestAnimationFrame(() => {
      movesScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      reviewPanelRef.current?.focus({ preventScroll: true });
    });
  }, [reviewing]);

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-[#e8e2ef] bg-[#fbf9ff]">
      <header className="shrink-0 border-b border-[#e8e2ef] bg-white px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-[#7447f5] to-[#a96ef6] text-white shadow-[0_6px_15px_rgba(116,71,245,0.25)]"><Sparkles className="h-4 w-4" /></div>
            <div><h2 className="text-sm font-extrabold text-slate-800">Madison’s Moves</h2><p className="mt-0.5 text-[10px] text-slate-500">Real opportunities, ready for review</p></div>
          </div>
          <button onClick={() => movesQuery.refetch()} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-[#7447f5]" title="Refresh moves"><RefreshCw className={`h-3.5 w-3.5 ${movesQuery.isFetching ? "animate-spin" : ""}`} /></button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {[{ label: "Ready", value: stats.moves }, { label: "Contacts", value: stats.recipients }, { label: "Priority", value: stats.urgent }].map((metric) => <div key={metric.label} className="rounded-xl bg-[#f7f3fd] px-2 py-2 text-center"><div className="text-sm font-extrabold text-[#6541cf]">{metric.value}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-[#927fb7]">{metric.label}</div></div>)}
        </div>
        <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["ready", "history"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold capitalize transition ${tab === value ? "bg-white text-[#6541cf] shadow-sm" : "text-slate-500"}`}>{value}</button>)}
        </div>
      </header>
      <div ref={movesScrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {reviewing && reviewCard && (
          <div ref={reviewPanelRef} tabIndex={-1} className="mb-3 outline-none">
            <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#7657bd]">Review recipients & message</span><button onClick={() => setReviewing(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button></div>
            <BulkSmsConfirmCard card={reviewCard} onDismiss={() => setReviewing(null)} onReviewSend={async ({ recipients, message }) => {
              const result = await sendMadisonMove.mutateAsync({ moveKey: reviewing.moveKey, recipients, message });
              return { message: result.message, results: result.results };
            }} onSent={(result) => { toast.success(result.message); setReviewing(null); movesQuery.refetch(); historyQuery.refetch(); }} />
          </div>
        )}
        {movesQuery.isLoading && <div className="grid place-items-center py-10 text-xs text-slate-400"><RefreshCw className="mb-2 h-4 w-4 animate-spin" /> Finding verified moves…</div>}
        {!movesQuery.isLoading && visible.length === 0 && <div className="rounded-2xl border border-dashed border-[#ddd4ed] bg-white px-5 py-10 text-center"><CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" /><p className="mt-3 text-xs font-bold text-slate-700">Nothing needs a move right now.</p><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Madison will surface the next verified opportunity here.</p></div>}
        <div className="space-y-3">{visible.map((move) => <MoveCard key={move.moveKey} move={move} onReview={() => setReviewing(move)} onDismiss={() => dismiss.mutate({ moveKey: move.moveKey, kind: move.kind })} onRestore={() => restore.mutate({ moveKey: move.moveKey })} onReviewItem={(itemKey, resolved) => reviewItem.mutate({ moveKey: move.moveKey, itemKey, resolved })} reviewItemPending={reviewItem.isPending} />)}</div>
      </div>
      <footer className="shrink-0 border-t border-[#e8e2ef] bg-white px-4 py-2.5"><p className="flex items-center gap-1.5 text-[9px] leading-relaxed text-slate-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Every outreach move is rechecked and requires your Send approval.</p></footer>
    </aside>
  );
}
