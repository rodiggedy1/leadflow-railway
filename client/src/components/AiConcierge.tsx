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
  Sparkles,
  ChevronRight,
  Sun,
} from "lucide-react";
import ReadinessDrawer from "./ReadinessDrawer";
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
  status: "complete" | "partial" | "not_found" | "ambiguous" | "error";
}
// ─── Prepare Tomorrow types ──────────────────────────────────────────────────

interface PrepareChecklistCard {
  steps: Array<{ label: string; status: "done" | "running" | "pending" }>;
}

interface PrepareResultCard {
  readinessPct: number;
  issueCount: number;
  date: string;
  rawDate?: string; // YYYY-MM-DD for drawer
}

interface TeamRatingsCard {
  windowDays: number;
  minRatings: number;
  rows: Array<{
    rank: number;
    cleanerName: string;
    avgRating: number;
    ratedJobs: number;
    totalJobs: number;
  }>;
  excluded: number;
}

interface NoEtaCard {
  date: string;
  rows: Array<{
    teamName: string;
    cleanerName: string;
    scheduledTime: string;
    serviceDateTime: string | null;
    etaStatus: "pending" | "unclear" | "no_answer";
    isPastScheduled: boolean;
    currentJobId: number;
  }>;
}

interface ConfirmationTextsCard {
  date: string;
  dateLabel: string;
  rows: Array<{
    cleanerJobId: number;
    customerName: string;
    customerPhone: string | null;
    serviceDateTime: string | null;
    teamName: string | null;
    alreadySent: boolean;
    smsConfirmedAt: number | null;
  }>;
}

interface ConfirmationResultsCard {
  date: string;
  dateLabel: string;
  rows: Array<{
    clientName: string | null;
    calledPhone: string | null;
    smsFollowupSent: number | null;
    smsConfirmedAt: number | null;
    smsReply: string | null;
    aiOutcome: string | null;
    aiOutcomeLabel: string | null;
    manualOutcome: string | null;
    manualOutcomeLabel: string | null;
    firedAt: number | null;
  }>;
  totalSent: number;
  totalConfirmed: number;
  totalPending: number;
}

