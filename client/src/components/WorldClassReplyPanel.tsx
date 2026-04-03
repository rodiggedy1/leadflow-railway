import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { X, Loader2, Copy, Check, RotateCcw, Send, Sparkles, Pencil } from "lucide-react";

const QUICK_SCENARIOS = [
  { emoji: "😤", label: "Cleaner missed spots" },
  { emoji: "⏰", label: "Team running late" },
  { emoji: "💔", label: "Unhappy with service" },
  { emoji: "🔑", label: "Entry issue" },
  { emoji: "💸", label: "Wants a refund" },
  { emoji: "📅", label: "Reschedule request" },
  { emoji: "⭐", label: "Happy customer" },
  { emoji: "😰", label: "Damage concern" },
] as const;

type Message = { role: "user" | "assistant"; content: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert?: (text: string) => void;
}

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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [history, mutation.isPending]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  const hasConversation = history.length > 0;

  const handleSubmit = (text?: string) => {
    const scenario = (text ?? scenarioInput).trim();
    if (!scenario || mutation.isPending) return;
    const isFollowUp = hasConversation && !text;
    setHistory([...(isFollowUp ? history : []), { role: "user", content: scenario }]);
    mutation.mutate({ scenario, history: isFollowUp ? history : [] });
    setScenarioInput("");
  };

  const handleQuickScenario = (label: string) => handleSubmit(label);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleInsert = (text: string) => { onInsert?.(text); onClose(); };
  const handleReset = () => { setHistory([]); setScenarioInput(""); mutation.reset(); };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={() => { handleReset(); onClose(); }} />
      <div
        className="fixed z-50 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
        style={{
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(600px, 92vw)",
          maxHeight: "min(560px, 85vh)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-purple-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 leading-tight">World-Class Reply</p>
              <p className="text-[11px] text-slate-500 leading-tight">Disney · Ritz-Carlton · Zappos</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {hasConversation && (
              <button onClick={handleReset} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition" title="Start over">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => { handleReset(); onClose(); }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 transition">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="overflow-y-auto" style={{ flex: "1 1 auto", minHeight: 0 }}>
          {!hasConversation ? (
            <div className="px-4 pt-3 pb-2">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Quick scenarios or describe your own below
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_SCENARIOS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleQuickScenario(s.label)}
                    disabled={mutation.isPending}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-violet-50 hover:border-violet-200 text-left text-sm font-medium text-slate-700 transition disabled:opacity-50"
                  >
                    <span className="text-lg leading-none shrink-0">{s.emoji}</span>
                    <span className="leading-tight">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              {history.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "user" ? (
                    <div className="max-w-[80%] bg-violet-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs font-medium shadow-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-[95%] bg-gradient-to-br from-slate-50 to-indigo-50/40 border border-indigo-100 rounded-2xl rounded-tl-sm px-3.5 py-3 text-xs text-slate-700 leading-relaxed shadow-sm">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                          <Sparkles className="h-2.5 w-2.5" />
                          World-class response
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-indigo-100">
                        <button
                          onClick={() => handleCopy(msg.content)}
                          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-white transition"
                        >
                          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                          {copied ? "Copied!" : "Copy"}
                        </button>
                        {onInsert && (
                          <button
                            onClick={() => handleInsert(msg.content)}
                            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition"
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
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-violet-100 px-3 py-2.5 bg-violet-50/40">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={scenarioInput}
              onChange={e => setScenarioInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
              }}
              placeholder="Describe the situation… (Enter to send, Shift+Enter for new line)"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 transition leading-relaxed"
              style={{ minHeight: "56px", maxHeight: "100px" }}
            />
            <button
              onClick={() => handleSubmit()}
              disabled={!scenarioInput.trim() || mutation.isPending}
              className="shrink-0 flex items-center justify-center h-9 w-9 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40 transition"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
