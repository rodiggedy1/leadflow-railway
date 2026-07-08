/**
 * SmsCampaigns — /admin/sms-campaigns
 *
 * SMS Campaign Command Center with a visual rule builder for audience targeting.
 * UI-only — logic wired in a subsequent phase.
 */
import { useState, useRef } from "react";
import {
  Timer,
  RefreshCw,
  CalendarClock,
  ThumbsUp,
  Layers,
} from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Users,
  ShieldCheck,
  MessageSquare,
  FlaskConical,
  Send,
  Sparkles,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Ban,
  Copy,
  ChevronRight,
  ChevronLeft,
  Zap,
  Phone,
  Plus,
  X,
  GripVertical,
  MapPin,
  CalendarDays,
  DollarSign,
  Star,
  Megaphone,
  Brain,
  Heart,
  ChevronDown,
  Trash2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5;
type RuleOperator = ">" | "<" | ">=" | "<=" | "=" | "!=" | "is" | "is not" | "contains";
type RuleValueType = "number" | "text" | "select" | "boolean" | "days";

interface RuleDefinition {
  id: string;
  label: string;
  category: string;
  operator: RuleOperator[];
  valueType: RuleValueType;
  unit?: string;
  selectOptions?: string[];
  icon: React.ReactNode;
  color: string; // tailwind text color
  bgColor: string; // tailwind bg color
}