interface CardStatusCard {
  date: string;
  rows: Array<{
    customerName: string;
    cardBrand: string | null;
    last4: string | null;
    status: "on_hold" | "no_preauth" | "no_card";
    amountCents: number;
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
  | { type: "card_status"; card: CardStatusCard }
  | { type: "rank_teams"; card: TeamRatingsCard }
  | { type: "list_no_eta"; card: NoEtaCard }
  | { type: "confirmation_texts"; card: ConfirmationTextsCard }
  | { type: "confirmation_results"; card: ConfirmationResultsCard }
  | { type: "job_status_stream"; card: JobStatusStreamCard }
  | { type: "prepare_checklist"; card: PrepareChecklistCard }
  | { type: "prepare_result"; card: PrepareResultCard };
  // customer_profile removed — all informational queries return query_result

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
    <div className="flex items-start gap-4 rounded-xl px-4 py-4" style={{background:"linear-gradient(135deg,#f0fdf4,#e8f5e9)",border:"1px solid #bbf7d0"}}>
      <span className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-white" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm" style={{color:"#166534"}}>Completed</p>
        <p className="text-sm mt-0.5" style={{color:"#4a4a5a"}}>{card.message}</p>
      </div>
      <span className="text-xs flex-shrink-0 mt-1" style={{color:"#8a8a9a"}}>{card.ts}</span>
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
    <div className="mt-3 rounded-xl overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea"}}>
      <div className="px-4 py-3 text-sm leading-relaxed" style={{color:"#2d3039",borderBottom:"1px solid #e5d9ea"}}>
        {card.message}
      </div>
      <div className="px-4 py-3 space-y-2">
        {card.teams.map((team) => (
          <button
            key={team.currentJobId}
            onClick={() => onPickTeam(team.currentJobId, team.name)}
            className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-all hover:bg-purple-50" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea"}}
          >
            <div>
              <p className="text-sm font-semibold" style={{color:"#202431"}}>{team.name}</p>
              <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>{team.address}</p>
            </div>
            <span className="text-xs flex-shrink-0 ml-3" style={{color:"#8a8a9a"}}>{team.scheduled}</span>
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3" style={{borderBottom:"1px solid #e5d9ea"}}>
        <p className="text-sm font-semibold" style={{color:"#202431"}}>Multiple matches — choose one</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        {card.matches.map((m) => (
          <button
            key={m.phone}
            onClick={() => onPick(m.phone, m.name)}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-purple-50" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea"}}
          >
            <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{background:"rgba(116,71,245,0.12)"}}>
              <User className="w-4 h-4" style={{color:"#7447f5"}} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{color:"#202431"}}>{m.name}</p>
              <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>{m.city || m.phone}{m.totalCleans ? ` · ${m.totalCleans} cleans` : ""}{m.lastJobDate ? ` · last ${m.lastJobDate}` : ""}</p>
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
        <Users className="w-4 h-4 flex-shrink-0" style={{color:"#7447f5"}} />
        <p className="text-sm font-semibold" style={{color:"#202431"}}>Text {card.targetDescription}</p>
        <span className="ml-auto text-xs text-gray-500">{card.recipients.length} recipient{card.recipients.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
        {card.recipients.map((r) => (
          <span key={r.phone} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs" style={{background:"rgba(116,71,245,0.08)",border:"1px solid #e5d9ea",color:"#4a4a5a"}}>
            <User className="w-3 h-3" style={{color:"#9b8aaa"}} />
            <span className="font-medium" style={{color:"#202431"}}>{r.name}</span>
            <span className="text-gray-500">·</span>
            <span style={{color:"#7447f5"}}>{r.phone}</span>
          </span>
        ))}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Edit3 className="w-3 h-3" style={{color:"#7447f5"}} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#7447f5"}}>Message</span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sent || sendMutation.isPending}
          rows={3}
          className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none transition-colors disabled:opacity-60 scrollbar-none overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{background:"rgba(255,255,255,0.8)",border:"1px solid #e5d9ea",color:"#2d3039"}}
        />
      </div>
      {!sent && (
        <div className="px-4 pb-4">
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-all" style={{background:"linear-gradient(135deg,#7447f5,#9b6ff5)"}}
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center gap-3 ${allOk ? "bg-green-50" : "bg-amber-50"}`} style={{borderBottom:"1px solid #e5d9ea"}}>
        <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${allOk ? "bg-green-500" : "bg-yellow-500"}`}>
          {allOk ? <CheckCircle2 className="w-5 h-5 text-white" /> : <AlertTriangle className="w-5 h-5 text-white" />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{color:"#202431"}}>{allOk ? "Message Sent" : "Partial Send"}</p>
          <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>
            {successCount > 0 && <span className="text-green-400">{successCount} delivered</span>}
            {failCount > 0 && <span className="text-red-400 ml-2">{failCount} failed</span>}
            <span className="ml-2" style={{color:"#8a8a9a"}}>· {sentAt}</span>
          </p>
        </div>
        <MessageSquare className={`w-4 h-4 flex-shrink-0 ${allOk ? "text-green-400" : "text-yellow-400"}`} />
      </div>
      {/* Recipient rows */}
      <div className="px-4 py-3 space-y-2">
        {card.results.map((r, i) => (
          <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg ${r.success ? "bg-green-500/5 border border-green-500/15" : "bg-red-500/5 border border-red-500/15"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${r.success ? "bg-green-100" : "bg-red-100"}`}>
              {r.success
                ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                : <XCircle className="w-4 h-4 text-red-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold truncate ${r.success ? "" : "text-red-500"}`}>{r.name}</p>
              <p className="text-xs truncate" style={{color:"#8a8a9a"}}>{r.phone}{r.error ? ` — ${r.error}` : ""}</p>
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
        <CreditCard className="w-4 h-4 flex-shrink-0" style={{color:"#7447f5"}} />
        <p className="text-sm font-semibold" style={{color:"#202431"}}>Send Payment Link</p>
      </div>
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{background:"rgba(116,71,245,0.12)"}}>
          <User className="w-4 h-4" style={{color:"#7447f5"}} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{color:"#202431"}}>{card.recipientName}</p>
          <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>{card.recipientPhone}</p>
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
        <span className="text-[11px]" style={{color:"#8a8a9a"}}>Link expires {expiryDate}</span>
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Edit3 className="w-3 h-3" style={{color:"#7447f5"}} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{color:"#7447f5"}}>Message to send</span>
        </div>
        <textarea
          value={smsText}
          onChange={(e) => setSmsText(e.target.value)}
          disabled={sent || sendMutation.isPending}
          rows={8}
          className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none transition-colors disabled:opacity-60" style={{background:"rgba(255,255,255,0.8)",border:"1px solid #e5d9ea",color:"#2d3039"}}
        />
      </div>
      {!sent && (
        <div className="px-4 pb-4">
          <button
            onClick={handleSend}
            disabled={!smsText.trim() || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-all" style={{background:"linear-gradient(135deg,#7447f5,#9b6ff5)"}}
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${card.success ? "bg-green-500" : "bg-red-500"}`}>
          {card.success ? <CheckCircle2 className="w-3.5 h-3.5 text-white" /> : <XCircle className="w-3.5 h-3.5 text-white" />}
        </span>
        <p className="text-sm font-semibold" style={{color:"#202431"}}>
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
      <div className="flex items-center gap-3 rounded-[18px] px-3 py-3" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea"}}>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-indigo-500" style={{background:"rgba(116,71,245,0.12)"}}>
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </div>
        <span className="text-xs text-indigo-400 italic">Audio loading…</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-[18px] px-3 py-3" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea"}}>
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
function CallClientConfirmCardView({ card, onFired, onMissionSaved }: { card: CallClientConfirmCard; onFired: (vapiCallId: string, script: string) => void; onMissionSaved?: (mission: MissionMetadata) => void }) {
  const [script, setScript] = useState(card.script);
  const [fired, setFired] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const saveCallMission = trpc.aiConcierge.saveCallMission.useMutation({
    onSuccess: (res) => { if (res.mission && onMissionSaved) onMissionSaved(res.mission); },
  });
  const startCall = trpc.callMatrix.startCall.useMutation({
    onSuccess: (result) => {
      setFired(true);
      const vapiCallId = result.vapiCallId ?? "";
      onFired(vapiCallId, script);
      if (vapiCallId) {
        saveCallMission.mutate({
          vapiCallId,
          recipientName: card.recipientName,
          recipientPhone: card.recipientPhone,
          script,
        });
      }
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3 flex items-center gap-3" style={{borderBottom:"1px solid #e5d9ea"}}>
        <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{background:"rgba(116,71,245,0.12)"}}>
          <Phone className="w-4 h-4" style={{color:"#7447f5"}} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{color:"#202431"}}>{card.recipientName}</p>
          <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>{card.recipientPhone}</p>
        </div>
      </div>
      <div className="px-4 py-3">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          disabled={fired || startCall.isPending}
          rows={4}
          className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none transition-colors disabled:opacity-60 scrollbar-none overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" style={{background:"rgba(255,255,255,0.8)",border:"1px solid #e5d9ea",color:"#2d3039"}}
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
            className="w-full flex items-center justify-center gap-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-all" style={{background:"linear-gradient(135deg,#7447f5,#9b6ff5)"}}
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3" style={{borderBottom:"1px solid #e5d9ea"}}>
        <p className="text-sm font-semibold text-white">Calling {card.recipientName}</p>
        <p className="text-xs mt-0.5" style={{color:"#8a8a9a"}}>{card.recipientPhone}</p>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-start gap-3">
          <StepIcon status="done" />
          <span className="flex-1 text-sm" style={{color:"#4a4a5a"}}>Call placed to <span className="text-white font-semibold">{card.recipientName}</span></span>
        </div>
        <div className="flex items-start gap-3">
          <StepIcon status={step2Status} />
          <span className={`flex-1 text-sm ${step2Status === "running" ? "font-semibold" : step2Status === "done" ? "" : "text-red-500"}`}>{step2Label}</span>
        </div>
      </div>
      {callDone && (
        <div className="px-4 pb-4 pt-3 space-y-3" style={{borderTop:"1px solid #e5d9ea"}}>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{color:"#7447f5"}}>
            <MessageCircle className="h-3.5 w-3.5" style={{color:"#7447f5"}} /> Recording
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
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea",color:"#7447f5"}}
              >
                <span>Call transcript</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${transcriptOpen ? "rotate-180" : ""}`} />
              </button>
              {transcriptOpen && (
                <div className="mt-1.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea",color:"#4a4a5a"}}>{transcript}</div>
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
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      <div className="px-4 py-3" style={{borderBottom:"1px solid #e5d9ea"}}>
        <p className="text-sm font-semibold" style={{color:"#202431"}}>ETA Update — {card.teamName}</p>
      </div>
      <div className="px-4 py-3 space-y-3">
        {/* Step 1: call placed */}
        <div className="flex items-start gap-3">
          <StepIcon status="done" />
          <span className="flex-1 text-sm" style={{color:"#4a4a5a"}}>
            ETA call placed for <span className="font-semibold" style={{color:"#202431"}}>{card.teamName}</span> ({card.cleanerName}) — scheduled {card.scheduledTimeET}
          </span>
        </div>
        {/* Step 2: call result */}
        <div className="flex items-start gap-3">
          <StepIcon status={step2Status} />
          <span className={`flex-1 text-sm ${step2Status === "running" ? "font-semibold" : step2Status === "done" ? "" : "text-red-500"}`}>
            {step2Label}
          </span>
        </div>
        {/* Step 3: client SMS */}
        <div className="flex items-start gap-3">
          <StepIcon status={step3Status} />
          <span className={`flex-1 text-sm ${step3Status === "pending" ? "" : step3Status === "done" ? "" : "text-red-500"}`}>
            {step3Label}
          </span>
        </div>
      </div>
      {/* Recording + transcript once call is done */}
      {callDone && (
        <div className="px-4 pb-4 pt-3 space-y-3" style={{borderTop:"1px solid #e5d9ea"}}>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest" style={{color:"#7447f5"}}>
            <MessageCircle className="h-3.5 w-3.5" style={{color:"#7447f5"}} /> Recording
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
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea",color:"#7447f5"}}
              >
                <span>Call transcript</span>
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${transcriptOpen ? "rotate-180" : ""}`} />
              </button>
              {transcriptOpen && (
                <div className="mt-1.5 rounded-xl px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea",color:"#4a4a5a"}}>
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
  onOpenReadiness,
}: {
  msg: Message;
  agentPhotoUrl?: string;
  onPickTeam: (jobId: number, teamName: string) => void;
  onPickClient: (phone: string, name: string, messageHint: string | null) => void;
  onAddMessage: (m: Message) => void;
  onAddMission: (metadata: MissionMetadata) => void;
  onOpenReadiness: (rawDate?: string) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex items-end justify-end gap-3">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed" style={{background:"linear-gradient(135deg,#7447f5,#9b6ff5)",color:"#fff"}}>
            {msg.content.type === "text" && msg.content.text}
          </div>
          <div className="text-right text-xs text-gray-500 mt-1 pr-1">
            {msg.ts}{" "}
            <span style={{color:"#9b6ff5"}}>✓✓</span>
          </div>
        </div>
        {agentPhotoUrl ? (
          <img
            src={agentPhotoUrl}
            alt="You"
            className="w-8 h-8 rounded-full object-cover flex-shrink-0 mb-5"
          />
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mb-5" style={{background:"linear-gradient(135deg,#7447f5,#9b6ff5)"}}>
            <User className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
    );
  }

  // AI message
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-full flex-shrink-0 mt-1 overflow-hidden" style={{ border: "2px solid rgba(255,255,255,0.9)", boxShadow: "0 4px 12px rgba(54,38,25,0.12)" }}>
        <img src="/madison-avatar.jpg" alt="Madison" className="w-full h-full object-cover" />
      </div>
      <div className="max-w-[82%]">
        {msg.content.type === "text" && (
          <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style={{ background: "linear-gradient(135deg, rgba(250,244,255,0.95), rgba(244,234,250,0.85))", border: "1px solid #e5d9ea", color: "#2d3039" }}>
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
          <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea"}}>
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
              onMissionSaved={onAddMission}
              onFired={(vapiCallId, _script) => {
                const recipientName = msg.content.type === "call_client_confirm" ? msg.content.card.recipientName : "";
                const recipientPhone = msg.content.type === "call_client_confirm" ? msg.content.card.recipientPhone : "";
                onAddMessage({
                  id: uid(),
                  role: "ai",
                  content: { type: "call_client_pending", card: { vapiCallId, recipientName, recipientPhone } },
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
        {msg.content.type === "card_status" && (
          <div>
            <CardStatusCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "rank_teams" && (
          <div>
            <TeamRatingsCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "list_no_eta" && (
          <div>
            <NoEtaCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "confirmation_texts" && (
          <div>
            <ConfirmationTextsCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "confirmation_results" && (
          <div>
            <ConfirmationResultsCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "job_status_stream" && (
          <div>
            <JobStatusStreamCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "prepare_checklist" && (
          <div>
            <PrepareChecklistCardView card={msg.content.card} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {msg.content.type === "prepare_result" && (
          <div>
            <PrepareResultCardView card={msg.content.card} onOpen={() => onOpenReadiness(msg.content.type === 'prepare_result' ? msg.content.card.rawDate : undefined)} />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
        {/* customer_profile branch removed — all informational queries return query_result */}
      </div>
    </div>
  );
}


// ─── Prepare checklist card ──────────────────────────────────────────────────

function PrepareChecklistCardView({ card }: { card: PrepareChecklistCard }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #e8e0f0", width: "100%" }}>
      <div style={{ background: "linear-gradient(135deg, #f5f0ff, #ede8ff)", borderBottom: "1px solid #e0d8f8", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles className="w-4 h-4" style={{ color: "#7c3aed" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#4c1d95" }}>Running tomorrow readiness checks...</span>
      </div>
      <div style={{ padding: "8px 0" }}>
        {card.steps.map((step, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px" }}>
            {step.status === "done" && (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
            )}
            {step.status === "running" && (
              <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" style={{ color: "#7c3aed" }} />
            )}
            {step.status === "pending" && (
              <Circle className="w-4 h-4 flex-shrink-0" style={{ color: "#d1d5db" }} />
            )}
            <span style={{ fontSize: 13, color: step.status === "pending" ? "#9ca3af" : "#1f2937", fontWeight: step.status === "running" ? 600 : 400 }}>
              {step.label}
            </span>
            {step.status === "done" && (
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#22c55e" }}>Done</span>
            )}
            {step.status === "running" && (
              <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: "#7c3aed" }}>In progress</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Prepare result card ──────────────────────────────────────────────────────

function PrepareResultCardView({ card, onOpen }: { card: PrepareResultCard; onOpen: (rawDate?: string) => void }) {
  const pct = card.readinessPct;
  const color = pct >= 90 ? "#22c55e" : pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid #e8e0f0", width: "100%" }}>
      {/* Top row: thumbnail + text info */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 14px 10px" }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, background: "linear-gradient(135deg, #fde68a, #fb923c, #c084fc)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
          🌅
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", marginBottom: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>Tomorrow Readiness</p>
          <p style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1.1, marginBottom: 4 }}>{pct}% Ready</p>
          <p style={{ fontSize: 12, color: "#9ca3af" }}>{card.issueCount} action item{card.issueCount !== 1 ? "s" : ""} need your attention</p>
        </div>
      </div>
      {/* Bottom row: full-width CTA button */}
      <div style={{ padding: "0 14px 14px" }}>
        <button
          onClick={() => onOpen(card.rawDate)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "11px 16px", borderRadius: 10, background: "linear-gradient(135deg, #7c3aed, #5b21b6)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}
        >
          Open Readiness <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Query result card ────────────────────────────────────────────────────────

function QueryResultCardView({ card }: { card: QueryResultCard }) {
  const statusColor: Record<string, string> = {
    complete: "#34d399",
    partial: "#fbbf24",
    not_found: "#6b7280",
    ambiguous: "#a78bfa",
    error: "#f87171",
  };
  const color = statusColor[card.status] ?? "#6b7280";

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      {/* Header */}
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #4f6ef7, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Calendar className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Operations Query</p>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color, background: `${color}22`, padding: "2px 8px", borderRadius: 10, textTransform: "capitalize", whiteSpace: "nowrap" }}>
          {card.status.replace("_", " ")}
        </span>
      </div>

      {/* Answer prose */}
      <div style={{ padding: "12px 14px" }}>
        {card.answer.split("\n").filter(Boolean).map((line, i) => (
          <p key={i} style={{ fontSize: 13, color: "#c8cde8", lineHeight: 1.6, marginBottom: 4 }}>{line}</p>
        ))}
      </div>
    </div>
  );
}

// ─── Card status card ───────────────────────────────────────────────────────
function CardStatusCardView({ card }: { card: CardStatusCard }) {
  const onHold = card.rows.filter(r => r.status === "on_hold");
  const noPreauth = card.rows.filter(r => r.status === "no_preauth");
  const noCard = card.rows.filter(r => r.status === "no_card");

  function formatAmount(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function formatCard(brand: string | null, last4: string | null) {
    if (!last4) return "—";
    const b = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
    return `${b} ···· ${last4}`;
  }

  function downloadCsv() {
    const header = "Customer,Card,Status,Amount";
    const lines = card.rows.map(r => {
      const status = r.status === "on_hold" ? `On Hold ${formatAmount(r.amountCents)}` : r.status === "no_preauth" ? "No Pre-Auth" : "No Card";
      return `"${r.customerName}","${formatCard(r.cardBrand, r.last4)}","${status}","${r.status === "on_hold" ? formatAmount(r.amountCents) : ""}"`;
    });
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-status-${card.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusBadge = (row: CardStatusCard["rows"][0]) => {
    if (row.status === "on_hold") return <span style={{ fontSize: 11, fontWeight: 600, color: "#34d399", background: "#34d39922", padding: "2px 7px", borderRadius: 8 }}>On Hold · {formatAmount(row.amountCents)}</span>;
    if (row.status === "no_preauth") return <span style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", background: "#fbbf2422", padding: "2px 7px", borderRadius: 8 }}>No Pre-Auth</span>;
    return <span style={{ fontSize: 11, fontWeight: 600, color: "#f87171", background: "#f8717122", padding: "2px 7px", borderRadius: 8 }}>No Card</span>;
  };

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      {/* Header */}
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #4f6ef7, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CreditCard className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Card Status</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#c8cde8" }}>{card.date} · {card.rows.length} job{card.rows.length !== 1 ? "s" : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {onHold.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#34d399", background: "#34d39922", padding: "2px 7px", borderRadius: 8 }}>{onHold.length} on hold</span>}
          {noPreauth.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", background: "#fbbf2422", padding: "2px 7px", borderRadius: 8 }}>{noPreauth.length} no pre-auth</span>}
          {noCard.length > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: "#f87171", background: "#f8717122", padding: "2px 7px", borderRadius: 8 }}>{noCard.length} no card</span>}
        </div>
      </div>
      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2a2e47" }}>
              {["Customer", "Card", "Status"].map(h => (
                <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < card.rows.length - 1 ? "1px solid #2a2e4744" : undefined }}>
                <td style={{ padding: "9px 14px", fontSize: 13, color: "#c8cde8", fontWeight: 500 }}>{row.customerName}</td>
                <td style={{ padding: "9px 14px", fontSize: 12, color: "#8a8aaa", fontFamily: "monospace" }}>{formatCard(row.cardBrand, row.last4)}</td>
                <td style={{ padding: "9px 14px" }}>{statusBadge(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Footer */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid #2a2e47" }}>
        <button onClick={downloadCsv} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#7447f5", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          <ExternalLink className="w-3 h-3" /> Download CSV
        </button>
      </div>
    </div>
  );
}

// ─── Team ratings card ───────────────────────────────────────────────────────

function TeamRatingsCardView({ card }: { card: TeamRatingsCard }) {
  function stars(rating: number) {
    const full = Math.floor(rating);
    const half = rating - full >= 0.5;
    return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(5 - full - (half ? 1 : 0));
  }

  const medalColor = (rank: number) => {
    if (rank === 1) return "#fbbf24"; // gold
    if (rank === 2) return "#9ca3af"; // silver
    if (rank === 3) return "#cd7c3f"; // bronze
    return "#6b7280";
  };

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      {/* Header */}
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #fbbf24, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Users className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Team Rankings</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#c8cde8" }}>Last {card.windowDays} days · min {card.minRatings} ratings</p>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", background: "#fbbf2422", padding: "2px 7px", borderRadius: 8 }}>{card.rows.length} teams</span>
      </div>
      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #2a2e47" }}>
              {["#", "Team", "Rating", "Jobs Rated"].map(h => (
                <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row, i) => (
              <tr key={i} style={{ borderBottom: i < card.rows.length - 1 ? "1px solid #2a2e4744" : undefined }}>
                <td style={{ padding: "9px 14px", fontSize: 13, fontWeight: 700, color: medalColor(row.rank) }}>{row.rank}</td>
                <td style={{ padding: "9px 14px", fontSize: 13, color: "#c8cde8", fontWeight: 500 }}>{row.cleanerName}</td>
                <td style={{ padding: "9px 14px", fontSize: 13, color: "#fbbf24", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {row.avgRating.toFixed(1)} <span style={{ fontSize: 11, color: "#6b7280" }}>{stars(row.avgRating)}</span>
                </td>
                <td style={{ padding: "9px 14px", fontSize: 12, color: "#8a8aaa" }}>{row.ratedJobs} / {row.totalJobs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {card.excluded > 0 && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid #2a2e47", fontSize: 11, color: "#6b7280" }}>
          {card.excluded} team{card.excluded !== 1 ? "s" : ""} excluded (fewer than {card.minRatings} rated jobs)
        </div>
      )}
    </div>
  );
}

// ─── No ETA card ────────────────────────────────────────────────────────────

function NoEtaCardView({ card }: { card: NoEtaCard }) {
  const etaStatusLabel = (s: string) => {
    if (s === "no_answer") return { label: "No Answer", color: "#ef4444", bg: "#ef444422" };
    if (s === "unclear") return { label: "Unclear", color: "#f59e0b", bg: "#f59e0b22" };
    return { label: "Pending", color: "#6b7280", bg: "#6b728022" };
  };

  if (card.rows.length === 0) {
    return (
      <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
        <div style={{ background: "#1e2235", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #22c55e, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <CheckCircle2 className="w-3 h-3 text-white" />
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#c8cde8" }}>All teams have confirmed ETAs — you're good to go!</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Clock className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Missing ETAs</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#c8cde8" }}>{card.rows.length} team{card.rows.length !== 1 ? "s" : ""} without confirmed ETA</p>
        </div>
        {card.rows.some(r => r.isPastScheduled) && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "#ef444422", padding: "2px 7px", borderRadius: 8, whiteSpace: "nowrap" }}>
            {card.rows.filter(r => r.isPastScheduled).length} OVERDUE
          </span>
        )}
      </div>
      <div>
        {card.rows.map((row, i) => {
          const { label, color, bg } = etaStatusLabel(row.etaStatus);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < card.rows.length - 1 ? "1px solid #2a2e4744" : undefined }}>
              {row.isPastScheduled ? (
                <span style={{ fontSize: 16, flexShrink: 0 }}>🔥</span>
              ) : (
                <Clock className="w-4 h-4 flex-shrink-0" style={{ color: "#6b7280" }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: row.isPastScheduled ? "#fca5a5" : "#c8cde8", marginBottom: 1 }}>{row.teamName}</p>
                <p style={{ fontSize: 11, color: "#6b7280" }}>{row.scheduledTime}{row.isPastScheduled ? " · past scheduled time" : ""}</p>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color, background: bg, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Confirmation texts card ────────────────────────────────────────────────

function ConfirmationTextsCardView({ card }: { card: ConfirmationTextsCard }) {
  const formatTime = (dt: string | null) => {
    if (!dt) return "";
    try {
      const d = new Date(dt);
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
    } catch { return ""; }
  };

  const pending = card.rows.filter(r => !r.alreadySent && r.customerPhone);
  const [selected, setSelected] = React.useState<Set<number>>(() => new Set(pending.map(r => r.cleanerJobId)));
  const [sentIds, setSentIds] = React.useState<Set<number>>(new Set());
  const [failedIds, setFailedIds] = React.useState<Set<number>>(new Set());
  const [sending, setSending] = React.useState(false);

  const placeCall = trpc.confirmationCalls.placeCall.useMutation();

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map(r => r.cleanerJobId)));
  };

  const sendSelected = async () => {
    const toSend = pending.filter(r => selected.has(r.cleanerJobId));
    if (toSend.length === 0) return;
    setSending(true);
    for (const row of toSend) {
      try {
        await placeCall.mutateAsync({
          cleanerJobId: row.cleanerJobId,
          jobDate: card.date,
          clientName: row.customerName,
          calledPhone: row.customerPhone!,
        });
        setSentIds(prev => new Set([...prev, row.cleanerJobId]));
      } catch {
        setFailedIds(prev => new Set([...prev, row.cleanerJobId]));
      }
    }
    setSending(false);
  };

  if (card.rows.length === 0) {
    return (
      <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
        <div style={{ background: "#1e2235", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #22c55e, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <CheckCircle2 className="w-3 h-3 text-white" />
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#c8cde8" }}>No jobs found for {card.dateLabel}.</p>
        </div>
      </div>
    );
  }

  const allSent = pending.length > 0 && pending.every(r => sentIds.has(r.cleanerJobId) || r.alreadySent);

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      {/* Header */}
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <MessageSquare className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Confirmation Texts — {card.dateLabel}</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#c8cde8" }}>
            {pending.length} pending · {card.rows.filter(r => r.alreadySent).length} already sent
          </p>
        </div>
        {pending.length > 0 && !allSent && (
          <button
            onClick={toggleAll}
            style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 6, whiteSpace: "nowrap" }}
          >
            {selected.size === pending.length ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {/* Rows */}
      <div>
        {card.rows.map((row, i) => {
          const isSent = sentIds.has(row.cleanerJobId);
          const isFailed = failedIds.has(row.cleanerJobId);
          const isAlreadySent = row.alreadySent;
          const isConfirmed = !!row.smsConfirmedAt;
          const isPending = !isAlreadySent && !isSent && row.customerPhone;
          const isChecked = selected.has(row.cleanerJobId);

          return (
            <div
              key={i}
              onClick={() => isPending && !sending ? toggle(row.cleanerJobId) : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                borderBottom: i < card.rows.length - 1 ? "1px solid #2a2e4744" : undefined,
                cursor: isPending && !sending ? "pointer" : "default",
                background: isPending && isChecked ? "rgba(99,102,241,0.06)" : undefined,
                transition: "background 0.15s",
              }}
            >
              {/* Checkbox / status icon */}
              {isConfirmed ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
              ) : isSent ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#6366f1" }} />
              ) : isFailed ? (
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}>!</span>
                </div>
              ) : isAlreadySent ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#6366f1" }} />
              ) : isPending ? (
                <div
                  className="w-4 h-4 rounded flex-shrink-0"
                  style={{
                    border: isChecked ? "2px solid #6366f1" : "2px solid #4b5563",
                    background: isChecked ? "#6366f1" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                >
                  {isChecked && <span style={{ fontSize: 9, color: "#fff", fontWeight: 700 }}>✓</span>}
                </div>
              ) : (
                <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ border: "2px solid #374151" }} />
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#c8cde8", marginBottom: 1 }}>{row.customerName}</p>
                <p style={{ fontSize: 11, color: "#6b7280" }}>
                  {row.teamName && <span>{row.teamName} · </span>}
                  {formatTime(row.serviceDateTime)}
                  {!row.customerPhone && <span style={{ color: "#ef4444" }}> · no phone</span>}
                </p>
              </div>

              {/* Status badge */}
              {isConfirmed ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#22c55e", background: "#22c55e22", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>Confirmed</span>
              ) : isSent ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "#6366f122", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>Sent ✓</span>
              ) : isFailed ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#ef4444", background: "#ef444422", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>Failed</span>
              ) : isAlreadySent ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6366f1", background: "#6366f122", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>Sent</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Footer: Send Selected button */}
      {pending.length > 0 && !allSent && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #2a2e47", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            {selected.size} of {pending.length} selected
          </span>
          <button
            onClick={sendSelected}
            disabled={selected.size === 0 || sending}
            style={{
              fontSize: 12, fontWeight: 700, color: "#fff",
              background: selected.size === 0 || sending ? "#374151" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "none", borderRadius: 8, padding: "6px 16px",
              cursor: selected.size === 0 || sending ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.15s",
            }}
          >
            {sending ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Sending...</>
            ) : (
              <>Send {selected.size > 0 ? selected.size : ""} Text{selected.size !== 1 ? "s" : ""}</>
            )}
          </button>
        </div>
      )}
      {allSent && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid #2a2e47", display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "#22c55e" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#22c55e" }}>All texts sent!</span>
        </div>
      )}
    </div>
  );
}

// ─── Confirmation results card ────────────────────────────────────────────────

function ConfirmationResultsCardView({ card }: { card: ConfirmationResultsCard }) {
  const outcomeLabel = (row: ConfirmationResultsCard["rows"][0]) => {
    const outcome = row.manualOutcome ?? row.aiOutcome;
    if (row.smsConfirmedAt) return { label: "Confirmed", color: "#22c55e", bg: "#22c55e22" };
    if (outcome === "confirmed") return { label: "Confirmed", color: "#22c55e", bg: "#22c55e22" };
    if (outcome === "reschedule") return { label: "Reschedule", color: "#f59e0b", bg: "#f59e0b22" };
    if (outcome === "cancel") return { label: "Cancel", color: "#ef4444", bg: "#ef444422" };
    if (outcome === "no_answer" || outcome === "voicemail") return { label: "No Answer", color: "#6b7280", bg: "#6b728022" };
    if (row.smsFollowupSent === 1) return { label: "Sent", color: "#6366f1", bg: "#6366f122" };
    return { label: "Pending", color: "#4b5563", bg: "#4b556322" };
  };

  if (card.rows.length === 0) {
    return (
      <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
        <div style={{ background: "#1e2235", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#c8cde8" }}>No confirmation texts sent for {card.dateLabel} yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", width: "100%" }}>
      <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg, #22c55e, #16a34a)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CheckCircle2 className="w-3 h-3 text-white" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280", marginBottom: 2 }}>Confirmation Results — {card.dateLabel}</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#c8cde8" }}>
            {card.totalConfirmed} confirmed · {card.totalPending} pending · {card.totalSent} sent
          </p>
        </div>
      </div>
      <div>
        {card.rows.map((row, i) => {
          const { label, color, bg } = outcomeLabel(row);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: i < card.rows.length - 1 ? "1px solid #2a2e4744" : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#c8cde8", marginBottom: 1 }}>{row.clientName ?? "Unknown"}</p>
                {row.smsReply && (
                  <p style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic", marginTop: 2 }}>\u201c{row.smsReply}\u201d</p>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color, background: bg, padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Customer profile card ───────────────────────────────────────────────────

// ─── Job Status Stream card ──────────────────────────────────────────────────

interface JobStatusStreamCard {
  alerts: Array<{ alertType: string; jobId: number; title: string; body: string; source: string; ts: number; resolvedAt?: number | null }>;
  cleanerStatuses: Array<{ id: number; cleanerName: string; status: string; label: string; emoji: string; customerName: string | null; etaLabel: string | null; issueNote: string | null; cleanerJobId: number | null; ts: number }>;
}

function JobStatusStreamCardView({ card }: { card: JobStatusStreamCard }) {
  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const ALERT_STYLE: Record<string, { borderColor: string; badgeText: string; badgeColor: string; icon: string }> = {
    stale_eta:    { borderColor: "#d97706", badgeText: "ETA PASSED",  badgeColor: "#d97706", icon: "🚗" },
    noshow_alert: { borderColor: "#ef4444", badgeText: "NO CHECK-IN", badgeColor: "#ef4444", icon: "🚨" },
  };

  const STATUS_COLOR: Record<string, string> = {
    completed:         "#22c55e",
    in_progress:       "#6366f1",
    arrived:           "#22c55e",
    on_the_way:        "#f59e0b",
    running_late:      "#ef4444",
    issue_at_property: "#ef4444",
    finishing_up:      "#8b5cf6",
    wrapping_up:       "#8b5cf6",
  };

  const hasAlerts = card.alerts.length > 0;
  const hasStatuses = card.cleanerStatuses.length > 0;

  if (!hasAlerts && !hasStatuses) {
    return (
      <div style={{ background: "#1a1d30", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", padding: "16px 14px", width: "100%" }}>
        <p style={{ fontSize: 13, color: "#6b7280", textAlign: "center" }}>No job activity yet today.</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
      {hasAlerts && (
        <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "9px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af", flex: 1 }}>Live Alerts</p>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", background: "#ef444422", padding: "1px 7px", borderRadius: 8 }}>{card.alerts.length}</span>
          </div>
          {card.alerts.map((alert, i) => {
            const s = ALERT_STYLE[alert.alertType] ?? ALERT_STYLE.noshow_alert;
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "10px 14px", borderBottom: i < card.alerts.length - 1 ? "1px solid #2a2e4744" : undefined, borderLeft: `3px solid ${s.borderColor}` }}>
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3 }}>{alert.title}</p>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: s.badgeColor, background: `${s.badgeColor}22`, padding: "1px 6px", borderRadius: 6, flexShrink: 0 }}>{s.badgeText}</span>
                  </div>
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{alert.body}</p>
                </div>
                <span style={{ fontSize: 11, color: "#6b7280", flexShrink: 0, alignSelf: "flex-start", marginTop: 2 }}>{fmtTime(alert.ts)}</span>
              </div>
            );
          })}
        </div>
      )}
      {hasStatuses && (
        <div style={{ background: "#1a1d30", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ background: "#1e2235", borderBottom: "1px solid #2a2e47", padding: "9px 14px", display: "flex", alignItems: "center", gap: 8 }}>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9ca3af", flex: 1 }}>Team Status</p>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280" }}>{card.cleanerStatuses.length} updates</span>
          </div>
          {card.cleanerStatuses.map((row, i) => {
            const dotColor = STATUS_COLOR[row.status] ?? "#6b7280";
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: i < card.cleanerStatuses.length - 1 ? "1px solid #2a2e4744" : undefined }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{row.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#c8cde8" }}>{row.cleanerName}</p>
                    <span style={{ fontSize: 10, fontWeight: 700, color: dotColor, background: `${dotColor}22`, padding: "1px 6px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{row.label}</span>
                  </div>
                  {row.customerName && (
                    <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>
                      {row.customerName}{row.etaLabel ? ` · ETA ${row.etaLabel}` : ""}
                    </p>
                  )}
                  {row.issueNote && (
                    <p style={{ fontSize: 11, color: "#ef4444", marginTop: 1 }}>{row.issueNote}</p>
                  )}
                </div>
                <span style={{ fontSize: 11, color: "#6b7280", flexShrink: 0 }}>{fmtTime(row.ts)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


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
    <div className="rounded-xl overflow-hidden w-full max-w-sm" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 20px rgba(116,71,245,0.08)"}}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{borderBottom:"1px solid #e5d9ea"}}>
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
          <div className="mt-3 text-xs leading-relaxed rounded-lg px-3 py-2" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #e5d9ea",color:"#4a4a5a"}}>
            {card.aiSummary}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4" style={{borderBottom:"1px solid #e5d9ea",borderTop:"1px solid #e5d9ea"}}>
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
        <div className="px-4 py-2.5 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
          <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
          <span className="text-xs text-gray-400">Usual team:</span>
          <span className="text-xs font-semibold text-white">{card.usualTeam}</span>
        </div>
      )}

      {/* Upcoming job */}
      {card.upcomingJob && (
        <div className="px-4 py-2.5 flex items-center gap-2" style={{borderBottom:"1px solid #e5d9ea"}}>
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
        <div className=""  style={{borderBottom:"1px solid #e5d9ea"}}>
          <button onClick={() => toggle("memory")} className="w-full px-4 py-2.5 flex items-center justify-between text-left transition-all hover:bg-purple-50">
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
        <div className=""  style={{borderBottom:"1px solid #e5d9ea"}}>
          <button onClick={() => toggle("jobs")} className="w-full px-4 py-2.5 flex items-center justify-between text-left transition-all hover:bg-purple-50">
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
        <div className=""  style={{borderBottom:"1px solid #e5d9ea"}}>
          <button onClick={() => toggle("messages")} className="w-full px-4 py-2.5 flex items-center justify-between text-left transition-all hover:bg-purple-50">
            <span className="text-xs font-semibold text-gray-300">Recent Messages ({card.lastMessages.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "messages" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "messages" && (
            <div className="px-4 pb-3 space-y-2">
              {card.lastMessages.map((m, i) => (
                <div key={i} className="rounded-lg px-3 py-2" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #f0e8fa"}}>
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
        <div className=""  style={{borderBottom:"1px solid #e5d9ea"}}>
          <button onClick={() => toggle("calls")} className="w-full px-4 py-2.5 flex items-center justify-between text-left transition-all hover:bg-purple-50">
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
          <button onClick={() => toggle("vapi")} className="w-full px-4 py-2.5 flex items-center justify-between text-left transition-all hover:bg-purple-50">
            <span className="text-xs font-semibold text-gray-300">AI Calls ({card.vapiCalls.length})</span>
            <span className="text-gray-500 text-xs">{expandedSection === "vapi" ? "▲" : "▼"}</span>
          </button>
          {expandedSection === "vapi" && (
            <div className="px-4 pb-3 space-y-2">
              {card.vapiCalls.map((c, i) => (
                <div key={i} className="rounded-lg px-3 py-2" style={{background:"rgba(255,255,255,0.7)",border:"1px solid #f0e8fa"}}>
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
  { emoji: "📅", label: "Prepare for date", example: "Prepare for tomorrow" },
  { emoji: "🚫", label: "Missing ETAs", example: "Which teams have no ETA?" },
  { emoji: "⭐", label: "Team rankings", example: "Rank teams by rating" },
  { emoji: "📋", label: "Customer notes", example: "Customer notes for today" },
  { emoji: "💳", label: "Credit card status", example: "Check credit card status for today" },
  { emoji: "📩", label: "Send confirmation texts", example: "Send confirmation texts for tomorrow" },
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
    <div className="mb-2 rounded-xl overflow-hidden" style={{background:"#fffdf9",border:"1px solid #e8dff0",boxShadow:"0 4px 24px rgba(120,80,160,0.08)"}}>
      <div className="px-4 py-3 flex items-center justify-between" style={{borderBottom:"1px solid #ede6f5"}}>
        <p className="text-sm font-semibold" style={{color:"#2d1f3d"}}>Some examples of things you can ask...</p>
        <button onClick={onClose} className="transition-colors text-lg leading-none" style={{color:"#9b8aaa"}} onMouseEnter={e=>(e.currentTarget.style.color="#6b3fa0")} onMouseLeave={e=>(e.currentTarget.style.color="#9b8aaa")}>✕</button>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => { onSelect(ex.example); onClose(); }}
            className="flex flex-col gap-1 p-3 rounded-xl transition-all text-left"
            style={{background:"rgba(255,255,255,0.85)",border:"1px solid #ede6f5"}}
            onMouseEnter={e=>(e.currentTarget.style.background="#f3eeff")}
            onMouseLeave={e=>(e.currentTarget.style.background="rgba(255,255,255,0.85)")}
          >
            <span className="text-lg leading-none">{ex.emoji}</span>
            <p className="text-xs font-semibold mt-1" style={{color:"#2d1f3d"}}>{ex.label}</p>
            <p className="text-[11px] leading-snug" style={{color:"#8b7a9e"}}>{ex.example}</p>
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
      ? "border"
      : mission.missionStatus === "failed"
      ? "border"
      : "border";
  const statusStyle =
    mission.missionStatus === "completed"
      ? { color: "#21aa68", background: "#edf9f2", border: "1px solid #c4ead4" }
      : mission.missionStatus === "failed"
      ? { color: "#e05050", background: "#fef2f2", border: "1px solid #fecaca" }
      : { color: "#d97706", background: "#fffbeb", border: "1px solid #fde68a" };

  const statusLabel =
    mission.missionStatus === "completed" ? "Completed" :
    mission.missionStatus === "failed" ? "Failed" : "Blocked";

  const stepIcon = (status: MissionStep["status"]) => {
    if (status === "completed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
    if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />;
    return <Circle className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />;
  };

  return (
    <div style={{ background: "rgba(255,253,249,0.84)", border: "1px solid #ebe4dc", borderRadius: 20, overflow: "hidden", boxShadow: "0 6px 18px rgba(73,55,42,0.04), inset 0 1px 0 rgba(255,255,255,0.8)" }}>
      {/* Header — always visible, click to toggle */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
        style={{ background: "transparent" }}
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(145deg, #f1e7ff, #e6d6ff)" }}>
          <Zap className="w-4 h-4" style={{ color: "#7447f5" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: "#202431" }}>{mission.missionTitle}</p>
          <p className="text-[12px] mt-0.5" style={{ color: "#70737d" }}>
            {mission.missionStats.completed} action{mission.missionStats.completed !== 1 ? "s" : ""}
            {" · "}{missionTimeAgo(mission.missionCompletedAt)}
          </p>
        </div>
        <span className="text-[11px] font-bold px-3 py-1 rounded-full" style={statusStyle}>
          {statusLabel}
        </span>
        {isExpanded
          ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: "#9a96a0" }} />
          : <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: "#9a96a0" }} />}
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-4">
          {/* Timestamps */}
          <div className="flex items-center gap-4 mb-3 pt-1" style={{ borderTop: "1px solid #ebe4dc" }}>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" style={{ color: "#9a96a0" }} />
              <span className="text-[11px]" style={{ color: "#9a96a0" }}>Started {fmtAbsTime(mission.missionStartedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" style={{ color: "#9a96a0" }} />
              <span className="text-[11px]" style={{ color: "#9a96a0" }}>Completed {fmtAbsTime(mission.missionCompletedAt)}</span>
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
                  <p className="text-xs leading-snug" style={{ color: "#202431" }}>{step.label}</p>
                  {step.detail && (
                    <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "#70737d" }}>{step.detail}</p>
                  )}
                  {step.vapiCallId && (
                    <div className="mt-2">
                      <CallClientPendingCardView card={{ vapiCallId: step.vapiCallId, recipientName: mission.missionTitle.replace(/^Call → /, ""), recipientPhone: "" }} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div
            className="pt-3"
            style={{ borderTop: "1px solid #ebe4dc" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] leading-relaxed" style={{ color: "#70737d" }}>{mission.missionSummary}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[10px]" style={{ color: "#9a96a0" }}>{mission.missionStats.total} total</span>
              <span className="text-[10px]" style={{ color: "#21aa68" }}>{mission.missionStats.completed} completed</span>
              {mission.missionStats.failed > 0 && (
                <span className="text-[10px]" style={{ color: "#e05050" }}>{mission.missionStats.failed} failed</span>
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
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [readinessDate, setReadinessDate] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Prepare Tomorrow flow (real tRPC data) ────────────────────────────────
  const PREPARE_STEPS = [
    "Checking tomorrow's schedule",
    "Checking customer confirmations",
    "Checking payment methods",
    "Checking team confirmations",
    "Checking client requests",
    "Scanning for other issues",
  ];

  const utils = trpc.useUtils();

  const runPrepareTomorrow = useCallback((dateOverride?: string) => {
    // 1. AI acknowledgement text
    const ackMsg: Message = {
      id: uid(),
      role: "ai",
      content: { type: "text", text: "On it! I'll run a full readiness check for tomorrow including customers, payments, teams, and schedule." },
      ts: nowTime(),
    };
    // 2. Checklist card — starts with first step running, rest pending
    const checklistId = uid();
    const initialSteps = PREPARE_STEPS.map((label, i) => ({
      label,
      status: (i === 0 ? "running" : "pending") as "done" | "running" | "pending",
    }));
    const checklistMsg: Message = {
      id: checklistId,
      role: "ai",
      content: { type: "prepare_checklist", card: { steps: initialSteps } },
      ts: nowTime(),
    };

    setMessages((prev) => [...prev, ackMsg, checklistMsg]);

    // Fire real tRPC call immediately while animation runs
    const fetchPromise = utils.aiConcierge.getReadinessSummary.fetch({ date: dateOverride });

    // Animate steps one by one
    let step = 0;
    const totalSteps = PREPARE_STEPS.length;
    const advanceStep = () => {
      step++;
      if (step < totalSteps) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== checklistId) return m;
            const newSteps = (m.content as { type: "prepare_checklist"; card: PrepareChecklistCard }).card.steps.map((s, i) => ({
              ...s,
              status: (i < step ? "done" : i === step ? "running" : "pending") as "done" | "running" | "pending",
            }));
            return { ...m, content: { type: "prepare_checklist" as const, card: { steps: newSteps } } };
          })
        );
        setTimeout(advanceStep, 700);
      } else {
        // Animation done — wait for fetch then show results
        fetchPromise.then((summary) => {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== checklistId) return m;
              const newSteps = (m.content as { type: "prepare_checklist"; card: PrepareChecklistCard }).card.steps.map((s) => ({ ...s, status: "done" as const }));
              return { ...m, content: { type: "prepare_checklist" as const, card: { steps: newSteps } } };
            })
          );
          const pct = summary.overallPct;
          const issues = summary.totalIssues;
          const dateStr = new Date(summary.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          const summaryMsg: Message = {
            id: uid(),
            role: "ai",
            content: {
              type: "text",
              text: issues === 0
                ? `All set! Tomorrow is ${pct}% ready — no issues found.`
                : `All set! Tomorrow is ${pct}% ready. I found ${issues} thing${issues !== 1 ? "s" : ""} that need your attention.`,
            },
            ts: nowTime(),
          };
          const resultMsg: Message = {
            id: uid(),
            role: "ai",
            content: { type: "prepare_result", card: { readinessPct: pct, issueCount: issues, date: dateStr, rawDate: summary.date } },
            ts: nowTime(),
          };
          setMessages((prev) => [...prev, summaryMsg, resultMsg]);
        }).catch(() => {
          // Fetch failed — still complete animation and show fallback card
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== checklistId) return m;
              const newSteps = (m.content as { type: "prepare_checklist"; card: PrepareChecklistCard }).card.steps.map((s) => ({ ...s, status: "done" as const }));
              return { ...m, content: { type: "prepare_checklist" as const, card: { steps: newSteps } } };
            })
          );
          const errMsg: Message = {
            id: uid(),
            role: "ai",
            content: { type: "text", text: "I ran into an issue fetching tomorrow's data. You can still open the Readiness panel to try again." },
            ts: nowTime(),
          };
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const dateStr = tomorrow.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          const resultMsg: Message = {
            id: uid(),
            role: "ai",
            content: { type: "prepare_result", card: { readinessPct: 0, issueCount: 0, date: dateStr } },
            ts: nowTime(),
          };
          setMessages((prev) => [...prev, errMsg, resultMsg]);
        });
      }
    };
    setTimeout(advanceStep, 700);
  }, [utils]);

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
    const isConfident = normalizedQuery.length >= 4 && normalizedName.startsWith(normalizedQuery);
    if (!isConfident) return;
    const m = allMatches[0];
    const entity: SelectedEntity = m.isCleaner && m.cleanerProfileId != null
      ? { type: "cleaner", cleanerProfileId: m.cleanerProfileId, name: m.name, phone: m.phone }
      : { type: "customer", name: m.name, phone: m.phone };
    setFocusedCustomer(entity);
    setAcQuery(null);
    setShowChangePopup(false);
    flashAttachedLabel();
    // Complete the partial name in the textarea
    setInput((prev) => {
      const COMMAND_RE = /^((?:text|call|tell|ask|remind|send|notify|update|let|jobs\s+for|payment\s+for|eta\s+for|entry\s+for|schedule\s+for|reschedule)\s+)(.+)/i;
      const match = prev.match(COMMAND_RE);
      if (match) return match[1] + entity.name;
      return prev;
    });
  }, [allMatches, acQuery, focusedCustomer]);

  // Show change popup
  const [showChangePopup, setShowChangePopup] = useState(false);

  // ── Confirm pill: set entity and complete the partial name in the textarea ──
  const confirmPill = (entity: SelectedEntity) => {
    setFocusedCustomer(entity);
    setAcQuery(null);
    setShowChangePopup(false);
    flashAttachedLabel();
    // Replace the partial name typed after the verb with the full selected name
    setInput((prev) => {
      const COMMAND_RE = /^((?:text|call|tell|ask|remind|send|notify|update|let|jobs\s+for|payment\s+for|eta\s+for|entry\s+for|schedule\s+for|reschedule)\s+)(.+)/i;
      const m = prev.match(COMMAND_RE);
      if (m) return m[1] + entity.name;
      return prev;
    });
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
          // customer_profile removed — all informational queries return query_result
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
        resolvedClientName: (isPaymentLink || isCallClient) ? name : undefined,
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

    // ── Intercept prepare tomorrow keywords (mock flow, no backend call) ──
    const lc = text.toLowerCase();
    // Try to extract a specific date like "July 21st", "July 21", "jul 21"
    const dateMatch = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
    let parsedDate: string | undefined;
    if (dateMatch) {
      const monthNames: Record<string, number> = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
      const month = monthNames[dateMatch[1].toLowerCase()];
      const day = parseInt(dateMatch[2], 10);
      if (month && day) {
        const year = new Date().getFullYear();
        parsedDate = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      }
    }
    const isPrepare =
      lc.includes("get tomorrow ready") ||
      lc.includes("prepare tomorrow") ||
      lc.includes("tomorrow ready") ||
      lc.includes("readiness check") ||
      lc.includes("prepare for") ||
      lc.includes("get ready for") ||
      (lc.includes("prepare") && !!parsedDate);
    if (isPrepare) {
      runPrepareTomorrow(parsedDate);
      return;
    }

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
          // customer_profile removed — all informational queries return query_result
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
    <>
    <div className="flex flex-col h-full rounded-2xl overflow-hidden shadow-2xl" style={{ minHeight: 600, background: "linear-gradient(180deg, #fffdf9 0%, #fbf8f3 100%)", border: "1px solid #ebe4dc" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "20px 22px 18px", borderBottom: "1px solid #ebe4dc", background: "transparent" }}>
        {/* Avatar */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <img
            src="/madison-avatar.jpg"
            alt="Madison"
            style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "3px solid rgba(255,255,255,0.95)", boxShadow: "0 8px 20px rgba(54,38,25,0.14), 0 0 0 1px rgba(79,59,44,0.07)" }}
          />
          <span style={{ position: "absolute", right: 2, bottom: 4, width: 16, height: 16, background: "#32bd75", border: "3px solid #fffdf9", borderRadius: "50%", display: "block" }} />
        </div>
        {/* Name + role + actions all in one column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: name + heart + BETA + Online + close */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
            <h1 style={{ margin: 0, fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 28, lineHeight: 1, fontWeight: 500, letterSpacing: "-0.03em", color: "#202431", whiteSpace: "nowrap" }}>Madison</h1>
            <span style={{ color: "#c9a8ff", fontSize: 20, lineHeight: 1, flexShrink: 0 }}>♡</span>
            <span style={{ padding: "4px 11px", color: "#7447f5", background: "#eee5ff", border: "1px solid #d8c5ff", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>BETA</span>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13, color: "#70737d", flexShrink: 0 }}>
              <span style={{ width: 7, height: 7, background: "#32bd75", borderRadius: "50%", display: "inline-block" }} />
              Online
            </div>
            {onClose && (
              <button
                onClick={onClose}
                style={{ marginLeft: "auto", width: 30, height: 30, display: "grid", placeItems: "center", color: "#7d7f85", background: "transparent", border: 0, borderRadius: "50%", cursor: "pointer", fontSize: 20, lineHeight: 1, flexShrink: 0 }}
                title="Close"
              >×</button>
            )}
          </div>
          {/* Row 2: role */}
          <p style={{ margin: "7px 0 0", fontSize: 13.5, fontWeight: 600, color: "#3e424c" }}>Your AI Operations Concierge</p>
          {/* Row 3: tagline */}
          <p style={{ margin: "3px 0 0", fontSize: 13.5, color: "#70737d" }}>Ask anything. I'll get it done.</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5" style={{ background: "transparent" }}>
        {/* Mission History */}
        {(missions.length > 0 || missionsLoading) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#a17ccf", letterSpacing: "0.12em" }}>Mission History</p>
              {missions.length > 0 && (
                <button
                  onClick={() => clearMissionHistory()}
                  className="text-[10px] transition-colors" style={{ color: "#9870c9" }}
                >
                  Clear
                </button>
              )}
            </div>
            {missionsLoading && missions.length === 0 && (
              <div className="flex items-center gap-2 py-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#c9a8ff" }} />
                <span className="text-[11px]" style={{ color: "#9a96a0" }}>Loading history…</span>
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
            {missions.length > 0 && <div className="pt-1" style={{ borderTop: "1px solid #ebe4dc" }} />}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} agentPhotoUrl={agentPhotoUrl} onPickTeam={handlePickTeam} onPickClient={handlePickClient} onAddMessage={(m) => setMessages((prev) => [...prev, m])} onAddMission={addMission} onOpenReadiness={(rawDate) => { setReadinessDate(rawDate); setReadinessOpen(true); }} />
        ))}
        {isThinking && (
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ border: "2px solid rgba(255,255,255,0.9)", boxShadow: "0 4px 12px rgba(54,38,25,0.12)" }}>
              <img src="/madison-avatar.jpg" alt="Madison" className="w-full h-full object-cover" />
            </div>
            <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ background: "linear-gradient(135deg, rgba(250,244,255,0.95), rgba(244,234,250,0.85))", border: "1px solid #e5d9ea" }}>
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
      <div className="px-4 py-3" style={{ borderTop: "1px solid #ebe4dc", background: "rgba(251,248,243,0.96)", backdropFilter: "blur(16px)", position: "relative" }}>

        {/* ── Recognition pill: locked person ── */}
        {focusedCustomer && (
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl" style={{background:"rgba(116,71,245,0.12)",border:"1px solid rgba(116,71,245,0.3)"}}>
            <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0" style={{background:"rgba(116,71,245,0.25)",color:"#5b21b6"}}>
              {focusedCustomer.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <span className="text-xs font-semibold flex-1 truncate" style={{color:"#3b1f6e"}}>{focusedCustomer.name}</span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{background:"rgba(116,71,245,0.15)",color:"#5b21b6"}}>{focusedCustomer.type === "cleaner" ? "Team ✓" : "Recognized ✓"}</span>
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
          <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl" style={{background:"rgba(116,71,245,0.10)",border:"1px solid rgba(116,71,245,0.25)"}}>
            <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0" style={{background:"rgba(116,71,245,0.2)",color:"#5b21b6"}}>
              {allMatches[0].name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-semibold" style={{color:"#3b1f6e"}}>{allMatches[0].name}</span>
              <span className="text-[11px] ml-1.5" style={{color:"#7447f5"}}>{allMatches[0].subtitle}</span>
            </div>
          </div>
        )}
        {showRecognitionPill && allMatches.length > 1 && (
          <div className="mb-2 rounded-xl overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #c4b5fd",boxShadow:"0 4px 16px rgba(116,71,245,0.12)"}}>
            <div className="px-3 py-2" style={{borderBottom:"1px solid #e5d9ea"}}>
              <p className="text-xs font-semibold" style={{color:"#7447f5"}}>{allMatches.length} people found — who did you mean?</p>
            </div>
            <div className="flex flex-col">
              {allMatches.slice(0, 4).map((m, idx) => (
                <button
                  key={m.phone}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); confirmPill(m.isCleaner && m.cleanerProfileId != null ? { type: "cleaner", cleanerProfileId: m.cleanerProfileId, name: m.name, phone: m.phone } : { type: "customer", name: m.name, phone: m.phone }); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 transition-all text-left last:border-0 hover:bg-purple-50" style={{borderBottom:"1px solid #f0e8fa"}}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style={{background:"rgba(116,71,245,0.12)",color:"#7447f5"}}>
                    {m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{color:"#202431"}}>{m.name}</p>
                    <p className="text-[11px] truncate" style={{color:"#8a8a9a"}}>{m.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Change popup: shown when user taps Change on the locked pill ── */}
        {showChangePopup && focusedCustomer && (
          <div className="mb-2 rounded-xl overflow-hidden" style={{background:"linear-gradient(135deg,#fffdf9,#f7f0ff)",border:"1px solid #e5d9ea",boxShadow:"0 4px 16px rgba(116,71,245,0.10)"}}>
            <div className="px-3 py-2 flex items-center justify-between" style={{borderBottom:"1px solid #e5d9ea"}}>
              <p className="text-xs font-semibold" style={{color:"#202431"}}>Who did you mean?</p>
              <button type="button" onClick={() => setShowChangePopup(false)} className="text-xs" style={{color:"#8a8a9a"}}>✕</button>
            </div>
            <div className="flex flex-col">
              {allMatches.slice(0, 5).map((m) => (
                <button
                  key={m.phone}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); confirmPill(m.isCleaner && m.cleanerProfileId != null ? { type: "cleaner", cleanerProfileId: m.cleanerProfileId, name: m.name, phone: m.phone } : { type: "customer", name: m.name, phone: m.phone }); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 transition-all text-left last:border-0 hover:bg-purple-50" style={{borderBottom:"1px solid #f0e8fa"}}
                >
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style={{background:"rgba(116,71,245,0.12)",color:"#7447f5"}}>
                    {m.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{color:"#202431"}}>{m.name}</p>
                    <p className="text-[11px] truncate" style={{color:"#8a8a9a"}}>{m.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative rounded-2xl overflow-hidden transition-colors" style={{ background: "rgba(255,253,249,0.9)", border: "1px solid #ebe4dc", boxShadow: "0 14px 32px rgba(60,42,29,0.06), inset 0 1px 0 rgba(255,255,255,0.9)" }}>
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
            className="w-full bg-transparent text-sm resize-none outline-none leading-relaxed px-4 pt-3.5 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-[#aaa6ab]"
            style={{ color: "#202431", minHeight: 52 }}
          />
          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <div className="flex items-center gap-0.5">
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs font-medium" style={{ color: "#74757b" }}>
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <div>
                <button
                  onClick={() => setShowCommands((v) => !v)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs font-medium" style={{ color: "#74757b" }}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Commands</span>
                </button>
              </div>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-xs font-medium" style={{ color: "#74757b" }}>
                <AtSign className="w-3.5 h-3.5" />
                <span>People</span>
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className="w-9 h-9 rounded-full disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-all flex-shrink-0 shadow-sm"
              style={{ background: "linear-gradient(145deg, #7650ff, #6233eb)" }}
            >
              {isThinking
                ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                : <Send className="w-3.5 h-3.5 text-white" />}
            </button>
          </div>
        {!input && (
          <p className="px-4 pb-2 text-[11px] transition-all" style={{ color: "#9a96a0" }}>💡 {HINT_EXAMPLES[hintIdx]}</p>
        )}
        </div>
        {showCommands && (
          <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, zIndex: 50, marginBottom: 6 }}>
            <CommandPicker
              onSelect={(cmd) => { setInput(cmd); setShowCommands(false); inputRef.current?.focus(); }}
              onClose={() => setShowCommands(false)}
            />
          </div>
        )}
      </div>
    </div>
    <ReadinessDrawer open={readinessOpen} onClose={() => setReadinessOpen(false)} date={readinessDate} />
    </>
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
  | { type: "query_result"; answer: string; status: "complete" | "partial" | "not_found" | "ambiguous" | "error" }
  | { type: "card_status"; date: string; rows: Array<{ customerName: string; cardBrand: string | null; last4: string | null; status: "on_hold" | "no_preauth" | "no_card"; amountCents: number }> }
  | { type: "rank_teams"; windowDays: number; minRatings: number; rows: Array<{ rank: number; cleanerName: string; avgRating: number; ratedJobs: number; totalJobs: number }>; excluded: number }
  | { type: "list_no_eta"; date: string; rows: Array<{ teamName: string; cleanerName: string; scheduledTime: string; serviceDateTime: string | null; etaStatus: "pending" | "unclear" | "no_answer"; isPastScheduled: boolean; currentJobId: number }> }
  | { type: "confirmation_texts"; date: string; dateLabel: string; rows: Array<{ cleanerJobId: number; customerName: string; customerPhone: string | null; serviceDateTime: string | null; teamName: string | null; alreadySent: boolean; smsConfirmedAt: number | null }> }
  | { type: "confirmation_results"; date: string; dateLabel: string; rows: Array<{ clientName: string | null; calledPhone: string | null; smsFollowupSent: number | null; smsConfirmedAt: number | null; smsReply: string | null; aiOutcome: string | null; aiOutcomeLabel: string | null; manualOutcome: string | null; manualOutcomeLabel: string | null; firedAt: number | null }>; totalSent: number; totalConfirmed: number; totalPending: number }
  | { type: "job_status_stream"; alerts: Array<{ alertType: string; jobId: number; title: string; body: string; source: string; ts: number; resolvedAt?: number | null }>; cleanerStatuses: Array<{ id: number; cleanerName: string; status: string; label: string; emoji: string; customerName: string | null; etaLabel: string | null; issueNote: string | null; cleanerJobId: number | null; ts: number }> };

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
      content: { type: "query_result", card: { answer: result.answer, status: result.status } },
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
  if (result.type === "card_status") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "card_status", card: { date: result.date, rows: result.rows } },
      ts,
    };
  }
  if (result.type === "rank_teams") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "rank_teams", card: { windowDays: result.windowDays, minRatings: result.minRatings, rows: result.rows, excluded: result.excluded } },
      ts,
    };
  }
  if (result.type === "list_no_eta") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "list_no_eta", card: { date: result.date, rows: result.rows } },
      ts,
    };
  }
  if (result.type === "confirmation_texts") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "confirmation_texts", card: { date: result.date, dateLabel: result.dateLabel, rows: result.rows } },
      ts,
    };
  }
  if (result.type === "confirmation_results") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "confirmation_results", card: { date: result.date, dateLabel: result.dateLabel, rows: result.rows, totalSent: result.totalSent, totalConfirmed: result.totalConfirmed, totalPending: result.totalPending } },
      ts,
    };
  }
  if (result.type === "job_status_stream") {
    return {
      id: uid(),
      role: "ai",
      content: { type: "job_status_stream", card: { alerts: result.alerts, cleanerStatuses: result.cleanerStatuses } },
      ts,
    };
  }
  return null;
}
