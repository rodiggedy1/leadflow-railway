/**
 * WorldClassReplyPanel — slide-up panel for CS Chat.
 *
 * Agent describes any customer service scenario → AI returns the exact
 * words to say, modeled on Disney HEARD, Ritz-Carlton Gold Standards,
 * Zappos WOW, and Nordstrom principles.
 *
 * Placement: absolute bottom-full inside the relative composer div,
 * same positioning pattern as ObjectionsPanel and FAQPanel.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  X,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  Send,
  Sparkles,
  Pencil,
} from "lucide-react";

// ── quick-start scenario chips ────────────────────────────────────────────────
const QUICK_SCENARIOS = [
  { emoji: "😤", label: "Cleaner missed spots", hint: "Customer says areas were skipped or not cleaned properly" },
  { emoji: "⏰", label: "Team running late",     hint: "Cleaner is behind schedule and customer is waiting" },
  { emoji: "💔", label: "Unhappy with service",  hint: "Customer is dissatisfied and wants to complain" },
  { emoji: "🔑", label: "Entry issue",           hint: "Cleaner couldn't get in — lockbox code wrong or no access" },
  { emoji: "💸", label: "Wants a refund",        hint: "Customer is demanding their money back" },
  { emoji: "📅", label: "Reschedule request",    hint: "Customer needs to move their appointment" },
  { emoji: "⭐", label: "Happy customer",        hint: "Customer is thrilled — maximize the moment" },
  { emoji: "😰", label: "Damage concern",        hint: "Customer says something was broken or damaged" },
] as const;

// ── types ─────────────────────────────────────────────────────────────────────
type Message = { role: "user" | "assistant"; content: string };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Optional: pre-fill compose box with the generated reply */
  onInsert?: (text: string) => void;
}

// ── component ─────────────────────────────────────────────────────────────────
export default function WorldClassReplyPanel({ open, onClose, onInsert }: Props) {
  const [scenarioInput, setScenarioInput] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mutation = trpc.opsChat.csReply.useMutation({
    onSuccess: (data) => {
      setHistory(prev => [...prev, { role: "assistant" as const, content: String(data.reply) }]);
    },
  });

  // Scroll to top whenever a new response arrives
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [history, mutation.isPending]);

  // Dismiss on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Auto-focus textarea when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const hasConversation = history.length > 0;

  const handleSubmit = (text?: string) => {
    const scenario = (text ?? scenarioInput).trim();
    if (!scenario || mutation.isPending) return;
    const userMsg: Message = { role: "user", content: scenario };
    // For follow-ups, keep history; for new scenarios, start fresh
    const isFollowUp = hasConversation && !text;
    const base = isFollowUp ? history : [];
    setHistory([...base, userMsg]);
    mutation.mutate({
      scenario,
      history: isFollowUp ? history : [],
    });
    if (!isFollowUp) setScenarioInput("");
    else setScenarioInput("");
  };

  const handleQuickScenario = (label: string) => {
    setScenarioInput(label);
    handleSubmit(label);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleInsert = (text: string) => {
    onInsert?.(text);
    onClose();
  };

  const handleReset = () => {
    setHistory([]);
    setScenarioInput("");
    mutation.reset();
  };

  const lastAssistantMsg = [...history].reverse().find(m => m.role === "assistant");

  return (
    <div
      className="absolute bottom-full left-0 right-0 z-50 mb-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-2xl"
      style={{ height: "min(600px, 65vh)", minHeight: "420px" }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-purple-50 shrink-0 rounded-t-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 leading-tight">World-Class Reply</p>
            <p className="text-[11px] text-slate-500 leading-tight">Disney · Ritz-Carlton · Zappos principles</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {hasConversation && (
            <button
              onClick={handleReset}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition"
              title="Start over"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => { handleReset(); onClose(); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Body — scrollable ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
        {!hasConversation ? (
          /* Empty state — quick-start chips */
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
              Quick scenarios or describe your own below
            </p>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_SCENARIOS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => handleQuickScenario(s.label)}
                  disabled={mutation.isPending}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-violet-50 hover:border-violet-200 text-left text-xs font-semibold text-slate-700 transition disabled:opacity-50"
                >
                  <span className="text-base leading-none shrink-0">{s.emoji}</span>
                  <span className="leading-tight">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Conversation thread */
          <div className="space-y-3">
            {history.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "user" ? (
                  <div className="max-w-[80%] bg-violet-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs font-medium shadow-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className="max-w-[95%] bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-indigo-100 rounded-2xl rounded-tl-sm px-3.5 py-3 text-xs text-slate-700 leading-relaxed shadow-sm relative group">
                    {/* Quality badge */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                        <Sparkles className="h-2.5 w-2.5" />
                        World-class response
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-indigo-100">
                      <button
                        onClick={() => handleCopy(msg.content)}
                        className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-white transition"
                        title="Copy to clipboard"
                      >
                        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        {copied ? "Copied!" : "Copy"}
                      </button>
                      {onInsert && (
                        <button
                          onClick={() => handleInsert(msg.content)}
                          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition"
                          title="Insert into compose box"
                        >
                          <Pencil className="h-3 w-3" />
                          Insert into reply
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {mutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-sm px-3.5 py-3 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                  <span className="text-xs text-slate-400">Crafting world-class response…</span>
                </div>
              </div>
            )}

            {/* Follow-up quick chips after first answer */}
            {!mutation.isPending && history.length >= 2 && (
              <div className="pt-1">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Try another scenario</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_SCENARIOS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => handleQuickScenario(s.label)}
                      disabled={mutation.isPending}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-200 transition disabled:opacity-50"
                    >
                      {s.emoji} {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Input bar ── */}
      <div className="shrink-0 border-t border-violet-100 px-3 py-3 bg-violet-50/40 rounded-b-xl">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={scenarioInput}
            onChange={e => setScenarioInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe the situation… e.g. 'Customer says cleaner missed the bathroom' (Shift+Enter for new line, Enter to send)"
            rows={3}
            className="flex-1 resize-none rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 transition leading-relaxed"
            style={{ minHeight: "72px", maxHeight: "120px" }}
          />
          <button
            onClick={() => handleSubmit()}
            disabled={!scenarioInput.trim() || mutation.isPending}
            className="shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40 transition"
            title="Get world-class response"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 text-right">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
