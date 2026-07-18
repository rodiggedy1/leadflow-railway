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
import { useState, useRef, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type StepStatus = "done" | "pending" | "running" | "failed";

interface WorkflowStep {
  id: string;
  label: string;
  status: StepStatus;
  ts?: string; // e.g. "9:41 AM"
  detail?: string;
}

interface WorkflowCard {
  summary: string;
  steps: WorkflowStep[];
  expandable?: { label: string; content: string };
}

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
  matches: Array<{ phone: string; name: string; city: string; totalCleans: number; lastJobDate: string | null }>;
}
interface BulkSmsConfirmCard {
  targetDescription: string;
  recipients: BulkSmsRecipient[];
  draftMessage: string;
}
interface BulkSmsSentCard {
  message: string;
  results: Array<{ name: string; phone: string; success: boolean; error?: string }>;
}
type MessageContent =
  | { type: "text"; text: string }
  | { type: "workflow"; workflow: WorkflowCard }
  | { type: "completed"; card: CompletedCard }
  | { type: "clarify"; card: ClarifyCard }
  | { type: "eta_pending"; card: EtaPendingCard }
  | { type: "bulk_sms_confirm"; card: BulkSmsConfirmCard }
  | { type: "bulk_sms_sent"; card: BulkSmsSentCard }
  | { type: "client_disambiguation"; card: ClientDisambiguationCard };

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

// ─── Workflow card ────────────────────────────────────────────────────────────

