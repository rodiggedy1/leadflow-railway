/**
 * Live Call Assist — Full-page real-time call coaching tool.
 *
 * Layout: 3-column
 *   Left:   Quick Context (lead info, stage tracker, live signals)
 *   Center: AI Suggestion card (primary + A/B/C alternatives)
 *   Right:  Transcript input (agent types what customer said)
 *
 * Phase 1: Manual transcript input
 * Phase 2 (future): Mic listening with real-time transcription
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
  AlertCircle,
  CheckCircle2,
  Circle,
  ArrowLeft,
  RefreshCw,
  User,
  Mic,
  MicOff,
  MessageSquare,
  Lightbulb,
  Target,
  Shield,
  TrendingUp,
  Star,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ─── Stage definitions ────────────────────────────────────────────────────────

const STAGES = [
  {
    id: "opener",
    label: "Pattern Interrupt Opener",
    shortLabel: "Opener",
    emoji: "⚡",
    icon: Zap,
    color: "#7c3aed",
    bgColor: "bg-violet-50",
    borderColor: "border-violet-200",
    textColor: "text-violet-700",
    goal: "Create curiosity and stand out from every other cleaning company call",
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
    goal: "Understand their situation deeply — not just beds/baths, but WHY they need cleaning NOW",
  },
  {
    id: "pain",
    label: "Pain Amplification",
    shortLabel: "Pain",
    emoji: "💡",
    icon: Lightbulb,
    color: "#d97706",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-700",
    goal: "Help them feel the cost of NOT solving this — make the problem vivid",
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
    goal: "Build the value stack BEFORE you mention a number",
  },
  {
    id: "close",
    label: "Assumptive Close",
    shortLabel: "Close",
    emoji: "📋",
    icon: TrendingUp,
    color: "#dc2626",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    textColor: "text-red-700",
    goal: "Present price confidently and assume the sale — ask WHEN, not IF",
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
    goal: "Treat objections as requests for more information — empathize then redirect",
  },
] as const;

type StageId = typeof STAGES[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptLine {
  id: number;
  speaker: "agent" | "customer";
  text: string;
  ts: number;
}

interface AISuggestion {
  primarySuggestion: string;
  primaryLabel: string;
  primaryRationale: string;
  alternatives: Array<{ label: string; suggestion: string; angle: string }>;
  liveSignals: string[];
  stageProgress: number;
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

// ─── Angle badge ──────────────────────────────────────────────────────────────

const ANGLE_COLORS: Record<string, string> = {
  Urgency: "bg-red-100 text-red-700",
  Empathy: "bg-blue-100 text-blue-700",
  "Social Proof": "bg-green-100 text-green-700",
  Curiosity: "bg-amber-100 text-amber-700",
  Assumptive: "bg-violet-100 text-violet-700",
  Value: "bg-emerald-100 text-emerald-700",
};

function AngleBadge({ angle }: { angle: string }) {
  const cls = ANGLE_COLORS[angle] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>
      {angle}
    </span>
  );
}

// ─── Signal badge ─────────────────────────────────────────────────────────────

function SignalBadge({ signal }: { signal: string }) {
  const lower = signal.toLowerCase();
  const isPositive = lower.includes("buying") || lower.includes("good") || lower.includes("interest") || lower.includes("engaged");
  const isWarning = lower.includes("hesitation") || lower.includes("price") || lower.includes("sensitive") || lower.includes("cold") || lower.includes("objection");
  const cls = isPositive
    ? "bg-green-50 border-green-200 text-green-700"
    : isWarning
    ? "bg-amber-50 border-amber-200 text-amber-700"
    : "bg-blue-50 border-blue-200 text-blue-700";
  const icon = isPositive ? "●" : isWarning ? "▲" : "◆";
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${cls}`}>
      <span className="text-[8px]">{icon}</span>
      {signal}
    </div>
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
        const Icon = stage.icon;
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
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold`}
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
}: {
  lines: TranscriptLine[];
  onAddLine: (speaker: "agent" | "customer", text: string) => void;
  onClear: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const [activeSpeaker, setActiveSpeaker] = useState<"customer" | "agent">("customer");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const handleSubmit = () => {
    const text = inputText.trim();
    if (!text) return;
    onAddLine(activeSpeaker, text);
    setInputText("");
    // After adding a customer line, switch to agent; after agent, switch to customer
    setActiveSpeaker(activeSpeaker === "customer" ? "agent" : "customer");
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
            <p className="text-xs text-gray-400 mt-1">Type what the customer says below to get AI suggestions</p>
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              className={`flex gap-2 ${line.speaker === "agent" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold mt-0.5 ${
                  line.speaker === "agent" ? "bg-violet-500" : "bg-gray-400"
                }`}
              >
                {line.speaker === "agent" ? "A" : "C"}
              </div>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  line.speaker === "agent"
                    ? "bg-violet-50 border border-violet-100"
                    : "bg-white border border-gray-200"
                }`}
              >
                <div className={`text-[10px] font-bold mb-0.5 ${line.speaker === "agent" ? "text-violet-600" : "text-gray-500"}`}>
                  {line.speaker === "agent" ? "You" : "Customer"}
                </div>
                <p className="text-xs text-gray-700 leading-relaxed">{line.text}</p>
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
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
              activeSpeaker === "customer"
                ? "bg-gray-700 text-white border-gray-700"
                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <User className="w-3 h-3" /> Customer
          </button>
          <button
            onClick={() => setActiveSpeaker("agent")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
              activeSpeaker === "agent"
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
            }`}
          >
            <MicOff className="w-3 h-3" /> Agent
          </button>
        </div>

        {/* Text input */}
        <div className="flex gap-2">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
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
        <p className="text-[10px] text-gray-400">Press Enter to add · Shift+Enter for newline</p>
      </div>
    </div>
  );
}

