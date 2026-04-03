/**
 * FAQPanel — slide-up drawer for agent FAQ queries.
 *
 * Rendering strategy:
 *  - Uses `display:none` / conditional render instead of `translate-y-full`
 *    to avoid being clipped by ancestor `overflow-hidden` containers.
 *  - When open=false the panel is simply not rendered (no DOM presence).
 *  - Fade+scale animation via CSS opacity/transform on mount.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  X,
  Send,
  Loader2,
  BookOpen,
  RotateCcw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
};

interface FAQPanelProps {
  open: boolean;
  onClose: () => void;
  context?: string;
}

export default function FAQPanel({ open, onClose, context }: FAQPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [visible, setVisible] = useState(false); // drives CSS animation
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Animate in/out: when open changes, trigger a one-frame delay for CSS transition
  useEffect(() => {
    if (open) {
      // Mount first, then flip visible on next frame so transition fires
      requestAnimationFrame(() => setVisible(true));
      setTimeout(() => textareaRef.current?.focus(), 120);
    } else {
      setVisible(false);
    }
  }, [open]);

  // Scroll latest message into view
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const faqAsk = trpc.opsChat.faqAsk.useMutation({
    onSuccess: (data) => {
      const answer = typeof data.answer === "string" ? data.answer : String(data.answer);
      setMessages((prev): Message[] => [...prev, { role: "assistant", content: answer }]);
    },
    onError: (err) => {
      setMessages((prev): Message[] => [
        ...prev,
        { role: "assistant", content: `Sorry, I couldn't get an answer right now. ${err.message}` },
      ]);
    },
  });

  const handleSend = useCallback(() => {
    const question = input.trim();
    if (!question || faqAsk.isPending) return;
    const history = messages;
    setMessages((prev): Message[] => [...prev, { role: "user", content: question }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    faqAsk.mutate({ question, history });
  }, [input, messages, faqAsk]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // Don't render anything when closed — avoids overflow-hidden clipping issues
  if (!open) return null;

  const isEmpty = messages.length === 0 && !faqAsk.isPending;

  return (
    <>
      {/* Backdrop — stops clicks on the chat behind it */}
      <div
        className="absolute inset-0 z-30 bg-black/10 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel — absolutely positioned at the bottom, flex column */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl",
          "shadow-[0_-8px_40px_rgba(15,23,42,0.16)] border-t border-slate-200",
          "flex flex-col",
          "transition-all duration-200 ease-out",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}
        style={{ maxHeight: "60vh" }}
        // Prevent backdrop click from bubbling through the panel itself
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 leading-none">FAQ Assistant</p>
              {context && (
                <p className="text-[10px] text-slate-400 mt-0.5 leading-none">{context}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition px-2 py-1 rounded-md hover:bg-slate-100"
                title="Clear conversation"
              >
                <RotateCcw className="h-3 w-3" />
                Clear
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              title="Close FAQ"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Scrollable messages ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
          {isEmpty ? (
            <div className="py-4 text-center">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto mb-3">
                <BookOpen className="h-5 w-5 text-emerald-500" />
              </div>
              <p className="text-sm font-medium text-slate-700 mb-1">
                Ask anything about Maids in Black
              </p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                Pricing, services, policies, scheduling — instant answers from the knowledge base.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                {[
                  "What's included in a deep clean?",
                  "Do you offer same-day service?",
                  "What's the cancellation policy?",
                  "How is pricing calculated?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => {
                      setInput(q);
                      setTimeout(() => textareaRef.current?.focus(), 50);
                    }}
                    className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 hover:bg-emerald-100 transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                {msg.role === "assistant" && (
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center mr-2.5 mt-0.5 shrink-0">
                    <BookOpen className="h-3 w-3 text-emerald-600" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-slate-900 text-white rounded-br-sm"
                      : "bg-slate-50 border border-slate-200 text-slate-800 rounded-bl-sm"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-slate max-w-none [&>p]:mb-2 [&>p:last-child]:mb-0 [&>ul]:mb-2 [&>ol]:mb-2">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <span>{msg.content}</span>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Typing indicator */}
          {faqAsk.isPending && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center mr-2.5 mt-0.5 shrink-0">
                <BookOpen className="h-3 w-3 text-emerald-600" />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input (pinned at bottom) ── */}
        <div className="px-5 pb-4 pt-3 border-t border-slate-100 shrink-0">
          <div className="flex items-end gap-2.5">
            <div className="flex-1">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question… (Enter to send)"
                rows={1}
                className="resize-none rounded-xl border-slate-200 bg-slate-50 focus:bg-white text-sm py-2.5 min-h-[40px] max-h-[120px] transition-colors focus-visible:ring-1 focus-visible:ring-emerald-400 focus-visible:border-emerald-400"
                style={{ height: "40px" }}
                disabled={faqAsk.isPending}
              />
            </div>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!input.trim() || faqAsk.isPending}
              className="h-10 w-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 p-0 shadow-sm disabled:opacity-40"
            >
              {faqAsk.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5 text-center">
            Based on Maids in Black knowledge base · Follow-up questions supported
          </p>
        </div>
      </div>
    </>
  );
}
