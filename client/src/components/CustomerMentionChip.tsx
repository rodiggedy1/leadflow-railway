/**
 * CustomerMentionChip — renders a @CustomerName chip in chat messages.
 * Click to open a modal card centered in the viewport.
 * Text button slides into an SMS composer view (reuses startCsConversation + PTT + tone rewrite).
 * Click outside / Escape / X to close.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Phone, Mail, MessageSquare, History, Star, Loader2, X, ChevronLeft, Mic, MicOff, Send, RefreshCw, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── AI Call types (mirrored from AICallPanel) ────────────────────────────────
type CallStatus = "idle" | "firing" | "queued" | "ringing" | "in_progress" | "completed" | "voicemail" | "no_answer" | "failed";
const CALL_STATUS_COLORS: Record<CallStatus, string> = {
  idle: "#8f98aa", firing: "#f3c96b", queued: "#7bb7ff",
  ringing: "#f3c96b", in_progress: "#63d297", completed: "#63d297",
  voicemail: "#8f98aa", no_answer: "#ff6b6b", failed: "#ff6b6b",
};
const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  idle: "Ready", firing: "Connecting…", queued: "Queued…",
  ringing: "Ringing…", in_progress: "In call…", completed: "Call completed",
  voicemail: "Left voicemail", no_answer: "No answer", failed: "Call failed",
};

// Customer-facing call scenarios (same list as AICallPanel)
const CALL_SCENARIOS = [
  { title: "Team running late", tag: "Urgent", tagColor: "#ef4444", description: "Apologize, give updated ETA, ask flexibility, offer status text." },
  { title: "Running significantly late", tag: "Urgent", tagColor: "#ef4444", description: "Team is 2+ hrs behind — offer to keep or reschedule." },
  { title: "Team at address / access needed", tag: "Now", tagColor: "#f97316", description: "Ask how to access home, lockbox, gate, concierge, parking." },
  { title: "Parking instructions", tag: "Now", tagColor: "#f97316", description: "Team is heading over — need parking details before arrival." },
  { title: "Put card on file", tag: "Payment", tagColor: "#8b5cf6", description: "Ask client to call Maids in Black or securely add a card before service." },
  { title: "Payment failed", tag: "Payment", tagColor: "#8b5cf6", description: "Card pre-auth declined — need new card or retry same card." },
  { title: "Confirm address", tag: "Prep", tagColor: "#3b82f6", description: "Verify address, unit, parking, and entry instructions." },
  { title: "Scope clarification", tag: "Prep", tagColor: "#3b82f6", description: "Extra areas noted — confirm scope before team arrives." },
  { title: "Client ETA update", tag: "Update", tagColor: "#10b981", description: "Tell client cleaner ETA and confirm window still works." },
  { title: "Earlier arrival available", tag: "Update", tagColor: "#10b981", description: "Slot opened up earlier — offer customer the option to move up." },
  { title: "Home not ready / team turned away", tag: "Issue", tagColor: "#f59e0b", description: "Team arrived but couldn't start — reschedule immediately." },
  { title: "Job paused — issue on site", tag: "Issue", tagColor: "#f59e0b", description: "Team stopped mid-clean — inform customer and decide next step." },
  { title: "Follow up / check-in", tag: "General", tagColor: "#6366f1", description: "General follow-up call to check on the customer." },
];

// Exact script logic copied from AICallPanel.buildScript
function buildCallScript(name: string, scenarioTitle: string): string {
  const first = name.split(" ")[0];
  const t = scenarioTitle.toLowerCase();
  if (t.includes("significantly late"))
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling because our team is running more than two hours behind schedule today.\n\nWe sincerely apologize for the inconvenience. We'd like to offer you the option to keep the appointment at the later time or reschedule at no charge.\n\nWhich would you prefer?`;
  if (t.includes("late"))
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling to let you know our team is running a bit behind schedule today.\n\nWe appreciate your patience and will keep you posted on the updated arrival time.\n\nIs there anything you need from us in the meantime?`;
  if (t.includes("access"))
    return `Hi ${first}, this is Ava from Maids in Black. Our team is at or near your address and we need help with access.\n\nCan you confirm the best way to get in — lockbox, front desk, gate code, or parking instructions?\n\nI'll update the team right away so they can get started.`;
  if (t.includes("parking"))
    return `Hi ${first}, this is Ava from Maids in Black. Our team is heading to your address and needs parking details before arrival.\n\nCould you share the best parking option — street, garage, or driveway?\n\nThank you!`;
  if (t.includes("card on file") || t.includes("put card"))
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling because we still need a card on file to secure your cleaning appointment.\n\nThere is no deposit required, but we do need a card saved before dispatch. You can call us or use the secure link we send by text.\n\nWould you like me to send that link now?`;
  if (t.includes("payment failed"))
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling because the card on file for your upcoming cleaning was declined during pre-authorization.\n\nCould you update your payment method or try the same card again? We want to make sure your appointment is confirmed.\n\nThank you!`;
  if (t.includes("confirm address"))
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling to confirm the details for your upcoming cleaning.\n\nCould you verify your service address, unit number if any, parking, and entry instructions?\n\nOnce confirmed we'll update your job notes so the team has everything before arrival.`;
  if (t.includes("scope"))
    return `Hi ${first}, this is Ava from Maids in Black. Our team noted some additional areas that may need attention during your upcoming cleaning.\n\nI wanted to confirm the scope with you before the team arrives so there are no surprises.\n\nCould you clarify what you'd like included?`;
  if (t.includes("eta update"))
    return `Hi ${first}, this is Ava from Maids in Black. I'm calling to give you an update on your cleaning today.\n\nYour team is on their way and should arrive within the scheduled window. Does that still work for you?`;
  if (t.includes("earlier arrival"))
    return `Hi ${first}, this is Ava from Maids in Black. Great news — a slot opened up earlier today and we can send your team sooner if you'd like.\n\nWould you prefer the earlier time or keep the original schedule?`;
  if (t.includes("not ready") || t.includes("turned away"))
    return `Hi ${first}, this is Ava from Maids in Black. Our team arrived at your address but was unable to start the cleaning.\n\nI'd like to reschedule you as soon as possible. What time works best for you?`;
  if (t.includes("paused") || t.includes("issue on site"))
    return `Hi ${first}, this is Ava from Maids in Black. Our team had to pause the cleaning at your home and I wanted to reach out personally.\n\nCould you give us a call back so we can discuss next steps and make sure everything is taken care of?`;
  // Default / follow-up
  return `Hi ${first}, this is Ava calling from Maids in Black.\n\nI'm reaching out to follow up and make sure everything is going smoothly with your service.\n\nPlease feel free to call us back or reply to this message if you have any questions. We appreciate your business!\n\nThank you.`;
}

export type CustomerData = {
  phone: string;
  name: string;
  email: string | null;
  address: string | null;
  frequency: string | null;
  lastJobDate: string | null;
  ltv: number;
  totalCleans: number;
  isVip: boolean;
  city: string;
};

function formatLtv(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n}`;
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ─── SMS Quick-text shortcuts ─────────────────────────────────────────────────
const SMS_SHORTCUTS = [
  { label: "Confirm availability", text: "Hi {name}, just checking — are you still available for your upcoming cleaning? Let us know! 😊" },
  { label: "Ask details", text: "Hi {name}, could you share the full address and any special instructions for your cleaning? We want to make sure everything is perfect!" },
  { label: "Send quote", text: "Hi {name}, your personalized quote is ready! Reply here and I'll send it right over." },
  { label: "Follow up", text: "Hi {name}, just following up on your recent inquiry. Happy to help — what questions do you have?" },
];

// ─── SMS Composer View ────────────────────────────────────────────────────────
function SmsComposer({
  customer,
  onBack,
  onClose,
}: {
  customer: CustomerData;
  onBack: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  // Voice PTT
  const [isRecording, setIsRecording] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPttRef = useRef(false);

  // Tone rewrite
  const [isRewriting, setIsRewriting] = useState(false);

  const transcribeMutation = trpc.opsChat.transcribeVoiceNote.useMutation();
  const rewriteMutation = trpc.opsChat.rewriteVoiceMessage.useMutation();
  const sendMutation = trpc.opsChat.startCsConversation.useMutation({
    onSuccess: () => {
      toast.success(`SMS sent to ${customer.name}`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const firstName = customer.name.split(" ")[0];

  // ── Voice PTT ──────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      isPttRef.current = true;
      setIsPressing(false);
      setIsRecording(true);
      setVoiceSeconds(0);
      timerRef.current = setInterval(() => setVoiceSeconds(s => s + 1), 1000);
    } catch {
      toast.error("Microphone access denied");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsPressing(false);
    isPttRef.current = false;
    setIsTranscribing(true);
    await new Promise<void>(resolve => {
      mr.onstop = () => resolve();
      try { mr.requestData(); } catch { /* ignore */ }
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    });
    try {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      if (blob.size === 0) { toast.warning("No audio captured — hold longer"); return; }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { text: transcribed } = await transcribeMutation.mutateAsync({ dataBase64, mimeType: "audio/webm" });
      if (transcribed.trim()) {
        setText(transcribed.trim());
      } else {
        toast.warning("No speech detected — try again");
      }
    } catch (err: any) {
      toast.error(err?.message?.length < 200 ? err.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
  }, [transcribeMutation]);

  // Global PTT release
  useEffect(() => {
    const release = () => { if (isPttRef.current) stopRecording(); };
    document.addEventListener("mouseup", release);
    document.addEventListener("touchend", release);
    return () => {
      document.removeEventListener("mouseup", release);
      document.removeEventListener("touchend", release);
    };
  }, [stopRecording]);

  // ── Tone rewrite ───────────────────────────────────────────────────────────
  async function rewrite(tone: "friendly" | "professional" | "casual") {
    if (!text.trim()) return;
    setIsRewriting(true);
    try {
      const result = await rewriteMutation.mutateAsync({
        rawMessage: text,
        customerName: customer.name,
        tone,
      });
      setText(result.message);
    } catch (err: any) {
      toast.error("Rewrite failed");
    } finally {
      setIsRewriting(false);
    }
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    sendMutation.mutate({ phone: customer.phone, firstMessage: text.trim() });
  }

  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="w-[360px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div className="relative px-4 pt-4 pb-3" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/60 hover:text-white transition-colors shrink-0">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0"
            style={{ background: `hsl(${hue}, 55%, 52%)` }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{customer.name}</p>
            <p className="text-blue-300 text-[11px]">{customer.phone}</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Quick shortcuts */}
      <div className="px-3 pt-3 pb-1 flex flex-wrap gap-1.5">
        {SMS_SHORTCUTS.map(s => (
          <button
            key={s.label}
            onClick={() => setText(s.text.replace("{name}", firstName))}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Text area */}
      <div className="px-3 pt-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={`Type a text to ${firstName}…`}
          rows={4}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
        />
      </div>

      {/* Tone chips */}
      <div className="px-3 pt-1.5 pb-1 flex flex-wrap gap-1.5">
        {(["friendly", "professional", "casual"] as const).map(tone => (
          <button
            key={tone}
            onClick={() => rewrite(tone)}
            disabled={isRewriting || !text.trim()}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            {isRewriting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
            {tone === "friendly" ? "😊 Friendlier" : tone === "professional" ? "👔 Professional" : "💬 Shorter"}
          </button>
        ))}
        <button
          onClick={() => rewrite("friendly")}
          disabled={isRewriting || !text.trim()}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          🇪🇸 Spanish
        </button>
        <button
          onClick={async () => {
            if (!text.trim()) return;
            setIsRewriting(true);
            try {
              const { invokeLLM } = await Promise.resolve(); // placeholder — use rewrite with casual + "translate to Portuguese"
              const result = await rewriteMutation.mutateAsync({ rawMessage: `Translate to Brazilian Portuguese: ${text}`, customerName: customer.name, tone: "casual" });
              setText(result.message);
            } catch { toast.error("Translation failed"); }
            finally { setIsRewriting(false); }
          }}
          disabled={isRewriting || !text.trim()}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          🇧🇷 Portuguese
        </button>
      </div>

      {/* Bottom bar: PTT + Send */}
      <div className="px-3 pb-3 pt-2 flex items-center gap-2">
        {/* PTT mic button */}
        <button
          onMouseDown={() => { setIsPressing(true); startRecording(); }}
          onTouchStart={(e) => { e.preventDefault(); setIsPressing(true); startRecording(); }}
          disabled={isTranscribing}
          className={cn(
            "w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all select-none",
            isRecording
              ? "bg-red-500 shadow-lg shadow-red-500/40 scale-110"
              : isPressing
              ? "bg-indigo-600 scale-105"
              : "bg-gradient-to-br from-indigo-500 to-purple-600 hover:scale-105",
            isTranscribing && "opacity-50 cursor-not-allowed"
          )}
          title="Hold to record voice"
        >
          {isTranscribing ? (
            <Loader2 className="h-4 w-4 text-white animate-spin" />
          ) : isRecording ? (
            <span className="flex flex-col items-center gap-0">
              <MicOff className="h-4 w-4 text-white" />
              <span className="text-white text-[8px] font-bold leading-none">{voiceSeconds}s</span>
            </span>
          ) : (
            <Mic className="h-4 w-4 text-white" />
          )}
        </button>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || sendMutation.isPending}
          className="flex-1 h-11 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
        >
          {sending || sendMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
          ) : (
            <><Send className="h-4 w-4" /> Send SMS</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── AI Call Composer View ───────────────────────────────────────────────────
function AiCallComposer({
  customer,
  onBack,
  onClose,
  onMinimize,
}: {
  customer: CustomerData;
  onBack: () => void;
  onClose: () => void;
  onMinimize?: (c: CustomerData) => void;
}) {
  const [selectedScenario, setSelectedScenario] = useState(CALL_SCENARIOS[0].title);
  const [script, setScript] = useState(() => buildCallScript(customer.name, CALL_SCENARIOS[0].title));
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callSummary, setCallSummary] = useState<string | null>(null);
  const [callTranscript, setCallTranscript] = useState<string | null>(null);
  const [callRecordingUrl, setCallRecordingUrl] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [vapiCallId, setVapiCallId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const utils = trpc.useUtils();

  // PTT state (copied from SmsComposer)
  const [isRecording, setIsRecording] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPttRef = useRef(false);

  // AI rewrite
  const [isRewriting, setIsRewriting] = useState(false);

  const transcribeMutation = trpc.opsChat.transcribeVoiceNote.useMutation();
  const rewriteMutation = trpc.opsChat.rewriteVoiceMessage.useMutation();

  const callActive = ["firing", "queued", "ringing", "in_progress"].includes(callStatus);
  const callEnded = ["completed", "voicemail", "no_answer", "failed"].includes(callStatus);

  // Auto-minimize when call goes active (notify parent), auto-expand when ended
  useEffect(() => {
    if (callActive) {
      if (onMinimize) {
        onMinimize(customer);
      } else {
        setMinimized(true);
      }
    }
  }, [callActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (callEnded) setMinimized(false);
  }, [callEnded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── CALL LOGIC (untouched) ────────────────────────────────────────────────
  const startCallMutation = trpc.callMatrix.startCall.useMutation({
    onSuccess: (result) => {
      if (result.vapiCallId) {
        setVapiCallId(result.vapiCallId);
        setCallStatus("queued");
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const poll = await utils.callMatrix.pollCall.fetch({ vapiCallId: result.vapiCallId! });
            const s = poll.status as CallStatus;
            setCallStatus(s);
            if (poll.summary) setCallSummary(poll.summary);
            if (poll.transcript) setCallTranscript(poll.transcript);
            if (poll.recordingUrl) setCallRecordingUrl(poll.recordingUrl);
            if (s === "completed" || s === "voicemail" || s === "no_answer" || s === "failed") {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } catch { /* ignore */ }
        }, 5000);
      } else {
        setCallStatus("failed");
        toast.error("Call failed to start — no call ID returned");
      }
    },
    onError: (err) => {
      setCallStatus("failed");
      toast.error(`Call error: ${err.message}`);
    },
  });

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function fireCall() {
    if (callActive) return;
    setCallStatus("firing");
    setCallSummary(null);
    setCallTranscript(null);
    setCallRecordingUrl(null);
    setShowTranscript(false);
    startCallMutation.mutate({
      cleanerJobId: 1,
      jobDate: "",
      personName: customer.name,
      phone: customer.phone,
      scenario: selectedScenario,
      script: script.trim(),
      audience: "customer",
    });
  }

  function resetCall() {
    if (pollRef.current) clearInterval(pollRef.current);
    setCallStatus("idle");
    setVapiCallId(null);
    setCallSummary(null);
    setCallTranscript(null);
    setCallRecordingUrl(null);
    setShowTranscript(false);
    setMinimized(false);
  }
  // ── END CALL LOGIC ────────────────────────────────────────────────────────

  // ── PTT (copied verbatim from SmsComposer) ────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.start(100);
      mediaRecorderRef.current = mr;
      isPttRef.current = true;
      setIsPressing(false);
      setIsRecording(true);
      setVoiceSeconds(0);
      timerRef.current = setInterval(() => setVoiceSeconds(s => s + 1), 1000);
    } catch { toast.error("Microphone access denied"); }
  }, []);

  const stopRecording = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    setIsPressing(false);
    isPttRef.current = false;
    setIsTranscribing(true);
    await new Promise<void>(resolve => {
      mr.onstop = () => resolve();
      try { mr.requestData(); } catch { /* ignore */ }
      mr.stop();
      mr.stream.getTracks().forEach(t => t.stop());
    });
    try {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      if (blob.size === 0) { toast.warning("No audio captured — hold longer"); return; }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { text } = await transcribeMutation.mutateAsync({ dataBase64, mimeType: "audio/webm" });
      if (text.trim()) setScript(prev => prev ? prev + "\n" + text.trim() : text.trim());
      else toast.warning("No speech detected — try again");
    } catch (err: any) {
      toast.error(err?.message?.length < 200 ? err.message : "Transcription failed");
    } finally { setIsTranscribing(false); }
  }, [transcribeMutation]);

  useEffect(() => {
    const release = () => { if (isPttRef.current) stopRecording(); };
    document.addEventListener("mouseup", release);
    document.addEventListener("touchend", release);
    return () => {
      document.removeEventListener("mouseup", release);
      document.removeEventListener("touchend", release);
    };
  }, [stopRecording]);
  // ── END PTT ───────────────────────────────────────────────────────────────

  async function rewrite(tone: "friendly" | "professional" | "casual") {
    if (!script.trim()) return;
    setIsRewriting(true);
    try {
      const result = await rewriteMutation.mutateAsync({ rawMessage: script, customerName: customer.name, tone });
      setScript(result.message);
    } catch { toast.error("Rewrite failed"); }
    finally { setIsRewriting(false); }
  }

  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const statusColor = CALL_STATUS_COLORS[callStatus];

  // ── Minimized pill — fixed bottom-right corner ──────────────────────────
  if (minimized) {
    return ReactDOM.createPortal(
      <div
        className="rounded-2xl overflow-hidden shadow-2xl border border-slate-700 cursor-pointer select-none"
        style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99999, fontFamily: "Inter, sans-serif", minWidth: 260, background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}
        onClick={() => setMinimized(false)}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-xs shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">{customer.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {callActive && <div className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: statusColor }} />}
                <span className="text-[11px] font-semibold" style={{ color: statusColor }}>{CALL_STATUS_LABELS[callStatus]}</span>
              </div>
            </div>
            {/* Maximize icon */}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-white/40 hover:text-white transition-colors shrink-0 ml-1">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="w-[380px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div className="relative px-4 pt-4 pb-3" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/60 hover:text-white transition-colors shrink-0">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{customer.name}</p>
            <p className="text-blue-300 text-[11px]">{customer.phone}</p>
          </div>
          <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}44` }}>
            {CALL_STATUS_LABELS[callStatus]}
          </span>
          {callActive && (
            <button
              onClick={() => { if (onMinimize) { onMinimize(customer); } else { setMinimized(true); } }}
              className="text-white/50 hover:text-white transition-colors shrink-0"
              title="Minimize"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          )}
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
        {/* Scenario chips — only when idle */}
        {callStatus === "idle" && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Call reason</p>
            <div className="flex flex-wrap gap-1.5">
              {CALL_SCENARIOS.map(s => (
                <button
                  key={s.title}
                  onClick={() => { setSelectedScenario(s.title); setScript(buildCallScript(customer.name, s.title)); }}
                  className={cn(
                    "text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors",
                    selectedScenario === s.title ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  )}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Script editor — only when idle */}
        {callStatus === "idle" && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Script — edit before calling</p>
              <button onClick={() => { navigator.clipboard.writeText(script); toast.success("Copied"); }} className="text-[10px] text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <textarea
              value={script}
              onChange={e => setScript(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
            />
            {/* Tone rewrite chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {(["friendly", "professional", "casual"] as const).map(tone => (
                <button
                  key={tone}
                  onClick={() => rewrite(tone)}
                  disabled={isRewriting || !script.trim()}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                >
                  {isRewriting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
                  {tone === "friendly" ? "😊 Friendlier" : tone === "professional" ? "👔 Professional" : "💬 Shorter"}
                </button>
              ))}
              <button
                onClick={() => setScript(prev => prev.replace("I'm sorry, but", "I wanted to personally update you —").replace("we still need", "we just need"))}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1"
              >
                <RefreshCw className="h-2.5 w-2.5" /> Softer
              </button>
            </div>
          </div>
        )}

        {/* Live call status */}
        {callStatus !== "idle" && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: `${statusColor}11`, border: `1px solid ${statusColor}33` }}>
            {callActive && <div className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{ background: statusColor }} />}
            <span className="text-sm font-bold" style={{ color: statusColor }}>{CALL_STATUS_LABELS[callStatus]}</span>
          </div>
        )}

        {/* Summary */}
        {callSummary && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-1">Call summary</p>
            <p className="text-xs text-slate-700 leading-relaxed">{callSummary}</p>
          </div>
        )}

        {/* Recording */}
        {callRecordingUrl && <audio controls src={callRecordingUrl} className="w-full h-8" />}

        {/* Transcript */}
        {callTranscript && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button onClick={() => setShowTranscript(v => !v)} className="w-full px-3 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 flex justify-between items-center">
              <span>Transcript</span><span>{showTranscript ? "▲ Hide" : "▼ Show"}</span>
            </button>
            {showTranscript && <pre className="text-[11px] text-slate-600 whitespace-pre-wrap px-3 pb-3 max-h-40 overflow-y-auto leading-relaxed">{callTranscript}</pre>}
          </div>
        )}
      </div>

      {/* Footer: PTT mic + fire/done buttons */}
      <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-slate-100">
        {callStatus === "idle" && (
          <button
            onMouseDown={() => { setIsPressing(true); startRecording(); }}
            onTouchStart={(e) => { e.preventDefault(); setIsPressing(true); startRecording(); }}
            disabled={isTranscribing}
            className={cn(
              "w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all select-none",
              isRecording ? "bg-red-500 shadow-lg shadow-red-500/40 scale-110" : isPressing ? "bg-indigo-600 scale-105" : "bg-gradient-to-br from-indigo-500 to-purple-600 hover:scale-105",
              isTranscribing && "opacity-50 cursor-not-allowed"
            )}
            title="Hold to dictate script"
          >
            {isTranscribing ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : isRecording ? (
              <span className="flex flex-col items-center gap-0"><MicOff className="h-4 w-4 text-white" /><span className="text-white text-[8px] font-bold leading-none">{voiceSeconds}s</span></span>
            ) : <Mic className="h-4 w-4 text-white" />}
          </button>
        )}
        {callEnded ? (
          <>
            <button onClick={resetCall} className="flex-1 h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">Call again</button>
            <button onClick={onClose} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-all">Done</button>
          </>
        ) : (
          <button
            onClick={fireCall}
            disabled={callActive || startCallMutation.isPending || !script.trim()}
            className="flex-1 h-11 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: callActive ? CALL_STATUS_COLORS[callStatus] : "#16a34a" }}
          >
            {callActive ? <><Loader2 className="h-4 w-4 animate-spin" /> {CALL_STATUS_LABELS[callStatus]}</> : <><Phone className="h-4 w-4" /> Start AI Call</>}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Customer Card View ───────────────────────────────────────────────────────
function CustomerCard({
  customer,
  onClose,
  onText,
  onCall,
}: {
  customer: CustomerData;
  onClose: () => void;
  onText: () => void;
  onCall: () => void;
}) {
  const { data: ctx, isLoading } = trpc.opsChat.getCustomerContext.useQuery(
    { phone: customer.phone, name: customer.name },
    { staleTime: 120_000, retry: false }
  );

  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;

  const actions = [
    { icon: MessageSquare, label: "Text", color: "text-green-600", bg: "hover:bg-green-50", onClick: onText },
    { icon: Phone, label: "AI Call", color: "text-blue-600", bg: "hover:bg-blue-50", onClick: onCall },
    { icon: Mail, label: "Email", color: "text-violet-600", bg: "hover:bg-violet-50", onClick: () => toast.info("Email — coming soon") },
    { icon: History, label: "History", color: "text-slate-600", bg: "hover:bg-slate-100", onClick: () => toast.info("History — coming soon") },
  ];

  return (
    <div className="w-[340px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      <div className="relative px-5 pt-5 pb-4" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg shrink-0 shadow-lg"
            style={{ background: `hsl(${hue}, 55%, 52%)` }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-base truncate">{customer.name}</span>
              {(ctx?.isVip ?? customer.isVip) && (
                <span className="shrink-0 bg-green-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <Star className="h-2.5 w-2.5 fill-white" /> VIP
                </span>
              )}
            </div>
            <p className="text-blue-200 text-xs mt-0.5 truncate">
              {customer.frequency ?? "Customer"}{customer.city ? ` · ${customer.city}` : ""}
            </p>
            <p className="text-blue-300 text-[11px] mt-0.5">{customer.phone}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50">
        {[
          { label: "LTV", value: formatLtv(ctx?.ltv ?? customer.ltv) },
          { label: "Cleans", value: String(ctx?.totalCleans ?? customer.totalCleans) },
          { label: "Last job", value: timeAgo(ctx?.lastJobDate ?? customer.lastJobDate) },
        ].map(s => (
          <div key={s.label} className="py-3 text-center">
            <p className="text-sm font-bold text-slate-900">{s.value}</p>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-0 border-b border-slate-100 px-2 py-3">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={a.onClick}
            className={cn("flex flex-col items-center gap-1.5 py-2 px-1 rounded-xl transition-colors", a.bg)}
          >
            <div className={cn("w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center", a.color)}>
              <a.icon className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-semibold text-slate-600">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">AI Context</p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">Loading context…</span>
          </div>
        ) : ctx?.aiSummary ? (
          <p className="text-xs text-slate-700 leading-relaxed">{ctx.aiSummary}</p>
        ) : (
          <p className="text-xs text-slate-400 italic">No context available</p>
        )}
      </div>
    </div>
  );
}

// ─── Main Chip ────────────────────────────────────────────────────────────────
export function CustomerMentionChip({ name, phone }: { name: string; phone: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"card" | "sms" | "call">("card");
  const [selected, setSelected] = useState<CustomerData | null>(null);

  // Call pill state — lives here so it survives modal close
  const [callMinimized, setCallMinimized] = useState(false);
  const [pillCustomer, setPillCustomer] = useState<CustomerData | null>(null);
  const [pillDismissed, setPillDismissed] = useState(false);

  const { data, isLoading } = trpc.opsChat.searchCustomers.useQuery(
    { query: phone },
    { staleTime: 300_000, retry: false, enabled: open }
  );

  const customers: CustomerData[] = data?.customers ?? [];
  const resolvedCustomer = selected ?? (customers.length === 1 ? customers[0] : null);

  const hue = Math.abs(phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // Close modal but keep pill alive if call is minimized
  function close() {
    setOpen(false);
    setSelected(null);
    setView("card");
  }

  // Full dismiss — kills pill too
  function dismissAll() {
    setPillDismissed(true);
    setCallMinimized(false);
    setPillCustomer(null);
    close();
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Element;
      // Don't close if clicking inside the modal OR the pill
      if (target.closest("[data-chip-modal]") || target.closest("[data-chip-pill]")) return;
      close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const modal = open ? ReactDOM.createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.35)" }}
        onMouseDown={close}
      />
      <div
        data-chip-modal
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 99999,
        }}
      >
        {isLoading ? (
          <div className="w-[340px] rounded-2xl bg-white border border-slate-200 shadow-2xl flex items-center justify-center py-12 gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : resolvedCustomer ? (
          view === "sms" ? (
            <SmsComposer customer={resolvedCustomer} onBack={() => setView("card")} onClose={close} />
          ) : view === "call" ? (
            <AiCallComposer
              customer={resolvedCustomer}
              onBack={() => setView("card")}
              onClose={dismissAll}
              onMinimize={(c) => { setPillCustomer(c); setCallMinimized(true); setPillDismissed(false); close(); }}
            />
          ) : (
            <CustomerCard customer={resolvedCustomer} onClose={close} onText={() => setView("sms")} onCall={() => setView("call")} />
          )
        ) : customers.length > 1 ? (
          <div className="w-[300px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-700">Multiple matches — choose one</p>
              <button onClick={close} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="divide-y divide-slate-100">
              {customers.map(c => {
                const cInitials = c.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
                const cHue = Math.abs(c.phone.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0)) % 360;
                return (
                  <button key={c.phone} onClick={() => setSelected(c)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0" style={{ background: `hsl(${cHue}, 55%, 52%)` }}>{cInitials}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{c.phone}{c.city ? ` · ${c.city}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-slate-700">{formatLtv(c.ltv)}</p>
                      <p className="text-[10px] text-slate-400">{c.totalCleans} cleans</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="w-[300px] rounded-2xl bg-white border border-slate-200 shadow-2xl px-5 py-5 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500 italic">No customer found for {phone}</p>
            <button onClick={close} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </>,
    document.body
  ) : null;

  // Standalone pill — rendered independently of the modal
  const pill = callMinimized && pillCustomer && !pillDismissed ? ReactDOM.createPortal(
    <div
      data-chip-pill
      className="rounded-2xl overflow-hidden shadow-2xl border border-slate-700 cursor-pointer select-none"
      style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99997, fontFamily: "Inter, sans-serif", minWidth: 260, background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}
      onClick={() => {
        // Re-open modal in call view
        setSelected(pillCustomer);
        setView("call");
        setCallMinimized(false);
        setOpen(true);
      }}
    >
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-xs shrink-0"
            style={{ background: `hsl(${Math.abs(pillCustomer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 55%, 52%)` }}
          >
            {pillCustomer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{pillCustomer.name}</p>
            <p className="text-blue-300 text-[10px]">AI Call in progress — tap to expand</p>
          </div>
          <div className="w-2 h-2 rounded-full animate-pulse shrink-0 bg-green-400" />
          <button
            onClick={(e) => { e.stopPropagation(); dismissAll(); }}
            className="text-white/40 hover:text-white transition-colors shrink-0 ml-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <span
        onClick={() => { setView("card"); setOpen(true); }}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-[13px] cursor-pointer hover:bg-emerald-100 transition-colors select-none align-middle"
      >
        <span
          className="w-4 h-4 rounded-full flex items-center justify-center text-white text-[8px] font-black shrink-0"
          style={{ background: `hsl(${hue}, 55%, 52%)` }}
        >
          {initials}
        </span>
        {name}
      </span>
      {modal}
      {pill}
    </>
  );
}

/**
 * Parse @[Name|phone] tokens and render CustomerMentionChip components.
 */
export function renderMessageWithMentions(body: string, _keyPrefix?: string): React.ReactNode[] {
  const TOKEN_RE = /@\[([^\]|]+)\|([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    const mName = match[1];
    const mPhone = match[2].split(",")[0].trim();
    parts.push(<CustomerMentionChip key={`${match.index}-${mPhone}`} name={mName} phone={mPhone} />);
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.length > 0 ? parts : [body];
}