function WorkflowCardView({ workflow }: { workflow: WorkflowCard }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/5 overflow-hidden">
      {/* Summary */}
      <div className="px-4 py-3 text-sm text-gray-200 leading-relaxed border-b border-white/10">
        {workflow.summary}
      </div>
      {/* Steps */}
      <div className="px-4 py-3 space-y-3">
        {workflow.steps.map((step) => (
          <div key={step.id} className="flex items-center gap-3">
            <StepIcon status={step.status} />
            <span
              className={`flex-1 text-sm ${
                step.status === "running"
                  ? "text-white font-semibold"
                  : step.status === "done"
                  ? "text-gray-300"
                  : step.status === "failed"
                  ? "text-red-400"
                  : "text-gray-500"
              }`}
            >
              {step.label}
            </span>
            {step.ts && (
              <span className="text-xs text-gray-500 flex-shrink-0">{step.ts}</span>
            )}
          </div>
        ))}
      </div>
      {/* Expandable details */}
      {workflow.expandable && (
        <div className="border-t border-white/10">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span>{workflow.expandable.label}</span>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expanded && (
            <div className="px-4 pb-4 text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
              {workflow.expandable.content}
            </div>
          )}
        </div>
      )}
    </div>
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
      { recipients: card.recipients, message: draft },
      {
        onSuccess: (result) => {
          setSent(true);
          onSent({ message: result.message, results: result.results });
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
          <span key={r.cleanerProfileId} className="inline-flex items-center gap-1 rounded-full bg-white/8 border border-white/10 px-2.5 py-1 text-xs text-gray-300">
            <User className="w-3 h-3 text-gray-500" />
            {r.name.split(" ")[0]}
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
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 resize-none outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-60"
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
              <><Send className="w-4 h-4" /> Send to {card.recipients.length} cleaner{card.recipients.length !== 1 ? "s" : ""}</>
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
  return (
    <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${allOk ? "bg-green-500" : "bg-yellow-500"}`}>
          {allOk ? <CheckCircle2 className="w-3.5 h-3.5 text-white" /> : <AlertTriangle className="w-3.5 h-3.5 text-white" />}
        </span>
        <p className="text-sm font-semibold text-white">{card.message}</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        {card.results.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <StepIcon status={r.success ? "done" : "failed"} />
            <span className={`flex-1 text-sm ${r.success ? "text-gray-300" : "text-red-400"}`}>
              {r.name}{r.error ? ` — ${r.error}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
// ─── AudioPlayer — copied verbatim from TeamEtaModal ────────────────────────
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
}: {
  msg: Message;
  agentPhotoUrl?: string;
  onPickTeam: (jobId: number, teamName: string) => void;
  onPickClient: (phone: string, name: string, messageHint: string | null) => void;
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
        {msg.content.type === "workflow" && (
          <div className="bg-[#1e2235] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3">
            <WorkflowCardView workflow={msg.content.workflow} />
            <div className="text-right text-xs text-gray-500 mt-2">{msg.ts}</div>
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
                const sentMsg: Message = {
                  id: uid(),
                  role: "ai",
                  content: { type: "bulk_sms_sent", card: result },
                  ts: nowTime(),
                };
                setMessages((prev) => [...prev, sentMsg]);
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
              onPick={(phone, name) => onPickClient(phone, name, msg.content.type === "client_disambiguation" ? msg.content.card.messageHint : null)}
            />
            <div className="text-xs text-gray-500 mt-2">{msg.ts}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Command chip ─────────────────────────────────────────────────────────────

const COMMANDS = [
  { label: "ETA update", icon: Clock, description: "Call team + text client with ETA" },
  { label: "Entry info", icon: MapPin, description: "Get entry info and send to team" },
  { label: "Reschedule", icon: Calendar, description: "Reschedule a job and notify all parties" },
  { label: "Call team", icon: Phone, description: "Initiate a call to the assigned team" },
  { label: "Text client", icon: MessageSquare, description: "Send SMS to client" },
  { label: "No show alert", icon: AlertTriangle, description: "Alert team about a no-show" },
];

function CommandPicker({ onSelect, onClose }: { onSelect: (cmd: string) => void; onClose: () => void }) {
  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 bg-[#1a1d2e] border border-white/15 rounded-xl shadow-2xl overflow-hidden z-50">
      <div className="px-3 py-2 border-b border-white/10">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Commands</p>
      </div>
      <div className="py-1">
        {COMMANDS.map((cmd) => (
          <button
            key={cmd.label}
            onClick={() => { onSelect(cmd.label); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/8 transition-colors text-left"
          >
            <span className="w-7 h-7 rounded-lg bg-indigo-600/30 flex items-center justify-center flex-shrink-0">
              <cmd.icon className="w-3.5 h-3.5 text-indigo-400" />
            </span>
            <div>
              <p className="text-sm text-white font-medium">{cmd.label}</p>
              <p className="text-xs text-gray-500">{cmd.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AiConcierge({ agentPhotoUrl, onClose }: { agentPhotoUrl?: string; onClose?: () => void }) {
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
  const [isThinking, setIsThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatMutation = trpc.aiConcierge.chat.useMutation();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Called when agent picks a client from a disambiguation card
  const handlePickClient = useCallback((phone: string, name: string, messageHint: string | null) => {
    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: { type: "text", text: `Text ${name}` },
      ts: nowTime(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsThinking(true);

    chatMutation.mutate(
      { message: `Text ${name}`, resolvedClientPhone: phone, resolvedClientMessageHint: messageHint },
      {
        onSuccess: (result) => {
          setIsThinking(false);
          const aiMsg = buildAiMessage(result);
          setMessages((prev) => [...prev, aiMsg]);
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
          setMessages((prev) => [...prev, aiMsg]);
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
    setIsThinking(true);

    chatMutation.mutate(
      { message: text },
      {
        onSuccess: (result) => {
          setIsThinking(false);
          const aiMsg = buildAiMessage(result);
          setMessages((prev) => [...prev, aiMsg]);
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
  }, [input, isThinking, chatMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} agentPhotoUrl={agentPhotoUrl} onPickTeam={handlePickTeam} onPickClient={handlePickClient} />
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
        <div className="relative bg-[#1e2235] border border-white/15 rounded-2xl px-4 py-3 flex flex-col gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or type a command..."
            rows={2}
            className="w-full bg-transparent text-white placeholder-gray-500 text-sm resize-none outline-none leading-relaxed"
            style={{ minHeight: 44 }}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 relative">
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/8 transition-colors text-xs font-medium">
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowCommands((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/8 transition-colors text-xs font-medium"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Commands</span>
                </button>
                {showCommands && (
                  <CommandPicker
                    onSelect={(cmd) => { setInput(cmd); inputRef.current?.focus(); }}
                    onClose={() => setShowCommands(false)}
                  />
                )}
              </div>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/8 transition-colors text-xs font-medium">
                <AtSign className="w-3.5 h-3.5" />
                <span>People</span>
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Map server result → Message ──────────────────────────────────────────────

type ServerResult =
  | { type: "completed"; message: string }
  | { type: "error"; message: string }
  | { type: "clarify"; message: string; teams: Array<{ name: string; currentJobId: number; address: string; scheduled: string; etaStatus: string }> }
  | { type: "workflow"; summary: string; steps: WorkflowStep[]; expandable?: { label: string; content: string } }
  | { type: "eta_pending"; jobId: number; teamName: string; cleanerName: string; scheduledTimeET: string; date: string }
  | { type: "bulk_sms_confirm"; targetDescription: string; recipients: BulkSmsRecipient[]; draftMessage: string }
  | { type: "bulk_sms_sent"; message: string; results: Array<{ name: string; phone: string; success: boolean; error?: string }> }
  | { type: "client_disambiguation"; messageHint: string | null; matches: Array<{ phone: string; name: string; city: string; totalCleans: number; lastJobDate: string | null }> };

function buildAiMessage(result: ServerResult): Message {
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
  // workflow
  return {
    id: uid(),
    role: "ai",
    content: { type: "workflow", workflow: { summary: result.summary, steps: result.steps, expandable: result.expandable } },
    ts,
  };
}
