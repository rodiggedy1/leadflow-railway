/**
 * AiConcierge — AI Operations Concierge chat interface.
 *
 * Dark chat UI with:
 * - Bot avatar + header
 * - User message bubbles (blue)
 * - AI response with step-by-step workflow progress cards
 * - Completed / failed / in-progress step states
 * - Commands and People chips at the bottom
 * - Expandable "View details" sections
 *
 * NOTE: All UI is verbatim from the original design.
 * The only change from the stub version is that handleSend now calls
 * trpc.aiConcierge.chat instead of the local simulateEtaWorkflow simulation.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  Send,
  Paperclip,
  Zap,
  AtSign,
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Phone,
  MessageSquare,
  Clock,
  User,
  Calendar,
  MapPin,
  AlertTriangle,
  Play,
  PhoneMissed,
  MessageCircle,
  Users,
  Edit3,
  CreditCard,
  ExternalLink,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";
import { useAuth } from "@/_core/hooks/useAuth";
import { useMissionHistory, type MissionMetadata, type MadisonMission, type MissionViewState } from "@/hooks/useMissionHistory";

// ─── Types ───────────────────────────────────────────────────────────────────

type StepStatus = "done" | "pending" | "running" | "failed";

interface CompletedCard {
  message: string;
  ts: string;
}

interface ClarifyCard {
  message: string;
  teams: Array<{ name: string; currentJobId: number; address: string; scheduled: string; etaStatus: string }>;
}
interface EtaPendingCard {
  jobId: number;
  teamName: string;
  cleanerName: string;
  scheduledTimeET: string;
  date: string;
}
interface BulkSmsRecipient {
  cleanerProfileId?: number;
  name: string;
  phone: string;
}
interface ClientDisambiguationCard {
  messageHint: string | null;
  matches: Array<{ phone: string; name: string; city: string | null; totalCleans: number; ltv?: number; lastJobDate: string | null }>;
}
interface BulkSmsConfirmCard {
  targetDescription: string;
  recipients: BulkSmsRecipient[];
  draftMessage: string;
  /** Original user command — forwarded to sendBulkSms for mission persistence */
  command?: string;
}
interface BulkSmsSentCard {
  message: string;
  results: Array<{ name: string; phone: string; success: boolean; error?: string }>;
  mission?: MissionMetadata;
}
interface PaymentLinkConfirmCard {
  recipientName: string;
  recipientFirstName: string;
  recipientPhone: string;
  paymentLinkUrl: string;
  expiresAt: number;
  smsText: string;
  /** Original user command — forwarded to sendPaymentLinkSms for mission persistence */
  command?: string;
}
interface PaymentLinkSentCard {
  recipientName: string;
  recipientPhone: string;
  paymentLinkUrl: string;
  success: boolean;
  error?: string;
  mission?: MissionMetadata;
}
interface CallClientConfirmCard {
  recipientName: string;
  recipientFirstName: string;
  recipientPhone: string;
  script: string;
  audience: "customer" | "cleaner";
  cleanerJobId: number;
}
interface CallClientPendingCard {
  vapiCallId: string;
  recipientName: string;
  recipientPhone: string;
}
interface QueryResultCard {
  answer: string;
  rows?: Array<{
    id: number;
    jobDate: string | null;
    teamName: string | null;
    cleanerName: string | null;
    customerName: string | null;
    jobAddress: string | null;
    serviceDateTime: string | null;
    jobStatus: string | null;
  }>;
}
interface CustomerProfileCard {
  name: string;
  phone: string;
  address: string | null;
  frequency: string | null;
  totalBookings: number;
  ltv: number;
  avgPrice: number | null;
  usualTeam: string | null;
  isVip: boolean;
  lastJobs: Array<{ jobDate: string | null; serviceType: string | null; price: number | null; rating: number | null; teamName: string | null }>;
  upcomingJob: { jobDate: string | null; serviceDateTime: string | null; jobStatus: string | null; teamName: string | null; jobAddress: string | null } | null;
  lastMessages: Array<{ content: string; ts: number | null }>;
  aiMemoryBullets: string[];
  openPhoneCalls: Array<{ direction: string | null; durationSeconds: number | null; callStartedAt: string | Date | null; callDebrief: string | null }>;
  vapiCalls: Array<{ step: string | null; outcome: string | null; summary: string | null; durationSeconds: number | null; createdAt: string | Date | null }>;
  aiSummary: string;
}

type MessageContent =
  | { type: "text"; text: string }
  | { type: "completed"; card: CompletedCard }
  | { type: "clarify"; card: ClarifyCard }
  | { type: "eta_pending"; card: EtaPendingCard }
  | { type: "bulk_sms_confirm"; card: BulkSmsConfirmCard }
  | { type: "bulk_sms_sent"; card: BulkSmsSentCard }
  | { type: "client_disambiguation"; card: ClientDisambiguationCard }
  | { type: "payment_link_confirm"; card: PaymentLinkConfirmCard }
  | { type: "payment_link_sent"; card: PaymentLinkSentCard }
  | { type: "call_client_confirm"; card: CallClientConfirmCard }
  | { type: "call_client_pending"; card: CallClientPendingCard }
  | { type: "query_result"; card: QueryResultCard }
  | { type: "customer_profile"; card: CustomerProfileCard };

interface Message {
  id: string;
  role: "user" | "ai";
  content: MessageContent;
  ts: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Step icon ───────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
        <CheckCircle2 className="w-4 h-4 text-white" />
      </span>
    );
  if (status === "running")
    return (
      <span className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-blue-400 flex items-center justify-center">
        <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
      </span>
    );
  if (status === "failed")
    return (
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
        <XCircle className="w-4 h-4 text-white" />
      </span>
    );
  // pending
  return (
    <span className="flex-shrink-0 w-6 h-6 rounded-full border-2 border-gray-500 flex items-center justify-center">
      <Circle className="w-3 h-3 text-gray-500" />
    </span>
  );
}

// ─── Completed card ───────────────────────────────────────────────────────────

function CompletedCardView({ card }: { card: CompletedCard }) {
  return (
    <div className="flex items-start gap-4 bg-white/5 border border-white/10 rounded-xl px-4 py-4">
      <span className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-white" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm">Completed</p>
        <p className="text-gray-400 text-sm mt-0.5">{card.message}</p>
      </div>
      <span className="text-xs text-gray-500 flex-shrink-0 mt-1">{card.ts}</span>
    </div>
  );
}

// ─── Clarify card (team picker) ───────────────────────────────────────────────

