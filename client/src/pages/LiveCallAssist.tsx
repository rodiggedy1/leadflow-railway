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
    intro: "What's most important to you in a cleaning service?",
    introLabel: "Situation Question",
    introNote: "Their answer tells you exactly what to lead with in Value. Reliability? Same team. Price? Value for money. Trust? Background-checked pros. Listen and advance.",
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
    intro: "",
    introLabel: "Mirror Back",
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
    intro: "",
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

      {/* Rebuttal is handled by AI — no pre-written card shown */}
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
  // Intro is shown until the agent submits their first customer line for this stage
  const [introVisible, setIntroVisible] = useState(true);
  const stage = STAGES.find((s) => s.id === activeStage)!;

  // Use the stage's static intro text (Recap and Close auto-fire AI on entry, so their intro is just a brief instruction)
  const dynamicIntro = stage.intro;

  // Reset intro visibility when stage changes
  useEffect(() => {
    setIntroVisible(true);
  }, [activeStage]);

  const handleSubmit = () => {
    if (!lastCustomerLine.trim()) return;
    setIntroVisible(false); // hide intro permanently for this stage once first response is submitted
    onGetSuggestion();
  };

  const handleCustomerLineKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Compact stage label bar */}
      <div className={`px-4 py-2 border-b ${stage.borderColor} ${stage.bgColor} flex items-center gap-2 shrink-0`}>
        <span className="text-sm font-bold" style={{ color: stage.color }}>{stage.emoji} {stage.label}</span>
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" style={{ color: stage.color }} />}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">

        {/* ── Intro script — shown until first customer response is submitted ── */}
        {introVisible && dynamicIntro && (
          <div className={`px-5 py-4 border-b ${stage.borderColor} ${stage.bgColor}`}>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: stage.color }}>
              {stage.introLabel} — say this to open
            </p>
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm font-medium text-gray-800 leading-relaxed italic">
                "{dynamicIntro}"
              </p>
              <CopyBtn text={dynamicIntro} />
            </div>
          </div>
        )}

        {/* ── Objection sub-types (only on objection stage) ── */}
        {activeStage === "objection" && (
          <ObjectionSubTypes
            activeType={objectionType}
            onSelect={onObjectionTypeChange}
          />
        )}

        {/* ── AI suggestion — fills the space once loaded ── */}
        <div className="flex-1 px-5 py-5">
          {!suggestion && !isLoading && (
            <p className="text-sm text-gray-400 text-center mt-6">
              {introVisible
                ? "Say the opening line, then type what the customer says below."
                : "Type what the customer says and press Enter."}
            </p>
          )}

          {isLoading && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: stage.color }} />
              <span className="text-sm text-gray-500">Getting your next line...</span>
            </div>
          )}

          {suggestion && !isLoading && (
            <div className={`rounded-2xl border-2 p-5 ${stage.borderColor} ${stage.bgColor}`}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Say This</span>
                <div className="flex-1 h-px bg-gray-200" />
                <CopyBtn text={suggestion.suggestion} />
              </div>
              <p className="text-base font-semibold text-gray-900 leading-relaxed">
                {suggestion.suggestion}
              </p>
            </div>
          )}
        </div>

        {/* ── Customer input — pinned at the bottom ── */}
        <div className="px-5 pt-4 pb-6 border-t border-gray-100 bg-gray-50 shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">What did they say?</p>
          <div className="flex gap-2 items-end">
            <textarea
              value={lastCustomerLine}
              onChange={(e) => onLastCustomerLineChange(e.target.value)}
              onKeyDown={handleCustomerLineKeyDown}
              placeholder="Type their response, then press Enter..."
              rows={3}
              className="flex-1 text-sm rounded-xl border border-gray-200 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400 bg-white leading-relaxed"
            />
            <button
              onClick={handleSubmit}
              disabled={isLoading || !lastCustomerLine.trim()}
              title="Get AI suggestion (Enter)"
              className="p-3 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors mb-0.5"
            >
              {isLoading
                ? <Loader2 className="w-5 h-5 animate-spin" />
                : <SendHorizonal className="w-5 h-5" />
              }
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Enter to get next line · Shift+Enter for newline</p>
        </div>
      </div>
    </div>
  );
}

