/**
 * ObjectionsPanel — fixed overlay panel for CS Chat.
 * Uses a fixed backdrop + panel so it escapes all overflow:hidden clipping.
 * Shows 8 preset objection cards + a manual input field.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { X, ChevronRight, Loader2, Copy, Check, RotateCcw, Send } from "lucide-react";

// ── preset objections ─────────────────────────────────────────────────────────
const PRESET_OBJECTIONS = [
  { id: "date",       label: "Not sure about date",     emoji: "📅", color: "bg-sky-50 border-sky-200 text-sky-800" },
  { id: "price",      label: "Price is too high",       emoji: "💰", color: "bg-amber-50 border-amber-200 text-amber-800" },
  { id: "shopping",   label: "Shopping around",         emoji: "🔍", color: "bg-violet-50 border-violet-200 text-violet-800" },
  { id: "trust",      label: "Don't know you / trust",  emoji: "🤝", color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  { id: "questions",  label: "More questions first",    emoji: "❓", color: "bg-blue-50 border-blue-200 text-blue-800" },
  { id: "bad",        label: "Had a bad experience",    emoji: "😟", color: "bg-rose-50 border-rose-200 text-rose-800" },
  { id: "access",     label: "Won't be home / access",  emoji: "🔑", color: "bg-teal-50 border-teal-200 text-teal-800" },
  { id: "timing",     label: "Not the right time",      emoji: "⏳", color: "bg-orange-50 border-orange-200 text-orange-800" },
] as const;

type Message = { role: "user" | "assistant"; content: string };

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ObjectionsPanel({ open, onClose }: Props) {
  const [customInput, setCustomInput] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const [activeObjection, setActiveObjection] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const mutation = trpc.opsChat.objectionReply.useMutation({
    onSuccess: (data) => {
      setHistory(prev => [...prev, { role: "assistant" as const, content: String(data.script) }]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, mutation.isPending]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleObjection = (text: string) => {
    if (mutation.isPending) return;
    setActiveObjection(text);
    setHistory(prev => [...prev, { role: "user", content: text }]);
    mutation.mutate({ objection: text, history });
  };

  const handleCustomSubmit = () => {
    const text = customInput.trim();
    if (!text || mutation.isPending) return;
    setCustomInput("");
    handleObjection(text);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReset = () => {
    setHistory([]);
    setActiveObjection(null);
    setCustomInput("");
    mutation.reset();
  };

  const hasConversation = history.length > 0;

  return (
    <>
      {/* Backdrop — clicking outside closes the panel */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel — fixed, centered horizontally, anchored to bottom of viewport */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col bg-white rounded-2xl border border-slate-200 shadow-2xl"
        style={{ width: "min(680px, calc(100vw - 2rem))", maxHeight: "520px" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-orange-50 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-base">🛡️</div>
            <div>
              <p className="text-sm font-bold text-slate-800 leading-tight">Objection Handler</p>
              <p className="text-[11px] text-slate-500 leading-tight">AI-powered rebuttal scripts</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {hasConversation && (
              <button
                onClick={handleReset}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
                title="Start over"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
          {!hasConversation ? (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5">
                Select an objection or type your own below
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_OBJECTIONS.map((obj) => (
                  <button
                    key={obj.id}
                    onClick={() => handleObjection(obj.label)}
                    disabled={mutation.isPending}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-xs font-semibold transition hover:shadow-sm active:scale-95 disabled:opacity-50 ${obj.color}`}
                  >
                    <span className="text-base leading-none shrink-0">{obj.emoji}</span>
                    <span className="leading-tight">{obj.label}</span>
                    <ChevronRight className="h-3 w-3 ml-auto shrink-0 opacity-50" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "user" ? (
                    <div className="max-w-[80%] bg-rose-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2 text-xs font-medium shadow-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-[92%] bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-sm px-3.5 py-3 text-xs text-slate-700 leading-relaxed shadow-sm relative group">
                      <div className="whitespace-pre-wrap pr-6">{msg.content}</div>
                      <button
                        onClick={() => handleCopy(msg.content)}
                        className="absolute top-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition bg-white border border-slate-200 text-slate-400 hover:text-slate-600"
                        title="Copy script"
                      >
                        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {mutation.isPending && (
                <div className="flex justify-start">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-tl-sm px-3.5 py-3 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                    <span className="text-xs text-slate-400">Crafting rebuttal…</span>
                  </div>
                </div>
              )}

              {!mutation.isPending && history.length >= 2 && (
                <div className="pt-1">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Try another objection</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_OBJECTIONS.filter(o => o.label !== activeObjection).slice(0, 4).map(obj => (
                      <button
                        key={obj.id}
                        onClick={() => handleObjection(obj.label)}
                        disabled={mutation.isPending}
                        className="text-[11px] font-medium px-2.5 py-1 rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
                      >
                        {obj.emoji} {obj.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-slate-100 px-3 py-2.5 bg-white rounded-b-2xl">
          <div className="flex items-end gap-2">
            <textarea
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleCustomSubmit();
                }
              }}
              placeholder="Type a custom objection… (Enter to send)"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-300 focus:border-rose-300 transition"
              style={{ minHeight: "36px", maxHeight: "80px" }}
            />
            <button
              onClick={handleCustomSubmit}
              disabled={!customInput.trim() || mutation.isPending}
              className="shrink-0 w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center hover:bg-rose-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1 text-center">
            Based on Maids in Black objection playbook · Follow-up questions supported
          </p>
        </div>
      </div>
    </>
  );
}