interface ActiveRule {
  uid: string;
  defId: string;
  operator: RuleOperator;
  value: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Audience Presets
// ─────────────────────────────────────────────────────────────────────────────

interface AudiencePreset {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  estimatedCount: number;
  color: string;
  iconColor: string;
}

const AUDIENCE_PRESETS: AudiencePreset[] = [
  { id: "last-minute",    label: "Last-minute openings",    description: "Customers likely to book on short notice",            icon: <Timer className="w-4 h-4" />,       estimatedCount: 94,  color: "bg-orange-50",  iconColor: "text-orange-500" },
  { id: "win-back",       label: "Win back inactive",       description: "Haven't booked in 90+ days",                         icon: <RefreshCw className="w-4 h-4" />,    estimatedCount: 211, color: "bg-blue-50",    iconColor: "text-blue-500" },
  { id: "former-recur",   label: "Former recurring",        description: "Used to have a recurring plan, now lapsed",           icon: <CalendarClock className="w-4 h-4" />, estimatedCount: 138, color: "bg-purple-50",  iconColor: "text-purple-500" },
  { id: "nearby",         label: "Customers within X miles", description: "Based on service address proximity",                 icon: <MapPin className="w-4 h-4" />,       estimatedCount: 184, color: "bg-emerald-50", iconColor: "text-emerald-500" },
  { id: "due-recurring",  label: "Due for recurring clean", description: "Recurring customers whose next clean is overdue",     icon: <CalendarClock className="w-4 h-4" />, estimatedCount: 47,  color: "bg-amber-50",   iconColor: "text-amber-500" },
  { id: "five-star",      label: "5★ reviewers",            description: "Customers who left a 5-star review",                  icon: <Star className="w-4 h-4" />,         estimatedCount: 73,  color: "bg-yellow-50",  iconColor: "text-yellow-500" },
  { id: "no-complaints",  label: "No complaints",           description: "Zero open issues or complaint history",               icon: <ThumbsUp className="w-4 h-4" />,     estimatedCount: 302, color: "bg-teal-50",    iconColor: "text-teal-500" },
  { id: "high-spend",     label: "Spent over $500",         description: "High-value customers by lifetime spend",              icon: <DollarSign className="w-4 h-4" />,   estimatedCount: 89,  color: "bg-green-50",   iconColor: "text-green-600" },
  { id: "not-contacted",  label: "Not contacted in 30 days", description: "No outbound SMS in the past month",                  icon: <MessageSquare className="w-4 h-4" />, estimatedCount: 256, color: "bg-slate-50",   iconColor: "text-slate-500" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Rule Catalog
// ─────────────────────────────────────────────────────────────────────────────

const RULE_CATALOG: RuleDefinition[] = [
  // Geography
  { id: "radius",       label: "Radius",           category: "Geography",       operator: ["<", "<="],          valueType: "number",  unit: "miles",    icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { id: "city",         label: "City",             category: "Geography",       operator: ["is", "is not"],     valueType: "text",                      icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { id: "zip",          label: "ZIP Code",         category: "Geography",       operator: ["is", "is not"],     valueType: "text",                      icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { id: "neighborhood", label: "Neighborhood",     category: "Geography",       operator: ["is", "is not"],     valueType: "text",                      icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  // Booking History
  { id: "last-booking", label: "Last Booking",     category: "Booking History", operator: [">", "<", ">=", "<="], valueType: "days", unit: "days ago", icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "num-bookings", label: "# of Bookings",   category: "Booking History", operator: [">", "<", ">=", "<=", "="], valueType: "number",             icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "recurring",    label: "Recurring Status", category: "Booking History", operator: ["is"],               valueType: "select",  selectOptions: ["Active", "Former", "Never"], icon: <CalendarDays className="w-3.5 h-3.5" />, color: "text-blue-600", bgColor: "bg-blue-50" },
  { id: "service-type", label: "Service Type",     category: "Booking History", operator: ["is", "is not"],     valueType: "select",  selectOptions: ["Standard", "Deep Clean", "Move-out", "Recurring"], icon: <CalendarDays className="w-3.5 h-3.5" />, color: "text-blue-600", bgColor: "bg-blue-50" },
  { id: "bedrooms",     label: "Bedrooms",         category: "Booking History", operator: ["=", ">", "<"],      valueType: "number",                    icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "bathrooms",    label: "Bathrooms",        category: "Booking History", operator: ["=", ">", "<"],      valueType: "number",                    icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  // Customer Value
  { id: "ltv",          label: "Lifetime Revenue", category: "Customer Value",  operator: [">", "<", ">=", "<="], valueType: "number", unit: "$",       icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bgColor: "bg-violet-50" },
  { id: "avg-ticket",   label: "Avg Ticket",       category: "Customer Value",  operator: [">", "<", ">=", "<="], valueType: "number", unit: "$",       icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bgColor: "bg-violet-50" },
  { id: "tips",         label: "Tips",             category: "Customer Value",  operator: [">", ">=", "="],     valueType: "number",  unit: "$",        icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bgColor: "bg-violet-50" },
  // Customer Health
  { id: "review-score", label: "Review Score",     category: "Customer Health", operator: [">=", ">", "="],     valueType: "select",  selectOptions: ["5", "4", "3", "2", "1"], icon: <Star className="w-3.5 h-3.5" />, color: "text-amber-600", bgColor: "bg-amber-50" },
  { id: "complaints",   label: "Complaints",       category: "Customer Health", operator: ["=", "<"],           valueType: "number",                    icon: <Heart className="w-3.5 h-3.5" />,         color: "text-amber-600",   bgColor: "bg-amber-50" },
  { id: "refunds",      label: "Refunds",          category: "Customer Health", operator: ["=", "<"],           valueType: "number",                    icon: <Heart className="w-3.5 h-3.5" />,         color: "text-amber-600",   bgColor: "bg-amber-50" },
  { id: "chargebacks",  label: "Chargebacks",      category: "Customer Health", operator: ["="],                valueType: "number",                    icon: <Heart className="w-3.5 h-3.5" />,         color: "text-amber-600",   bgColor: "bg-amber-50" },
  // Marketing
  { id: "last-sms",     label: "Last SMS",         category: "Marketing",       operator: [">", "<"],           valueType: "days",    unit: "days ago", icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "last-email",   label: "Last Email",       category: "Marketing",       operator: [">", "<"],           valueType: "days",    unit: "days ago", icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "prev-campaign",label: "Previous Campaign",category: "Marketing",       operator: ["is", "is not"],     valueType: "text",                      icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "stop-status",  label: "STOP Status",      category: "Marketing",       operator: ["is"],               valueType: "select",  selectOptions: ["Opted in", "Opted out"], icon: <Ban className="w-3.5 h-3.5" />, color: "text-pink-600", bgColor: "bg-pink-50" },
  { id: "open-rate",    label: "Open Rate",        category: "Marketing",       operator: [">", "<"],           valueType: "number",  unit: "%",        icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "reply-rate",   label: "Reply Rate",       category: "Marketing",       operator: [">", "<"],           valueType: "number",  unit: "%",        icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  // AI
  { id: "ai-book",      label: "Likelihood to Book",    category: "AI",        operator: [">", ">="],           valueType: "number",  unit: "%",        icon: <Brain className="w-3.5 h-3.5" />,         color: "text-indigo-600",  bgColor: "bg-indigo-50" },
  { id: "ai-respond",   label: "Likelihood to Respond", category: "AI",        operator: [">", ">="],           valueType: "number",  unit: "%",        icon: <Brain className="w-3.5 h-3.5" />,         color: "text-indigo-600",  bgColor: "bg-indigo-50" },
];

const CATEGORIES = [
  { name: "Geography",       icon: <MapPin className="w-3.5 h-3.5" />,       color: "text-emerald-600", bg: "bg-emerald-50",  border: "border-emerald-200" },
  { name: "Booking History", icon: <CalendarDays className="w-3.5 h-3.5" />, color: "text-blue-600",    bg: "bg-blue-50",     border: "border-blue-200" },
  { name: "Customer Value",  icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bg: "bg-violet-50",   border: "border-violet-200" },
  { name: "Customer Health", icon: <Heart className="w-3.5 h-3.5" />,        color: "text-amber-600",   bg: "bg-amber-50",    border: "border-amber-200" },
  { name: "Marketing",       icon: <Megaphone className="w-3.5 h-3.5" />,    color: "text-pink-600",    bg: "bg-pink-50",     border: "border-pink-200" },
  { name: "AI",              icon: <Brain className="w-3.5 h-3.5" />,        color: "text-indigo-600",  bg: "bg-indigo-50",   border: "border-indigo-200" },
];

// ─────────────────────────────────────────────────────────────────────────────
// SavedAudiencePicker
// ─────────────────────────────────────────────────────────────────────────────

function SavedAudiencePicker({
  selectedPresets,
  setSelectedPresets,
}: {
  selectedPresets: Set<string>;
  setSelectedPresets: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const toggle = (id: string) =>
    setSelectedPresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mb-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
          <Layers className="w-4 h-4 text-gray-500" />
          Saved Audiences
        </h2>
        {selectedPresets.size > 0 && (
          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {selectedPresets.size} selected
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Pick one or more audiences. Combine with rules below for extra precision.
      </p>
      <div className="flex flex-col gap-2">
        {AUDIENCE_PRESETS.map((preset) => {
          const active = selectedPresets.has(preset.id);
          return (
            <button
              key={preset.id}
              onClick={() => toggle(preset.id)}
              className={[
                "flex items-center gap-3 p-3 rounded-2xl border text-left transition-all",
                active
                  ? "border-gray-900 bg-gray-900 shadow-sm"
                  : "border-gray-100 bg-gray-50 hover:border-gray-300 hover:bg-white",
              ].join(" ")}
            >
              <div className={["w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", active ? "bg-white/15" : preset.color].join(" ")}>
                <span className={active ? "text-white" : preset.iconColor}>{preset.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={["text-sm font-bold leading-tight", active ? "text-white" : "text-gray-900"].join(" ")}>{preset.label}</div>
                <div className={["text-xs mt-0.5 truncate", active ? "text-gray-300" : "text-gray-400"].join(" ")}>{preset.description}</div>
              </div>
              <div className={["text-xs font-black rounded-full px-2 py-0.5 flex-shrink-0", active ? "bg-white/20 text-white" : "bg-white text-gray-500 border border-gray-200"].join(" ")}>
                ~{preset.estimatedCount}
              </div>
              {active && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulated recipient count
// ─────────────────────────────────────────────────────────────────────────────

function computeCount(rules: ActiveRule[], selectedPresets: Set<string>): number {
  // Base from presets
  let base = 0;
  if (selectedPresets.size > 0) {
    for (const id of selectedPresets) {
      const p = AUDIENCE_PRESETS.find((x) => x.id === id);
      if (p) base += p.estimatedCount;
    }
    if (selectedPresets.size > 1) base = Math.round(base * 0.72);
  } else {
    // No presets — start from full list and let rules narrow
    if (rules.length === 0) return 0;
    base = 480;
  }
  for (const r of rules) {
    const def = RULE_CATALOG.find((d) => d.id === r.defId);
    if (!def) continue;
    const v = parseFloat(r.value) || 0;
    switch (r.defId) {
      case "radius":       base = Math.round(base * Math.min(1, (v || 5) / 15)); break;
      case "last-booking": base = Math.round(base * (v > 60 ? 0.55 : 0.8)); break;
      case "ltv":          base = Math.round(base * (v > 300 ? 0.45 : 0.7)); break;
      case "review-score": base = Math.round(base * (r.value === "5" ? 0.35 : 0.6)); break;
      case "complaints":   base = Math.round(base * 0.82); break;
      case "last-sms":     base = Math.round(base * 0.65); break;
      case "stop-status":  base = Math.round(base * (r.value === "Opted in" ? 0.9 : 0.05)); break;
      case "ai-book":      base = Math.round(base * 0.4); break;
      case "ai-respond":   base = Math.round(base * 0.45); break;
      default:             base = Math.round(base * 0.78);
    }
  }
  return Math.max(base, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowBar
// ─────────────────────────────────────────────────────────────────────────────

function WorkflowBar({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  const steps: { id: Step; label: string; icon: React.ReactNode }[] = [
    { id: 1, label: "Audience",  icon: <Users className="w-3.5 h-3.5" /> },
    { id: 2, label: "Safety",    icon: <ShieldCheck className="w-3.5 h-3.5" /> },
    { id: 3, label: "Message",   icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: 4, label: "Test",      icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: 5, label: "Type SEND", icon: <Send className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex items-center gap-1.5 my-4">
      {steps.map((s, idx) => {
        const done = s.id < step;
        const active = s.id === step;
        return (
          <div key={s.id} className="flex items-center gap-1.5 flex-1 min-w-0">
            <button
              onClick={() => onStep(s.id)}
              className={[
                "flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-all w-full justify-center truncate",
                active  ? "bg-gray-900 text-white shadow-md"
                : done  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-gray-100 text-gray-400",
              ].join(" ")}
            >
              {done ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : s.icon}
              <span className="hidden sm:inline truncate">{s.label}</span>
              <span className="sm:hidden">{s.id}</span>
            </button>
            {idx < steps.length - 1 && (
              <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeroCard
// ─────────────────────────────────────────────────────────────────────────────

function HeroCard({ count, ruleCount, excluded, expectedReplies }: {
  count: number; ruleCount: number; excluded: number; expectedReplies: number;
}) {
  return (
    <div
      className="rounded-3xl p-7 text-center text-white mb-4"
      style={{ background: "linear-gradient(180deg,#111827 0%,#1f2937 100%)" }}
    >
      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">Recipients</div>
      <div className="font-black text-white leading-none mb-1 tabular-nums transition-all duration-300" style={{ fontSize: 72 }}>
        {count}
      </div>
      <div className="text-sm text-gray-300 mb-1">eligible customers</div>
      <div className="text-xs text-gray-500 mb-4">
        {ruleCount === 0 ? "Select an audience or add rules" : `${ruleCount} filter${ruleCount > 1 ? "s" : ""} active`}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "excluded",        value: excluded },
          { label: "expected replies", value: expectedReplies },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="text-xl font-black">{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RuleBlock — a single active rule row
// ─────────────────────────────────────────────────────────────────────────────

function RuleBlock({
  rule,
  onUpdate,
  onRemove,
  dragHandleProps,
}: {
  rule: ActiveRule;
  onUpdate: (uid: string, patch: Partial<ActiveRule>) => void;
  onRemove: (uid: string) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const def = RULE_CATALOG.find((d) => d.id === rule.defId)!;
  const [editingValue, setEditingValue] = useState(false);

  return (
    <div
      className="flex items-center gap-2 p-3 rounded-2xl border border-gray-200 bg-white shadow-sm group"
      style={{ userSelect: "none" }}
    >
      {/* Drag handle */}
      <div
        {...dragHandleProps}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Category icon */}
      <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${def.bgColor}`}>
        <span className={def.color}>{def.icon}</span>
      </div>

      {/* Label */}
      <span className="text-sm font-bold text-gray-800 flex-shrink-0 min-w-[90px]">
        {def.label}
      </span>

      {/* Operator selector */}
      <div className="relative flex-shrink-0">
        <select
          value={rule.operator}
          onChange={(e) => onUpdate(rule.uid, { operator: e.target.value as RuleOperator })}
          className="appearance-none bg-gray-100 border-0 rounded-lg px-2 py-1.5 pr-6 text-xs font-bold text-gray-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          {def.operator.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
      </div>

      {/* Value input */}
      <div className="flex-1 min-w-0">
        {def.valueType === "select" ? (
          <div className="relative">
            <select
              value={rule.value}
              onChange={(e) => onUpdate(rule.uid, { value: e.target.value })}
              className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 pr-7 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              <option value="">Select…</option>
              {def.selectOptions?.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        ) : def.valueType === "boolean" ? (
          <span className="text-sm font-semibold text-gray-700 px-2">true</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type={def.valueType === "number" || def.valueType === "days" ? "number" : "text"}
              value={rule.value}
              onChange={(e) => onUpdate(rule.uid, { value: e.target.value })}
              placeholder="value"
              min="0"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
            {def.unit && (
              <span className="text-xs text-gray-400 font-medium flex-shrink-0">{def.unit}</span>
            )}
          </div>
        )}
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(rule.uid)}
        className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RulePicker — the "+ Add Rule" dropdown panel
// ─────────────────────────────────────────────────────────────────────────────

function RulePicker({ onAdd, onClose }: { onAdd: (defId: string) => void; onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState("Geography");
  const ref = useRef<HTMLDivElement>(null);

  const rulesInCategory = RULE_CATALOG.filter((r) => r.category === activeCategory);
  const cat = CATEGORIES.find((c) => c.name === activeCategory)!;

  return (
    <div
      ref={ref}
      className="absolute z-50 top-full left-0 mt-2 w-[480px] max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-3xl shadow-2xl overflow-hidden"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span className="font-black text-gray-900 text-sm">Add a Rule</span>
        <button onClick={onClose} className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>

      <div className="flex" style={{ height: 340 }}>
        {/* Category sidebar */}
        <div className="w-40 border-r border-gray-100 flex flex-col py-2 flex-shrink-0 overflow-y-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c.name}
              onClick={() => setActiveCategory(c.name)}
              className={[
                "flex items-center gap-2 px-3 py-2.5 text-left text-xs font-bold transition-colors",
                activeCategory === c.name
                  ? `${c.bg} ${c.color}`
                  : "text-gray-500 hover:bg-gray-50",
              ].join(" ")}
            >
              <span className={activeCategory === c.name ? c.color : "text-gray-400"}>{c.icon}</span>
              {c.name}
            </button>
          ))}
        </div>

        {/* Rule list */}
        <div className="flex-1 overflow-y-auto py-2 px-3">
          <div className={`text-xs font-black uppercase tracking-widest mb-3 px-1 ${cat.color}`}>
            {activeCategory}
          </div>
          <div className="flex flex-col gap-1">
            {rulesInCategory.map((rule) => (
              <button
                key={rule.id}
                onClick={() => { onAdd(rule.id); onClose(); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 text-left group transition-colors"
              >
                <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${rule.bgColor}`}>
                  <span className={rule.color}>{rule.icon}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-800 group-hover:text-gray-900">{rule.label}</div>
                  <div className="text-xs text-gray-400">
                    {rule.operator.slice(0, 3).join(" · ")}
                    {rule.unit ? ` · ${rule.unit}` : ""}
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-gray-500" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AudienceRuleBuilder
// ─────────────────────────────────────────────────────────────────────────────

let uidCounter = 0;
function makeUid() { return `rule-${++uidCounter}`; }

function AudienceRuleBuilder({
  rules,
  setRules,
}: {
  rules: ActiveRule[];
  setRules: React.Dispatch<React.SetStateAction<ActiveRule[]>>;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const addRule = (defId: string) => {
    const def = RULE_CATALOG.find((d) => d.id === defId)!;
    setRules((prev) => [
      ...prev,
      {
        uid: makeUid(),
        defId,
        operator: def.operator[0],
        value: def.selectOptions ? def.selectOptions[0] : "",
      },
    ]);
  };

  const updateRule = (uid: string, patch: Partial<ActiveRule>) => {
    setRules((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const removeRule = (uid: string) => {
    setRules((prev) => prev.filter((r) => r.uid !== uid));
  };

  // Simple drag-to-reorder
  const handleDragEnd = () => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      setRules((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(overIdx, 0, moved);
        return next;
      });
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  // Preset quick-adds
  const QUICK_PRESETS = [
    { label: "Win Back",        rules: [{ defId: "last-booking", op: ">", val: "90" }] },
    { label: "High Value",      rules: [{ defId: "ltv",          op: ">", val: "500" }] },
    { label: "5★ No Issues",    rules: [{ defId: "review-score", op: ">=", val: "5" }, { defId: "complaints", op: "=", val: "0" }] },
    { label: "AI Ready",        rules: [{ defId: "ai-respond",   op: ">", val: "60" }] },
    { label: "Not Texted 30d",  rules: [{ defId: "last-sms",     op: ">", val: "30" }] },
  ];

  const applyPreset = (preset: typeof QUICK_PRESETS[0]) => {
    const newRules: ActiveRule[] = preset.rules.map((r) => {
      const def = RULE_CATALOG.find((d) => d.id === r.defId)!;
      return { uid: makeUid(), defId: r.defId, operator: r.op as RuleOperator, value: r.val };
    });
    setRules((prev) => {
      // avoid duplicates
      const existingIds = new Set(prev.map((r) => r.defId));
      return [...prev, ...newRules.filter((r) => !existingIds.has(r.defId))];
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gray-500" />
          Audience Rules
        </h2>
        {rules.length > 0 && (
          <button
            onClick={() => setRules([])}
            className="text-xs text-red-400 font-bold hover:text-red-600 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Every rule narrows the audience. All rules are combined with AND logic.
      </p>

      {/* Quick preset chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {QUICK_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className="px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Active rules */}
      {rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 rounded-2xl border-2 border-dashed border-gray-200 text-center mb-4">
          <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-gray-400" />
          </div>
          <div className="text-sm font-bold text-gray-400 mb-1">No rules yet</div>
          <div className="text-xs text-gray-300">Click "+ Add Rule" or pick a quick preset above</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 mb-4">
          {rules.map((rule, idx) => (
            <div
              key={rule.uid}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
              onDragEnd={handleDragEnd}
              className={[
                "transition-all",
                overIdx === idx && dragIdx !== idx ? "opacity-50 scale-95" : "",
              ].join(" ")}
            >
              {/* AND connector */}
              {idx > 0 && (
                <div className="flex items-center gap-2 py-1 px-3">
                  <div className="flex-1 h-px bg-gray-100" />
                  <span className="text-xs font-black text-gray-300 uppercase tracking-widest">AND</span>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              )}
              <RuleBlock
                rule={rule}
                onUpdate={updateRule}
                onRemove={removeRule}
                dragHandleProps={{}}
              />
            </div>
          ))}
        </div>
      )}

      {/* Add Rule button */}
      <div className="relative">
        <button
          onClick={() => setShowPicker((v) => !v)}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-gray-900 hover:text-gray-900 hover:bg-gray-50 transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
        {showPicker && (
          <RulePicker onAdd={addRule} onClose={() => setShowPicker(false)} />
        )}
      </div>

      {/* Category legend */}
      {rules.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const count = rules.filter((r) => RULE_CATALOG.find((d) => d.id === r.defId)?.category === c.name).length;
            if (!count) return null;
            return (
              <span key={c.name} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${c.bg} ${c.color} border ${c.border}`}>
                {c.icon} {c.name} · {count}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SafetySummary
// ─────────────────────────────────────────────────────────────────────────────

function SafetySummary() {
  const stats = [
    { icon: <Ban className="w-4 h-4 text-red-500" />,            label: "STOP / opt-out",  value: 8,  color: "text-red-600" },
    { icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, label: "Open issues",     value: 11, color: "text-amber-600" },
    { icon: <Clock className="w-4 h-4 text-blue-500" />,          label: "Recently texted", value: 22, color: "text-blue-600" },
    { icon: <Copy className="w-4 h-4 text-gray-400" />,           label: "Duplicates",      value: 0,  color: "text-gray-500" },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        Safety Summary
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-gray-50 border border-gray-100 rounded-2xl p-3">
            <div className="flex items-center gap-1.5 mb-1">{s.icon}</div>
            <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-0.5 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveAudiencePreview
// ─────────────────────────────────────────────────────────────────────────────

const PREVIEW_PEOPLE = [
  { name: "Jennifer Smith", rating: 5, lastClean: "42 days ago",  distance: "3.1 miles", type: "Former recurring" },
  { name: "Alex Grant",     rating: 5, lastClean: "8 months ago", distance: "2.4 miles", type: "One-time" },
  { name: "Nina Lee",       rating: 4, lastClean: "92 days ago",  distance: "4.4 miles", type: "Former recurring" },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 text-amber-400 text-sm">
      {[1,2,3,4,5].map((i) => <span key={i} style={{ opacity: i <= rating ? 1 : 0.25 }}>★</span>)}
    </div>
  );
}

function LiveAudiencePreview({ ruleCount }: { ruleCount: number }) {
  if (ruleCount === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Users className="w-4 h-4 text-gray-600" />
        Live Audience Preview
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PREVIEW_PEOPLE.map((p) => (
          <div key={p.name} className="border border-gray-100 rounded-2xl p-3 bg-white">
            <div className="font-bold text-gray-900 text-sm mb-1">{p.name}</div>
            <StarRating rating={p.rating} />
            <div className="text-xs text-gray-500 mt-2 leading-relaxed">
              Last clean: {p.lastClean}<br />
              {p.distance} · {p.type}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageEditor
// ─────────────────────────────────────────────────────────────────────────────

function MessageEditor({ message, setMessage }: { message: string; setMessage: (m: string) => void }) {
  const insertVar = (v: string) => setMessage(message + v);
  const charCount = message.length;
  const smsCount = Math.ceil(charCount / 160) || 1;
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-gray-600" />
        Message
      </h2>
      <div className="flex gap-2 mb-3">
        <button onClick={() => insertVar("{{first_name}}")} className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors">+ first_name</button>
        <button onClick={() => insertVar("{{area}}")} className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors">+ area</button>
      </div>
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-[110px] rounded-xl border-gray-300 text-sm leading-relaxed resize-none" placeholder="Write your message…" />
      <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
        <span>{charCount} chars</span>
        <span>{smsCount} SMS segment{smsCount > 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PersonalizedPreviews
// ─────────────────────────────────────────────────────────────────────────────

function PersonalizedPreviews({ message }: { message: string }) {
  const previews = [
    { name: "Jennifer", firstName: "Jennifer", area: "Arlington" },
    { name: "Alex",     firstName: "Alex",     area: "Arlington" },
    { name: "Nina",     firstName: "Nina",     area: "Arlington" },
  ];
  const personalize = (tpl: string, fn: string, area: string) =>
    tpl.replace(/\{\{first_name\}\}/g, fn).replace(/\{\{area\}\}/g, area);
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Phone className="w-4 h-4 text-gray-600" />
        Personalized Previews
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {previews.map((p) => (
          <div key={p.name} className="rounded-3xl p-4 min-h-[200px]" style={{ background: "#101828" }}>
            <div className="text-white font-bold text-sm mb-1">{p.name}</div>
            <div className="text-white text-xs leading-relaxed mt-3 p-3" style={{ background: "#2563eb", borderRadius: "18px 18px 4px 18px" }}>
              {personalize(message, p.firstName, p.area)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StepTest
// ─────────────────────────────────────────────────────────────────────────────

function StepTest({ message, onTestSent }: { message: string; onTestSent: () => void }) {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const handleSend = () => {
    if (!phone.trim()) { toast.error("Enter a phone number"); return; }
    setSending(true);
    setTimeout(() => { setSending(false); setSent(true); onTestSent(); toast.success("Test SMS sent! (UI-only)"); }, 1200);
  };
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-gray-600" />
        Send Test SMS
      </h2>
      <p className="text-sm text-gray-500 mb-4">Send yourself a preview before the real campaign goes out.</p>
      <div className="flex gap-2">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" className="rounded-xl border-gray-300" />
        <Button onClick={handleSend} disabled={sending || sent} className={["rounded-xl font-bold px-5 flex-shrink-0", sent ? "bg-emerald-600 hover:bg-emerald-600" : "bg-gray-900 hover:bg-gray-800"].join(" ")}>
          {sending ? <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending…</span>
            : sent ? <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />Sent!</span>
            : "Send Test"}
        </Button>
      </div>
      {sent && <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2"><CheckCircle2 className="w-4 h-4" />Test SMS sent — check your phone.</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StepFinalApproval
// ─────────────────────────────────────────────────────────────────────────────

function StepFinalApproval({ recipientCount, testSent, message }: { recipientCount: number; testSent: boolean; message: string }) {
  const [confirmText, setConfirmText] = useState("");
  const expectedConfirm = `SEND ${recipientCount}`;
  const isReady = testSent && confirmText.trim() === expectedConfirm && recipientCount > 0;
  const checks = [
    { label: "Audience built",       status: recipientCount > 0 ? "passed" : "pending" },
    { label: "Test SMS sent",        status: testSent ? "passed" : "pending" },
    { label: "Quiet hours protected", status: "passed", note: "9am–8pm local" },
    { label: "Opt-outs excluded",    status: "passed", note: "8 excluded" },
    { label: "Type confirmation",    status: confirmText === expectedConfirm ? "passed" : "required", note: `Type: ${expectedConfirm}` },
  ];
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Send className="w-4 h-4 text-gray-600" />
        Final Approval
      </h2>
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr>
            <th className="text-left text-xs font-black uppercase tracking-widest text-gray-400 pb-2 border-b border-gray-100">Check</th>
            <th className="text-left text-xs font-black uppercase tracking-widest text-gray-400 pb-2 border-b border-gray-100">Status</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.label} className="border-b border-gray-50">
              <td className="py-3 text-sm text-gray-700">{c.label}</td>
              <td className="py-3">
                {c.status === "passed" ? <span className="flex items-center gap-1 text-emerald-600 text-sm font-semibold"><CheckCircle2 className="w-3.5 h-3.5" />Passed</span>
                  : c.status === "pending" ? <span className="flex items-center gap-1 text-amber-500 text-sm font-semibold"><Clock className="w-3.5 h-3.5" />Pending</span>
                  : <span className="text-sm font-semibold text-gray-500">Required: <strong className="text-gray-900">{c.note}</strong></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mb-5">
        <div className="text-xs font-bold text-gray-500 mb-1.5">Type <span className="font-black text-gray-900">{expectedConfirm}</span> to unlock sending</div>
        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={`Type "${expectedConfirm}" here`} className={["rounded-xl font-mono", confirmText === expectedConfirm ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-gray-300"].join(" ")} />
      </div>
      <div className="flex justify-between items-center gap-3">
        <Button variant="outline" className="rounded-xl font-bold border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => toast.info("Draft saved (UI-only)")}>Save Draft</Button>
        <Button onClick={() => { if (!isReady) { toast.error("Complete all checks first"); return; } toast.success("Campaign scheduled! (UI-only)"); }} disabled={!isReady} className={["rounded-xl font-bold px-6", isReady ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"].join(" ")}>
          <Zap className="w-4 h-4 mr-1.5" />Schedule Campaign
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main content
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MESSAGE = "Hi {{first_name}}, this is Madison from Maid in Black 😊 We have a few openings near {{area}} this week and wanted to see if you'd like help with a cleaning. Want me to send available times?";

function SmsCampaignsContent() {
  const [step, setStep] = useState<Step>(1);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [testSent, setTestSent] = useState(false);
  const [rules, setRules] = useState<ActiveRule[]>([]);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());

  const recipientCount = computeCount(rules, selectedPresets);
  const excluded = (rules.length > 0 || selectedPresets.size > 0) ? Math.round(recipientCount * 0.18) : 0;
  const expectedReplies = Math.round(recipientCount * 0.13);

  return (
    <>
      <div className="flex items-start justify-between mb-1 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900" style={{ letterSpacing: "-0.03em" }}>SMS Campaign Command Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Build the safest possible audience before anyone can send anything.</p>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0 mt-1">
          <ShieldCheck className="w-3.5 h-3.5" />Draft · Send locked
        </span>
      </div>

      <WorkflowBar step={step} onStep={setStep} />

      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-4 mt-2">
        {/* LEFT */}
        <div>
          <HeroCard count={recipientCount} ruleCount={rules.length + selectedPresets.size} excluded={excluded} expectedReplies={expectedReplies} />
          <SavedAudiencePicker selectedPresets={selectedPresets} setSelectedPresets={setSelectedPresets} />
          <AudienceRuleBuilder rules={rules} setRules={setRules} />
        </div>
        {/* RIGHT */}
        <div>
          <SafetySummary />
          <LiveAudiencePreview ruleCount={rules.length} />
          <MessageEditor message={message} setMessage={setMessage} />
          <PersonalizedPreviews message={message} />
          <StepTest message={message} onTestSent={() => setTestSent(true)} />
          <StepFinalApproval recipientCount={recipientCount} testSent={testSent} message={message} />
        </div>
      </div>

      <div className="flex justify-between items-center mt-6 pb-8">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(s - 1, 1) as Step)} disabled={step === 1} className="rounded-xl font-bold gap-1.5">
          <ChevronLeft className="w-4 h-4" />Previous
        </Button>
        <span className="text-xs text-gray-400 font-medium">Step {step} of 5</span>
        <Button onClick={() => setStep((s) => Math.min(s + 1, 5) as Step)} disabled={step === 5} className="bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold gap-1.5">
          Next<ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page export
// ─────────────────────────────────────────────────────────────────────────────

export default function SmsCampaigns() {
  const { isAdmin } = useAgentPermissions();
  return (
    <AdminPageGuard pageId="sms-campaigns">
      <AdminHeader activeTab="sms-campaigns" isAdmin={isAdmin} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <SmsCampaignsContent />
      </main>
    </AdminPageGuard>
  );
}
