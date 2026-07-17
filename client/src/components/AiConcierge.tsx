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
} from "lucide-react";
import { trpc } from "@/lib/trpc";

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

type MessageContent =
  | { type: "text"; text: string }
  | { type: "workflow"; workflow: WorkflowCard }
  | { type: "completed"; card: CompletedCard }
  | { type: "clarify"; card: ClarifyCard };

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

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  agentPhotoUrl,
  onPickTeam,
}: {
  msg: Message;
  agentPhotoUrl?: string;
  onPickTeam: (jobId: number, teamName: string) => void;
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
          <MessageBubble key={msg.id} msg={msg} agentPhotoUrl={agentPhotoUrl} onPickTeam={handlePickTeam} />
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
  | { type: "workflow"; summary: string; steps: WorkflowStep[]; expandable?: { label: string; content: string } };

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

  // workflow
  return {
    id: uid(),
    role: "ai",
    content: { type: "workflow", workflow: { summary: result.summary, steps: result.steps, expandable: result.expandable } },
    ts,
  };
}