// ─── Pricing engine (mirrors server/openphone.ts estimatePrice) ───────────────

const BEDROOM_OPTIONS = [
  "Studio", "1 Bedroom", "2 Bedrooms", "3 Bedrooms",
  "4 Bedrooms", "5 Bedrooms", "6 Bedrooms", "7 Bedrooms", "7+ Bedrooms",
];

const BATHROOM_OPTIONS = [
  "1 Bathroom", "1.5 Bathrooms", "2 Bathrooms", "2.5 Bathrooms",
  "3 Bathrooms", "3.5 Bathrooms", "4 Bathrooms", "4+ Bathrooms",
];

const SERVICE_OPTIONS = [
  "Standard Cleaning", "Deep Cleaning", "Move-In / Move-Out Cleaning",
  "Post-Construction Cleaning", "Office Cleaning",
];

function estimatePrice(bedrooms: string, bathrooms: string, serviceType: string): string {
  if (!bedrooms || !bathrooms || !serviceType) return "";

  if (serviceType === "Office Cleaning") {
    const officePricing: Record<string, number> = {
      "Under 500 sq ft": 75, "500\u20131,000 sq ft": 120, "1,000\u20132,000 sq ft": 175,
      "2,000\u20133,000 sq ft": 250, "3,000\u20135,000 sq ft": 375,
      "5,000\u201310,000 sq ft": 650, "10,000+ sq ft": 999,
    };
    const p = officePricing[bedrooms];
    return p ? p.toString() : "custom";
  }

  const bedroomBase: Record<string, number> = {
    "Studio": 119, "1 Bedroom": 119, "2 Bedrooms": 209, "3 Bedrooms": 229,
    "4 Bedrooms": 279, "5 Bedrooms": 319, "6 Bedrooms": 379,
    "7 Bedrooms": 419, "7+ Bedrooms": 419,
  };
  const bathroomCount: Record<string, number> = {
    "1 Bathroom": 1, "1.5 Bathrooms": 1, "2 Bathrooms": 2, "2.5 Bathrooms": 2,
    "3 Bathrooms": 3, "3.5 Bathrooms": 3, "4 Bathrooms": 4, "4+ Bathrooms": 4,
  };
  const serviceSurcharge: Record<string, number> = {
    "Standard Cleaning": 0, "Deep Cleaning": 60,
    "Move-In / Move-Out Cleaning": 60, "Post-Construction Cleaning": 60,
  };

  const base = bedroomBase[bedrooms] ?? 119;
  const baths = bathroomCount[bathrooms] ?? 1;
  const surcharge = serviceSurcharge[serviceType] ?? 0;
  return (base + baths * 30 + surcharge).toString();
}

// ─── Lead context panel (left column top) ────────────────────────────────────

