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

type MessageContent =
  | { type: "text"; text: string }
  | { type: "workflow"; workflow: WorkflowCard }
  | { type: "completed"; card: CompletedCard };

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

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  agentPhotoUrl,
}: {
  msg: Message;
  agentPhotoUrl?: string;
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
            onClick={() => { onSelect(cmd.description); onClose(); }}
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

// ─── Demo workflow simulation ─────────────────────────────────────────────────

function simulateEtaWorkflow(
  input: string,
  onUpdate: (msgs: Message[]) => void,
  existingMsgs: Message[]
) {
  const ts = nowTime();
  const workflowId = uid();

  const steps: WorkflowStep[] = [
    { id: "1", label: "Found today's job schedule", status: "running", ts },
    { id: "2", label: "Calculated ETA based on current location", status: "pending" },
    { id: "3", label: "Calling team to confirm ETA", status: "pending" },
    { id: "4", label: "Texting client with ETA update", status: "pending" },
    { id: "5", label: "Waiting for team confirmation", status: "pending" },
  ];

  const aiMsg: Message = {
    id: workflowId,
    role: "ai",
    content: {
      type: "workflow",
      workflow: {
        summary: "I'll get the ETA for the team and send it to the client right away.",
        steps: [...steps],
        expandable: { label: "View job details", content: "Loading..." },
      },
    },
    ts,
  };

  const allMsgs = [...existingMsgs, aiMsg];
  onUpdate(allMsgs);

  // Simulate step progression
  const progressions: Array<{ delay: number; stepIdx: number; status: StepStatus; detail?: string }> = [
    { delay: 900, stepIdx: 0, status: "done" },
    { delay: 1200, stepIdx: 1, status: "running" },
    { delay: 2200, stepIdx: 1, status: "done" },
    { delay: 2500, stepIdx: 2, status: "running" },
    { delay: 4000, stepIdx: 2, status: "done" },
    { delay: 4300, stepIdx: 3, status: "running" },
    { delay: 5500, stepIdx: 3, status: "done" },
    { delay: 5800, stepIdx: 4, status: "running" },
  ];

  progressions.forEach(({ delay, stepIdx, status }) => {
    setTimeout(() => {
      steps[stepIdx].status = status;
      if (status === "running" && stepIdx > 0) {
        // Timestamp the step
        steps[stepIdx].ts = nowTime();
      }
      onUpdate((prev: Message[]) =>
        prev.map((m) =>
          m.id === workflowId
            ? {
                ...m,
                content: {
                  type: "workflow",
                  workflow: {
                    summary: "I'll get the ETA for the team and send it to the client right away.",
                    steps: [...steps],
                    expandable: {
                      label: "View job details",
                      content: "Job: 123 Main St.\nTeam: Team 8\nScheduled: 2:00 PM\nETA sent: 2:15 PM\nClient notified via SMS",
                    },
                  },
                },
              }
            : m
        ) as Message[]
      );
    }, delay);
  });

  // Final completed card
  setTimeout(() => {
    const completedMsg: Message = {
      id: uid(),
      role: "ai",
      content: {
        type: "completed",
        card: {
          message: "Team confirmed ETA. Client has been notified via SMS.",
          ts: nowTime(),
        },
      },
      ts: nowTime(),
    };
    onUpdate((prev: Message[]) => [...prev, completedMsg] as Message[]);
  }, 8000);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AiConcierge({ agentPhotoUrl }: { agentPhotoUrl?: string }) {
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isThinking) return;

    const userMsg: Message = {
      id: uid(),
      role: "user",
      content: { type: "text", text },
      ts: nowTime(),
    };

    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setIsThinking(true);

    // Detect ETA-related intent for demo
    const lower = text.toLowerCase();
    const isEta = lower.includes("eta") || lower.includes("late") || lower.includes("running") || lower.includes("time") || lower.includes("team") || lower.includes("entry");

    setTimeout(() => {
      setIsThinking(false);
      if (isEta) {
        simulateEtaWorkflow(text, setMessages as any, newMsgs);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "ai",
            content: {
              type: "text",
              text: "Got it. I'm working on building that workflow. For now I can run ETA updates, entry info lookups, and team notifications. Try: \"Send ETA update for Team 8 to the 2pm client\"",
            },
            ts: nowTime(),
          },
        ]);
      }
    }, 600);
  }, [input, isThinking, messages]);

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
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-400">Online</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} agentPhotoUrl={agentPhotoUrl} />
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
