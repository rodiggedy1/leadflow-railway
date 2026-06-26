/**
 * CustomerMentionChip — renders a @CustomerName chip in chat messages.
 * Click to open a modal card centered in the viewport.
 * Text button slides into an SMS composer view (reuses startCsConversation + PTT + tone rewrite).
 * AI Call button slides into a call composer view backed by useCallSession.
 * Click outside / Escape / X to close.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Phone, Mail, MessageSquare, History, Star, Loader2, X, ChevronLeft, Mic, MicOff, Send, RefreshCw, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallSession, CallSession, CallStatus, StartCallParams } from "@/hooks/useCallSession";

// ─── Call status display maps ─────────────────────────────────────────────────
const CALL_STATUS_COLORS: Record<CallStatus, string> = {
  firing: "#f3c96b", queued: "#7bb7ff",
  ringing: "#f3c96b", in_progress: "#63d297", completed: "#63d297",
  voicemail: "#8f98aa", no_answer: "#ff6b6b", failed: "#ff6b6b", canceled: "#8f98aa",
};
const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  firing: "Connecting…", queued: "Queued…",
  ringing: "Ringing…", in_progress: "In call…", completed: "Completed",
  voicemail: "Voicemail", no_answer: "No answer", failed: "Call failed", canceled: "Canceled",
};

// ─── Call scenarios ───────────────────────────────────────────────────────────
const CALL_SCENARIOS = [
  { title: "Team running late", tag: "Urgent", tagColor: "#ef4444" },
  { title: "Running significantly late", tag: "Urgent", tagColor: "#ef4444" },
  { title: "Team at address / access needed", tag: "Now", tagColor: "#f97316" },
  { title: "Parking instructions", tag: "Now", tagColor: "#f97316" },
  { title: "Put card on file", tag: "Payment", tagColor: "#8b5cf6" },
  { title: "Payment failed", tag: "Payment", tagColor: "#8b5cf6" },
  { title: "Confirm address", tag: "Prep", tagColor: "#3b82f6" },
  { title: "Scope clarification", tag: "Prep", tagColor: "#3b82f6" },
  { title: "Client ETA update", tag: "Update", tagColor: "#10b981" },
  { title: "Earlier arrival available", tag: "Update", tagColor: "#10b981" },
  { title: "Home not ready / team turned away", tag: "Issue", tagColor: "#f59e0b" },
  { title: "Job paused — issue on site", tag: "Issue", tagColor: "#f59e0b" },
  { title: "Follow up / check-in", tag: "General", tagColor: "#6366f1" },
];

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

// ─── Build SMS text from scenario (mirrors buildCallScript but for SMS) ─────────
function buildSmsText(name: string, scenarioTitle: string): string {
  const first = name.split(" ")[0];
  const t = scenarioTitle.toLowerCase();
  if (t.includes("significantly late"))
    return `Hi ${first}, this is Maid in Black. We're sorry — our team is running more than 2 hours behind today. We can keep your appointment at the later time or reschedule at no charge. What works best for you?`;
  if (t.includes("late"))
    return `Hi ${first}, this is Maid in Black. Just a heads up — our team is running a bit behind schedule today. We appreciate your patience and will keep you updated!`;
  if (t.includes("access"))
    return `Hi ${first}, this is Maid in Black. Our team is at your address and needs help with access. Could you share the entry details (lockbox, gate code, front desk)? Thank you!`;
  if (t.includes("parking"))
    return `Hi ${first}, this is Maid in Black. Our team is on the way and needs parking details. What's the best option — street, garage, or driveway? Thanks!`;
  if (t.includes("card on file") || t.includes("put card"))
    return `Hi ${first}, this is Maid in Black. We still need a card on file to confirm your appointment. No deposit required — we just need it saved before dispatch. Reply here and we'll send the secure link!`;
  if (t.includes("payment failed"))
    return `Hi ${first}, this is Maid in Black. The card on file was declined during pre-authorization. Could you update your payment method? We want to make sure your appointment is confirmed. Thank you!`;
  if (t.includes("confirm address"))
    return `Hi ${first}, this is Maid in Black. Could you confirm your service address, unit number, and any entry instructions? We want to make sure the team has everything before arrival. Thanks!`;
  if (t.includes("scope"))
    return `Hi ${first}, this is Maid in Black. We wanted to confirm the scope of your upcoming cleaning before the team arrives. Any specific areas or tasks you'd like us to focus on?`;
  if (t.includes("eta update"))
    return `Hi ${first}, this is Maid in Black. Your team is on the way and should arrive within the scheduled window. Does that still work for you?`;
  if (t.includes("earlier arrival"))
    return `Hi ${first}, this is Maid in Black. Great news — a slot opened up earlier today! Would you prefer an earlier arrival or keep the original schedule?`;
  if (t.includes("not ready") || t.includes("turned away"))
    return `Hi ${first}, this is Maid in Black. Our team arrived but was unable to start the cleaning. We'd love to reschedule as soon as possible — what time works for you?`;
  if (t.includes("paused") || t.includes("issue on site"))
    return `Hi ${first}, this is Maid in Black. Our team had to pause the cleaning at your home. Could you give us a call or reply here so we can discuss next steps? Thank you!`;
  return `Hi ${first}, this is Maid in Black. Just following up to make sure everything is going smoothly with your service. Feel free to reply here if you have any questions — we're happy to help!`;
}

// ─── SMS Composer View ────────────────────────────────────────────────────────
function SmsComposer({
  customer,
  onBack,
  onClose,
  lastMessage,
}: {
  customer: CustomerData;
  onBack: () => void;
  onClose: () => void;
  lastMessage?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const autoDraftFiredRef = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPttRef = useRef(false);

  const [isRewriting, setIsRewriting] = useState(false);

  const transcribeMutation = trpc.opsChat.transcribeVoiceNote.useMutation();
  const rewriteMutation = trpc.opsChat.rewriteVoiceMessage.useMutation();
  const transformMutation = trpc.opsChat.transformMessage.useMutation();
  const draftReplyMutation = trpc.opsChat.draftReply.useMutation();

  // Auto-draft: same as email — use draftReply mutation when lastMessage is provided
  useEffect(() => {
    if (!lastMessage || autoDraftFiredRef.current) return;
    autoDraftFiredRef.current = true;
    setIsDrafting(true);
    draftReplyMutation.mutateAsync({
      customerName: customer.name,
      lastMessage,
      channel: "sms",
    }).then(({ draft }) => {
      setText(draft);
    }).catch(() => {
      // silently fail — agent can type manually
    }).finally(() => setIsDrafting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMutation = trpc.opsChat.startCsConversation.useMutation({
    onSuccess: () => {
      toast.success(`SMS sent to ${customer.name}`);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const firstName = customer.name.split(" ")[0];

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

  useEffect(() => {
    const release = () => { if (isPttRef.current) stopRecording(); };
    document.addEventListener("mouseup", release);
    document.addEventListener("touchend", release);
    return () => {
      document.removeEventListener("mouseup", release);
      document.removeEventListener("touchend", release);
    };
  }, [stopRecording]);

  async function rewrite(tone: "friendly" | "professional" | "casual") {
    if (!text.trim()) return;
    setIsRewriting(true);
    try {
      const result = await rewriteMutation.mutateAsync({ rawMessage: text, customerName: customer.name, tone });
      setText(result.message);
    } catch {
      toast.error("Rewrite failed");
    } finally {
      setIsRewriting(false);
    }
  }

  async function handleSend() {
    if (!text.trim() || sending) return;
    setSending(true);
    sendMutation.mutate({ phone: customer.phone, firstMessage: text.trim() });
  }

  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="w-[440px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
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
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-3 space-y-2 max-h-[65vh] overflow-y-auto">
        {/* Call scenario chips — same as AI Call view */}
        <div className="flex flex-wrap gap-1.5">
          {CALL_SCENARIOS.map(s => (
            <button
              key={s.title}
              onClick={() => setText(buildSmsText(customer.name, s.title))}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full border bg-white transition-colors hover:opacity-90"
              style={{ borderColor: s.tagColor + "55", color: s.tagColor, background: s.tagColor + "12" }}
            >
              {s.title}
            </button>
          ))}
        </div>

        {/* Last message strip — below scenario chips, right above textarea */}
        {lastMessage && (
          <div className="rounded-xl border-l-4 border-blue-400 bg-blue-50 px-3 py-2.5">
            <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wide mb-1 flex items-center gap-1">
              <span>&#8629;</span> Replying to
            </p>
            <p className="text-xs text-slate-700 font-medium line-clamp-3 leading-relaxed">{lastMessage}</p>
          </div>
        )}

        <div className="relative">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={isDrafting ? "" : `Type a text to ${firstName}…`}
            rows={5}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
          />
          {isDrafting && (
            <div className="absolute inset-0 rounded-xl flex items-start px-3 py-2.5 pointer-events-none">
              <span className="text-sm text-blue-500 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="animate-pulse">Drafting reply…</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
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
          <div className="w-px h-4 bg-slate-200 mx-0.5 self-center" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide self-center">Translate</span>
          <button
            onClick={async () => {
              if (!text.trim()) return;
              setIsRewriting(true);
              try {
                const result = await transformMutation.mutateAsync({
                  text,
                  customerName: customer.name,
                  instruction: "Translate into natural, conversational Latin American Spanish suitable for SMS customer support. Preserve names, addresses, dates, times, prices, URLs, phone numbers, and formatting exactly. Do not explain the translation or add any extra text. Return only the translated message.",
                });
                setText(result.message);
              } catch { toast.error("Translation failed"); }
              finally { setIsRewriting(false); }
            }}
            disabled={isRewriting || !text.trim()}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-orange-50 hover:border-orange-300 hover:text-orange-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            {isRewriting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
            🇪🇸 Español
          </button>
          <button
            onClick={async () => {
              if (!text.trim()) return;
              setIsRewriting(true);
              try {
                const result = await transformMutation.mutateAsync({
                  text,
                  customerName: customer.name,
                  instruction: "Translate into natural Brazilian Portuguese suitable for SMS customer support. Preserve names, addresses, dates, times, prices, URLs, phone numbers, and formatting exactly. Do not explain the translation or add any extra text. Return only the translated message.",
                });
                setText(result.message);
              } catch { toast.error("Translation failed"); }
              finally { setIsRewriting(false); }
            }}
            disabled={isRewriting || !text.trim()}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            {isRewriting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
            🇧🇷 Português
          </button>
        </div>
      </div>

      <div className="px-3 pb-3 pt-2 flex items-center gap-2">
        <button
          onMouseDown={() => { setIsPressing(true); startRecording(); }}
          onTouchStart={(e) => { e.preventDefault(); setIsPressing(true); startRecording(); }}
          disabled={isTranscribing}
          className={cn(
            "w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all select-none",
            isRecording ? "bg-red-500 shadow-lg shadow-red-500/40 scale-110" : isPressing ? "bg-indigo-600 scale-105" : "bg-gradient-to-br from-indigo-500 to-purple-600 hover:scale-105",
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

// ─── Email templates (subset of CANNED_TEMPLATES from EmailInbox) ─────────────
const EMAIL_TEMPLATES = [
  {
    label: "Follow Up",
    subject: "Just Checking In",
    body: "Hi {first},\n\nJust wanted to follow up in case you were still looking for a cleaning service.\n\nYour quote is still available, and we'd be happy to get you on the schedule.\n\nLet us know if you have any questions!\n\nThanks,\nThe Maid in Black Team",
  },
  {
    label: "Running Late",
    subject: "Quick Update on Your Appointment",
    body: "Hi {first},\n\nJust a quick update — our team is running a little behind due to the previous appointment taking longer than expected.\n\nWe appreciate your patience and apologize for the inconvenience.\n\nThanks,\nThe Maid in Black Team",
  },
  {
    label: "Confirm Appointment",
    subject: "Your Cleaning is Confirmed! 🎉",
    body: "Hi {first},\n\nYou're all set! Your cleaning has been confirmed.\n\nOur team will arrive within the scheduled arrival window and will come fully equipped with supplies unless otherwise requested.\n\nIf you have any special instructions, parking information, or entry details, simply reply to this email.\n\nWe look forward to making your home shine!\n\nThanks,\nThe Maid in Black Team",
  },
  {
    label: "Payment",
    subject: "Payment Reminder",
    body: "Hi {first},\n\nJust a friendly reminder that we still need a card on file before your appointment.\n\nIf you have any questions, let us know!\n\nThanks,\nThe Maid in Black Team",
  },
  {
    label: "Thank You",
    subject: "Thank You for Choosing Maid in Black!",
    body: "Hi {first},\n\nThank you for choosing Maid in Black!\n\nWe hope you loved your cleaning. If everything looks great, we'd really appreciate a quick review — it helps our small business tremendously.\n\nIf there's anything that isn't perfect, please reply directly and we'll make it right.\n\nThanks again!\nThe Maid in Black Team",
  },
];

// ─── Email Composer View ──────────────────────────────────────────────────────
function EmailComposer({
  customer,
  onBack,
  onClose,
  lastMessage,
  emailSubject,
}: {
  customer: CustomerData;
  onBack: () => void;
  onClose: () => void;
  lastMessage?: string;
  emailSubject?: string;
}) {
  const firstName = customer.name.split(" ")[0];
  const [subject, setSubject] = useState(emailSubject || "Regarding your cleaning appointment");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [isRewriting, setIsRewriting] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const autoDraftFiredRef = useRef(false);

  // In-memory draft cache — survives modal close/reopen within session
  const draftRef = useRef<{ subject: string; body: string } | null>(null);
  useEffect(() => {
    if (draftRef.current) {
      setSubject(draftRef.current.subject);
      setBody(draftRef.current.body);
    }
  }, []);
  useEffect(() => {
    draftRef.current = { subject, body };
  }, [subject, body]);

  // PTT voice
  const [isRecording, setIsRecording] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPttRef = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const transcribeMutation = trpc.opsChat.transcribeVoiceNote.useMutation();
  const rewriteMutation = trpc.opsChat.rewriteVoiceMessage.useMutation();
  const draftReplyMutation = trpc.opsChat.draftReply.useMutation();
  const sendMutation = trpc.gmail.composeNew.useMutation({
    onSuccess: () => setSent(true),
    onError: (err) => toast.error(err.message),
  });

  // Auto-draft: generate a reply suggestion when lastMessage is provided
  useEffect(() => {
    if (!lastMessage || autoDraftFiredRef.current) return;
    autoDraftFiredRef.current = true;
    setIsDrafting(true);
    draftReplyMutation.mutateAsync({
      customerName: customer.name,
      lastMessage,
      channel: "email",
      subject: emailSubject,
    }).then(({ draft }) => {
      setBody(draft);
    }).catch(() => {
      // silently fail — agent can type manually
    }).finally(() => setIsDrafting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setBody(prev => prev ? prev + "\n" + transcribed.trim() : transcribed.trim());
      } else {
        toast.warning("No speech detected — try again");
      }
    } catch (err: any) {
      toast.error(err?.message?.length < 200 ? err.message : "Transcription failed");
    } finally {
      setIsTranscribing(false);
    }
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

  async function rewrite(tone: "friendly" | "professional" | "casual") {
    if (!body.trim()) return;
    setIsRewriting(true);
    try {
      const result = await rewriteMutation.mutateAsync({ rawMessage: body, customerName: customer.name, tone });
      setBody(result.message);
    } catch {
      toast.error("Rewrite failed");
    } finally {
      setIsRewriting(false);
    }
  }

  function applyTemplate(tpl: typeof EMAIL_TEMPLATES[number]) {
    setSubject(tpl.subject);
    setBody(tpl.body.replace(/{first}/g, firstName));
    setTimeout(() => bodyRef.current?.focus(), 50);
  }

  function handleSend() {
    if (!subject.trim() || !body.trim() || sendMutation.isPending) return;
    sendMutation.mutate({
      to: customer.email!,
      subject: subject.trim(),
      bodyHtml: body.trim().replace(/\n/g, "<br>"),
    });
  }

  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const canSend = subject.trim().length > 0 && body.trim().length > 0;

  // No email on file
  if (!customer.email) {
    return (
      <div className="w-[440px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="relative px-4 pt-4 pb-3" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-white/60 hover:text-white transition-colors shrink-0"><ChevronLeft className="h-5 w-5" /></button>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">{customer.name}</p>
              <p className="text-blue-300 text-[11px]">Email</p>
            </div>
            <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="px-5 py-8 text-center">
          <Mail className="h-8 w-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">No email on file</p>
          <p className="text-xs text-slate-400 mt-1">No email address found for {customer.name}</p>
          <button onClick={onBack} className="mt-4 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors">← Back</button>
        </div>
      </div>
    );
  }

  // Sent confirmation
  if (sent) {
    return (
      <div className="w-[440px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
        <div className="relative px-4 pt-4 pb-3" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">{customer.name}</p>
              <p className="text-blue-300 text-[11px]">{customer.email}</p>
            </div>
            <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="px-5 py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-base font-bold text-slate-900">Email sent</p>
          <p className="text-xs text-slate-500 mt-1">To: {customer.name}</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate px-4">{subject}</p>
        </div>
        <div className="px-3 pb-3 flex gap-2">
          <button
            onClick={() => { setSent(false); setSubject("Regarding your cleaning appointment"); setBody(""); draftRef.current = null; }}
            className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            Send another
          </button>
          <button onClick={onClose} className="flex-1 h-10 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[440px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div className="relative px-4 pt-4 pb-3" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/60 hover:text-white transition-colors shrink-0"><ChevronLeft className="h-5 w-5" /></button>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-sm shrink-0" style={{ background: `hsl(${hue}, 55%, 52%)` }}>{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{customer.name}</p>
            <p className="text-blue-300 text-[11px] truncate">{customer.email}</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors shrink-0"><X className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="px-3 py-3 space-y-2 max-h-[65vh] overflow-y-auto">
        {/* Templates */}
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_TEMPLATES.map(tpl => (
            <button
              key={tpl.label}
              onClick={() => applyTemplate(tpl)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 transition-colors"
            >
              {tpl.label}
            </button>
          ))}
        </div>

        {/* Subject */}
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
        />

        {/* Last message strip — below subject, right above body */}
        {lastMessage && (
          <div className="rounded-xl border-l-4 border-violet-400 bg-violet-50 px-3 py-2.5">
            <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide mb-1 flex items-center gap-1">
              <span>&#8629;</span> Replying to
            </p>
            <p className="text-xs text-slate-700 font-medium line-clamp-3 leading-relaxed">{lastMessage}</p>
          </div>
        )}

        {/* Body */}
        <div className="relative">
          <textarea
            ref={bodyRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={isDrafting ? "" : `Write an email to ${firstName}…`}
            rows={5}
            autoFocus
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
          />
          {isDrafting && (
            <div className="absolute inset-0 rounded-xl flex items-start px-3 py-2.5 pointer-events-none">
              <span className="text-sm text-violet-500 flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="animate-pulse">Drafting reply…</span>
              </span>
            </div>
          )}
        </div>

        {/* AI tone chips */}
        <div className="flex flex-wrap gap-1.5">
          {([
            { tone: "friendly" as const, label: "✨ Improve" },
            { tone: "friendly" as const, label: "😊 Friendlier" },
            { tone: "professional" as const, label: "👔 Professional" },
            { tone: "casual" as const, label: "💬 Shorter" },
          ]).map(({ tone, label }) => (
            <button
              key={label}
              onClick={() => rewrite(tone)}
              disabled={isRewriting || !body.trim()}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
            >
              {isRewriting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 pb-3 pt-2 flex items-center gap-2">
        <button
          onMouseDown={() => { setIsPressing(true); startRecording(); }}
          onTouchStart={(e) => { e.preventDefault(); setIsPressing(true); startRecording(); }}
          disabled={isTranscribing}
          className={cn(
            "w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all select-none",
            isRecording ? "bg-red-500 shadow-lg shadow-red-500/40 scale-110" : isPressing ? "bg-violet-600 scale-105" : "bg-gradient-to-br from-violet-500 to-purple-600 hover:scale-105",
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

        <button
          onClick={handleSend}
          disabled={!canSend || sendMutation.isPending}
          className="flex-1 h-11 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
        >
          {sendMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
          ) : (
            <><Mail className="h-4 w-4" /> Send Email</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── AI Call Composer View (presentational) ───────────────────────────────────
// This component owns only UI state: script text, selected scenario, PTT, rewrite.
// All call lifecycle state comes from the parent via props (session, onStartCall, etc.)
function AiCallComposer({
  customer,
  session,
  isPolling,
  onStartCall,
  onMinimize,
  onCancelCall,
  onDismissSession,
  onBack,
  onClose,
}: {
  customer: CustomerData;
  session: CallSession | null;
  isPolling: boolean;
  onStartCall: (params: StartCallParams) => Promise<void>;
  onMinimize: () => void;
  onCancelCall: () => Promise<void>;
  onDismissSession: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [selectedScenario, setSelectedScenario] = useState(CALL_SCENARIOS[0].title);
  const [script, setScript] = useState(() => buildCallScript(customer.name, CALL_SCENARIOS[0].title));
  const [showTranscript, setShowTranscript] = useState(false);
  const [isFiring, setIsFiring] = useState(false);

  // PTT state
  const [isRecording, setIsRecording] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPttRef = useRef(false);

  const [isRewriting, setIsRewriting] = useState(false);

  const transcribeMutation = trpc.opsChat.transcribeVoiceNote.useMutation();
  const rewriteMutation = trpc.opsChat.rewriteVoiceMessage.useMutation();

  const callStatus = session?.status ?? null;
  const callPhase = session?.phase ?? null;
  const isActive = callPhase === "active";
  const isTerminal = callPhase === "terminal";
  const statusColor = callStatus ? CALL_STATUS_COLORS[callStatus] : "#8f98aa";
  const statusLabel = callStatus ? CALL_STATUS_LABELS[callStatus] : "Ready";

  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // Auto-minimize when call goes active
  useEffect(() => {
    if (isActive) {
      onMinimize();
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // PTT
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

  async function rewrite(tone: "friendly" | "professional" | "casual") {
    if (!script.trim()) return;
    setIsRewriting(true);
    try {
      const result = await rewriteMutation.mutateAsync({ rawMessage: script, customerName: customer.name, tone });
      setScript(result.message);
    } catch { toast.error("Rewrite failed"); }
    finally { setIsRewriting(false); }
  }

  async function fireCall() {
    if (session !== null || isFiring) return;
    setIsFiring(true);
    try {
      await onStartCall({
        cleanerJobId: 1,
        jobDate: "",
        personName: customer.name,
        phone: customer.phone,
        scenario: selectedScenario,
        script: script.trim(),
        audience: "customer",
      });
    } catch (err: any) {
      toast.error(err?.message?.length < 200 ? err.message : "Failed to start call");
    } finally {
      setIsFiring(false);
    }
  }

  function handleCallAgain() {
    onDismissSession();
    setShowTranscript(false);
  }

  return (
    <div className="w-[440px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
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
          {session && (
            <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}44` }}>
              {statusLabel}
            </span>
          )}
          {isActive && (
            <button
              onClick={onMinimize}
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
        {/* Scenario chips — only when no session */}
        {!session && (
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

        {/* Script editor — only when no session */}
        {!session && (
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
        {session && (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: `${statusColor}11`, border: `1px solid ${statusColor}33` }}>
            {isActive && <div className="w-2.5 h-2.5 rounded-full shrink-0 animate-pulse" style={{ background: statusColor }} />}
            <span className="text-sm font-bold" style={{ color: statusColor }}>{statusLabel}</span>
            {isPolling && <Loader2 className="h-3.5 w-3.5 animate-spin ml-auto" style={{ color: statusColor }} />}
          </div>
        )}

        {/* Error */}
        {session?.outcome?.error && !session?.outcome?.summary && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
            <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide mb-1">Error</p>
            <p className="text-xs text-slate-700 leading-relaxed">{session.outcome.error}</p>
          </div>
        )}

        {/* Summary */}
        {session?.outcome?.summary && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide mb-1">Call summary</p>
            <p className="text-xs text-slate-700 leading-relaxed">{session.outcome?.summary}</p>
          </div>
        )}

        {/* Recording */}
        {session?.outcome?.recordingUrl && (
          <audio controls src={session.outcome?.recordingUrl} className="w-full h-8" />
        )}

        {/* Transcript */}
        {session?.outcome?.transcript && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <button onClick={() => setShowTranscript(v => !v)} className="w-full px-3 py-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 flex justify-between items-center">
              <span>Transcript</span><span>{showTranscript ? "▲ Hide" : "▼ Show"}</span>
            </button>
            {showTranscript && <pre className="text-[11px] text-slate-600 whitespace-pre-wrap px-3 pb-3 max-h-40 overflow-y-auto leading-relaxed">{session.outcome?.transcript}</pre>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-slate-100">
        {!session && (
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
        {isTerminal ? (
          <>
            <button onClick={handleCallAgain} className="flex-1 h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all">Call again</button>
            <button onClick={onClose} className="flex-1 h-11 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-all">Done</button>
          </>
        ) : (
          <button
            onClick={fireCall}
            disabled={session !== null || isFiring || !script.trim()}
            className="flex-1 h-11 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: session ? statusColor : "#16a34a" }}
          >
            {session ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {statusLabel}</>
            ) : isFiring ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</>
            ) : (
              <><Phone className="h-4 w-4" /> Start AI Call</>
            )}
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
  onEmail,
}: {
  customer: CustomerData;
  onClose: () => void;
  onText: () => void;
  onCall: () => void;
  onEmail: () => void;
}) {
  const { data: ctx, isLoading } = trpc.opsChat.getCustomerContext.useQuery(
    { phone: customer.phone, name: customer.name },
    { staleTime: 120_000, retry: false }
  );

  // Agent info for the "sending as" side
  const { data: agentMe } = trpc.agents.me.useQuery(undefined, { staleTime: 300_000, retry: false });
  const { data: agentStatuses } = trpc.agents.getStatuses.useQuery(undefined, { staleTime: 300_000, retry: false });
  const agentName = agentMe?.name ?? "Agent";
  const agentPhoto = agentStatuses?.find(a => a.name === agentName)?.profilePhotoUrl ?? null;
  const agentInitials = agentName.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();

  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;

  const actions = [
    { icon: MessageSquare, label: "Text", color: "text-green-600", bg: "hover:bg-green-50", onClick: onText },
    { icon: Phone, label: "AI Call", color: "text-blue-600", bg: "hover:bg-blue-50", onClick: onCall },
    { icon: Mail, label: "Email", color: "text-violet-600", bg: "hover:bg-violet-50", onClick: onEmail },
    { icon: History, label: "History", color: "text-slate-600", bg: "hover:bg-slate-100", onClick: () => toast.info("History — coming soon") },
  ];

  return (
    <div className="w-[420px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
      <div className="relative px-5 pt-5 pb-4" style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-white/50 hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>

        {/* Chat-style header: agent → customer */}
        <div className="flex items-center justify-between gap-3 pb-1">
          {/* Agent side (sender — left) */}
          <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <div className="w-14 h-14 rounded-full overflow-hidden shadow-lg shrink-0 bg-slate-600 flex items-center justify-center">
              {agentPhoto ? (
                <img src={agentPhoto} alt={agentName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-black text-lg">{agentInitials}</span>
              )}
            </div>
            <div className="text-center min-w-0 w-full">
              <p className="text-white font-bold text-sm truncate">{agentName}</p>
              <p className="text-blue-300 text-[11px]">Sending as</p>
            </div>
          </div>

          {/* Arrow */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M6 14h16M16 8l6 6-6 6" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>

          {/* Customer side (recipient — right) */}
          <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
            <div className="relative">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-lg shadow-lg" style={{ background: `hsl(${hue}, 55%, 52%)` }}>
                {initials}
              </div>
              {(ctx?.isVip ?? customer.isVip) && (
                <span className="absolute -top-1 -right-1 bg-green-500 text-white text-[8px] font-black px-1 py-0.5 rounded-full flex items-center gap-0.5 leading-none">
                  <Star className="h-2 w-2 fill-white" />
                </span>
              )}
            </div>
            <div className="text-center min-w-0 w-full">
              <p className="text-white font-bold text-sm truncate">{customer.name}</p>
              <p className="text-blue-200 text-[11px] truncate">{customer.frequency ?? "Customer"}{customer.city ? ` · ${customer.city}` : ""}</p>
            </div>
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
  const [view, setView] = useState<"card" | "sms" | "call" | "email">("card");
  const [selected, setSelected] = useState<CustomerData | null>(null);

  // Call session — lives here, survives modal open/close
  const { session, isPolling, startCall, cancelCall, dismissSession } = useCallSession();

  // Track if we've already auto-reopened for this terminal session
  const autoReopenedRef = useRef(false);

  const { data, isLoading } = trpc.opsChat.searchCustomers.useQuery(
    { query: phone },
    { staleTime: 300_000, retry: false, enabled: open || session !== null }
  );

  const customers: CustomerData[] = data?.customers ?? [];
  const resolvedCustomer = selected ?? (customers.length === 1 ? customers[0] : null);

  const hue = Math.abs(phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  // Auto-reopen modal when call reaches terminal state (once per session)
  useEffect(() => {
    if (session?.phase === "terminal" && !autoReopenedRef.current) {
      autoReopenedRef.current = true;
      setView("call");
      setOpen(true);
    }
    // Reset the flag when session is cleared
    if (session === null) {
      autoReopenedRef.current = false;
    }
  }, [session?.phase, session]);

  function close() {
    setOpen(false);
    setSelected(null);
    setView("card");
  }

  function handleDismissSession() {
    dismissSession();
    autoReopenedRef.current = false;
    close();
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Element;
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
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 99999 }}
      >
        {isLoading ? (
          <div className="w-[420px] rounded-2xl bg-white border border-slate-200 shadow-2xl flex items-center justify-center py-12 gap-2 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : resolvedCustomer ? (
          view === "sms" ? (
            <SmsComposer customer={resolvedCustomer} onBack={() => setView("card")} onClose={close} />
          ) : view === "call" ? (
            <AiCallComposer
              customer={resolvedCustomer}
              session={session}
              isPolling={isPolling}
              onStartCall={startCall}
              onMinimize={close}
              onCancelCall={cancelCall}
              onDismissSession={handleDismissSession}
              onBack={() => setView("card")}
              onClose={close}
            />
          ) : view === "email" ? (
            <EmailComposer customer={resolvedCustomer} onBack={() => setView("card")} onClose={close} />
          ) : (
            <CustomerCard customer={resolvedCustomer} onClose={close} onText={() => setView("sms")} onCall={() => setView("call")} onEmail={() => setView("email")} />
          )
        ) : customers.length > 1 ? (
          <div className="w-[380px] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 bg-white" style={{ fontFamily: "Inter, sans-serif" }}>
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
          <div className="w-[380px] rounded-2xl bg-white border border-slate-200 shadow-2xl px-5 py-5 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500 italic">No customer found for {phone}</p>
            <button onClick={close} className="text-slate-400 hover:text-slate-600 shrink-0"><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </>,
    document.body
  ) : null;

  // Pill — shown whenever session exists (active OR terminal), until dismissed
  const pillSession = session;
  const pillStatusColor = pillSession ? CALL_STATUS_COLORS[pillSession.status] : "#8f98aa";
  const pillStatusLabel = pillSession ? CALL_STATUS_LABELS[pillSession.status] : "";
  const pillIsActive = pillSession?.phase === "active";

  const pill = pillSession ? ReactDOM.createPortal(
    <div
      data-chip-pill
      className="rounded-2xl overflow-hidden shadow-2xl border border-slate-700 cursor-pointer select-none"
      style={{ position: "fixed", bottom: 24, right: 24, zIndex: 99997, fontFamily: "Inter, sans-serif", minWidth: 260, background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)" }}
      onClick={() => {
        setView("call");
        setOpen(true);
      }}
    >
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-black text-xs shrink-0"
            style={{ background: `hsl(${hue}, 55%, 52%)` }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm truncate">{pillSession.customerName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {pillIsActive && <div className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: pillStatusColor }} />}
              <span className="text-[11px] font-semibold" style={{ color: pillStatusColor }}>{pillStatusLabel}</span>
            </div>
          </div>
          {/* Maximize icon */}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <button
            onClick={(e) => { e.stopPropagation(); handleDismissSession(); }}
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
        data-chip-pill
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 font-semibold text-[13px] cursor-pointer hover:bg-slate-200 transition-colors select-none align-middle"
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
 * Parse @[Name|phone] (legacy) or @[Name] (new) tokens and render CustomerMentionChip components.
 * phoneMap is used for new-format tokens to resolve the phone number.
 */
export function renderMessageWithMentions(
  body: string,
  _keyPrefix?: string,
  phoneMap?: Record<string, string>
): React.ReactNode[] {
  // Matches both @[Name|phone] and @[Name]
  const TOKEN_RE = /@\[([^\]]+?)(?:\|([^\]]+))?\]/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    const mName = match[1];
    // Phone comes from: (1) legacy inline format, (2) phoneMap lookup
    const mPhone = match[2]
      ? match[2].split(",")[0].trim()
      : (phoneMap?.[mName] ?? "");
    parts.push(<CustomerMentionChip key={`${match.index}-${mName}`} name={mName} phone={mPhone} />);
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.length > 0 ? parts : [body];
}

// ─── QuickReplyModal ──────────────────────────────────────────────────────────
// Opens the SMS or Email composer directly from a CustomerData object,
// bypassing the search step. Used by sidebar panels (CS SMS, Email Inbox, Lead Replies).
export function QuickReplyModal({
  customer,
  initialView,
  onClose,
  lastMessage,
  emailSubject,
}: {
  customer: CustomerData;
  initialView: "sms" | "email";
  onClose: () => void;
  lastMessage?: string;
  emailSubject?: string;
}) {
  const [view, setView] = useState<"card" | "sms" | "call" | "email">(initialView);
  const { session, isPolling, startCall, cancelCall, dismissSession } = useCallSession();

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return ReactDOM.createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 99998, background: "rgba(0,0,0,0.35)" }}
        onMouseDown={onClose}
      />
      <div
        data-chip-modal
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 99999 }}
      >
        {view === "sms" ? (
          <SmsComposer customer={customer} onBack={onClose} onClose={onClose} lastMessage={lastMessage} />
        ) : view === "email" ? (
          <EmailComposer customer={customer} onBack={onClose} onClose={onClose} lastMessage={lastMessage} emailSubject={emailSubject} />
        ) : view === "call" ? (
          <AiCallComposer
            customer={customer}
            session={session}
            isPolling={isPolling}
            onStartCall={startCall}
            onMinimize={onClose}
            onCancelCall={cancelCall}
            onDismissSession={() => { dismissSession(); onClose(); }}
            onBack={() => setView("card")}
            onClose={onClose}
          />
        ) : (
          <CustomerCard
            customer={customer}
            onClose={onClose}
            onText={() => setView("sms")}
            onCall={() => setView("call")}
            onEmail={() => setView("email")}
          />
        )}
      </div>
    </>,
    document.body
  );
}
