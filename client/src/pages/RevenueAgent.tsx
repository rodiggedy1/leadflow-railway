import { useMemo } from "react";
import { BarChart3, Clock3, MessageSquareText, RefreshCw, Send, Sparkles, Target, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { MadisonSmsDraftCard } from "@/components/CommandChat";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";

const MADISON_PHOTO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Target; label: string; value: number | string; tone: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</span>
        <Icon className="h-4 w-4" style={{ color: tone }} />
      </div>
      <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

export default function RevenueAgent() {
  const { agentName } = useAgentPermissions();
  const utils = trpc.useUtils();
  const { data: cards = [], isLoading, isFetching, refetch } = trpc.opsChat.getFocusCards.useQuery(undefined, {
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const smsCards = useMemo(() => cards.filter(card => card.quickAction === "madison_sms_draft"), [cards]);
  const needsReview = smsCards.length;

  const refresh = async () => {
    await refetch();
    await utils.opsChat.getUnresolvedMadisonCount.invalidate();
  };

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900">
      <AdminHeader activeTab="metrics" />
      <main className="mx-auto max-w-[1380px] px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[28px] bg-[#15132c] px-6 py-7 text-white shadow-[0_20px_55px_rgba(21,19,44,.18)] sm:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <img src={MADISON_PHOTO} alt="Madison" className="h-14 w-14 rounded-full border-2 border-white/30 object-cover" />
              <div>
                <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-violet-200"><Sparkles className="h-3.5 w-3.5" />Revenue Agent</div>
                <h1 className="text-3xl font-black tracking-tight">Revenue opportunities</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Review Madison&apos;s customer-facing SMS drafts in one focused workspace. Nothing sends without your approval.</p>
              </div>
            </div>
            <button type="button" onClick={refresh} disabled={isFetching} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Target} label="Needs review" value={needsReview.length} tone="#6d5cff" />
          <Stat icon={Clock3} label="Active SMS queue" value={smsCards.length} tone="#d97706" />
          <Stat icon={Send} label="Approval required" value={needsReview.length} tone="#15803d" />
          <Stat icon={BarChart3} label="Customer-facing channel" value="SMS" tone="#2563eb" />
        </section>

        <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Madison queue</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Draft review</h2>
              <p className="mt-1 text-sm text-slate-500">Edit, approve, or dismiss each active SMS draft using the existing guarded send path.</p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-slate-400">Loading Madison&apos;s queue…</div>
          ) : smsCards.length === 0 ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-violet-500"><MessageSquareText className="h-6 w-6" /></div>
              <h3 className="mt-4 text-lg font-black text-slate-900">You&apos;re all caught up</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">New Madison SMS drafts will appear here when they need a human review.</p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {smsCards.map(card => (
                <MadisonSmsDraftCard
                  key={card.id}
                  msg={{ ...card, createdAt: new Date(card.ts) }}
                  callerName={agentName ?? "Office"}
                  compact={false}
                  onActed={() => { void refresh(); }}
                />
              ))}
            </div>
          )}
        </section>

        <div className="mt-4 flex items-center gap-2 px-1 text-xs text-slate-400">
          <XCircle className="h-3.5 w-3.5" />
          <span>Sent and dismissed drafts are removed from the active approval queue; the existing draft lifecycle remains unchanged.</span>
        </div>
      </main>
    </div>
  );
}