// ─── AI Suggestion card (center column) ──────────────────────────────────────

function SuggestionCard({
  suggestion,
  isLoading,
  activeStage,
  onGetSuggestion,
  hasTranscript,
}: {
  suggestion: AISuggestion | null;
  isLoading: boolean;
  activeStage: StageId;
  onGetSuggestion: () => void;
  hasTranscript: boolean;
}) {
  const [selectedAlt, setSelectedAlt] = useState<number | null>(null);
  const stage = STAGES.find((s) => s.id === activeStage)!;

  // Reset selected alt when suggestion changes
  useEffect(() => {
    setSelectedAlt(null);
  }, [suggestion]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`px-4 py-3 border-b ${stage.borderColor} ${stage.bgColor} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm"
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
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
            isLoading
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : `text-white hover:opacity-90`
          }`}
          style={isLoading ? {} : { background: stage.color }}
        >
          {isLoading ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Thinking...</>
          ) : (
            <><Zap className="w-3 h-3" /> {suggestion ? "Refresh" : "Get Suggestion"}</>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {!suggestion && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 text-2xl"
              style={{ background: `${stage.color}15` }}
            >
              {stage.emoji}
            </div>
            <h3 className="text-base font-bold text-gray-700 mb-2">Ready to coach</h3>
            <p className="text-sm text-gray-400 max-w-xs">
              {hasTranscript
                ? "Click \"Get Suggestion\" to get AI coaching based on the transcript."
                : "Add transcript lines on the right, then click \"Get Suggestion\" for contextual coaching."}
            </p>
            <button
              onClick={onGetSuggestion}
              className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-white transition-colors hover:opacity-90"
              style={{ background: stage.color }}
            >
              <Zap className="w-4 h-4" /> Get Suggestion
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full py-12">
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
          <>
            {/* Stage progress bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Stage Progress</span>
                <span className="text-[10px] font-bold" style={{ color: stage.color }}>{suggestion.stageProgress}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${suggestion.stageProgress}%`, background: stage.color }}
                />
              </div>
            </div>

            {/* Live signals */}
            {suggestion.liveSignals.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Live Signals</div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestion.liveSignals.map((signal, i) => (
                    <SignalBadge key={i} signal={signal} />
                  ))}
                </div>
              </div>
            )}

            {/* Primary suggestion */}
            <div
              className={`rounded-2xl border-2 p-4 space-y-3 ${stage.borderColor} ${stage.bgColor}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Primary Suggestion</span>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ background: stage.color }}
                    >
                      {suggestion.primaryLabel}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-800 leading-relaxed">
                    {suggestion.primarySuggestion}
                  </p>
                </div>
                <CopyBtn text={suggestion.primarySuggestion} />
              </div>
              <p className="text-[11px] text-gray-500 italic border-l-2 pl-2" style={{ borderColor: stage.color }}>
                {suggestion.primaryRationale}
              </p>
            </div>

            {/* Alternative suggestions */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Alternative Angles</div>
              {suggestion.alternatives.map((alt, i) => {
                const letter = ["A", "B", "C"][i] ?? String(i + 1);
                const isSelected = selectedAlt === i;
                return (
                  <div
                    key={i}
                    className={`rounded-xl border p-3 space-y-2 cursor-pointer transition-all ${
                      isSelected
                        ? "border-gray-300 bg-gray-50 shadow-sm"
                        : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50"
                    }`}
                    onClick={() => setSelectedAlt(isSelected ? null : i)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">
                          {letter}
                        </div>
                        <span className="text-xs font-semibold text-gray-700">{alt.label}</span>
                        <AngleBadge angle={alt.angle} />
                      </div>
                      <CopyBtn text={alt.suggestion} size="xs" />
                    </div>
                    {isSelected && (
                      <p className="text-xs text-gray-600 leading-relaxed pl-7">
                        {alt.suggestion}
                      </p>
                    )}
                    {!isSelected && (
                      <p className="text-xs text-gray-400 leading-relaxed pl-7 line-clamp-1">
                        {alt.suggestion}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
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

  // AI suggestions
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);

  const suggestionMutation = trpc.leads.getLiveCallSuggestions.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setSuggestion({
          primarySuggestion: data.primarySuggestion,
          primaryLabel: data.primaryLabel,
          primaryRationale: data.primaryRationale,
          alternatives: data.alternatives,
          liveSignals: data.liveSignals,
          stageProgress: data.stageProgress,
        });
      } else {
        setSuggestion({
          primarySuggestion: data.primarySuggestion,
          primaryLabel: data.primaryLabel,
          primaryRationale: data.primaryRationale,
          alternatives: data.alternatives,
          liveSignals: data.liveSignals,
          stageProgress: data.stageProgress,
        });
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
  }, []);

  const handleGetSuggestion = useCallback(() => {
    // Build transcript string from recent lines (last 20)
    const recentLines = transcriptLines.slice(-20);
    const transcriptText = recentLines
      .map((l) => `${l.speaker === "agent" ? "AGENT" : "CUSTOMER"}: ${l.text}`)
      .join("\n");

    // Find the last customer line
    const lastCustomerLine = [...transcriptLines]
      .reverse()
      .find((l) => l.speaker === "customer")?.text;

    suggestionMutation.mutate({
      stage: activeStage,
      transcript: transcriptText,
      leadName: leadName.trim() || undefined,
      serviceType: serviceType.trim() || undefined,
      quotedPrice: quotedPrice.trim() || undefined,
      lastCustomerLine: lastCustomerLine,
    });
  }, [activeStage, transcriptLines, leadName, serviceType, quotedPrice, suggestionMutation]);

  const handleStageSelect = (id: StageId) => {
    setActiveStage(id);
    setSuggestion(null); // clear suggestion when switching stages
  };

  const handleMarkComplete = (id: StageId) => {
    setCompletedStages((prev) => { const next = new Set(prev); next.add(id); return next; });
    const idx = STAGES.findIndex((s) => s.id === id);
    const next = STAGES[idx + 1];
    if (next) {
      setActiveStage(next.id);
      setSuggestion(null);
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
  };

  const activeStageData = STAGES.find((s) => s.id === activeStage)!;
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
          {/* Phase 2 placeholder */}
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

        {/* ── Center column: AI Suggestion ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-white border-r border-gray-200">
          <SuggestionCard
            suggestion={suggestion}
            isLoading={suggestionMutation.isPending}
            activeStage={activeStage}
            onGetSuggestion={handleGetSuggestion}
            hasTranscript={transcriptLines.length > 0}
          />
        </div>

        {/* ── Right column: Transcript input ── */}
        <div className="w-80 shrink-0 bg-white flex flex-col">
          <TranscriptPanel
            lines={transcriptLines}
            onAddLine={handleAddLine}
            onClear={handleClearTranscript}
          />
        </div>
      </div>
    </div>
  );
}