function ClarifyCardView({
  card,
  onPickTeam,
}: {
  card: ClarifyCard;
  onPickTeam: (jobId: number, teamName: string) => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-4 py-3 text-sm text-gray-200 leading-relaxed border-b border-white/10">
        {card.message}
      </div>
      <div className="px-4 py-3 space-y-2">
        {card.teams.map((team) => (
          <button
            key={team.currentJobId}
            onClick={() => onPickTeam(team.currentJobId, team.name)}
            className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2.5 text-left transition-colors"
          >
            <div>
              <p className="text-sm text-white font-semibold">{team.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{team.address}</p>
            </div>
            <span className="text-xs text-gray-500 flex-shrink-0 ml-3">{team.scheduled}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Client disambiguation card ─────────────────────────────────────────────
function ClientDisambiguationCardView({
  card,
  onPick,
}: {
  card: ClientDisambiguationCard;
  onPick: (phone: string, name: string) => void;
}) {
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <p className="text-sm font-semibold text-white">Multiple matches — choose one</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        {card.matches.map((m) => (
          <button
            key={m.phone}
            onClick={() => onPick(m.phone, m.name)}
            className="w-full flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2.5 text-left transition-colors"
          >
            <span className="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-indigo-400" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white font-semibold">{m.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{m.city || m.phone}{m.totalCleans ? ` · ${m.totalCleans} cleans` : ""}{m.lastJobDate ? ` · last ${m.lastJobDate}` : ""}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Bulk SMS confirm card ───────────────────────────────────────────────────
function BulkSmsConfirmCardView({ card, onSent }: { card: BulkSmsConfirmCard; onSent: (result: BulkSmsSentCard) => void }) {
  const [draft, setDraft] = useState(card.draftMessage);
  const [sent, setSent] = useState(false);
  const sendMutation = trpc.aiConcierge.sendBulkSms.useMutation();

  function handleSend() {
    if (sent || sendMutation.isPending) return;
    sendMutation.mutate(
      {
        recipients: card.recipients,
        message: draft,
        ...(card.command ? { command: card.command } : {}),
      },
      {
        onSuccess: (result) => {
          setSent(true);
          onSent({ message: result.message, results: result.results, mission: result.mission ?? undefined });
        },
      }
    );
  }

  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <p className="text-sm font-semibold text-white">Text {card.targetDescription}</p>
        <span className="ml-auto text-xs text-gray-500">{card.recipients.length} recipient{card.recipients.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
        {card.recipients.map((r) => (
          <span key={r.phone} className="inline-flex items-center gap-1.5 rounded-full bg-white/8 border border-white/10 px-2.5 py-1 text-xs text-gray-300">
            <User className="w-3 h-3 text-gray-500" />
            <span className="font-medium text-white">{r.name}</span>
            <span className="text-gray-500">·</span>
            <span className="text-indigo-300">{r.phone}</span>
          </span>
        ))}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Edit3 className="w-3 h-3 text-indigo-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-400">Message</span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sent || sendMutation.isPending}
          rows={3}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 resize-none outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-60 scrollbar-none overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        />
      </div>
      {!sent && (
        <div className="px-4 pb-4">
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {sendMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            ) : (
              <><Send className="w-4 h-4" /> Send text{card.recipients.length > 1 ? ` to ${card.recipients.length} people` : ""}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
// ─── Bulk SMS sent card ───────────────────────────────────────────────────────
function BulkSmsSentCardView({ card }: { card: BulkSmsSentCard }) {
  const allOk = card.results.every(r => r.success);
  const successCount = card.results.filter(r => r.success).length;
  const failCount = card.results.filter(r => !r.success).length;
  const sentAt = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 border-b border-white/10 flex items-center gap-3 ${allOk ? "bg-green-500/8" : "bg-yellow-500/8"}`}>
        <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${allOk ? "bg-green-500" : "bg-yellow-500"}`}>
          {allOk ? <CheckCircle2 className="w-5 h-5 text-white" /> : <AlertTriangle className="w-5 h-5 text-white" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">{allOk ? "Message Sent" : "Partial Send"}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {successCount > 0 && <span className="text-green-400">{successCount} delivered</span>}
            {failCount > 0 && <span className="text-red-400 ml-2">{failCount} failed</span>}
            <span className="text-gray-500 ml-2">· {sentAt}</span>
          </p>
        </div>
        <MessageSquare className={`w-4 h-4 flex-shrink-0 ${allOk ? "text-green-400" : "text-yellow-400"}`} />
      </div>
      {/* Recipient rows */}
      <div className="px-4 py-3 space-y-2">
        {card.results.map((r, i) => (
          <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg ${r.success ? "bg-green-500/5 border border-green-500/15" : "bg-red-500/5 border border-red-500/15"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${r.success ? "bg-green-500/20" : "bg-red-500/20"}`}>
              {r.success
                ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                : <XCircle className="w-4 h-4 text-red-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold truncate ${r.success ? "text-white" : "text-red-300"}`}>{r.name}</p>
              <p className="text-xs text-gray-500 truncate">{r.phone}{r.error ? ` — ${r.error}` : ""}</p>
            </div>
            {r.success && <span className="text-xs text-green-400 font-medium flex-shrink-0">✓ Sent</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
// ─── AudioPlayer — copied verbatim from TeamEtaModal ────────────────────────
// ─── Payment link confirm card ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function PaymentLinkConfirmCardView({ card, onSent }: { card: PaymentLinkConfirmCard; onSent: (result: PaymentLinkSentCard) => void }) {
  const [smsText, setSmsText] = useState(card.smsText);
  const [sent, setSent] = useState(false);
  const sendMutation = trpc.aiConcierge.sendPaymentLinkSms.useMutation();

  function handleSend() {
    if (sent || sendMutation.isPending) return;
    sendMutation.mutate(
      {
        recipientPhone: card.recipientPhone,
        recipientName: card.recipientName,
        smsText,
        paymentLinkUrl: card.paymentLinkUrl,
        ...(card.command ? { command: card.command } : {}),
      },
      {
        onSuccess: (result) => {
          setSent(true);
          onSent({ ...result, mission: result.mission ?? undefined });
        },
      }
    );
  }

  const expiryDate = new Date(card.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <p className="text-sm font-semibold text-white">Send Payment Link</p>
      </div>
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-violet-600/30 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-violet-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-semibold">{card.recipientName}</p>
          <p className="text-xs text-gray-400 mt-0.5">{card.recipientPhone}</p>
        </div>
        <a
          href={card.paymentLinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors flex-shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          View link
        </a>
      </div>
      <div className="px-4 pb-2">
        <span className="text-[11px] text-gray-500">Link expires {expiryDate}</span>
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Edit3 className="w-3 h-3 text-violet-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-violet-400">Message to send</span>
        </div>
        <textarea
          value={smsText}
          onChange={(e) => setSmsText(e.target.value)}
          disabled={sent || sendMutation.isPending}
          rows={8}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 resize-none outline-none focus:border-violet-500/50 transition-colors disabled:opacity-60"
        />
      </div>
      {!sent && (
        <div className="px-4 pb-4">
          <button
            onClick={handleSend}
            disabled={!smsText.trim() || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {sendMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            ) : (
              <><Send className="w-4 h-4" /> Send to {card.recipientFirstName}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
// ─── Payment link sent card ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function PaymentLinkSentCardView({ card }: { card: PaymentLinkSentCard }) {
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${card.success ? "bg-green-500" : "bg-red-500"}`}>
          {card.success ? <CheckCircle2 className="w-3.5 h-3.5 text-white" /> : <XCircle className="w-3.5 h-3.5 text-white" />}
        </span>
        <p className="text-sm font-semibold text-white">
          {card.success ? `Payment link sent to ${card.recipientName}` : `Failed to send to ${card.recipientName}`}
        </p>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-xs text-gray-400">{card.recipientPhone}</p>
        {card.success && (
          <a
            href={card.paymentLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View payment link
          </a>
        )}
        {card.error && <p className="text-xs text-red-400">{card.error}</p>}
      </div>
    </div>
  );
}
function AudioPlayer({ url }: { url: string | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onloadedmetadata = null;
      audioRef.current = null;
    }
    setPlaying(false);
    setDuration(null);
  }, [url]);
  function toggle() {
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
      audioRef.current.onloadedmetadata = () => {
        if (audioRef.current) setDuration(audioRef.current.duration);
      };
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { void audioRef.current.play(); setPlaying(true); }
  }
  function fmtDur(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }
  if (!url) {
    return (
      <div className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-indigo-900/60 text-indigo-400">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </div>
        <span className="text-xs text-indigo-400 italic">Audio loading…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-white/10 bg-white/5 px-3 py-3">
      <button onClick={toggle} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-900/40">
        {playing
          ? <span className="flex gap-[3px]"><span className="h-4 w-[3px] rounded-full bg-white" /><span className="h-4 w-[3px] rounded-full bg-white" /></span>
          : <Play className="ml-0.5 h-5 w-5 fill-current" />}
      </button>
      <div className="flex h-10 flex-1 items-center gap-[3px]">
        {[5,11,17,10,20,26,18,31,22,14,27,34,20,12,25,18,30,13,22,10].map((h,i)=>(
          <span key={i} className="w-[3px] rounded-full bg-gradient-to-t from-indigo-600 to-indigo-400" style={{height:h, transformOrigin:"bottom", animation: playing ? `audioWave ${0.6 + (i % 5) * 0.1}s ease-in-out ${(i * 0.05).toFixed(2)}s infinite` : "none"}} />
        ))}
      </div>
      {duration !== null && <span className="text-xs font-bold text-gray-400">{fmtDur(duration)}</span>}
      <style>{`@keyframes audioWave{0%,100%{transform:scaleY(0.4)}50%{transform:scaleY(1.0)}}`}</style>
    </div>
  );
}
// ─── Call client confirm card ──────────────────────────────────────────────────
function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function CallClientConfirmCardView({ card, onFired }: { card: CallClientConfirmCard; onFired: (vapiCallId: string) => void }) {
  const [script, setScript] = useState(card.script);
  const [fired, setFired] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const startCall = trpc.callMatrix.startCall.useMutation({
    onSuccess: (result) => {
      setFired(true);
      onFired(result.vapiCallId ?? "");
    },
    onError: (err) => {
      setCallError(err.message);
    },
  });
  function handleCall() {
    if (fired || startCall.isPending) return;
    setCallError(null);
    startCall.mutate({
      cleanerJobId: card.cleanerJobId || 1,
      jobDate: todayET(),
      personName: card.recipientName,
      phone: card.recipientPhone,
      scenario: "Concierge call",
      script: script.trim(),
      audience: card.audience,
    });
  }
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
          <Phone className="w-4 h-4 text-indigo-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-semibold">{card.recipientName}</p>
          <p className="text-xs text-gray-400 mt-0.5">{card.recipientPhone}</p>
        </div>
      </div>
      <div className="px-4 py-3">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={fired || startCall.isPending}
          rows={4}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 resize-none outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-60 scrollbar-none overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        />
      </div>
      {callError && (
        <div className="px-4 pb-2 text-sm text-red-400">{callError}</div>
      )}
      {!fired && (
        <div className="px-4 pb-4">
          <button
            onClick={handleCall}
            disabled={!script.trim() || startCall.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {startCall.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Calling…</>
            ) : (
              <><Phone className="w-4 h-4" /> Call {card.recipientFirstName}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
// ─── Call client pending card — polls callMatrix.pollCall ────────────────────
function CallClientPendingCardView({ card }: { card: CallClientPendingCard }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const { data: pollResult } = trpc.callMatrix.pollCall.useQuery(
    { vapiCallId: card.vapiCallId },
    {
      enabled: !!card.vapiCallId,
      refetchInterval: (query) => {
        const s = query.state.data?.status;
        return (s === "completed" || s === "voicemail" || s === "no_answer" || s === "failed") ? false : 5000;
      },
    }
  );
  const callDone = pollResult !== undefined && (pollResult.status === "completed" || pollResult.status === "voicemail" || pollResult.status === "no_answer" || pollResult.status === "failed");
  const noAnswer = pollResult?.status === "no_answer" || pollResult?.status === "failed";
  const transcript = pollResult?.transcript ?? null;
  const hasTranscript = !!transcript && transcript.trim().length > 5;
  let step2Status: StepStatus = "running";
  let step2Label = "Waiting for call to complete…";
  if (callDone) {
    if (noAnswer) { step2Status = "failed"; step2Label = "No answer"; }
    else if (pollResult?.status === "voicemail") { step2Status = "done"; step2Label = "Left voicemail"; }
    else { step2Status = "done"; step2Label = pollResult?.summary ? `Completed — "${pollResult.summary}"` : "Call completed"; }
  }
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <p className="text-sm font-semibold text-white">Calling {card.recipientName}</p>
        <p className="text-xs text-gray-400 mt-0.5">{card.recipientPhone}</p>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-start gap-3">
          <StepIcon status="done" />
          <span className="flex-1 text-sm text-gray-300">Call placed to <span className="text-white font-semibold">{card.recipientName}</span></span>
        </div>
        <div className="flex items-start gap-3">
          <StepIcon status={step2Status} />
          <span className={`flex-1 text-sm ${step2Status === "running" ? "text-white font-semibold" : step2Status === "done" ? "text-gray-300" : "text-red-400"}`}>{step2Label}</span>
        </div>
      </div>
      {callDone && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3 space-y-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-indigo-400">
            <MessageCircle className="h-3.5 w-3.5" /> Recording
          </div>
          {noAnswer ? (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <PhoneMissed className="h-4 w-4 flex-shrink-0" /> No answer — no recording available
            </div>
          ) : (
            <AudioPlayer url={proxyRecordingUrl(pollResult?.recordingUrl ?? null)} />
          )}
          {hasTranscript && (
            <div>
              <button
                onClick={() => setTranscriptOpen(v => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-indigo-400 hover:bg-white/10 transition-colors"
              >
                <span>Call transcript</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${transcriptOpen ? "rotate-180" : ""}`} />
              </button>
              {transcriptOpen && (
                <div className="mt-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs leading-relaxed text-gray-300 whitespace-pre-wrap">{transcript}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ─── ETA Pending card — polls getTeamEtaSummary, shows steps with full content ──
function EtaPendingCardView({ card }: { card: EtaPendingCard }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const { data: rawTeams } = trpc.fieldMgmt.getTeamEtaSummary.useQuery(
    { date: card.date },
    { refetchInterval: (query) => {
        const team = (query.state.data ?? []).find((t: { currentJobId: number }) => t.currentJobId === card.jobId);
        return team?.etaCall ? false : 5000;
      }
    }
  );
  const team = (rawTeams ?? []).find((t: { currentJobId: number }) => t.currentJobId === card.jobId);
  const etaCall = team?.etaCall ?? null;
  const callDone = etaCall !== null;
  const resultType = etaCall?.resultType ?? null;
  const etaTimeStr = etaCall?.etaTimeStr ?? null;
  const cleanerStatement = etaCall?.cleanerStatement ?? null;
  const clientNotified = etaCall?.clientNotified ?? false;
  const smsSentBody = etaCall?.smsSentBody ?? null;
  const recordingUrl = etaCall?.recordingUrl ?? null;
  const transcript = etaCall?.transcript ?? null;
  const hasTranscript = !!transcript && transcript.trim().length > 5;
  // Step 2: call result
  let step2Status: StepStatus = "running";
  let step2Label = "Waiting for call to complete…";
  if (callDone) {
    if (resultType === "success") {
      step2Status = "done";
      step2Label = etaTimeStr
        ? `ETA confirmed: ${etaTimeStr}${cleanerStatement ? ` — "${cleanerStatement}"` : ""}`
        : `Call completed${cleanerStatement ? ` — "${cleanerStatement}"` : ""}`;
    } else if (resultType === "no_answer" || resultType === "dispatcher_needed") {
      step2Status = "failed";
      step2Label = "No answer — cleaner did not pick up";
    } else if (resultType === "unclear") {
      step2Status = "failed";
      step2Label = "Unclear — could not confirm ETA";
    } else {
      step2Status = "done";
      step2Label = "Call completed";
    }
  }
  // Step 3: client SMS
  let step3Status: StepStatus = "pending";
  let step3Label = "Client SMS pending…";
  if (callDone) {
    if (clientNotified && smsSentBody) {
      step3Status = "done";
      step3Label = `Client texted: "${smsSentBody}"`;
    } else {
      step3Status = "failed";
      step3Label = "Client was not notified";
    }
  }
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <p className="text-sm font-semibold text-white">ETA Update — {card.teamName}</p>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Step 1: call placed */}
        <div className="flex items-start gap-3">
          <StepIcon status="done" />
          <span className="flex-1 text-sm text-gray-300">
            ETA call placed for <span className="text-white font-semibold">{card.teamName}</span> ({card.cleanerName}) — scheduled {card.scheduledTimeET}
          </span>
        </div>
        {/* Step 2: call result */}
        <div className="flex items-start gap-3">
          <StepIcon status={step2Status} />
          <span className={`flex-1 text-sm ${step2Status === "running" ? "text-white font-semibold" : step2Status === "done" ? "text-gray-300" : "text-red-400"}`}>
            {step2Label}
          </span>
        </div>
        {/* Step 3: client SMS */}
        <div className="flex items-start gap-3">
          <StepIcon status={step3Status} />
          <span className={`flex-1 text-sm ${step3Status === "pending" ? "text-gray-500" : step3Status === "done" ? "text-gray-300" : "text-red-400"}`}>
            {step3Label}
          </span>
        </div>
      </div>
      {/* Recording + transcript once call is done */}
      {callDone && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3 space-y-3">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-indigo-400">
            <MessageCircle className="h-3.5 w-3.5" /> Recording
          </div>
          {resultType === "no_answer" || resultType === "dispatcher_needed" ? (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <PhoneMissed className="h-4 w-4 flex-shrink-0" /> No answer — no recording available
            </div>
          ) : (
            <AudioPlayer url={proxyRecordingUrl(recordingUrl)} />
          )}
          {hasTranscript && (
            <div>
              <button
                onClick={() => setTranscriptOpen(v => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-indigo-400 hover:bg-white/10 transition-colors"
              >
                <span>Call transcript</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${transcriptOpen ? "rotate-180" : ""}`} />
              </button>
              {transcriptOpen && (
                <div className="mt-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs leading-relaxed text-gray-300 whitespace-pre-wrap">
                  {transcript}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  agentPhotoUrl,
  onPickTeam,
  onPickClient,
  onAddMessage,
  onAddMission,
}: {
  msg: Message;
  agentPhotoUrl?: string;
  onPickTeam: (jobId: number, teamName: string) => void;
  onPickClient: (phone: string, name: string, messageHint: string | null) => void;
  onAddMessage: (m: Message) => void;
  onAddMission: (metadata: MissionMetadata) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex items-end justify-end gap-3">
        <div className="max-w-[75%]">
          <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed">
            {msg.content.type === "text" && msg.content.text}
          </div>
          <div className="text-right text-xs text-gray-500 mt-1 pr-1">
            {msg.ts}{" "}
            <span className="text-blue-400">✓✓</span>
          </div>
        </div>
        {agentPhotoUrl ? (
          <img
            src={agentPhotoUrl}
            alt="You"
            className="w-8 h-8 rounded-full object-cover flex-shrink-0 mb-5"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mb-5">
            <User className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
    );
  }

  // AI message
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-1">
        <Bot className="w-5 h-5 text-white" />
      </div>
      <div className="max-w-[82%]">
        {msg.content.type === "text" && (
          <div className="bg-white/8 border border-white/10 text-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed">
            {msg.content.text}
          </div>
        )}
        {msg.content.type === "completed" && (
          <div>
            <CompletedCardView card={msg.content.card} />
            <div className="text-right text-xs text-gray-500 mt-1">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "clarify" && (
          <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
            <ClarifyCardView card={msg.content.card} onPickTeam={onPickTeam} />
            <div className="text-right text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "eta_pending" && (
          <div>
            <EtaPendingCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "bulk_sms_confirm" && (
          <div>
            <BulkSmsConfirmCardView
              card={msg.content.card}
              onSent={(result) => {
                onAddMessage({
                  id: uid(),
                  role: "ai",
                  content: { type: "bulk_sms_sent", card: result },
                  ts: nowTime(),
                });
                if (result.mission) onAddMission(result.mission);
              }}
            />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "bulk_sms_sent" && (
          <div>
            <BulkSmsSentCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "client_disambiguation" && (
          <div>
            <ClientDisambiguationCardView
              card={msg.content.card}
              onPick={(phone, name) => {
                const hint = msg.content.type === "client_disambiguation" ? msg.content.card.messageHint : null;
                onPickClient(phone, name, hint);
              }}
            />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "payment_link_confirm" && (
          <div>
            <PaymentLinkConfirmCardView
              card={msg.content.card}
              onSent={(result) => {
                onAddMessage({
                  id: uid(),
                  role: "ai",
                  content: { type: "payment_link_sent", card: result },
                  ts: nowTime(),
                });
                if (result.mission) onAddMission(result.mission);
              }}
            />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "payment_link_sent" && (
          <div>
            <PaymentLinkSentCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "call_client_confirm" && (
          <div>
            <CallClientConfirmCardView
              card={msg.content.card}
              onFired={(vapiCallId) => {
                onAddMessage({
                  id: uid(),
                  role: "ai",
                  content: { type: "call_client_pending", card: { vapiCallId, recipientName: msg.content.type === "call_client_confirm" ? msg.content.card.recipientName : "", recipientPhone: msg.content.type === "call_client_confirm" ? msg.content.card.recipientPhone : "" } },
                  ts: nowTime(),
                });
              }}
            />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "call_client_pending" && (
          <div>
            <CallClientPendingCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "query_result" && (
          <div>
            <QueryResultCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "customer_profile" && (
          <div>
            <CustomerProfileCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Query result card ────────────────────────────────────────────────────────

function QueryResultCardView({ card }: { card: QueryResultCard }) {
  const rows = card.rows ?? [];

  // Parse amount and status from jobStatus string
  // completedJobs format: "completed (bi-weekly, $161)"
  // cleanerJobs format: "not started" | "in progress" | "completed" etc.
  type JobRow = NonNullable<QueryResultCard["rows"]>[0];
  function parseJobRow(row: JobRow) {
    const status = row.jobStatus ?? "";
    // Extract dollar amount from completedJobs format: "completed (bi-weekly, $161)"
    const amountMatch = status.match(/\$(\d+(?:\.\d+)?)/);
    const amount = amountMatch ? `$${amountMatch[1]}` : null;
    // Determine display status
    const isHistorical = status.startsWith("completed (");
    const displayStatus = isHistorical ? "completed" : (status || "scheduled");
    // Team display
    const team = row.teamName ?? row.cleanerName ?? null;
    // Date formatting
    const dateStr = row.jobDate ?? row.serviceDateTime ?? null;
    let displayDate = "—";
    let displayWeekday = "";
    if (dateStr) {
      // jobDate is YYYY-MM-DD, parse as local date
      const parts = dateStr.split("T")[0].split("-");
      if (parts.length === 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        displayDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        displayWeekday = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
      }
    }
    return { amount, displayStatus, team, isHistorical, displayDate, displayWeekday };
  }

  function StatusBadge({ status }: { status: string }) {
    const s = status.toLowerCase();
    if (s === "completed") return <span style={{ background: "#064e3b", color: "#6ee7b7", fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, whiteSpace: "nowrap" }}>Completed</span>;
    if (s === "in progress" || s === "in-progress") return <span style={{ background: "#3b2a00", color: "#fbbf24", fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, whiteSpace: "nowrap" }}>In Progress</span>;
    if (s === "scheduled" || s === "not started") return <span style={{ background: "#1e3a5f", color: "#93c5fd", fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, whiteSpace: "nowrap" }}>Scheduled</span>;
    return <span style={{ background: "#2a2e47", color: "#8b8fa8", fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, whiteSpace: "nowrap", textTransform: "capitalize" }}>{status}</span>;
  }

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      {/* Header */}
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #4f6ef7, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
          <Calendar className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Job Lookup</p>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#c8cde8", lineHeight: 1.4 }}>{card.answer.split("\n")[0].slice(0, 120)}</p>
        </div>
      </div>

      {/* Summary bar */}
      {rows.length > 0 && (
        <div style={{ padding: "8px 14px", background: "#161929", borderBottom: "1px solid #2a2e47", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ background: "#2a2e47", color: "#a5b4fc", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>{rows.length} job{rows.length !== 1 ? "s" : ""}</span>
          <span style={{ color: "#8b8fa8", fontSize: 12 }}>
            {rows[0].customerName ?? rows[0].cleanerName ?? ""}
          </span>
        </div>
      )}

      {/* Job rows */}
      {rows.length === 0 ? (
        <div style={{ padding: "24px 14px", textAlign: "center" }}>
          <p style={{ color: "#3d4260", fontSize: 13 }}>No jobs found</p>
        </div>
      ) : (
        <div>
          {rows.map((row, i) => {
            const { amount, displayStatus, team, displayDate, displayWeekday } = parseJobRow(row);
            return (
              <div
                key={row.id}
                style={{
                  padding: "9px 14px",
                  display: "grid",
                  gridTemplateColumns: "80px 1fr auto",
                  gap: 8,
                  alignItems: "start",
                  borderBottom: i < rows.length - 1 ? "1px solid #1e2235" : "none",
                }}
              >
                {/* Date */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e5f5", whiteSpace: "nowrap" }}>{displayDate}</span>
                  <span style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{displayWeekday}</span>
                </div>
                {/* Address + team */}
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "#c8cde8", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.jobAddress ?? "—"}
                  </span>
                  {team ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4f6ef7", flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{team}</span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: "#3d4260", fontStyle: "italic" }}>No team data</span>
                  )}
                </div>
                {/* Amount + status */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                  {amount ? (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#34d399", whiteSpace: "nowrap" }}>{amount}</span>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#3d4260" }}>—</span>
                  )}
                  <StatusBadge status={displayStatus} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ background: "#161929", borderTop: "1px solid #2a2e47", padding: "7px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "#3d4260", fontStyle: "italic" }}>Historical jobs may not include team info</span>
        <span style={{ fontSize: 10, color: "#3d4260" }}>cleanerJobs + completedJobs</span>
      </div>
    </div>
  );
}

// ─── Customer profile card ───────────────────────────────────────────────────

function CustomerProfileCardView({ card }: { card: CustomerProfileCard }) {
  const [expandedSection, setExpandedSection] = React.useState<string | null>(null);

  const toggle = (s: string) => setExpandedSection(prev => prev === s ? null : s);

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    const [y, m, day] = d.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[parseInt(m)-1]} ${parseInt(day)}`;
  };

  const formatDuration = (secs: number | null) => {
    if (!secs) return null;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatCallDate = (d: string | Date | null) => {
    if (!d) return "—";
    try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
    catch { return "—"; }
  };

  const stars = (rating: number | null) => {
    if (!rating) return null;
    return "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
  };

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#1a1f2e] text-white w-full max-w-sm">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold tracking-widest text-indigo-400 uppercase">Customer Profile</span>
              {card.isVip && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">VIP</span>
              )}
            </div>
            <div className="text-base font-bold text-white mt-0.5 truncate">{card.name}</div>
            {card.address && (
              <div className="text-xs text-gray-400 truncate mt-0.5">{card.address.split(",").slice(0,2).join(",")}</div>
            )}
          </div>
        </div>

        {/* AI Summary */}
        {card.aiSummary && (
          <div className="mt-3 text-xs text-gray-300 leading-relaxed bg-white/5 rounded-lg px-3 py-2 border border-white/5">
            {card.aiSummary}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 divide-x divide-white/10 border-b border-white/10">
        {[
          { label: "Cleans", value: card.totalBookings },
          { label: "LTV", value: card.ltv > 0 ? `$${card.ltv.toLocaleString()}` : "—" },
          { label: "Avg", value: card.avgPrice ? `$${card.avgPrice}` : "—" },
          { label: "Freq", value: card.frequency ? card.frequency.replace(/monthly/i,"Mo").replace(/weekly/i,"Wk").replace(/bi-weekly/i,"BiWk").replace(/one-time/i,"1x") : "—" },
        ].map(s => (
          <div key={s.label} className="flex flex-col items-center py-2.5 px-1">
            <span className="text-sm font-bold text-white">{s.value}</span>
            <span className="text-[10px] text-gray-500 mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Usual team */}
      {card.usualTeam && (
        <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
          <span className="text-xs text-gray-400">Usual team:</span>
          <span className="text-xs font-semibold text-white">{card.usualTeam}</span>
        </div>
      )}

      {/* Upcoming job */}
      {card.upcomingJob && (
        <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          <span className="text-xs text-gray-400">Next job:</span>
          <span className="text-xs font-semibold text-white">{formatDate(card.upcomingJob.jobDate)}</span>
          {card.upcomingJob.serviceDateTime && (
            <span className="text-xs text-gray-400">at {card.upcomingJob.serviceDateTime}</span>
          )}
          {card.upcomingJob.teamName && (
            <span className="text-xs text-gray-500">· {card.upcomingJob.teamName}</span>
          )}
        </div>
      )}

      {/* AI Memory bullets */}
      {card.aiMemoryBullets.length > 0 && (
        <div className="border-b border-white/10">
          <button onClick={() => toggle("memory")} className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors">
            <span className="text-xs font-semibold text-indigo-300">AI Memory ({card.aiMemoryBullets.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "memory" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "memory" && (
            <div className="px-4 pb-3 space-y-1">
              {card.aiMemoryBullets.map((b, i) => (
                <div key={i} className="text-xs text-gray-300 flex gap-2">
                  <span className="text-indigo-400 shrink-0">·</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Last 5 jobs */}
      {card.lastJobs.length > 0 && (
        <div className="border-b border-white/10">
          <button onClick={() => toggle("jobs")} className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors">
            <span className="text-xs font-semibold text-gray-300">Job History ({card.lastJobs.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "jobs" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "jobs" && (
            <div className="px-4 pb-3 space-y-2">
              {card.lastJobs.map((j, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white">{formatDate(j.jobDate)}</div>
                    <div className="text-[10px] text-gray-500 truncate">{j.teamName ?? "No team"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {j.price && <div className="text-xs font-bold text-green-400">${j.price}</div>}
                    {j.rating && <div className="text-[10px] text-amber-400">{stars(j.rating)}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent messages */}
      {card.lastMessages.length > 0 && (
        <div className="border-b border-white/10">
          <button onClick={() => toggle("messages")} className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors">
            <span className="text-xs font-semibold text-gray-300">Recent Messages ({card.lastMessages.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "messages" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "messages" && (
            <div className="px-4 pb-3 space-y-2">
              {card.lastMessages.map((m, i) => (
                <div key={i} className="bg-white/5 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-200 leading-relaxed">{m.content}</div>
                  {m.ts && <div className="text-[10px] text-gray-500 mt-1">{new Date(m.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* OpenPhone calls */}
      {card.openPhoneCalls.length > 0 && (
        <div className="border-b border-white/10">
          <button onClick={() => toggle("calls")} className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors">
            <span className="text-xs font-semibold text-gray-300">Calls ({card.openPhoneCalls.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "calls" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "calls" && (
            <div className="px-4 pb-3 space-y-2">
              {card.openPhoneCalls.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${c.direction === "inbound" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>
                    {c.direction === "inbound" ? "IN" : "OUT"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-300">{formatCallDate(c.callStartedAt)}</span>
                      {c.durationSeconds && <span className="text-[10px] text-gray-500">{formatDuration(c.durationSeconds)}</span>}
                    </div>
                    {c.callDebrief && <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{c.callDebrief}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Vapi calls */}
      {card.vapiCalls.length > 0 && (
        <div>
          <button onClick={() => toggle("vapi")} className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-white/5 transition-colors">
            <span className="text-xs font-semibold text-gray-300">AI Calls ({card.vapiCalls.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "vapi" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "vapi" && (
            <div className="px-4 pb-3 space-y-2">
              {card.vapiCalls.map((c, i) => (
                <div key={i} className="bg-white/5 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white capitalize">{(c.step ?? "call").replace(/_/g," ")}</span>
                    {c.outcome && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.outcome === "success" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{c.outcome}</span>}
                  </div>
                  {c.summary && <div className="text-[10px] text-gray-400 mt-1 line-clamp-2">{c.summary}</div>}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-500">{formatCallDate(c.createdAt)}</span>
                    {c.durationSeconds && <span className="text-[10px] text-gray-500">{formatDuration(c.durationSeconds)}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Command chip ─────────────────────────────────────────────────────────────

const EXAMPLES = [
  { emoji: "🚗", label: "ETA update", example: "Update ETA for Maria's team" },
  { emoji: "📞", label: "Call client", example: "Call Sarah about her upcoming clean" },
  { emoji: "💬", label: "Text client", example: "Text Jennifer I'll be 15 min late" },
  { emoji: "📨", label: "Text team", example: "Text Maria's team to bring extra supplies" },
  { emoji: "📈", label: "Revenue today", example: "Revenue today" },
  { emoji: "💳", label: "Payment link", example: "Send Alex a payment link" },
  { emoji: "👤", label: "Customer profile", example: "Pull up Jennifer's profile" },
  { emoji: "⏰", label: "Check ETA", example: "When is Sarah's cleaner arriving?" },
];

const HINT_EXAMPLES = [
  'Try: "Update ETA for Maria\'s team"',
  'Try: "Text Jennifer I\'ll be 15 min late"',
  'Try: "Revenue today"',
  'Try: "Send Alex a payment link"',
  'Try: "Pull up Jennifer\'s profile"',
  'Try: "Call Sarah about her upcoming clean"',
];

function CommandPicker({ onSelect, onClose }: { onSelect: (cmd: string) => void; onClose: () => void }) {
  return (
    <div className="mb-2 bg-[#1a1d2e] border border-white/15 rounded-xl">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <p className="text-sm text-white font-semibold">Things you can ask</p>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-lg leading-none">✕</button>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => { onSelect(ex.example); onClose(); }}
            className="flex flex-col gap-1 p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-indigo-600/15 hover:border-indigo-500/40 transition-colors text-left"
          >
            <span className="text-lg leading-none">{ex.emoji}</span>
            <p className="text-xs text-white font-semibold mt-1">{ex.label}</p>
            <p className="text-[11px] text-gray-400 leading-snug">{ex.example}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Mission Card ───────────────────────────────────────────────────────────

function missionTimeAgo(isoDate: string): string {
  const d = new Date(isoDate);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function fmtAbsTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function MissionCard({
  mission,
  viewState,
  onSetViewState,
}: {
  mission: MadisonMission;
  viewState: MissionViewState;
  onSetViewState: (id: string, state: MissionViewState) => void;
}) {
  const isExpanded = viewState === "expanded";
  const autoCollapseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userInteractedRef = useRef(false);

  // Auto-collapse after 2s ONLY for newly-created missions (isNew: true).
  // Restored missions (isNew: false/undefined) start collapsed and are never auto-collapsed.
  useEffect(() => {
    if (!mission.isNew) return; // restored from server — already collapsed, skip
    if (mission.missionStatus !== "completed") return;
    if (viewState !== "expanded") return;
    autoCollapseRef.current = setTimeout(() => {
      if (!userInteractedRef.current) {
        onSetViewState(mission.missionId, "collapsed");
      }
    }, 2000);
    return () => {
      if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current);
    };
  }, [mission.missionId, mission.missionStatus, mission.isNew, viewState, onSetViewState]);

  const handleToggle = () => {
    userInteractedRef.current = true;
    if (autoCollapseRef.current) clearTimeout(autoCollapseRef.current);
    onSetViewState(mission.missionId, isExpanded ? "collapsed" : "expanded");
  };

  const statusColor =
    mission.missionStatus === "completed"
      ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"
      : mission.missionStatus === "failed"
      ? "text-red-400 bg-red-500/15 border-red-500/30"
      : "text-amber-400 bg-amber-500/15 border-amber-500/30";

  const statusLabel =
    mission.missionStatus === "completed" ? "Completed" :
    mission.missionStatus === "failed" ? "Failed" : "Blocked";

  const stepIcon = (status: MissionStep["status"]) => {
    if (status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
    if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    return <Circle className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />;
  };

  return (
    <div className="bg-[#1a1d2e] border border-white/10 rounded-2xl overflow-hidden">
      {/* Header — always visible, click to toggle */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/4 transition-colors text-left"
      >
        <div className="w-7 h-7 rounded-lg bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
          <Zap className="w-3.5 h-3.5 text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{mission.missionTitle}</p>
          <p className="text-gray-500 text-[11px] mt-0.5">
            {mission.missionStats.completed} action{mission.missionStats.completed !== 1 ? "s" : ""}
            {" · "}{missionTimeAgo(mission.missionCompletedAt)}
          </p>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
          {statusLabel}
        </span>
        {isExpanded
          ? <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />}
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-4">
          {/* Timestamps */}
          <div className="flex items-center gap-4 mb-3 pt-1 border-t border-white/8">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-gray-500" />
              <span className="text-[11px] text-gray-500">Started {fmtAbsTime(mission.missionStartedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-gray-500" />
              <span className="text-[11px] text-gray-500">Completed {fmtAbsTime(mission.missionCompletedAt)}</span>
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-2 mb-3">
            {mission.missionSteps.map((step) => (
              <div
                key={step.id}
                className="flex items-start gap-2.5"
                onClick={(e) => e.stopPropagation()}
              >
                {stepIcon(step.status)}
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 text-xs leading-snug">{step.label}</p>
                  {step.detail && (
                    <p className="text-gray-500 text-[11px] mt-0.5 leading-snug">{step.detail}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div
            className="border-t border-white/8 pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-gray-400 text-[11px] leading-relaxed">{mission.missionSummary}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[10px] text-gray-600">{mission.missionStats.total} total</span>
              <span className="text-[10px] text-emerald-600">{mission.missionStats.completed} completed</span>
              {mission.missionStats.failed > 0 && (
                <span className="text-[10px] text-red-500">{mission.missionStats.failed} failed</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type MissionStep = MadisonMission["missionSteps"][number];

// ─── Main component ───────────────────────────────────────────────────────────

export default function AiConcierge({ agentPhotoUrl, onClose }: { agentPhotoUrl?: string; onClose?: () => void }) {
  const { user } = useAuth();
  // Use the agent's numeric id (from agent cookie session) as the stable userId for
  // mission history. Agents do NOT use Manus OAuth, so user?.openId is always undefined.
  const agentMeQuery = trpc.agents.me.useQuery(undefined, { retry: false, staleTime: 60_000, refetchOnWindowFocus: false });
  const agentUserId = agentMeQuery.data?.id != null ? String(agentMeQuery.data.id) : undefined;
  const {
    missions,
    viewState: missionViewState,
    addMission,
    setViewState: setMissionViewState,
    clearHistory: clearMissionHistory,
    isLoading: missionsLoading,
  } = useMissionHistory(agentUserId);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "ai",
      content: {
        type: "text",
        text: "Hi! I'm your AI Operations Concierge. I can run workflows like sending ETA updates, getting entry info to teams, rescheduling jobs, and more. What do you need?",
      },
      ts: nowTime(),
    },
  ]);
  const [input, setInput] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [hintIdx, setHintIdx] = useState(0);
  const inputFocused = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      if (!inputFocused.current && !input) setHintIdx((i) => (i + 1) % HINT_EXAMPLES.length);
    }, 3000);
    return () => clearInterval(id);
  }, [input]);
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Selected entity (set when a pill is confirmed or a customer_profile card is shown) ──────────
  // Discriminated union: customer entities route via resolvedClientPhone; cleaner entities route via resolvedEntity
  type SelectedEntity =
    | { type: "customer"; name: string; phone: string }
    | { type: "cleaner"; cleanerProfileId: number; name: string; phone: string };
  const [focusedCustomer, setFocusedCustomer] = useState<SelectedEntity | null>(null);
  // ── Attached label flash ──────────────────────────────────────────────
  const [showAttachedLabel, setShowAttachedLabel] = useState(false);
  const attachedLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cleanup on unmount
  useEffect(() => () => { if (attachedLabelTimerRef.current) clearTimeout(attachedLabelTimerRef.current); }, []);

  // ── Suggestions panel ──────────────────────────────────────────────────
  const [acQuery, setAcQuery] = useState<string | null>(null);
  const { data: acData, error: acError } = trpc.opsChat.searchCustomers.useQuery(
    { query: acQuery ?? "" },
    { enabled: (acQuery?.length ?? 0) >= 2, staleTime: 30_000 }
  );
  const { data: acCleanerData, error: acCleanerError } = trpc.opsChat.searchCleaners.useQuery(
    { query: acQuery ?? "" },
    { enabled: (acQuery?.length ?? 0) >= 2, staleTime: 30_000 }
  );
  const acCustomers = (acData?.customers ?? []).slice(0, 4);
  const acCleaners = (acCleanerData?.cleaners ?? []).slice(0, 3);
  // Combine all matches into a unified list for the recognition pill
  const allMatches: Array<{ name: string; phone: string; subtitle: string; isCleaner?: boolean; cleanerProfileId?: number }> = [
    ...acCustomers.map(c => ({
      name: c.name,
      phone: c.phone,
      subtitle: [c.city, c.teamName ? `Team ${c.teamName}` : null, c.phone].filter(Boolean).join(" · ") || c.phone,
    })),
    ...acCleaners.map(c => ({
      name: c.name,
      phone: c.phone,
      subtitle: [c.isActive ? "Team · Active" : "Team", c.phone].filter(Boolean).join(" · "),
      isCleaner: true,
      cleanerProfileId: c.cleanerProfileId,
    })),
  ];
  // Show recognition pill only when not already locked and we have results
  const showRecognitionPill = !focusedCustomer && (acQuery?.length ?? 0) >= 2 && allMatches.length > 0;

  // ── Name recognition debounce timer ─────────────────────────────────────
  const acDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── flashAttachedLabel helper ─────────────────────────────────────────────
  const flashAttachedLabel = useCallback(() => {
    if (attachedLabelTimerRef.current) clearTimeout(attachedLabelTimerRef.current);
    setShowAttachedLabel(true);
    attachedLabelTimerRef.current = setTimeout(() => {
      setShowAttachedLabel(false);
      attachedLabelTimerRef.current = null;
    }, 1200);
  }, []);

  // ── Auto-attach useEffect ─────────────────────────────────────────────────
  useEffect(() => {
    if (focusedCustomer || !acQuery || allMatches.length !== 1) return;
    const normalizedQuery = acQuery.trim().toLowerCase();
    const normalizedName = allMatches[0].name.trim().toLowerCase();
    const words = normalizedQuery.split(/\s+/);
    const isConfident = words.length >= 2 && normalizedName.startsWith(normalizedQuery);
    if (!isConfident) return;
    const m = allMatches[0];
    setFocusedCustomer(m.isCleaner && m.cleanerProfileId != null
      ? { type: "cleaner", cleanerProfileId: m.cleanerProfileId, name: m.name, phone: m.phone }
      : { type: "customer", name: m.name, phone: m.phone });
    setAcQuery(null);
    setShowChangePopup(false);
    flashAttachedLabel();
    // Textarea is NOT touched
  }, [allMatches, acQuery, focusedCustomer]);

  // Show change popup
  const [showChangePopup, setShowChangePopup] = useState(false);

  // ── Confirm pill: set entity (textarea NOT touched) ────────────────────────
  const confirmPill = (entity: SelectedEntity) => {
    setFocusedCustomer(entity);
    setAcQuery(null);
    setShowChangePopup(false);
    flashAttachedLabel();
    // Textarea is NOT touched
  };

  // ── updateEntityRecognition: single source of truth for command parsing ────────
  const updateEntityRecognition = useCallback((val: string) => {
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current);
    acDebounceRef.current = setTimeout(() => {
      const COMMAND_RE = /^(?:text|call|tell|ask|remind|send|notify|update|let|jobs\s+for|payment\s+for|eta\s+for|entry\s+for|schedule\s+for|reschedule)\s+(.+)/i;
      const cmdMatch = val.match(COMMAND_RE);
      if (cmdMatch) {
        const entity = cmdMatch[1].trim();
        setAcQuery(entity.length >= 2 ? entity : null);
      } else {
        setAcQuery(null);
      }
    }, 200);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // If a person is already locked, skip all entity searching.
    if (focusedCustomer) {
      setAcQuery(null);
      return;
    }

    updateEntityRecognition(val);
  };

  // Clicking a suggestion fills the input with a full question and sends it
  const handleSuggestionSelect = (fullQuestion: string) => {
    setAcQuery(null);
    setInput("");
    const text = fullQuestion.trim();
    if (!text) return;
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: { type: "text", text },
      ts: nowTime(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);
    chatMutation.mutate(
      { message: text },
      {
        onSuccess: (result) => {
          setIsThinking(false);
          const aiMsg0 = buildAiMessage(result);
          if (aiMsg0) setMessages((prev) => [...prev, aiMsg0]);
          if (result.type === "customer_profile") {
            setFocusedCustomer({ type: "customer", name: result.profile.name, phone: result.profile.phone });
          }
        },
        onError: (err) => {
          setIsThinking(false);
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: "ai", content: { type: "text", text: `Something went wrong: ${err.message}` }, ts: nowTime() },
          ]);
        },
      }
    );
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const chatMutation = trpc.aiConcierge.chat.useMutation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Called when agent picks a client from a disambiguation card
    const handlePickClient = useCallback((phone: string, name: string, messageHint: string | null) => {
    const isPaymentLink = messageHint === "__payment_link__";
    const isCallClient = (messageHint ?? "").startsWith("__call_client__");
    const callQuestionHint = isCallClient ? (messageHint ?? "").replace("__call_client__:", "") || null : null;
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: { type: "text", text: isPaymentLink ? `Send payment link to ${name}` : isCallClient ? `Call ${name}` : `Text ${name}` },
      ts: nowTime(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);
    chatMutation.mutate(
      {
        message: isPaymentLink ? `Send payment link to ${name}` : isCallClient ? `Call ${name}` : `Text ${name}`,
        resolvedClientPhone: phone,
        resolvedClientMessageHint: (isPaymentLink || isCallClient) ? null : messageHint,
        resolvedPaymentLink: isPaymentLink,
        resolvedCallClient: isCallClient,
        resolvedCallPersonName: isCallClient ? name : undefined,
        resolvedCallQuestionHint: callQuestionHint,
      },
      {
        onSuccess: (result) => {
          setIsThinking(false);
          const aiMsg = buildAiMessage(result);
          if (aiMsg) setMessages((prev) => [...prev, aiMsg]);
        },
        onError: (err) => {
          setIsThinking(false);
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: "ai",
              content: { type: "text", text: `Something went wrong: ${err.message}` },
              ts: nowTime(),
            },
          ]);
        },
      }
    );
  }, [chatMutation]);

  // Called when agent picks a team from a clarify card
  const handlePickTeam = useCallback((jobId: number, teamName: string) => {
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: { type: "text", text: `ETA update for ${teamName}` },
      ts: nowTime(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    chatMutation.mutate(
      { message: `ETA update for ${teamName}`, resolvedJobId: jobId },
      {
        onSuccess: (result) => {
          setIsThinking(false);
          const aiMsg = buildAiMessage(result);
          if (aiMsg) setMessages((prev) => [...prev, aiMsg]);
        },
        onError: (err) => {
          setIsThinking(false);
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: "ai",
              content: { type: "text", text: `Something went wrong: ${err.message}` },
              ts: nowTime(),
            },
          ]);
        },
      }
    );
  }, [chatMutation]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: { type: "text", text },
      ts: nowTime(),
    };

    // Cancel any pending bulk_sms_confirm cards — they're stale once user sends a new message
    setMessages((prev) =>
      prev.map((m) =>
        m.content.type === "bulk_sms_confirm"
          ? { ...m, content: { type: "text" as const, text: "_(Cancelled — new request sent)_" } }
          : m
      )
    );
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAcQuery(null); // always clear autocomplete on send
    setIsThinking(true);

    // When a person is locked in, extract the message hint from what the user typed.
    // The message is the full textarea text (entity is the chip, not part of the text)
    let focusedMessageHint: string | null = null;
    if (focusedCustomer) {
      focusedMessageHint = text.trim() || null;
    }

    // Build resolvedEntity for pill-selected entities
    const resolvedEntityPayload = focusedCustomer
      ? focusedCustomer.type === "customer"
        ? ({ type: "customer" as const, phone: focusedCustomer.phone, name: focusedCustomer.name })
        : ({ type: "cleaner" as const, cleanerProfileId: focusedCustomer.cleanerProfileId, name: focusedCustomer.name })
      : undefined;

    chatMutation.mutate(
      {
        message: text,
        // Pass resolvedEntity for pill-selected entities (customer or cleaner)
        ...(resolvedEntityPayload ? { resolvedEntity: resolvedEntityPayload } : {}),
        // Legacy resolvedClientPhone kept for non-pill flows (disambiguation cards, etc.)
        // Pass the message hint so the LLM uses it instead of generating a generic message
        ...(focusedMessageHint ? { resolvedClientMessageHint: focusedMessageHint } : {}),
      },
      {
        onSuccess: (result) => {
          setIsThinking(false);
          const aiMsg = buildAiMessage(result);
          if (aiMsg) setMessages((prev) => [...prev, aiMsg]);
          // Lock suggestions to this customer when a profile is shown
          if (result.type === "customer_profile") {
            setFocusedCustomer({ type: "customer", name: result.profile.name, phone: result.profile.phone });
          }
        },
        onError: (err) => {
          setIsThinking(false);
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: "ai",
              content: { type: "text", text: `Something went wrong: ${err.message}` },
              ts: nowTime(),
            },
          ]);
        },
      }
    );
  }, [input, isThinking, chatMutation, focusedCustomer]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0f1120] rounded-2xl overflow-hidden border border-white/10 shadow-2xl" style={{ minHeight: 600 }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 bg-[#13162a]">
        <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-base">AI Operations Concierge</span>
            <span className="text-xs bg-indigo-600/40 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full font-medium">BETA</span>
          </div>
          <p className="text-gray-400 text-xs mt-0.5">Ask anything. I'll get it done.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-400">Online</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-between text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Mission History */}
        {(missions.length > 0 || missionsLoading) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600">Mission History</p>
              {missions.length > 0 && (
                <button
                  onClick={() => clearMissionHistory()}
                  className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            {missionsLoading && missions.length === 0 && (
              <div className="flex items-center gap-2 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse" />
                <span className="text-[11px] text-gray-600">Loading history…</span>
              </div>
            )}
            {missions.map((mission) => (
              <MissionCard
                key={mission.missionId}
                mission={mission}
                viewState={missionViewState[mission.missionId] ?? (mission.isNew ? "expanded" : "collapsed")}
                onSetViewState={setMissionViewState}
              />
            ))}
            {missions.length > 0 && <div className="border-t border-white/8 pt-1" />}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} agentPhotoUrl={agentPhotoUrl} onPickTeam={handlePickTeam} onPickClient={handlePickClient} onAddMessage={(m) => setMessages((prev) => [...prev, m])} onAddMission={addMission} />
        ))}
        {isThinking && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="px-4 py-3 border-t border-white/10 bg-[#13162a]">

        {/* ── Recognition pill: locked person ── */}
        {focusedCustomer && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-indigo-600/15 border border-indigo-500/40 rounded-xl">
            <div className="w-5 h-5 rounded-md bg-indigo-600/50 flex items-center justify-center text-indigo-200 text-[10px] font-bold shrink-0">
              {focusedCustomer.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <span className="text-indigo-200 text-xs font-semibold flex-1 truncate">{focusedCustomer.name}</span>
            <span className="text-indigo-400 text-[10px] font-medium bg-indigo-500/20 px-1.5 py-0.5 rounded-full">{focusedCustomer.type === "cleaner" ? "Team ✓" : "Recognized ✓"}</span>
            {showAttachedLabel && <span className="text-green-400 text-[10px] font-semibold mr-1 transition-opacity duration-300">✓ Attached</span>}
            <button
              type="button"
              onClick={() => { setFocusedCustomer(null); setShowAttachedLabel(false); setShowChangePopup(false); updateEntityRecognition(input); }}
              className="text-indigo-400 hover:text-red-400 text-[13px] font-bold px-1.5 py-0.5 rounded hover:bg-red-500/10 transition-colors leading-none"
              aria-label="Remove attached person"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Recognition pill: single match ── */}
        {showRecognitionPill && allMatches.length === 1 && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-indigo-600/10 border border-indigo-500/30 rounded-xl">
            <div className="w-5 h-5 rounded-md bg-indigo-600/40 flex items-center justify-center text-indigo-300 text-[10px] font-bold shrink-0">
              {allMatches[0].name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-white text-xs font-semibold">{allMatches[0].name}</span>
              <span className="text-gray-400 text-[11px] ml-1.5">{allMatches[0].subtitle}</span>
            </div>
          </div>
        )}
        {showRecognitionPill && allMatches.length > 1 && (
          <div className="mb-2 bg-[#1e2235] border border-indigo-500/25 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-white/8">
              <p className="text-indigo-300 text-xs font-semibold">{allMatches.length} people found — who did you mean?</p>
            </div>
            <div className="flex flex-col">
              {allMatches.slice(0, 4).map((m, idx) => (
                <button
                  key={m.phone}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); confirmPill(m.isCleaner && m.cleanerProfileId != null ? { type: "cleaner", cleanerProfileId: m.cleanerProfileId, name: m.name, phone: m.phone } : { type: "customer", name: m.name, phone: m.phone }); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left border-b border-white/5 last:border-0 hover:bg-indigo-500/10"
                >
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/30 flex items-center justify-center text-indigo-300 text-[10px] font-bold shrink-0">
                    {m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{m.name}</p>
                    <p className="text-gray-400 text-[11px] truncate">{m.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Change popup: shown when user taps Change on the locked pill ── */}
        {showChangePopup && focusedCustomer && (
          <div className="mb-2 bg-[#1e2235] border border-white/20 rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-white/8 flex items-center justify-between">
              <p className="text-white text-xs font-semibold">Who did you mean?</p>
              <button type="button" onClick={() => setShowChangePopup(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>
            <div className="flex flex-col">
              {allMatches.slice(0, 5).map((m) => (
                <button
                  key={m.phone}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); confirmPill(m.isCleaner && m.cleanerProfileId != null ? { type: "cleaner", cleanerProfileId: m.cleanerProfileId, name: m.name, phone: m.phone } : { type: "customer", name: m.name, phone: m.phone }); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-indigo-500/10 transition-colors text-left border-b border-white/5 last:border-0"
                >
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/30 flex items-center justify-center text-indigo-300 text-[10px] font-bold shrink-0">
                    {m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{m.name}</p>
                    <p className="text-gray-400 text-[11px] truncate">{m.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative bg-[#161929] border border-white/10 rounded-2xl overflow-hidden shadow-lg focus-within:border-indigo-500/40 transition-colors">
          {/* Text input area */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { inputFocused.current = true; }}
            onBlur={() => { inputFocused.current = false; }}
            placeholder="Ask anything or type a command..."
            rows={2}
            className="w-full bg-transparent placeholder-gray-600 text-white text-sm resize-none outline-none leading-relaxed px-4 pt-3.5 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            style={{ minHeight: 52 }}
          />
          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <div className="flex items-center gap-0.5">
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/6 transition-colors text-xs font-medium">
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <div>
                <button
                  onClick={() => setShowCommands((v) => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/6 transition-colors text-xs font-medium"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Commands</span>
                </button>
              </div>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/6 transition-colors text-xs font-medium">
                <AtSign className="w-3.5 h-3.5" />
                <span>People</span>
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all flex-shrink-0 shadow-sm"
            >
              {isThinking
                ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                : <Send className="w-3.5 h-3.5 text-white" />}
            </button>
          </div>
        {!input && (
          <p className="px-4 pb-2 text-[11px] text-gray-400 transition-all">💡 {HINT_EXAMPLES[hintIdx]}</p>
        )}
        </div>
        {showCommands && (
          <CommandPicker
            onSelect={(cmd) => { setInput(cmd); setShowCommands(false); inputRef.current?.focus(); }}
            onClose={() => setShowCommands(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Map server result → Message ──────────────────────────────────────────────

type ServerResult =
  | { type: "completed"; message: string }
  | { type: "error"; message: string }
  | { type: "clarify"; message: string; teams: Array<{ name: string; currentJobId: number; address: string; scheduled: string; etaStatus: string }> }
  | { type: "eta_pending"; jobId: number; teamName: string; cleanerName: string; scheduledTimeET: string; date: string }
  | { type: "bulk_sms_confirm"; targetDescription: string; recipients: BulkSmsRecipient[]; draftMessage: string; command?: string }
  | { type: "bulk_sms_sent"; message: string; results: Array<{ name: string; phone: string; success: boolean; error?: string }> }
  | { type: "client_disambiguation"; messageHint: string | null; matches: Array<{ phone: string; name: string; city: string | null; totalCleans: number; ltv?: number; lastJobDate: string | null }> }
  | { type: "payment_link_confirm"; recipientName: string; recipientFirstName: string; recipientPhone: string; paymentLinkUrl: string; expiresAt: number; smsText: string; command?: string }
  | { type: "payment_link_sent"; recipientName: string; recipientPhone: string; paymentLinkUrl: string; success: boolean; error?: string }
  | { type: "call_client_confirm"; recipientName: string; recipientFirstName: string; recipientPhone: string; script: string; audience: "customer" | "cleaner"; cleanerJobId: number }
  | { type: "call_client_pending"; recipientName: string; recipientPhone: string }
  | { type: "query_result"; answer: string; rows?: Array<{ id: number; jobDate: string | null; teamName: string | null; cleanerName: string | null; customerName: string | null; jobAddress: string | null; serviceDateTime: string | null; jobStatus: string | null }> }
  | { type: "customer_profile"; profile: CustomerProfileCard };

function buildAiMessage(result: ServerResult): Message | null {
  const ts = nowTime();

  if (result.type === "completed") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "completed", card: { message: result.message, ts } },
      ts,
    };
  }

  if (result.type === "error") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "text", text: result.message },
      ts,
    };
  }

  if (result.type === "clarify") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "clarify", card: { message: result.message, teams: result.teams } },
      ts,
    };
  }

  if (result.type === "eta_pending") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "eta_pending",
        card: {
          jobId: result.jobId,
          teamName: result.teamName,
          cleanerName: result.cleanerName,
          scheduledTimeET: result.scheduledTimeET,
          date: result.date,
        },
      },
      ts,
    };
  }
  if (result.type === "bulk_sms_confirm") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "bulk_sms_confirm",
        card: {
          targetDescription: result.targetDescription,
          recipients: result.recipients,
          draftMessage: result.draftMessage,
          command: result.command,
        },
      },
      ts,
    };
  }
  if (result.type === "bulk_sms_sent") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "bulk_sms_sent",
        card: { message: result.message, results: result.results },
      },
      ts,
    };
  }
  if (result.type === "payment_link_confirm") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "payment_link_confirm",
        card: {
          recipientName: result.recipientName,
          recipientFirstName: result.recipientFirstName,
          recipientPhone: result.recipientPhone,
          paymentLinkUrl: result.paymentLinkUrl,
          expiresAt: result.expiresAt,
          smsText: result.smsText,
          command: result.command,
        },
      },
      ts,
    };
  }
  if (result.type === "payment_link_sent") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "payment_link_sent",
        card: {
          recipientName: result.recipientName,
          recipientPhone: result.recipientPhone,
          paymentLinkUrl: result.paymentLinkUrl,
          success: result.success,
          error: result.error,
        },
      },
      ts,
    };
  }
  if (result.type === "client_disambiguation") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "client_disambiguation",
        card: { messageHint: result.messageHint, matches: result.matches },
      },
      ts,
    };
  }
  if (result.type === "call_client_confirm") {
    return {
      id: uid(),
      role: "ai",
      content: {
        type: "call_client_confirm",
        card: {
          recipientName: result.recipientName,
          recipientFirstName: result.recipientFirstName,
          recipientPhone: result.recipientPhone,
          script: result.script,
          audience: result.audience,
          cleanerJobId: result.cleanerJobId,
        },
      },
      ts,
    };
  }
  if (result.type === "query_result") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "query_result", card: { answer: result.answer, rows: result.rows?.map(r => ({ ...r, jobDate: r.jobDate ?? null })) } },
      ts,
    };
  }
  if (result.type === "customer_profile") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "customer_profile", card: result.profile },
      ts,
    };
  }
  if (result.type === "call_client_pending") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "call_client_pending", card: { vapiCallId: "", recipientName: result.recipientName, recipientPhone: result.recipientPhone } },
      ts,
    };
  }
  return null;
}
