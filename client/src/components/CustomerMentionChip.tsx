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
import { Phone, Mail, MessageSquare, History, Star, Loader2, X, ChevronLeft, Mic, MicOff, Send } from "lucide-react";
import { cn } from "@/lib/utils";

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

// ─── Customer Card View ───────────────────────────────────────────────────────
function CustomerCard({
  customer,
  onClose,
  onText,
}: {
  customer: CustomerData;
  onClose: () => void;
  onText: () => void;
}) {
  const { data: ctx, isLoading } = trpc.opsChat.getCustomerContext.useQuery(
    { phone: customer.phone, name: customer.name },
    { staleTime: 120_000, retry: false }
  );

  const initials = customer.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = Math.abs(customer.phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;

  const actions = [
    { icon: MessageSquare, label: "Text", color: "text-green-600", bg: "hover:bg-green-50", onClick: onText },
    { icon: Phone, label: "AI Call", color: "text-blue-600", bg: "hover:bg-blue-50", onClick: () => toast.info("AI Call — coming soon") },
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
  const [view, setView] = useState<"card" | "sms">("card");
  const [selected, setSelected] = useState<CustomerData | null>(null);

  const { data, isLoading } = trpc.opsChat.searchCustomers.useQuery(
    { query: phone },
    { staleTime: 300_000, retry: false, enabled: open }
  );

  const customers: CustomerData[] = data?.customers ?? [];
  const resolvedCustomer = selected ?? (customers.length === 1 ? customers[0] : null);

  const hue = Math.abs(phone.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  function close() { setOpen(false); setSelected(null); setView("card"); }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Element;
      if (!target.closest("[data-chip-modal]")) close();
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
          ) : (
            <CustomerCard customer={resolvedCustomer} onClose={close} onText={() => setView("sms")} />
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
