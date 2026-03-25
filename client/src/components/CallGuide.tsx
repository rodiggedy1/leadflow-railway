import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronRight, Phone, Loader2, Zap, CheckCircle2, Circle, Copy, Check } from "lucide-react";
import { toast } from "sonner";

// ─── Stage definitions ────────────────────────────────────────────────────────

const STAGES = [
  {
    id: "opener",
    label: "Pattern Interrupt Opener",
    emoji: "⚡",
    color: "#7c3aed",
    goal: "Create curiosity and stand out from every other cleaning company call",
    checklist: [
      "Use their first name immediately",
      "Mention something specific (their inquiry, their area)",
      "End with an open question — not 'Is this a good time?'",
    ],
    scripts: [
      "\"Hey [Name]! This is [Your Name] with Maid in Black — I saw you were looking for a cleaning service, and I wanted to reach out personally before we get slammed this week. Quick question for you...\"",
      "\"Hi [Name], it's [Your Name] from Maid in Black. I don't want to waste your time so I'll be straight — we have a spot opening up in your area this week and I wanted to see if it's a fit before it goes. Can I ask you a couple of quick questions?\"",
      "\"[Name]? Hey, this is [Your Name] — I'm one of the booking coordinators at Maid in Black. I actually pulled your request myself because your area is one we're really focused on right now. Do you have 90 seconds?\"",
    ],
  },
  {
    id: "discovery",
    label: "Discovery & Needs Assessment",
    emoji: "🔍",
    color: "#0891b2",
    goal: "Understand their situation deeply — not just beds/baths, but WHY they need cleaning NOW",
    checklist: [
      "Get property details (beds, baths, sq ft)",
      "Ask about their current cleaning situation",
      "Find the emotional driver — why now?",
      "Listen for urgency signals",
    ],
    scripts: [
      "\"So tell me — what's going on at the house right now? Is this for regular maintenance or is there something specific coming up?\"",
      "\"Are you currently using a cleaning service, or has it been a while since you've had someone in?\"",
      "\"What made you reach out today specifically? Sometimes people have a big event coming up, or they've just hit a wall — what's your situation?\"",
      "\"On a scale of 1–10, how would you rate the current state of the house? No judgment — I just want to make sure we send the right team.\"",
    ],
  },
  {
    id: "pain",
    label: "Pain Amplification",
    emoji: "💡",
    color: "#d97706",
    goal: "Help them feel the cost of NOT solving this — make the problem vivid before you offer a solution",
    checklist: [
      "Reflect their pain back to them",
      "Ask what it's costing them (time, stress, embarrassment)",
      "Connect cleaning to their bigger goal",
      "Don't rush to the solution",
    ],
    scripts: [
      "\"It sounds like this has been weighing on you for a while. What's the biggest thing that bothers you about the current situation?\"",
      "\"So when guests come over, or when you walk in after a long day — how does that feel knowing it's not where you want it?\"",
      "\"I hear that a lot — people are just exhausted. You're working hard all week and the last thing you want is to spend your weekend cleaning. How long has it been like this?\"",
      "\"What would it mean for you if you just didn't have to think about this anymore?\"",
    ],
  },
  {
    id: "value",
    label: "Value Anchoring Before Price",
    emoji: "💎",
    color: "#059669",
    goal: "Build the value stack BEFORE you mention a number — price is only a problem when value is unclear",
    checklist: [
      "Describe what they actually get (not just 'cleaning')",
      "Mention the team quality / vetting",
      "Anchor to their specific pain points",
      "Set up the price reveal as a relief, not a shock",
    ],
    scripts: [
      "\"So here's what we do that's different — we don't just send whoever's available. We send a dedicated team that learns your home, uses your preferred products, and we're fully insured and background-checked. This isn't a gig-economy thing.\"",
      "\"Before I give you a number, I want to make sure you understand what you're getting — because when people hear our price, they usually say 'that's it?' once they know what's included.\"",
      "\"Based on what you told me — the [specific pain point they mentioned] — I'm going to make sure we address that specifically. That's not something every company does.\"",
      "\"We've been cleaning homes in [their area] for years. Our clients don't leave because they trust us in their home. That trust is worth something — and our pricing reflects that.\"",
    ],
  },
  {
    id: "quote",
    label: "Quote & Assumptive Close",
    emoji: "📋",
    color: "#dc2626",
    goal: "Present the price confidently and assume the sale — don't ask if they want to book, ask WHEN",
    checklist: [
      "State the price without apologizing",
      "Immediately follow with the assumptive close",
      "Offer two options (not yes/no)",
      "Stay quiet after the close — let them respond",
    ],
    scripts: [
      "\"For a [X bed / Y bath] home, we're looking at $[price] for the first clean. After that, recurring is $[price]. So — do you want to start this week or next week?\"",
      "\"The investment is $[price]. And honestly, for what you described — the stress, the time it's taking — that's going to feel like nothing once you walk into a clean house. What day works best for you?\"",
      "\"We have [day] and [day] available in your area. Which one works better for your schedule?\"",
      "\"I'm going to go ahead and pencil you in — I just need to confirm, morning or afternoon works better for you?\"",
    ],
  },
  {
    id: "objections",
    label: "Objection Handling",
    emoji: "🛡️",
    color: "#6b7280",
    goal: "Treat objections as requests for more information — never argue, always empathize then redirect",
    checklist: [
      "Pause before responding (don't jump in)",
      "Acknowledge their concern genuinely",
      "Ask a clarifying question before rebutting",
      "Redirect to value or urgency",
    ],
    scripts: [
      "Too expensive: \"I totally get that — can I ask, is it the total amount or is it more about the timing? Because we do have options...\"",
      "Need to think about it: \"Of course — what specifically do you want to think through? I want to make sure you have everything you need to make the right call.\"",
      "Already have someone: \"That's great — what made you reach out today then? Sometimes people are looking for a backup or they're not 100% happy with their current situation...\"",
      "Not sure about quality: \"That's a fair concern. What if we did a first clean and you judged us on that? If it's not exactly what you expected, we'll make it right — no questions asked.\"",
    ],
  },
];