function LeadContextPanel({
  leadName,
  bedrooms,
  bathrooms,
  serviceType,
  quotedPrice,
  onLeadNameChange,
  onBedroomsChange,
  onBathroomsChange,
  onServiceTypeChange,
}: {
  leadName: string;
  bedrooms: string;
  bathrooms: string;
  serviceType: string;
  quotedPrice: string;
  onLeadNameChange: (v: string) => void;
  onBedroomsChange: (v: string) => void;
  onBathroomsChange: (v: string) => void;
  onServiceTypeChange: (v: string) => void;
}) {
  const selectClass = "w-full text-xs rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300 bg-white text-gray-700";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <User className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Quick Context</span>
      </div>
      <div className="space-y-2">
        {/* Customer name */}
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
        {/* Service type */}
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Service Type</label>
          <select value={serviceType} onChange={(e) => onServiceTypeChange(e.target.value)} className={selectClass}>
            <option value="">Select…</option>
            {SERVICE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {/* Bedrooms */}
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Bedrooms</label>
          <select value={bedrooms} onChange={(e) => onBedroomsChange(e.target.value)} className={selectClass}>
            <option value="">Select…</option>
            {BEDROOM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {/* Bathrooms */}
        <div>
          <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">Bathrooms</label>
          <select value={bathrooms} onChange={(e) => onBathroomsChange(e.target.value)} className={selectClass}>
            <option value="">Select…</option>
            {BATHROOM_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        {/* Auto-calculated price */}
        {quotedPrice && (
          <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold text-violet-500 uppercase tracking-wide">Quoted Price</span>
            <span className="text-base font-black text-violet-700">
              {quotedPrice === "custom" ? "Custom Quote" : `$${quotedPrice}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveCallAssist() {
  const [, navigate] = useLocation();

  // Lead context
  const [leadName, setLeadName] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [serviceType, setServiceType] = useState("");
  // Auto-calculated from pricing engine — no manual entry
  const quotedPrice = estimatePrice(bedrooms, bathrooms, serviceType);
  // Human-readable service summary for AI context
  const serviceContext = [bedrooms, bathrooms, serviceType].filter(Boolean).join(", ");

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
      // AI decided this stage is complete — advance immediately
      if (data.advanceStage) {
        setActiveStage((current) => {
          const idx = STAGES.findIndex((s) => s.id === current);
          const next = STAGES[idx + 1];
          if (next) {
            setCompletedStages((prev) => { const s = new Set(prev); s.add(current); return s; });
            setSuggestion(null);
            setLastCustomerLine("");
            return next.id;
          }
          return current;
        });
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
      serviceType: serviceContext.trim() || undefined,
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

  // Clicking a stage switches to it and shows the intro script.
  // Exception: Recap stage auto-fires AI immediately so the agent gets a pre-built mirror-back line
  // generated from the transcript — no static template, no placeholder text.
  const handleStageSelect = useCallback((id: StageId) => {
    setActiveStage(id);
    setSuggestion(null);
    setLastCustomerLine("");
    if (id !== "objection") setObjectionType(null);

    if (id === "recap" || id === "close") {
      // Auto-fire AI for Recap and Close so the agent gets a pre-built line immediately:
      // - Recap: AI builds the mirror-back from the transcript (no placeholder text)
      // - Close: AI builds the price line using quoted price and service type from context
      const recentLines = transcriptLines.slice(-30);
      const transcriptText = recentLines
        .map((l) => `${l.speaker === "agent" ? "AGENT" : "CUSTOMER"}: ${l.text}`)
        .join("\n");
      const instruction = id === "recap"
        ? "Generate the recap mirror-back line from the transcript above. Use the actual details the customer mentioned."
        : "Generate the price quote line. Use the quoted price and service type from context. Give the number confidently and immediately ask morning or afternoon.";
      suggestionMutation.mutate({
        stage: id,
        transcript: transcriptText,
        leadName: leadName.trim() || undefined,
        serviceType: serviceContext.trim() || undefined,
        quotedPrice: quotedPrice.trim() || undefined,
        lastCustomerLine: instruction,
      });
    }
  }, [transcriptLines, leadName, serviceType, quotedPrice, suggestionMutation]);

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
      serviceType: serviceContext.trim() || undefined,
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
    setBedrooms("");
    setBathrooms("");
    setServiceType("");
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
              bedrooms={bedrooms}
              bathrooms={bathrooms}
              serviceType={serviceType}
              quotedPrice={quotedPrice}
              onLeadNameChange={setLeadName}
              onBedroomsChange={setBedrooms}
              onBathroomsChange={setBathrooms}
              onServiceTypeChange={setServiceType}
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
