/**
 * Live Call Assist — Real-time AI call coaching for Maids in Black agents.
 *
 * How it works:
 * 1. Agent types what the customer just said
 * 2. Hits Enter
 * 3. AI reads the full conversation and returns the single best next line
 * 4. Agent reads it, says it, types the next customer response
 *
 * That's it. No complexity. Same pattern as the SMS flow.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  Phone, Loader2, Copy, Check, ArrowLeft, RotateCcw,
  Zap, Target, Star, ClipboardList, TrendingUp, Shield,
  SendHorizonal, MessageSquare, User,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

// ─── Stages (visual only — AI determines current stage) ──────────────────────

const STAGES = [
  { id: "opener",    label: "Opener",    color: "#7c3aed", bg: "bg-violet-50",  border: "border-violet-200", text: "text-violet-700",  icon: Zap },
  { id: "discovery", label: "Discovery", color: "#0891b2", bg: "bg-cyan-50",    border: "border-cyan-200",   text: "text-cyan-700",    icon: Target },
  { id: "value",     label: "Value",     color: "#059669", bg: "bg-emerald-50", border: "border-emerald-200",text: "text-emerald-700", icon: Star },
  { id: "recap",     label: "Recap",     color: "#7e22ce", bg: "bg-purple-50",  border: "border-purple-200", text: "text-purple-700",  icon: ClipboardList },
  { id: "close",     label: "Close",     color: "#dc2626", bg: "bg-red-50",     border: "border-red-200",    text: "text-red-700",     icon: TrendingUp },
  { id: "objection", label: "Objection", color: "#6b7280", bg: "bg-gray-50",    border: "border-gray-200",   text: "text-gray-700",    icon: Shield },
] as const;

type StageId = typeof STAGES[number]["id"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationLine {
  id: number;
  speaker: "agent" | "customer";
  text: string;
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

// ─── Pricing engine ───────────────────────────────────────────────────────────

const BEDROOM_OPTIONS = ["Studio","1 Bedroom","2 Bedrooms","3 Bedrooms","4 Bedrooms","5 Bedrooms","6 Bedrooms","7+ Bedrooms"];
const BATHROOM_OPTIONS = ["1 Bathroom","1.5 Bathrooms","2 Bathrooms","2.5 Bathrooms","3 Bathrooms","3.5 Bathrooms","4 Bathrooms","4+ Bathrooms"];
const SERVICE_OPTIONS = ["Standard Cleaning","Deep Cleaning","Move-In / Move-Out Cleaning","Post-Construction Cleaning"];

function estimatePrice(bedrooms: string, bathrooms: string, serviceType: string): string {
  if (!bedrooms || !bathrooms || !serviceType) return "";
  const bedroomBase: Record<string, number> = {
    "Studio": 119, "1 Bedroom": 119, "2 Bedrooms": 209, "3 Bedrooms": 229,
    "4 Bedrooms": 279, "5 Bedrooms": 319, "6 Bedrooms": 379, "7+ Bedrooms": 419,
  };
  const bathroomCount: Record<string, number> = {
    "1 Bathroom": 1, "1.5 Bathrooms": 1, "2 Bathrooms": 2, "2.5 Bathrooms": 2,
    "3 Bathrooms": 3, "3.5 Bathrooms": 3, "4 Bathrooms": 4, "4+ Bathrooms": 4,
  };
  const surcharge: Record<string, number> = {
    "Standard Cleaning": 0, "Deep Cleaning": 60,
    "Move-In / Move-Out Cleaning": 60, "Post-Construction Cleaning": 60,
  };
  const base = bedroomBase[bedrooms] ?? 119;
  const baths = bathroomCount[bathrooms] ?? 1;
  const extra = surcharge[serviceType] ?? 0;
  return (base + baths * 30 + extra).toString();
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function LiveCallAssist() {
  const [, navigate] = useLocation();

  // Context fields (filled in as agent learns them during the call)
  const [leadName, setLeadName]       = useState("");
  const [address, setAddress]         = useState("");
  const [bedrooms, setBedrooms]       = useState("");
  const [bathrooms, setBathrooms]     = useState("");
  const [serviceType, setServiceType] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const quotedPrice = estimatePrice(bedrooms, bathrooms, serviceType);

  // Conversation history — what the AI reads
  const [conversation, setConversation] = useState<ConversationLine[]>([]);
  const nextId = useRef(1);

  // What the agent is typing right now (customer's response)
  const [customerInput, setCustomerInput] = useState("");

  // The AI's suggested next line
  const [suggestion, setSuggestion] = useState("");

  // Which stage pill is active (set by AI response)
  const [activeStage, setActiveStage] = useState<StageId>("opener");
  const [doneStages, setDoneStages]   = useState<Set<StageId>>(new Set());

  // Scroll transcript to bottom
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [conversation]);

  // ── AI call ──────────────────────────────────────────────────────────────────

  const mutation = trpc.leads.getLiveCallSuggestions.useMutation({
    onSuccess: (data) => {
      setSuggestion(data.suggestion);

      // Log customer line to conversation
      const customerText = customerInput.trim();
      if (customerText) {
        setConversation(prev => [...prev, { id: nextId.current++, speaker: "customer", text: customerText }]);
      }

      // Log AI suggestion as agent line
      if (data.suggestion) {
        setConversation(prev => [...prev, { id: nextId.current++, speaker: "agent", text: data.suggestion }]);
      }

      // Advance stage pill if AI moved forward
      if (data.currentStage) {
        const stageIds = STAGES.map(s => s.id);
        const newIdx = stageIds.indexOf(data.currentStage as StageId);
        const oldIdx = stageIds.indexOf(activeStage);
        if (newIdx > oldIdx) {
          setDoneStages(prev => {
            const next = new Set(prev);
            for (let i = 0; i < newIdx; i++) next.add(stageIds[i]);
            return next;
          });
          setActiveStage(data.currentStage as StageId);
        }
      }

      // Clear input ready for next customer line
      setCustomerInput("");
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const text = customerInput.trim();
    if (!text || mutation.isPending) return;

    // Build full conversation string for AI — include current customer line
    const lines = [
      ...conversation,
      { id: -1, speaker: "customer" as const, text },
    ];
    const transcript = lines
      .map(l => `${l.speaker === "agent" ? "AGENT" : "CUSTOMER"}: ${l.text}`)
      .join("\n");

    const context = [
      leadName   ? `Customer name: ${leadName}` : null,
      address    ? `Address: ${address}` : null,
      bedrooms   ? `Bedrooms: ${bedrooms}` : null,
      bathrooms  ? `Bathrooms: ${bathrooms}` : null,
      serviceType ? `Service: ${serviceType}` : null,
      preferredDate ? `Preferred date: ${preferredDate}` : null,
      quotedPrice ? `Quoted price: $${quotedPrice}` : null,
    ].filter(Boolean).join("\n");

    mutation.mutate({
      stage: activeStage,
      transcript,
      leadName: leadName || undefined,
      serviceType: [bedrooms, bathrooms, serviceType].filter(Boolean).join(", ") || undefined,
      quotedPrice: quotedPrice || undefined,
      lastCustomerLine: text,
      context: context || undefined,
    });
  }, [customerInput, conversation, mutation, activeStage, leadName, address, bedrooms, bathrooms, serviceType, preferredDate, quotedPrice]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setConversation([]);
    setSuggestion("");
    setCustomerInput("");
    setActiveStage("opener");
    setDoneStages(new Set());
    setLeadName("");
    setAddress("");
    setBedrooms("");
    setBathrooms("");
    setServiceType("");
    setPreferredDate("");
  };

  const activeStageObj = STAGES.find(s => s.id === activeStage)!;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">

      {/* ── Top bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 shrink-0 flex-wrap">
        <button
          onClick={() => navigate(-1 as any)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="w-px h-5 bg-gray-200 shrink-0" />
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center">
            <Phone className="w-3 h-3 text-violet-600" />
          </div>
          <span className="text-sm font-bold text-gray-800">Live Call Assist</span>
        </div>
        <div className="w-px h-5 bg-gray-200 shrink-0" />

        {/* Stage pills */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto">
          {STAGES.map((stage, idx) => {
            const isActive = activeStage === stage.id;
            const isDone   = doneStages.has(stage.id);
            return (
              <button
                key={stage.id}
                onClick={() => setActiveStage(stage.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all shrink-0 border ${
                  isActive ? `${stage.bg} ${stage.border} shadow-sm`
                  : isDone ? "bg-green-50 border-green-200 text-green-700 opacity-80"
                  : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                  style={{ background: isDone ? "#16a34a" : isActive ? stage.color : "#d1d5db" }}
                >
                  {isDone ? "✓" : idx + 1}
                </span>
                <span className={isActive ? stage.text : ""}>{stage.label}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors shrink-0"
        >
          <RotateCcw className="w-3 h-3" /> New Call
        </button>
      </div>

      {/* ── 3-column body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Context fields ── */}
        <div className="w-52 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-1.5 mb-1">
              <User className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Call Context</span>
            </div>

            {/* Name */}
            <Field label="Customer Name">
              <input
                type="text" value={leadName} onChange={e => setLeadName(e.target.value)}
                placeholder="e.g. Sarah"
                className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 placeholder-gray-400"
              />
            </Field>

            {/* Address */}
            <Field label="Address">
              <input
                type="text" value={address} onChange={e => setAddress(e.target.value)}
                placeholder="e.g. 123 Main St NW"
                className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 placeholder-gray-400"
              />
            </Field>

            {/* Preferred date */}
            <Field label="Preferred Date">
              <input
                type="text" value={preferredDate} onChange={e => setPreferredDate(e.target.value)}
                placeholder="e.g. this Saturday"
                className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 placeholder-gray-400"
              />
            </Field>

            {/* Service type */}
            <Field label="Service Type">
              <select value={serviceType} onChange={e => setServiceType(e.target.value)}
                className="w-full text-xs rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white text-gray-700">
                <option value="">Select…</option>
                {SERVICE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            {/* Bedrooms */}
            <Field label="Bedrooms">
              <select value={bedrooms} onChange={e => setBedrooms(e.target.value)}
                className="w-full text-xs rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white text-gray-700">
                <option value="">Select…</option>
                {BEDROOM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            {/* Bathrooms */}
            <Field label="Bathrooms">
              <select value={bathrooms} onChange={e => setBathrooms(e.target.value)}
                className="w-full text-xs rounded-lg border border-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 bg-white text-gray-700">
                <option value="">Select…</option>
                {BATHROOM_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>

            {/* Quoted price */}
            {quotedPrice && (
              <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 flex items-center justify-between">
                <span className="text-[10px] font-bold text-violet-500 uppercase tracking-wide">Price</span>
                <span className="text-base font-black text-violet-700">${quotedPrice}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Center: AI suggestion + customer input ── */}
        <div className="flex-1 min-w-0 flex flex-col bg-white border-r border-gray-200">

          {/* Stage label bar */}
          <div className={`px-4 py-2 border-b ${activeStageObj.border} ${activeStageObj.bg} flex items-center gap-2 shrink-0`}>
            <span className="text-sm font-bold" style={{ color: activeStageObj.color }}>
              {activeStageObj.label}
            </span>
            {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" style={{ color: activeStageObj.color }} />}
          </div>

          {/* Suggestion area */}
          <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0 space-y-5">

            {/* Opener intro — always visible until first customer line is submitted */}
            {conversation.length === 0 && (
              <div className="rounded-2xl border-2 border-violet-200 bg-violet-50 p-6">
                <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wide mb-3">Opening Line — say this first</p>
                <p className="text-2xl font-semibold text-gray-900 leading-relaxed italic">
                  "Hi, thank you for calling Maids in Black, this is [Your Name]! You called at the perfect time — how can I help you today?"
                </p>
              </div>
            )}

            {!suggestion && !mutation.isPending && conversation.length === 0 && (
              <p className="text-sm text-gray-400 text-center pt-2">After they respond, type what they said below and hit Enter</p>
            )}

            {!suggestion && !mutation.isPending && conversation.length > 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-center">
                <p className="text-sm text-gray-400">Type their next response and hit Enter</p>
              </div>
            )}

            {mutation.isPending && (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: activeStageObj.color }} />
                <p className="text-sm text-gray-500">Getting your next line...</p>
              </div>
            )}

            {suggestion && !mutation.isPending && (
              <div className={`rounded-2xl border-2 p-6 ${activeStageObj.border} ${activeStageObj.bg}`}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Say This</span>
                  <div className="flex-1 h-px bg-gray-200" />
                  <CopyBtn text={suggestion} />
                </div>
                <p className="text-2xl font-semibold text-gray-900 leading-relaxed">
                  {suggestion}
                </p>
              </div>
            )}
          </div>

          {/* Customer input — pinned at bottom */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-2">What did they say?</p>
            <div className="flex gap-2 items-end">
              <textarea
                value={customerInput}
                onChange={e => setCustomerInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type their response, then press Enter..."
                rows={4}
                className="flex-1 text-sm rounded-xl border border-gray-200 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 placeholder-gray-400 bg-white leading-relaxed"
              />
              <button
                onClick={handleSubmit}
                disabled={mutation.isPending || !customerInput.trim()}
                className="p-3 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors mb-0.5"
              >
                {mutation.isPending
                  ? <Loader2 className="w-5 h-5 animate-spin" />
                  : <SendHorizonal className="w-5 h-5" />
                }
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Enter to get next line · Shift+Enter for newline</p>
          </div>
        </div>

        {/* ── Right: Conversation transcript ── */}
        <div className="w-72 shrink-0 bg-white flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-700">Transcript</span>
              {conversation.length > 0 && (
                <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
                  {conversation.length}
                </span>
              )}
            </div>
            {conversation.length > 0 && (
              <button
                onClick={() => setConversation([])}
                className="text-[11px] text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          <div ref={transcriptRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
            {conversation.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <MessageSquare className="w-8 h-8 text-gray-200 mb-2" />
                <p className="text-xs text-gray-400">Conversation will appear here</p>
              </div>
            ) : (
              conversation.map(line => (
                <div key={line.id} className={`flex gap-2 ${line.speaker === "agent" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5 ${
                    line.speaker === "agent" ? "bg-violet-500" : "bg-gray-400"
                  }`}>
                    {line.speaker === "agent" ? "A" : "C"}
                  </div>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    line.speaker === "agent"
                      ? "bg-violet-50 text-violet-900 rounded-tr-sm"
                      : "bg-gray-100 text-gray-800 rounded-tl-sm"
                  }`}>
                    {line.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Small helper ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide block mb-1">{label}</label>
      {children}
    </div>
  );
}