// ─── Copied phrase feedback ───────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text.replace(/^"|"$/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="shrink-0 p-1 rounded hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Single stage card ────────────────────────────────────────────────────────

function StageCard({
  stage,
  index,
  isActive,
  isComplete,
  onToggle,
  onComplete,
}: {
  stage: typeof STAGES[0];
  index: number;
  isActive: boolean;
  isComplete: boolean;
  onToggle: () => void;
  onComplete: () => void;
}) {
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());
  const [showScripts, setShowScripts] = useState(false);

  const toggleCheck = (i: number) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <div
      className={`rounded-xl border transition-all ${
        isComplete
          ? "border-green-200 bg-green-50/50 opacity-70"
          : isActive
          ? "border-gray-200 bg-white shadow-sm"
          : "border-gray-100 bg-gray-50/50"
      }`}
    >
      {/* Stage header */}
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
        onClick={onToggle}
      >
        <div
          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          style={{ background: isComplete ? "#16a34a" : stage.color }}
        >
          {isComplete ? "✓" : index + 1}
        </div>
        <span className="text-sm font-semibold text-gray-800 flex-1">{stage.emoji} {stage.label}</span>
        {isActive ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {/* Expanded content */}
      {isActive && (
        <div className="px-3 pb-3 space-y-3">
          {/* Goal */}
          <p className="text-[11px] text-gray-500 italic leading-snug border-l-2 pl-2" style={{ borderColor: stage.color }}>
            Goal: {stage.goal}
          </p>

          {/* Checklist */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Key Points</div>
            {stage.checklist.map((item, ci) => (
              <button
                key={ci}
                onClick={() => toggleCheck(ci)}
                className="flex items-start gap-2 w-full text-left group"
              >
                {checkedItems.has(ci)
                  ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: stage.color }} />
                  : <Circle className="w-4 h-4 shrink-0 mt-0.5 text-gray-300 group-hover:text-gray-400" />
                }
                <span className={`text-xs leading-snug ${checkedItems.has(ci) ? "line-through text-gray-400" : "text-gray-600"}`}>
                  {item}
                </span>
              </button>
            ))}
          </div>

          {/* Scripts toggle */}
          <button
            onClick={() => setShowScripts(v => !v)}
            className="text-[11px] font-semibold flex items-center gap-1 transition-colors"
            style={{ color: stage.color }}
          >
            {showScripts ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {showScripts ? "Hide" : "Show"} scripts ({stage.scripts.length})
          </button>

          {showScripts && (
            <div className="space-y-2">
              {stage.scripts.map((script, si) => (
                <div key={si} className="flex gap-2 bg-gray-50 rounded-lg px-2.5 py-2 border border-gray-100">
                  <p className="text-[11px] text-gray-700 leading-relaxed flex-1">{script}</p>
                  <CopyButton text={script} />
                </div>
              ))}
            </div>
          )}

          {/* Mark complete */}
          {!isComplete && (
            <button
              onClick={onComplete}
              className="w-full text-[11px] font-semibold py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: stage.color, color: stage.color }}
            >
              ✓ Done — Next Stage
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── AI Objection Handler ─────────────────────────────────────────────────────

function ObjectionHandler() {
  const [input, setInput] = useState("");
  const [rebuttal, setRebuttal] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const rebuttalMutation = trpc.leads.getObjectionRebuttal.useMutation({
    onSuccess: (data) => setRebuttal(data.rebuttal),
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!input.trim()) return;
    setRebuttal(null);
    rebuttalMutation.mutate({ objection: input.trim() });
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">AI Objection Handler</span>
      </div>
      <p className="text-[11px] text-amber-600">Type what the customer just said and get an instant rebuttal.</p>
      <textarea
        ref={textareaRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
        placeholder={`e.g. "It's too expensive" or "I need to think about it"`}
        rows={2}
        className="w-full text-xs rounded-lg border border-amber-200 bg-white px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder-gray-400"
      />
      <button
        onClick={handleSubmit}
        disabled={!input.trim() || rebuttalMutation.isPending}
        className="w-full py-1.5 rounded-lg text-[11px] font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
      >
        {rebuttalMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Getting rebuttal...</> : "⚡ Get Rebuttal"}
      </button>
      {rebuttal && (
        <div className="bg-white rounded-lg border border-amber-200 px-3 py-2.5 flex gap-2">
          <p className="text-xs text-gray-700 leading-relaxed flex-1">{rebuttal}</p>
          <CopyButton text={rebuttal} />
        </div>
      )}
    </div>
  );
}

// ─── Main CallGuide component ─────────────────────────────────────────────────

export default function CallGuide({ collapsed = false }: { collapsed?: boolean }) {
  const [isOpen, setIsOpen] = useState(!collapsed);
  const [activeStage, setActiveStage] = useState<string | null>("opener");
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());

  const handleComplete = (stageId: string, index: number) => {
    setCompletedStages(prev => new Set([...prev, stageId]));
    // Auto-advance to next stage
    const next = STAGES[index + 1];
    if (next) setActiveStage(next.id);
  };

  const handleReset = () => {
    setCompletedStages(new Set());
    setActiveStage("opener");
  };

  const progress = Math.round((completedStages.size / STAGES.length) * 100);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setIsOpen(v => !v)}
      >
        <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
          <Phone className="w-3.5 h-3.5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-gray-800">Live Call Guide</div>
          {completedStages.size > 0 && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">{completedStages.size}/{STAGES.length}</span>
            </div>
          )}
        </div>
        {completedStages.size > 0 && (
          <button
            onClick={e => { e.stopPropagation(); handleReset(); }}
            className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0 mr-1"
          >
            Reset
          </button>
        )}
        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {/* Body */}
      {isOpen && (
        <div className="px-3 pb-3 space-y-2 border-t border-gray-100 pt-3">
          {STAGES.map((stage, index) => (
            <StageCard
              key={stage.id}
              stage={stage}
              index={index}
              isActive={activeStage === stage.id}
              isComplete={completedStages.has(stage.id)}
              onToggle={() => setActiveStage(activeStage === stage.id ? null : stage.id)}
              onComplete={() => handleComplete(stage.id, index)}
            />
          ))}
          <ObjectionHandler />
        </div>
      )}
    </div>
  );
}
