/**
 * Live Call Assist — Full-page real-time call coaching tool.
 *
 * Layout: 3-column
 *   Left:   Quick Context (lead info) + Stage tracker
 *   Center: Customer line (top, Enter to submit) → AI suggestion card
 *   Right:  Live transcript input
 *
 * UX principles:
 * - Clicking a stage immediately fires AI — no second "Get Suggestion" click
 * - Customer's last line is pinned at the top of the center column with Enter-to-submit
 * - Each stage has a built-in intro/opening script shown before any AI response
 * - Recap micro-stage between Value and Close
 * - Objection stage has quick-tap sub-types (Price, Timing, Trust, Already have someone)
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  Phone,
  Loader2,
  Copy,
  Check,
  ChevronRight,
  Zap,
  CheckCircle2,
  ArrowLeft,
  User,
  Mic,
  MessageSquare,
  Lightbulb,
  Target,
  Shield,
  TrendingUp,
  Star,
  RotateCcw,
  ChevronDown,
  RefreshCw,
  ClipboardList,
  DollarSign,
  Clock,
  UserCheck,
  Users,
  SendHorizonal,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ─── Stage definitions ────────────────────────────────────────────────────────

const STAGES = [
  {
    id: "opener",
    label: "Warm Welcome",
    shortLabel: "Opener",
    emoji: "⚡",
    icon: Zap,
    color: "#7c3aed",
    bgColor: "bg-violet-50",
    borderColor: "border-violet-200",
    textColor: "text-violet-700",
    goal: "Warm welcome, confirm interest, and set a friendly tone before asking any questions",
    intro: "Hi, thanks so much for calling Maids in Black! My name is [Your Name] — I'm so glad you reached out. Are you looking to get a cleaning scheduled, or did you have some questions first?",
    introLabel: "Opening Line",
    introNote: "They called YOU — they're already interested. Start warm, confirm what they need, and let them feel heard right away.",
  },
  {
    id: "discovery",
    label: "Discovery & Needs Assessment",
    shortLabel: "Discovery",
    emoji: "🔍",
    icon: Target,
    color: "#0891b2",
    bgColor: "bg-cyan-50",
    borderColor: "border-cyan-200",
    textColor: "text-cyan-700",
    goal: "Understand their home, their situation, and what's driving them to book right now",
    intro: "Awesome! To make sure I get you the right quote, can you tell me a little about your home? Like how many bedrooms and bathrooms — and is this a regular clean or more of a deep clean?",
    introLabel: "Discovery Opener",
    introNote: "They're ready to book — your job is to gather info efficiently while making them feel taken care of, not interrogated.",
  },
  {
    id: "pain",
    label: "Situation & History",
    shortLabel: "Situation",
    emoji: "💡",
    icon: Lightbulb,
    color: "#d97706",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-700",
    goal: "Understand what's been frustrating them and why they're calling now instead of later",
    intro: "Got it! And is this your first time using a cleaning service, or have you had cleaners before? I just want to make sure we get it right for you.",
    introLabel: "Situation Question",
    introNote: "If they've had bad experiences before, this is where you learn them. If they're new, it's a chance to set great expectations. Either way, it builds trust.",
  },
  {
    id: "value",
    label: "Value Anchoring",
    shortLabel: "Value",
    emoji: "💎",
    icon: Star,
    color: "#059669",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    textColor: "text-emerald-700",
    goal: "Highlight what makes Maids in Black worth it before presenting the price",
    intro: "So here's what I love about our service — we send the same team every time so you're not letting strangers in your home each visit. They're background-checked, trained, and they bring everything. Most of our clients say the biggest thing they get back is their weekends.",
    introLabel: "Value Bridge",
    introNote: "Say this before you give the price. You're not selling cleaning — you're selling time, trust, and consistency. Make the number feel like a bargain.",
  },
  {
    id: "recap",
    label: "Recap Before Close",
    shortLabel: "Recap",
    emoji: "📝",
    icon: ClipboardList,
    color: "#7e22ce",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    textColor: "text-purple-700",
    goal: "Mirror back what they told you so they feel heard — then present the price",
    intro: "So just to make sure I have this right — you've got a [X bed / X bath], you're looking for a [regular / deep] clean, and [any situation detail they shared]. Does that sound right?",
    introLabel: "Mirror & Confirm",
    introNote: "Repeat their own words back to them. This builds trust, confirms accuracy, and creates a natural pause before the price — making the number land better.",
  },
  {
    id: "close",
    label: "Quote & Close",
    shortLabel: "Close",
    emoji: "📋",
    icon: TrendingUp,
    color: "#dc2626",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    textColor: "text-red-700",
    goal: "Give the price confidently and immediately pivot to scheduling — assume they're booking",
    intro: "Based on what you've told me, I'd put you at [price] for [service]. That includes everything — supplies, equipment, the works. We have openings this week — do you prefer mornings or afternoons?",
    introLabel: "Quote & Close",
    introNote: "Give the number once, confidently, then immediately move to scheduling. Don't pause and wait — the silence after a price is where deals die. Keep moving.",
  },
  {
    id: "objection",
    label: "Objection Handler",
    shortLabel: "Objection",
    emoji: "🛡️",
    icon: Shield,
    color: "#6b7280",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
    textColor: "text-gray-700",
    goal: "Acknowledge their concern, keep the tone warm, and find a path forward",
    intro: "That's totally fair — I hear that a lot actually. Can I ask what's making you hesitate? I want to make sure I'm giving you the right information, not just pushing you to book.",
    introLabel: "Objection Opener",
    introNote: "They called you — they want to book. An objection is usually a question in disguise. Stay warm, don't get defensive, and ask what's really behind it.",
  },
] as const;

type StageId = typeof STAGES[number]["id"];

// ─── Objection sub-types ──────────────────────────────────────────────────────

const OBJECTION_TYPES = [
  {
    id: "price",
    label: "Too Expensive",
    icon: DollarSign,
    color: "#dc2626",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    textColor: "text-red-700",
    rebuttal: "I completely understand — price is always a factor. Can I ask what you're currently paying, or what you were expecting? I want to make sure we're comparing apples to apples, because a lot of our clients found they were actually paying more with other services once they factored in supplies and reliability.",
    rebuttalnote: "Don't discount immediately. Understand their anchor first. Then reframe value.",
  },
  {
    id: "timing",
    label: "Not Ready Yet",
    icon: Clock,
    color: "#d97706",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-700",
    rebuttal: "That's totally fine — I'm not trying to rush you. Can I ask what would need to happen for it to feel like the right time? Sometimes locking in a date a few weeks out actually takes the pressure off.",
    rebuttalnote: "Don't push. Ask what 'ready' looks like. Offer a future booking to remove urgency.",
  },
  {
    id: "trust",
    label: "Not Sure About You",
    icon: UserCheck,
    color: "#0891b2",
    bgColor: "bg-cyan-50",
    borderColor: "border-cyan-200",
    textColor: "text-cyan-700",
    rebuttal: "That's a fair concern — you're letting people into your home. All our cleaners are background-checked and we've been serving [area] for [X years]. Would it help if I sent you some reviews from clients in your neighborhood?",
    rebuttalnote: "Validate the concern — it's legitimate. Then offer social proof specific to their area.",
  },
  {
    id: "competitor",
    label: "Already Have Someone",
    icon: Users,
    color: "#059669",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    textColor: "text-emerald-700",
    rebuttal: "Oh that's great — it sounds like you already value having a clean home. Can I ask what you like about your current service? I'm not trying to poach you, but if there's something they're not delivering, I'd love to show you what we do differently.",
    rebuttalnote: "Don't trash the competitor. Ask what they like — then find the gap. Most people call because something isn't working.",
  },
] as const;

type ObjectionTypeId = typeof OBJECTION_TYPES[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptLine {
  id: number;
  speaker: "agent" | "customer";
  text: string;
  ts: number;
}

interface AISuggestion {
  suggestion: string;
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text, size = "sm" }: { text: string; size?: "sm" | "xs" }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className={`shrink-0 rounded transition-colors text-gray-400 hover:text-gray-600 hover:bg-gray-100 ${size === "xs" ? "p-0.5" : "p-1"}`}
      title="Copy to clipboard"
    >
      {copied
        ? <Check className={size === "xs" ? "w-3 h-3 text-green-500" : "w-3.5 h-3.5 text-green-500"} />
        : <Copy className={size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      }
    </button>
  );
}



// ─── Stage tracker (left column) ─────────────────────────────────────────────

function StageTracker({
  activeStage,
  completedStages,
  onSelect,
}: {
  activeStage: StageId;
  completedStages: Set<StageId>;
  onSelect: (id: StageId) => void;
}) {
  return (
    <div className="space-y-1">
      {STAGES.map((stage, idx) => {
        const isActive = activeStage === stage.id;
        const isDone = completedStages.has(stage.id);
        return (
          <button
            key={stage.id}
            onClick={() => onSelect(stage.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all ${
              isActive
                ? `${stage.bgColor} ${stage.borderColor} border shadow-sm`
                : isDone
                ? "bg-green-50 border border-green-200 opacity-70"
                : "hover:bg-gray-50 border border-transparent"
            }`}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold"
              style={{ background: isDone ? "#16a34a" : isActive ? stage.color : "#d1d5db" }}
            >
              {isDone ? "✓" : idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-semibold truncate ${isActive ? stage.textColor : isDone ? "text-green-700" : "text-gray-500"}`}>
                {stage.shortLabel}
              </div>
            </div>
            {isActive && <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${stage.textColor}`} />}
          </button>
        );
      })}
    </div>
  );
}

// ─── Transcript area (right column) ──────────────────────────────────────────

function TranscriptPanel({
  lines,
  onAddLine,
  onClear,
  lastCustomerLine,
  onLastCustomerLineChange,
  focusRef,
}: {
  lines: TranscriptLine[];
  onAddLine: (speaker: "agent" | "customer", text: string) => void;
  onClear: () => void;
  lastCustomerLine: string;
  onLastCustomerLineChange: (v: string) => void;
  focusRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [inputText, setInputText] = useState("");
  const [activeSpeaker, setActiveSpeaker] = useState<"customer" | "agent">("customer");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Expose a focus function to the parent via focusRef
  useEffect(() => {
    if (focusRef) {
      focusRef.current = () => {
        setActiveSpeaker("customer");
        inputRef.current?.focus();
      };
    }
  }, [focusRef]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleSubmit = () => {
    const text = inputText.trim();
    if (!text) return;
    onAddLine(activeSpeaker, text);
    if (activeSpeaker === "customer") {
      onLastCustomerLineChange(text);
    }
    setInputText("");
    setActiveSpeaker(activeSpeaker === "customer" ? "agent" : "customer");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">Live Transcript</span>
          {lines.length > 0 && (
            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
              {lines.length} lines
            </span>
          )}
        </div>
        {lines.length > 0 && (
          <button
            onClick={onClear}
            className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Transcript lines */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <MessageSquare className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm text-gray-400 font-medium">No transcript yet</p>
            <p className="text-xs text-gray-400 mt-1">Type what the customer says below</p>
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={`flex gap-2 ${line.speaker === "agent" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5 ${
                  line.speaker === "agent" ? "bg-violet-500" : "bg-gray-400"
                }`}
              >
                {line.speaker === "agent" ? "A" : "C"}
              </div>
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  line.speaker === "agent"
                    ? "bg-violet-50 text-violet-900 rounded-tr-sm"
                    : "bg-gray-100 text-gray-800 rounded-tl-sm"
                }`}
              >
                {line.text}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-gray-100 px-3 py-3 space-y-2">
        {/* Speaker toggle */}
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveSpeaker("customer")}
            className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-colors ${
              activeSpeaker === "customer"
                ? "bg-gray-800 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            Customer
          </button>
          <button
            onClick={() => setActiveSpeaker("agent")}
            className={`flex-1 py-1 rounded-lg text-[11px] font-bold transition-colors ${
              activeSpeaker === "agent"
                ? "bg-violet-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            Agent
          </button>
        </div>
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeSpeaker === "customer"
                ? "Type what the customer said..."
                : "Type what you said..."
            }
            rows={2}
            className="flex-1 text-xs rounded-xl border border-gray-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400"
          />
          <button
            onClick={handleSubmit}
            disabled={!inputText.trim()}
            className="self-end px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-40 transition-colors"
          >
            Add
          </button>
        </div>
        <p className="text-[10px] text-gray-400">Enter to add · Shift+Enter for newline</p>
      </div>
    </div>
  );
}

// ─── Objection sub-type panel ─────────────────────────────────────────────────

function ObjectionSubTypes({
  activeType,
  onSelect,
}: {
  activeType: ObjectionTypeId | null;
  onSelect: (id: ObjectionTypeId) => void;
}) {
  const active = OBJECTION_TYPES.find((t) => t.id === activeType);

  return (
    <div className="px-4 py-3 border-b border-gray-100 space-y-2">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">What's the objection?</div>
      <div className="grid grid-cols-2 gap-1.5">
        {OBJECTION_TYPES.map((type) => {
          const Icon = type.icon;
          const isSelected = activeType === type.id;
          return (
            <button
              key={type.id}
              onClick={() => onSelect(type.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                isSelected
                  ? `${type.bgColor} ${type.borderColor} shadow-sm`
                  : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? type.textColor : "text-gray-400"}`} />
              <span className={`text-[11px] font-semibold ${isSelected ? type.textColor : "text-gray-600"}`}>
                {type.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Show the rebuttal for the selected type */}
      {active && (
        <div className={`rounded-xl border p-3 space-y-2 mt-1 ${active.bgColor} ${active.borderColor}`}>
          <div className="flex items-start gap-2">
            <p className="flex-1 text-xs font-medium text-gray-800 leading-relaxed italic">
              "{active.rebuttal}"
            </p>
            <CopyBtn text={active.rebuttal} size="xs" />
          </div>
          <p className="text-[10px] text-gray-500 border-l-2 pl-2" style={{ borderColor: active.color }}>
            {active.rebuttalnote}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Center column: Customer line banner + AI suggestion ──────────────────────

function CenterColumn({
  suggestion,
  isLoading,
  activeStage,
  onGetSuggestion,
  lastCustomerLine,
  onLastCustomerLineChange,
  objectionType,
  onObjectionTypeChange,
  onUseSuggestion,
}: {
  suggestion: AISuggestion | null;
  isLoading: boolean;
  activeStage: StageId;
  onGetSuggestion: () => void;
  lastCustomerLine: string;
  onLastCustomerLineChange: (v: string) => void;
  objectionType: ObjectionTypeId | null;
  onObjectionTypeChange: (id: ObjectionTypeId) => void;
  onUseSuggestion: (text: string) => void;
}) {
  const [introExpanded, setIntroExpanded] = useState(true);
  const stage = STAGES.find((s) => s.id === activeStage)!;

  // Collapse intro once a suggestion loads
  useEffect(() => {
    if (suggestion) setIntroExpanded(false);
  }, [suggestion]);

  // Re-expand intro when stage changes and no suggestion yet
  useEffect(() => {
    if (!suggestion) setIntroExpanded(true);
  }, [activeStage]);

  const handleCustomerLineKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (lastCustomerLine.trim()) {
        onGetSuggestion();
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Stage header */}
      <div className={`px-4 py-3 border-b ${stage.borderColor} ${stage.bgColor} flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm shrink-0"
            style={{ background: stage.color }}
          >
            {stage.emoji}
          </div>
          <div>
            <div className={`text-sm font-bold ${stage.textColor}`}>{stage.label}</div>
            <div className="text-[10px] text-gray-500">{stage.goal}</div>
          </div>
        </div>
        <button
          onClick={onGetSuggestion}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors shrink-0 ${
            isLoading
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "text-white hover:opacity-90"
          }`}
          style={isLoading ? {} : { background: stage.color }}
        >
          {isLoading ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Thinking...</>
          ) : (
            <><RefreshCw className="w-3 h-3" /> {suggestion ? "Refresh" : "Get Suggestion"}</>
          )}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ── Intro / opening script ── always shown, collapsible after suggestion loads */}
        <div className={`border-b ${stage.borderColor}`}>
          <button
            onClick={() => setIntroExpanded((v) => !v)}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${stage.bgColor} hover:opacity-90`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: stage.color }}>
                {stage.introLabel}
              </span>
              <span className="text-[10px] text-gray-400">— say this first</span>
            </div>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform shrink-0 ${introExpanded ? "rotate-180" : ""}`}
              style={{ color: stage.color }}
            />
          </button>
          {introExpanded && (
            <div className={`px-4 pb-3 ${stage.bgColor}`}>
              <div className="flex items-start gap-2">
                <p className="flex-1 text-sm font-medium text-gray-800 leading-relaxed italic">
                  "{stage.intro}"
                </p>
                <CopyBtn text={stage.intro} />
              </div>
              <p className="text-[11px] text-gray-500 mt-2 border-l-2 pl-2" style={{ borderColor: stage.color }}>
                {stage.introNote}
              </p>
            </div>
          )}
        </div>

        {/* ── Objection sub-types (only on objection stage) ── */}
        {activeStage === "objection" && (
          <ObjectionSubTypes
            activeType={objectionType}
            onSelect={onObjectionTypeChange}
          />
        )}

        {/* ── Customer's last line ── */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-4 h-4 rounded-full bg-gray-400 flex items-center justify-center text-[9px] font-bold text-white shrink-0">C</div>
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Customer just said</span>
          </div>
          <div className="flex gap-2">
            <textarea
              value={lastCustomerLine}
              onChange={(e) => onLastCustomerLineChange(e.target.value)}
              onKeyDown={handleCustomerLineKeyDown}
              placeholder="Type what the customer just said, then press Enter or click →"
              rows={2}
              className="flex-1 text-sm rounded-xl border border-gray-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400 bg-white"
            />
            <button
              onClick={onGetSuggestion}
              disabled={isLoading || !lastCustomerLine.trim()}
              title="Get AI suggestion (Enter)"
              className="self-end p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              {isLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <SendHorizonal className="w-4 h-4" />
              }
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Press Enter to get AI suggestion · Shift+Enter for newline</p>
        </div>

        {/* ── AI suggestion area ── */}
        <div className="px-4 py-4 space-y-4">
          {!suggestion && !isLoading && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 text-2xl"
                style={{ background: `${stage.color}15` }}
              >
                {stage.emoji}
              </div>
              <p className="text-sm text-gray-500">
                {lastCustomerLine.trim()
                  ? "Press Enter or click → to get AI coaching."
                  : "Enter what the customer said above, then press Enter."}
              </p>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-10">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                style={{ background: `${stage.color}20` }}
              >
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: stage.color }} />
              </div>
              <p className="text-sm text-gray-500 font-medium">Analyzing conversation...</p>
              <p className="text-xs text-gray-400 mt-1">Getting the best move for this stage</p>
            </div>
          )}

          {suggestion && !isLoading && (
            <div className={`rounded-2xl border-2 p-5 space-y-4 ${stage.borderColor} ${stage.bgColor}`}>
              {/* Say This label */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Say This</span>
                <div className="flex-1 h-px bg-gray-200" />
                <CopyBtn text={suggestion.suggestion} />
              </div>

              {/* The suggestion — large and easy to read */}
              <p className="text-base font-medium text-gray-800 leading-relaxed">
                {suggestion.suggestion}
              </p>

              {/* I said this button */}
              <button
                onClick={() => onUseSuggestion(suggestion.suggestion)}
                className="w-full py-2 rounded-xl text-xs font-bold text-white transition-colors hover:opacity-90 flex items-center justify-center gap-1.5"
                style={{ background: stage.color }}
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> I said this — what did they say next?
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lead context panel (left column top) ────────────────────────────────────

function LeadContextPanel({
  leadName,
  serviceType,
  quotedPrice,
  onLeadNameChange,
  onServiceTypeChange,
  onQuotedPriceChange,
}: {
  leadName: string;
  serviceType: string;
  quotedPrice: string;
  onLeadNameChange: (v: string) => void;
  onServiceTypeChange: (v: string) => void;
  onQuotedPriceChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <User className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Quick Context</span>
      </div>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Customer Name</label>
          <input
            type="text"
            value={leadName}
            onChange={(e) => onLeadNameChange(e.target.value)}
            placeholder="e.g. Sarah"
            className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Service Type</label>
          <input
            type="text"
            value={serviceType}
            onChange={(e) => onServiceTypeChange(e.target.value)}
            placeholder="e.g. Deep clean, 3bd/2ba"
            className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Quoted Price</label>
          <input
            type="text"
            value={quotedPrice}
            onChange={(e) => onQuotedPriceChange(e.target.value)}
            placeholder="e.g. 180"
            className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveCallAssist() {
  const [, navigate] = useLocation();

  // Lead context
  const [leadName, setLeadName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [quotedPrice, setQuotedPrice] = useState("");

  // Stage tracking
  const [activeStage, setActiveStage] = useState<StageId>("opener");
  const [completedStages, setCompletedStages] = useState<Set<StageId>>(new Set());

  // Transcript
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const nextId = useRef(1);
  const transcriptFocusRef = useRef<() => void>(null);

  // Customer's last line — lives in main state so center column can read it
  const [lastCustomerLine, setLastCustomerLine] = useState("");

  // Objection sub-type
  const [objectionType, setObjectionType] = useState<ObjectionTypeId | null>(null);

  // AI suggestions
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);

  const suggestionMutation = trpc.leads.getLiveCallSuggestions.useMutation({
    onSuccess: (data) => {
      setSuggestion({ suggestion: data.suggestion });
      if (!data.success) {
        toast.error("AI suggestion failed — showing fallback");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const handleAddLine = useCallback((speaker: "agent" | "customer", text: string) => {
    setTranscriptLines((prev) => [
      ...prev,
      { id: nextId.current++, speaker, text, ts: Date.now() },
    ]);
  }, []);

  const handleClearTranscript = useCallback(() => {
    setTranscriptLines([]);
    setSuggestion(null);
    setLastCustomerLine("");
  }, []);

  const fireSuggestion = useCallback((stageId: StageId, customerLine: string) => {
    const recentLines = transcriptLines.slice(-20);
    const transcriptText = recentLines
      .map((l) => `${l.speaker === "agent" ? "AGENT" : "CUSTOMER"}: ${l.text}`)
      .join("\n");

    // Build objection context string if on objection stage
    const objType = OBJECTION_TYPES.find((t) => t.id === objectionType);
    const objContext = stageId === "objection" && objType
      ? `Objection type: ${objType.label}`
      : undefined;

    suggestionMutation.mutate({
      stage: stageId,
      transcript: transcriptText,
      leadName: leadName.trim() || undefined,
      serviceType: serviceType.trim() || undefined,
      quotedPrice: quotedPrice.trim() || undefined,
      lastCustomerLine: (customerLine.trim() || lastCustomerLine.trim() || objContext) || undefined,
    });
  }, [transcriptLines, lastCustomerLine, leadName, serviceType, quotedPrice, objectionType, suggestionMutation]);

  const handleGetSuggestion = useCallback(() => {
    // Log the customer line to the transcript before firing AI
    if (lastCustomerLine.trim()) {
      handleAddLine("customer", lastCustomerLine.trim());
    }
    fireSuggestion(activeStage, lastCustomerLine);
  }, [activeStage, lastCustomerLine, fireSuggestion, handleAddLine]);

  // Called when agent clicks "I said this" on a suggestion:
  // 1. Log the agent line to the transcript
  // 2. Clear the customer line input so it's ready for the next response
  // 3. Focus the transcript customer input
  const handleUseSuggestion = useCallback((text: string) => {
    handleAddLine("agent", text);
    setLastCustomerLine("");
    setSuggestion(null);
    // Focus the right-column customer input after a short delay
    setTimeout(() => transcriptFocusRef.current?.(), 50);
  }, [handleAddLine]);

  // Clicking a stage immediately fires AI — no second click required
  const handleStageSelect = useCallback((id: StageId) => {
    setActiveStage(id);
    setSuggestion(null);
    if (id !== "objection") setObjectionType(null);
    fireSuggestion(id, lastCustomerLine);
  }, [lastCustomerLine, fireSuggestion]);

  // When an objection type is selected, immediately fire AI with that context
  const handleObjectionTypeChange = useCallback((id: ObjectionTypeId) => {
    setObjectionType(id);
    const objType = OBJECTION_TYPES.find((t) => t.id === id)!;
    const recentLines = transcriptLines.slice(-20);
    const transcriptText = recentLines
      .map((l) => `${l.speaker === "agent" ? "AGENT" : "CUSTOMER"}: ${l.text}`)
      .join("\n");
    suggestionMutation.mutate({
      stage: "objection",
      transcript: transcriptText,
      leadName: leadName.trim() || undefined,
      serviceType: serviceType.trim() || undefined,
      quotedPrice: quotedPrice.trim() || undefined,
      lastCustomerLine: lastCustomerLine.trim() || `Objection type: ${objType.label}`,
    });
  }, [transcriptLines, lastCustomerLine, leadName, serviceType, quotedPrice, suggestionMutation]);

  const handleMarkComplete = (id: StageId) => {
    setCompletedStages((prev) => { const next = new Set(prev); next.add(id); return next; });
    const idx = STAGES.findIndex((s) => s.id === id);
    const nextStage = STAGES[idx + 1];
    if (nextStage) {
      handleStageSelect(nextStage.id);
    }
  };

  const handleReset = () => {
    setCompletedStages(new Set());
    setActiveStage("opener");
    setTranscriptLines([]);
    setSuggestion(null);
    setLeadName("");
    setServiceType("");
    setQuotedPrice("");
    setLastCustomerLine("");
    setObjectionType(null);
  };

  const progress = Math.round((completedStages.size / STAGES.length) * 100);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate(-1 as any)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="w-px h-5 bg-gray-200" />
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
            <Phone className="w-3.5 h-3.5 text-violet-600" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-800">Live Call Assist</div>
            <div className="text-[10px] text-gray-400">Real-time AI coaching</div>
          </div>
        </div>

        {/* Overall progress */}
        {completedStages.size > 0 && (
          <div className="flex items-center gap-2 ml-4">
            <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{completedStages.size}/{STAGES.length} stages</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => toast.info("Mic listening coming in Phase 2")}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-400 hover:bg-gray-50 transition-colors"
          >
            <Mic className="w-3 h-3" /> Live Mic (Phase 2)
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> New Call
          </button>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 57px)" }}>

        {/* ── Left column: Context + Stage tracker ── */}
        <div className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-y-auto">
          <div className="p-3 space-y-3">
            {/* Lead context */}
            <LeadContextPanel
              leadName={leadName}
              serviceType={serviceType}
              quotedPrice={quotedPrice}
              onLeadNameChange={setLeadName}
              onServiceTypeChange={setServiceType}
              onQuotedPriceChange={setQuotedPrice}
            />

            {/* Stage tracker */}
            <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Call Stages</span>
                {completedStages.size > 0 && (
                  <button
                    onClick={() => { setCompletedStages(new Set()); setActiveStage("opener"); setSuggestion(null); }}
                    className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Reset
                  </button>
                )}
              </div>
              <StageTracker
                activeStage={activeStage}
                completedStages={completedStages}
                onSelect={handleStageSelect}
              />
              {/* Mark current stage done */}
              {!completedStages.has(activeStage) && (
                <button
                  onClick={() => handleMarkComplete(activeStage)}
                  className="w-full py-1.5 rounded-lg text-[11px] font-bold border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 transition-colors flex items-center justify-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" /> Done — Next Stage
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Center column: Customer line + AI Suggestion ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-white border-r border-gray-200">
          <CenterColumn
            suggestion={suggestion}
            isLoading={suggestionMutation.isPending}
            activeStage={activeStage}
            onGetSuggestion={handleGetSuggestion}
            lastCustomerLine={lastCustomerLine}
            onLastCustomerLineChange={setLastCustomerLine}
            objectionType={objectionType}
            onObjectionTypeChange={handleObjectionTypeChange}
            onUseSuggestion={handleUseSuggestion}
          />
        </div>

        {/* ── Right column: Transcript input ── */}
        <div className="w-80 shrink-0 bg-white flex flex-col">
          <TranscriptPanel
            lines={transcriptLines}
            onAddLine={handleAddLine}
            onClear={handleClearTranscript}
            lastCustomerLine={lastCustomerLine}
            onLastCustomerLineChange={setLastCustomerLine}
            focusRef={transcriptFocusRef}
          />
        </div>
      </div>
    </div>
  );
}
