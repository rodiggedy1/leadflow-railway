/**
 * SmsCampaigns — /admin/sms-campaigns
 *
 * SMS Campaign Command Center — Stage 3: wired to real AudiencePlanner data.
 *
 * Architecture:
 * - UI builds an AudienceDefinition object (presets + rules)
 * - trpc.smsCampaign.planAudience.useQuery() is debounced 800ms
 * - All counts, safety stats, and audience preview come from real DB queries
 * - Unsupported rules show a yellow badge (server owns the supported list)
 * - Previous planner result persists while re-fetching ("Updating…" not skeleton)
 */
import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import CampaignReviewScreen from "@/components/CampaignReviewScreen";
import {
  Timer,
  RefreshCw,
  CalendarClock,
  ThumbsUp,
  Layers,
  Info,
  Lock,
  Unlock,
  UserX,
  ChevronUp,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
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
  Save,
  Pencil,
  History,
  LockOpen,
  RotateCcw,
  Loader2,
  RefreshCw,
  Timer,
  ThumbsUp,
  CalendarClock,
  ChevronUp,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5;

// Server-canonical operator types (subset accepted by the tRPC endpoint)
type ServerOperator = ">" | ">=" | "<" | "<=" | "=" | "!=" | "is_true" | "is_false";

// UI-facing operators (superset — some are display-only for unsupported rules)
type RuleOperator = ServerOperator | "is" | "is not" | "contains";

type RuleValueType = "number" | "text" | "select" | "boolean" | "days";

// Server-canonical field names (must match plannerTypes.ts RuleField)
type RuleField =
  | "lastBookingDays" | "bookingCount" | "recurringStatus" | "serviceType"
  | "bedrooms" | "bathrooms" | "lifetimeRevenue" | "avgTicket" | "lastBookingPrice"
  | "reviewScore" | "hasComplaint" | "hasRefund" | "hasChargeback"
  | "lastSmsDays" | "lastEmailDays" | "stopStatus" | "openRate" | "replyRate"
  | "aiLikelihoodToBook" | "aiLikelihoodToRespond"
  | "radiusMiles" | "city" | "zip";

interface RuleDefinition {
  id: RuleField;
  label: string;
  category: string;
  operator: RuleOperator[];
  valueType: RuleValueType;
  unit?: string;
  selectOptions?: string[];
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

interface ActiveRule {
  uid: string;
  field: RuleField;        // server-canonical field name
  operator: RuleOperator;
  value: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved Audience Presets
// ─────────────────────────────────────────────────────────────────────────────

type AudiencePresetId =
  | "win-back" | "former-recurring" | "last-minute-openings" | "five-star-no-issues"
  | "high-value" | "not-contacted-30d" | "due-for-recurring" | "spent-over-500" | "within-x-miles";

interface AudiencePreset {
  id: AudiencePresetId;
  label: string;
  description: string;
  icon: React.ReactNode;
  estimatedCount: number;
  color: string;
  iconColor: string;
}

const AUDIENCE_PRESETS: AudiencePreset[] = [
  { id: "last-minute-openings", label: "Last-minute openings",    description: "Customers likely to book on short notice",            icon: <Timer className="w-4 h-4" />,        estimatedCount: 94,  color: "bg-orange-50",  iconColor: "text-orange-500" },
  { id: "win-back",             label: "Win back inactive",       description: "Haven't booked in 90+ days",                         icon: <RefreshCw className="w-4 h-4" />,     estimatedCount: 211, color: "bg-blue-50",    iconColor: "text-blue-500" },
  { id: "former-recurring",     label: "Former recurring",        description: "Used to have a recurring plan, now lapsed",           icon: <CalendarClock className="w-4 h-4" />, estimatedCount: 138, color: "bg-purple-50",  iconColor: "text-purple-500" },
  { id: "within-x-miles",       label: "Customers within X miles", description: "Based on service address proximity",                 icon: <MapPin className="w-4 h-4" />,        estimatedCount: 184, color: "bg-emerald-50", iconColor: "text-emerald-500" },
  { id: "due-for-recurring",    label: "Due for recurring clean", description: "Recurring customers whose next clean is overdue",     icon: <CalendarClock className="w-4 h-4" />, estimatedCount: 47,  color: "bg-amber-50",   iconColor: "text-amber-500" },
  { id: "five-star-no-issues",  label: "5★ reviewers",            description: "Customers who left a 5-star review",                  icon: <Star className="w-4 h-4" />,          estimatedCount: 73,  color: "bg-yellow-50",  iconColor: "text-yellow-500" },
  { id: "high-value",           label: "No complaints",           description: "Zero open issues or complaint history",               icon: <ThumbsUp className="w-4 h-4" />,      estimatedCount: 302, color: "bg-teal-50",    iconColor: "text-teal-500" },
  { id: "spent-over-500",       label: "Spent over $500",         description: "High-value customers by lifetime spend",              icon: <DollarSign className="w-4 h-4" />,    estimatedCount: 89,  color: "bg-green-50",   iconColor: "text-green-600" },
  { id: "not-contacted-30d",    label: "Not contacted in 30 days", description: "No outbound SMS in the past month",                  icon: <MessageSquare className="w-4 h-4" />, estimatedCount: 256, color: "bg-slate-50",   iconColor: "text-slate-500" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Rule Catalog — IDs are server-canonical RuleField names
// ─────────────────────────────────────────────────────────────────────────────

const RULE_CATALOG: RuleDefinition[] = [
  // Geography
  { id: "radiusMiles",            label: "Radius",            category: "Geography",       operator: ["<", "<="],              valueType: "number",  unit: "miles",    icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { id: "city",                   label: "City",              category: "Geography",       operator: ["is", "is not"],         valueType: "text",                      icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  { id: "zip",                    label: "ZIP Code",          category: "Geography",       operator: ["is", "is not"],         valueType: "text",                      icon: <MapPin className="w-3.5 h-3.5" />,        color: "text-emerald-600", bgColor: "bg-emerald-50" },
  // Booking History
  { id: "lastBookingDays",        label: "Last Booking",      category: "Booking History", operator: [">", "<", ">=", "<="],   valueType: "days",    unit: "days ago", icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "bookingCount",           label: "# of Bookings",    category: "Booking History", operator: [">", "<", ">=", "<=", "="], valueType: "number",                icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "recurringStatus",        label: "Recurring Status",  category: "Booking History", operator: ["="],                    valueType: "select",  selectOptions: ["active-recurring", "former-recurring", "one-time"], icon: <CalendarDays className="w-3.5 h-3.5" />, color: "text-blue-600", bgColor: "bg-blue-50" },
  { id: "serviceType",            label: "Service Type",      category: "Booking History", operator: ["=", "!="],              valueType: "select",  selectOptions: ["Standard Cleaning", "Deep Clean", "Move-out Cleaning", "Recurring"], icon: <CalendarDays className="w-3.5 h-3.5" />, color: "text-blue-600", bgColor: "bg-blue-50" },
  { id: "bedrooms",               label: "Bedrooms",          category: "Booking History", operator: ["=", ">", "<"],          valueType: "number",                    icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  { id: "bathrooms",              label: "Bathrooms",         category: "Booking History", operator: ["=", ">", "<"],          valueType: "number",                    icon: <CalendarDays className="w-3.5 h-3.5" />,  color: "text-blue-600",    bgColor: "bg-blue-50" },
  // Customer Value
  { id: "lifetimeRevenue",        label: "Lifetime Revenue",  category: "Customer Value",  operator: [">", "<", ">=", "<="],   valueType: "number",  unit: "$",        icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bgColor: "bg-violet-50" },
  { id: "avgTicket",              label: "Avg Ticket",        category: "Customer Value",  operator: [">", "<", ">=", "<="],   valueType: "number",  unit: "$",        icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bgColor: "bg-violet-50" },
  { id: "lastBookingPrice",       label: "Last Booking Price",category: "Customer Value",  operator: [">", "<", ">=", "<="],   valueType: "number",  unit: "$",        icon: <DollarSign className="w-3.5 h-3.5" />,   color: "text-violet-600",  bgColor: "bg-violet-50" },
  // Customer Health
  { id: "reviewScore",            label: "Review Score",      category: "Customer Health", operator: [">=", ">", "="],         valueType: "select",  selectOptions: ["5", "4", "3", "2", "1"], icon: <Star className="w-3.5 h-3.5" />, color: "text-amber-600", bgColor: "bg-amber-50" },
  { id: "hasComplaint",           label: "Complaints",        category: "Customer Health", operator: ["is_true", "is_false"],  valueType: "boolean",                   icon: <Heart className="w-3.5 h-3.5" />,         color: "text-amber-600",   bgColor: "bg-amber-50" },
  { id: "hasRefund",              label: "Refunds",           category: "Customer Health", operator: ["is_true", "is_false"],  valueType: "boolean",                   icon: <Heart className="w-3.5 h-3.5" />,         color: "text-amber-600",   bgColor: "bg-amber-50" },
  { id: "hasChargeback",          label: "Chargebacks",       category: "Customer Health", operator: ["is_true", "is_false"],  valueType: "boolean",                   icon: <Heart className="w-3.5 h-3.5" />,         color: "text-amber-600",   bgColor: "bg-amber-50" },
  // Marketing
  { id: "lastSmsDays",            label: "Last SMS",          category: "Marketing",       operator: [">", "<"],               valueType: "days",    unit: "days ago", icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "lastEmailDays",          label: "Last Email",        category: "Marketing",       operator: [">", "<"],               valueType: "days",    unit: "days ago", icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "stopStatus",             label: "STOP Status",       category: "Marketing",       operator: ["is_true", "is_false"],  valueType: "boolean",                   icon: <Ban className="w-3.5 h-3.5" />,           color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "openRate",               label: "Open Rate",         category: "Marketing",       operator: [">", "<"],               valueType: "number",  unit: "%",        icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  { id: "replyRate",              label: "Reply Rate",        category: "Marketing",       operator: [">", "<"],               valueType: "number",  unit: "%",        icon: <Megaphone className="w-3.5 h-3.5" />,     color: "text-pink-600",    bgColor: "bg-pink-50" },
  // AI
  { id: "aiLikelihoodToBook",     label: "Likelihood to Book",    category: "AI",          operator: [">", ">="],              valueType: "number",  unit: "%",        icon: <Brain className="w-3.5 h-3.5" />,         color: "text-indigo-600",  bgColor: "bg-indigo-50" },
  { id: "aiLikelihoodToRespond",  label: "Likelihood to Respond", category: "AI",          operator: [">", ">="],              valueType: "number",  unit: "%",        icon: <Brain className="w-3.5 h-3.5" />,         color: "text-indigo-600",  bgColor: "bg-indigo-50" },
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
// Translate UI rules → server AudienceDefinition
// ─────────────────────────────────────────────────────────────────────────────

const SERVER_OPERATORS = new Set([">" , ">=" , "<" , "<=" , "=" , "!=" , "is_true" , "is_false"]);

function translateRulesToServer(rules: ActiveRule[], supportedFields: RuleField[]): {
  field: RuleField; op: string; value: string | number | boolean;
}[] {
  const supported = new Set(supportedFields);
  return rules
    .filter((r) => supported.has(r.field) && SERVER_OPERATORS.has(r.operator) && r.value !== "")
    .map((r) => ({
      field: r.field,
      op: r.operator as string,
      value: r.valueType === "number" || r.valueType === "days"
        ? Number(r.value)
        : r.operator === "is_true" ? true
        : r.operator === "is_false" ? false
        : r.value,
    }));
}

// Add valueType to ActiveRule for translation — derive from catalog
function getRuleDef(field: RuleField): RuleDefinition | undefined {
  return RULE_CATALOG.find((d) => d.id === field);
}

// ─────────────────────────────────────────────────────────────────────────────
// Debounce hook
// ─────────────────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Audience Sentence
// ─────────────────────────────────────────────────────────────────────────────

function buildAudienceSentence(
  selectedPresets: Set<AudiencePresetId>,
  rules: ActiveRule[]
): React.ReactNode {
  const presetLabels = [...selectedPresets].map(
    (id) => AUDIENCE_PRESETS.find((p) => p.id === id)?.label ?? id
  );

  let subject: React.ReactNode;
  if (presetLabels.length === 0) {
    subject = <><strong>all customers</strong></>;
  } else if (presetLabels.length === 1) {
    subject = <><strong>{presetLabels[0].toLowerCase()}</strong></>;
  } else {
    const joined = presetLabels.map((l, i) => (
      <span key={i}>
        {i > 0 && (i === presetLabels.length - 1 ? " and " : ", ")}
        <strong>{l.toLowerCase()}</strong>
      </span>
    ));
    subject = <>{joined}</>;
  }

  const clauses: React.ReactNode[] = [];
  for (const rule of rules) {
    if (!rule.value) continue;
    const v = rule.value;
    const op = rule.operator;
    switch (rule.field) {
      case "radiusMiles":           clauses.push(<>within <strong>{v} miles</strong></>); break;
      case "city":                  clauses.push(<>in <strong>{v}</strong></>); break;
      case "zip":                   clauses.push(<>in ZIP <strong>{v}</strong></>); break;
      case "lastBookingDays":       clauses.push(<>who {op === ">" || op === ">=" ? "have not booked in" : "booked within"} <strong>{v} days</strong></>); break;
      case "bookingCount":          clauses.push(<>with <strong>{op} {v} booking{Number(v) !== 1 ? "s" : ""}</strong></>); break;
      case "recurringStatus":       clauses.push(<>with <strong>{v.replace(/-/g, " ")}</strong> status</>); break;
      case "serviceType":           clauses.push(<>who booked a <strong>{v.toLowerCase()}</strong></>); break;
      case "bedrooms":              clauses.push(<>with <strong>{op} {v} bedroom{Number(v) !== 1 ? "s" : ""}</strong></>); break;
      case "bathrooms":             clauses.push(<>with <strong>{op} {v} bathroom{Number(v) !== 1 ? "s" : ""}</strong></>); break;
      case "lifetimeRevenue":       clauses.push(<>who spent <strong>{op} ${v}</strong> lifetime</>); break;
      case "avgTicket":             clauses.push(<>with an average ticket <strong>{op} ${v}</strong></>); break;
      case "lastBookingPrice":      clauses.push(<>whose last booking was <strong>{op} ${v}</strong></>); break;
      case "reviewScore":           clauses.push(<>with a <strong>{v}★ or higher</strong> review</>); break;
      case "hasComplaint":          clauses.push(op === "is_false" ? <>with <strong>no complaints</strong></> : <>with <strong>open complaints</strong></>); break;
      case "hasRefund":             clauses.push(op === "is_false" ? <>with <strong>no refunds</strong></> : <>with <strong>refunds on file</strong></>); break;
      case "hasChargeback":         clauses.push(op === "is_false" ? <>with <strong>no chargebacks</strong></> : <>with <strong>chargebacks on file</strong></>); break;
      case "lastSmsDays":           clauses.push(<>not texted in <strong>{v} days</strong></>); break;
      case "lastEmailDays":         clauses.push(<>not emailed in <strong>{v} days</strong></>); break;
      case "stopStatus":            clauses.push(op === "is_false" ? <>who have <strong>opted in</strong></> : <>who have <strong>opted out</strong></>); break;
      case "openRate":              clauses.push(<>with an open rate <strong>{op} {v}%</strong></>); break;
      case "replyRate":             clauses.push(<>with a reply rate <strong>{op} {v}%</strong></>); break;
      case "aiLikelihoodToBook":    clauses.push(<>with a <strong>{op} {v}% likelihood</strong> to book</>); break;
      case "aiLikelihoodToRespond": clauses.push(<>with a <strong>{op} {v}% likelihood</strong> to respond</>); break;
    }
  }

  if (selectedPresets.size === 0 && rules.length === 0) return null;

  const clauseNodes = clauses.map((c, i) => (
    <span key={i}>
      {i === 0 ? " " : i === clauses.length - 1 && clauses.length > 1 ? " and " : ", "}
      {c}
    </span>
  ));

  return <>You are messaging {subject}{clauseNodes}.</>;
}

function AudienceSentence({
  selectedPresets,
  rules,
}: {
  selectedPresets: Set<AudiencePresetId>;
  rules: ActiveRule[];
}) {
  const sentence = buildAudienceSentence(selectedPresets, rules);
  if (!sentence) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 px-5 py-4 mb-4 text-sm text-gray-300 italic">
        Your audience description will appear here as you build it.
      </div>
    );
  }
  return (
    <div
      className="rounded-2xl px-5 py-4 mb-4 text-sm leading-relaxed"
      style={{ background: "linear-gradient(135deg, #f0f9ff 0%, #fafafa 100%)", border: "1px solid #bae6fd" }}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: "#0ea5e9", boxShadow: "0 0 0 4px rgba(14,165,233,0.12)" }}>
          <MessageSquare className="w-3 h-3 text-white" />
        </div>
        <p className="text-gray-700 leading-relaxed">{sentence}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SavedAudiencePicker
// ─────────────────────────────────────────────────────────────────────────────

function SavedAudiencePicker({
  selectedPresets,
  setSelectedPresets,
  liveCount,
  isFetching,
}: {
  selectedPresets: Set<AudiencePresetId>;
  setSelectedPresets: React.Dispatch<React.SetStateAction<Set<AudiencePresetId>>>;
  liveCount: number | null;   // live planner count when exactly 1 preset is selected
  isFetching: boolean;
}) {
  const toggle = (id: AudiencePresetId) =>
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
                active ? "border-gray-900 bg-gray-900 shadow-sm" : "border-gray-100 bg-gray-50 hover:border-gray-300 hover:bg-white",
              ].join(" ")}
            >
              <div className={["w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", active ? "bg-white/15" : preset.color].join(" ")}>
                <span className={active ? "text-white" : preset.iconColor}>{preset.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className={["text-sm font-bold leading-tight", active ? "text-white" : "text-gray-900"].join(" ")}>{preset.label}</div>
                <div className={["text-xs mt-0.5 truncate", active ? "text-gray-300" : "text-gray-400"].join(" ")}>{preset.description}</div>
              </div>
              <div className={["text-xs font-black rounded-full px-2 py-0.5 flex-shrink-0 min-w-[2.5rem] text-center", active ? "bg-white/20 text-white" : "bg-white text-gray-500 border border-gray-200"].join(" ")}>
                {active && liveCount !== null
                  ? isFetching ? "…" : liveCount.toLocaleString()
                  : `~${preset.estimatedCount}`}
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
                active ? "bg-gray-900 text-white shadow-md" : done ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-100 text-gray-400",
              ].join(" ")}
            >
              {done ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : s.icon}
              <span className="hidden sm:inline truncate">{s.label}</span>
              <span className="sm:hidden">{s.id}</span>
            </button>
            {idx < steps.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeroCard — wired to real planner data
// ─────────────────────────────────────────────────────────────────────────────

function HeroCard({
  plannerResult,
  isFetching,
  isLoading,
  isError,
  errorMessage,
  ruleCount,
  plannerVersion,
  updatedSecondsAgo,
}: {
  plannerResult: { summary: { matchedCustomers: number; excludedCustomers: number; estimatedReplies: number; qualityScore: number; qualityGrade: string } } | null;
  isFetching: boolean;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  ruleCount: number;
  plannerVersion: string | null;
  updatedSecondsAgo: number | null;
}) {
  const count = plannerResult?.summary.matchedCustomers ?? 0;
  const excluded = plannerResult?.summary.excludedCustomers ?? 0;
  const expectedReplies = plannerResult?.summary.estimatedReplies ?? 0;
  const qualityScore = plannerResult?.summary.qualityScore ?? 0;
  const qualityGrade = plannerResult?.summary.qualityGrade ?? null;

  const gradeColor = qualityGrade === "A" ? "text-emerald-400" : qualityGrade === "B" ? "text-blue-400" : qualityGrade === "C" ? "text-amber-400" : qualityGrade === "D" ? "text-orange-400" : "text-red-400";

  return (
    <div className="rounded-3xl p-7 text-center text-white mb-4" style={{ background: "linear-gradient(180deg,#111827 0%,#1f2937 100%)" }}>
      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">Recipients</div>

      {/* Error state — visible diagnostic */}
      {isError && (
        <div className="mb-2 px-3 py-2 rounded-xl bg-red-900/60 border border-red-500/40 text-left">
          <div className="text-xs font-black text-red-400 uppercase tracking-wider mb-0.5">Planner error</div>
          <div className="text-xs text-red-300 font-mono break-all">{errorMessage ?? "Unknown error"}</div>
        </div>
      )}

      {/* Count */}
      {isLoading ? (
        <div className="h-[72px] flex items-center justify-center mb-1">
          <div className="w-12 h-12 rounded-full border-4 border-gray-600 border-t-white animate-spin" />
        </div>
      ) : isError ? (
        <div className="font-black text-red-400 leading-none mb-1" style={{ fontSize: 48 }}>—</div>
      ) : (
        <div className="font-black text-white leading-none mb-1 tabular-nums transition-all duration-300 relative" style={{ fontSize: 72 }}>
          {count}
          {isFetching && (
            <span className="absolute -top-1 -right-4 w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>
      )}

      <div className="text-sm text-gray-300 mb-1">eligible customers</div>

      {/* Status line */}
      <div className="text-xs text-gray-500 mb-2">
        {ruleCount === 0
          ? "Select an audience or add rules"
          : isError
          ? "Query failed — see error above"
          : isFetching
          ? "Updating…"
          : `${ruleCount} filter${ruleCount > 1 ? "s" : ""} active`}
      </div>

      {/* Quality score */}
      {qualityGrade && (
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className={`text-sm font-black ${gradeColor}`}>Quality {qualityScore} · {qualityGrade}</span>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "excluded",         value: excluded },
          { label: "expected replies",  value: expectedReplies },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
            <div className="text-xl font-black">{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Planner version + timestamp */}
      {plannerVersion && (
        <div className="mt-3 text-xs text-gray-600 font-mono">
          Planner v{plannerVersion}
          {updatedSecondsAgo !== null && ` · Updated ${updatedSecondsAgo}s ago`}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AudienceStats row
// ─────────────────────────────────────────────────────────────────────────────

function AudienceStatsRow({ stats }: { stats: { avgDaysSinceLastBooking: number; avgLastBookingPrice: number; recurringPercent: number } | null }) {
  if (!stats) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {[
        { label: `Avg ticket: $${stats.avgLastBookingPrice}` },
        { label: `Avg ${stats.avgDaysSinceLastBooking}d since booking` },
        { label: `${stats.recurringPercent}% former recurring` },
      ].map((s) => (
        <span key={s.label} className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600 border border-gray-200">
          {s.label}
        </span>
      ))}
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
  isUnsupported,
  dragHandleProps,
}: {
  rule: ActiveRule;
  onUpdate: (uid: string, patch: Partial<ActiveRule>) => void;
  onRemove: (uid: string) => void;
  isUnsupported: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const def = RULE_CATALOG.find((d) => d.id === rule.field)!;
  if (!def) return null;

  return (
    <div
      className={[
        "flex items-center gap-2 p-3 rounded-2xl border bg-white shadow-sm group",
        isUnsupported ? "border-amber-200 bg-amber-50/30" : "border-gray-200",
      ].join(" ")}
      style={{ userSelect: "none" }}
    >
      {/* Drag handle */}
      <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 flex-shrink-0">
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Category icon */}
      <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${def.bgColor}`}>
        <span className={def.color}>{def.icon}</span>
      </div>

      {/* Label + unsupported badge */}
      <div className="flex flex-col flex-shrink-0 min-w-[90px]">
        <span className="text-sm font-bold text-gray-800 leading-tight">{def.label}</span>
        {isUnsupported && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-600 mt-0.5">
            <Info className="w-2.5 h-2.5" />
            Not in live count
          </span>
        )}
      </div>

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
          <span className="text-sm font-semibold text-gray-500 px-2 italic">
            {rule.operator === "is_true" ? "Yes" : "No"}
          </span>
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
            {def.unit && <span className="text-xs text-gray-400 font-medium flex-shrink-0">{def.unit}</span>}
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
// RulePicker
// ─────────────────────────────────────────────────────────────────────────────

function RulePicker({ onAdd, onClose, supportedFields }: {
  onAdd: (field: RuleField) => void;
  onClose: () => void;
  supportedFields: Set<RuleField>;
}) {
  const [activeCategory, setActiveCategory] = useState("Geography");
  const rulesInCategory = RULE_CATALOG.filter((r) => r.category === activeCategory);
  const cat = CATEGORIES.find((c) => c.name === activeCategory)!;

  return (
    <div
      className="absolute z-50 top-full left-0 mt-2 w-[480px] max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-3xl shadow-2xl overflow-hidden"
      style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span className="font-black text-gray-900 text-sm">Add a Rule</span>
        <button onClick={onClose} className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
          <X className="w-3.5 h-3.5 text-gray-500" />
        </button>
      </div>
      <div className="flex" style={{ height: 340 }}>
        <div className="w-40 border-r border-gray-100 flex flex-col py-2 flex-shrink-0 overflow-y-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c.name}
              onClick={() => setActiveCategory(c.name)}
              className={["flex items-center gap-2 px-3 py-2.5 text-left text-xs font-bold transition-colors", activeCategory === c.name ? `${c.bg} ${c.color}` : "text-gray-500 hover:bg-gray-50"].join(" ")}
            >
              <span className={activeCategory === c.name ? c.color : "text-gray-400"}>{c.icon}</span>
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-3">
          <div className={`text-xs font-black uppercase tracking-widest mb-3 px-1 ${cat.color}`}>{activeCategory}</div>
          <div className="flex flex-col gap-1">
            {rulesInCategory.map((rule) => {
              const supported = supportedFields.has(rule.id);
              return (
                <button
                  key={rule.id}
                  onClick={() => { onAdd(rule.id); onClose(); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 text-left group transition-colors"
                >
                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 ${rule.bgColor}`}>
                    <span className={rule.color}>{rule.icon}</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-800 group-hover:text-gray-900">{rule.label}</div>
                    <div className="text-xs text-gray-400">
                      {rule.operator.slice(0, 3).join(" · ")}
                      {rule.unit ? ` · ${rule.unit}` : ""}
                    </div>
                  </div>
                  {!supported && (
                    <span className="text-[10px] font-bold text-amber-500 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Preview only</span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-gray-500" />
                </button>
              );
            })}
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
  supportedFields,
}: {
  rules: ActiveRule[];
  setRules: React.Dispatch<React.SetStateAction<ActiveRule[]>>;
  supportedFields: Set<RuleField>;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const addRule = (field: RuleField) => {
    const def = RULE_CATALOG.find((d) => d.id === field)!;
    setRules((prev) => [
      ...prev,
      {
        uid: makeUid(),
        field,
        operator: def.operator[0] as RuleOperator,
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

  const QUICK_PRESETS = [
    { label: "Win Back",       rules: [{ field: "lastBookingDays" as RuleField, op: ">",       val: "90" }] },
    { label: "High Value",     rules: [{ field: "lifetimeRevenue" as RuleField, op: ">",       val: "500" }] },
    { label: "5★ No Issues",   rules: [{ field: "reviewScore" as RuleField,    op: ">=",      val: "5" }, { field: "hasComplaint" as RuleField, op: "is_false", val: "false" }] },
    { label: "AI Ready",       rules: [{ field: "aiLikelihoodToRespond" as RuleField, op: ">", val: "60" }] },
    { label: "Not Texted 30d", rules: [{ field: "lastSmsDays" as RuleField,    op: ">",       val: "30" }] },
  ];

  const applyPreset = (preset: typeof QUICK_PRESETS[0]) => {
    const newRules: ActiveRule[] = preset.rules.map((r) => ({
      uid: makeUid(),
      field: r.field,
      operator: r.op as RuleOperator,
      value: r.val,
    }));
    setRules((prev) => {
      const existingFields = new Set(prev.map((r) => r.field));
      return [...prev, ...newRules.filter((r) => !existingFields.has(r.field))];
    });
  };

  const unsupportedCount = rules.filter((r) => !supportedFields.has(r.field)).length;

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-gray-500" />
          Audience Rules
          {unsupportedCount > 0 && (
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              {unsupportedCount} preview-only
            </span>
          )}
        </h2>
        {rules.length > 0 && (
          <button onClick={() => setRules([])} className="text-xs text-red-400 font-bold hover:text-red-600 transition-colors flex items-center gap-1">
            <X className="w-3 h-3" /> Clear all
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-4">Every rule narrows the audience. All rules are combined with AND logic.</p>

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
              className={["transition-all", overIdx === idx && dragIdx !== idx ? "opacity-50 scale-95" : ""].join(" ")}
            >
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
                isUnsupported={!supportedFields.has(rule.field)}
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
          <RulePicker onAdd={addRule} onClose={() => setShowPicker(false)} supportedFields={supportedFields} />
        )}
      </div>

      {/* Category legend */}
      {rules.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const count = rules.filter((r) => RULE_CATALOG.find((d) => d.id === r.field)?.category === c.name).length;
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
// SafetySummary — wired to real exclusion breakdown
// ─────────────────────────────────────────────────────────────────────────────

function SafetySummary({ breakdown }: {
  breakdown: { stopOptOut: number; openComplaint: number; recentlyTexted: number; duplicate: number } | null;
}) {
  const stats = [
    { icon: <Ban className="w-4 h-4 text-red-500" />,            label: "STOP / opt-out",  value: breakdown?.stopOptOut ?? 0,    color: "text-red-600" },
    { icon: <AlertTriangle className="w-4 h-4 text-amber-500" />, label: "Open issues",     value: breakdown?.openComplaint ?? 0, color: "text-amber-600" },
    { icon: <Clock className="w-4 h-4 text-blue-500" />,          label: "Recently texted", value: breakdown?.recentlyTexted ?? 0, color: "text-blue-600" },
    { icon: <Copy className="w-4 h-4 text-gray-400" />,           label: "Duplicates",      value: breakdown?.duplicate ?? 0,     color: "text-gray-500" },
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
// LiveAudiencePreview — wired to real sample customers
// ─────────────────────────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 text-amber-400 text-sm">
      {[1,2,3,4,5].map((i) => <span key={i} style={{ opacity: i <= rating ? 1 : 0.25 }}>★</span>)}
    </div>
  );
}

function LiveAudiencePreview({ sampleIncluded }: {
  sampleIncluded: Array<{
    displayName: string;
    daysSinceLastBooking: number;
    reviewScore: number | null;
    frequency: string;
    matchedBecause: string[];
    confidence: number;
  }> | null;
}) {
  if (!sampleIncluded || sampleIncluded.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Users className="w-4 h-4 text-gray-600" />
        Live Audience Preview
        <span className="text-xs font-normal text-gray-400 ml-1">({sampleIncluded.length} sample)</span>
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {sampleIncluded.slice(0, 3).map((p, i) => (
          <div key={i} className="border border-gray-100 rounded-2xl p-3 bg-white">
            <div className="flex items-start justify-between mb-1">
              <div className="font-bold text-gray-900 text-sm">{p.displayName}</div>
              <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1">
                {p.confidence}%
              </span>
            </div>
            {p.reviewScore !== null && <StarRating rating={p.reviewScore} />}
            <div className="text-xs text-gray-500 mt-2 leading-relaxed">
              Last booking: {p.daysSinceLastBooking}d ago<br />
              {p.frequency}
            </div>
            {p.matchedBecause.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {p.matchedBecause.slice(0, 3).map((tag, j) => (
                  <span key={j} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MessageEditor
// ─────────────────────────────────────────────────────────────────────────────

const MSG_TOKENS = [
  { token: "{{first_name}}",              label: "first name",         color: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
  { token: "{{last_service}}",             label: "last service",        color: "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100" },
  { token: "{{last_price}}",               label: "last price",          color: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  { token: "{{days_since_last_booking}}",  label: "days since booking",  color: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
  { token: "{{city}}",                     label: "city",                color: "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100" },
  { token: "{{frequency}}",                label: "frequency",           color: "bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100" },
  { token: "{{bedrooms}}",                 label: "bedrooms",            color: "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100" },
  { token: "{{preferred_team}}",           label: "preferred team",      color: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100" },
] as const;

function MessageEditor({ message, setMessage }: { message: string; setMessage: (m: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const charCount = message.length;
  const smsCount = Math.ceil(charCount / 160) || 1;

  const insertToken = (token: string) => {
    const el = textareaRef.current;
    if (!el) { setMessage(message + token); return; }
    const start = el.selectionStart ?? message.length;
    const end = el.selectionEnd ?? message.length;
    const next = message.slice(0, start) + token + message.slice(end);
    setMessage(next);
    // Restore cursor after token
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-gray-600" />
        Message
      </h2>
      {/* Token picker */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {MSG_TOKENS.map(({ token, label, color }) => (
          <button
            key={token}
            type="button"
            onClick={() => insertToken(token)}
            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors ${color}`}
            title={`Insert ${token}`}
          >
            + {label}
          </button>
        ))}
      </div>
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="min-h-[110px] rounded-xl border-gray-300 text-sm leading-relaxed resize-none font-mono"
        placeholder="Write your message…"
      />
      <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
        <span>{charCount} chars</span>
        <span>{smsCount} SMS segment{smsCount > 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PersonalizedPreviews — uses real sample names
// ─────────────────────────────────────────────────────────────────────────────

function PersonalizedPreviews({ message, sampleNames }: { message: string; sampleNames: string[] }) {
  const previews = sampleNames.length > 0
    ? sampleNames.slice(0, 3).map((n) => ({ displayName: n, firstName: n.split(" ")[0], area: "Arlington" }))
    : [
        { displayName: "Jennifer S.", firstName: "Jennifer", area: "Arlington" },
        { displayName: "Alex G.",     firstName: "Alex",     area: "Arlington" },
        { displayName: "Nina L.",     firstName: "Nina",     area: "Arlington" },
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
          <div key={p.displayName} className="rounded-3xl p-4 min-h-[200px]" style={{ background: "#101828" }}>
            <div className="text-white font-bold text-sm mb-1">{p.displayName}</div>
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
// StepFinalApproval — uses real recipient count
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Campaign History funnel helpers
// ─────────────────────────────────────────────────────────────────────────────

const funnelColorMap: Record<string, string> = {
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  blue:   "bg-blue-50 text-blue-700 border-blue-200",
  emerald:"bg-emerald-50 text-emerald-700 border-emerald-200",
  green:  "bg-green-50 text-green-700 border-green-200",
  gray:   "bg-gray-50 text-gray-400 border-gray-200",
};

function FunnelStep({
  label,
  sublabel,
  color,
  isFirst = false,
  faded = false,
}: {
  label: string;
  sublabel?: string;
  color: string;
  isFirst?: boolean;
  faded?: boolean;
}) {
  const colorCls = funnelColorMap[color] ?? funnelColorMap.gray;
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-xl border text-sm font-bold ${colorCls} ${faded ? "opacity-50" : ""}`}>
      <span>{label}</span>
      {sublabel && <span className="text-[11px] font-normal opacity-70">{sublabel}</span>}
    </div>
  );
}

function FunnelArrow({ faded = false }: { faded?: boolean }) {
  return (
    <div className={`flex justify-center py-0.5 ${faded ? "opacity-30" : "opacity-50"}`}>
      <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
        <path d="M6 10L0 0h12L6 10z" fill="#6b7280" />
      </svg>
    </div>
  );
}

// ReviewAudienceModal — paginated frozen recipient list with manual removal
// ─────────────────────────────────────────────────────────────────────────────

function ReviewAudienceModal({
  open,
  onOpenChange,
  campaignId,
  campaignStatus,
  frozenCount,
  onApprove,
  isApproving,
  onCountChange,
  onUnfreeze,
  isUnfreezing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  campaignId: number | null;
  campaignStatus: string | null;
  frozenCount: number;
  onApprove: () => void;
  isApproving: boolean;
  onCountChange: (newCount: number) => void;
  onUnfreeze: () => void;
  isUnfreezing: boolean;
}) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const utils = trpc.useUtils();

  const { data, isFetching } = trpc.smsCampaign.listRecipients.useQuery(
    { campaignId: campaignId!, page, pageSize: PAGE_SIZE },
    { enabled: open && campaignId !== null }
  );

  const removeRecipient = trpc.smsCampaign.removeRecipient.useMutation({
    onSuccess: (result) => {
      toast.success(`Recipient removed. ${result.remainingCount} remaining.`);
      onCountChange(result.remainingCount);
      utils.smsCampaign.listRecipients.invalidate({ campaignId: campaignId! });
      utils.smsCampaign.getCampaign.invalidate({ campaignId: campaignId! });
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const isFrozen = campaignStatus === "FROZEN";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Review Frozen Audience
            {frozenCount > 0 && (
              <Badge variant="secondary" className="ml-1 font-black">{frozenCount} recipients</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Status banner */}
        {!isFrozen && campaignStatus && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-700 font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            Campaign is {campaignStatus} — recipient list is locked.
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isFetching && !data ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : data?.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Users className="w-10 h-10 mb-3" />
              <p className="text-sm font-semibold">No recipients found</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-xs font-black uppercase tracking-widest text-gray-400">#</th>
                  <th className="text-left py-2 px-3 text-xs font-black uppercase tracking-widest text-gray-400">Name</th>
                  <th className="text-left py-2 px-3 text-xs font-black uppercase tracking-widest text-gray-400">Phone</th>
                  <th className="text-left py-2 px-3 text-xs font-black uppercase tracking-widest text-gray-400">Last Booking</th>
                  <th className="text-left py-2 px-3 text-xs font-black uppercase tracking-widest text-gray-400">Ticket</th>
                  {isFrozen && <th className="py-2 px-3" />}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r, idx) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-2 px-3 text-gray-400 font-mono text-xs">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="py-2 px-3 font-semibold text-gray-900">{r.snapshotName ?? "—"}</td>
                    <td className="py-2 px-3 text-gray-500 font-mono text-xs">{r.phone}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs">
                      {r.snapshotLastService ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs">
                      {r.snapshotLastPrice !== null ? `$${r.snapshotLastPrice}` : "—"}
                    </td>
                    {isFrozen && (
                      <td className="py-2 px-3">
                        <button
                          onClick={() => removeRecipient.mutate({ campaignId: campaignId!, recipientId: r.id })}
                          disabled={removeRecipient.isPending}
                          className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Remove from campaign"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Page {page} of {totalPages} · {data?.total ?? 0} total
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg h-7 px-2">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg h-7 px-2">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl font-bold">Close</Button>
          {isFrozen && (
            <Button
              variant="outline"
              onClick={onUnfreeze}
              disabled={isUnfreezing || isApproving}
              className="rounded-xl font-bold border-orange-300 text-orange-700 hover:bg-orange-50"
            >
              {isUnfreezing ? (
                <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Unfreezing…</span>
              ) : (
                <span className="flex items-center gap-1.5"><LockOpen className="w-3.5 h-3.5" />Unfreeze (back to Draft)</span>
              )}
            </Button>
          )}
          {isFrozen && (
            <Button
              onClick={onApprove}
              disabled={isApproving || isUnfreezing || frozenCount === 0}
              className="rounded-xl font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-6"
            >
              {isApproving ? (
                <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Approving…</span>
              ) : (
                <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />Approve {frozenCount} Recipients</span>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StepFinalApproval — Stage 4: real Save Draft + Freeze + Approve flow
// ─────────────────────────────────────────────────────────────────────────────

function StepFinalApproval({
  recipientCount,
  testSent,
  stopOptOut,
  campaignId,
  campaignStatus,
  frozenCount,
  isApprovingCampaign,
  onApprove,
  onOpenReview,
}: {
  recipientCount: number;
  testSent: boolean;
  stopOptOut: number;
  campaignId: number | null;
  campaignStatus: string | null;
  frozenCount: number;
  isApprovingCampaign: boolean;
  onApprove: () => void;
  onOpenReview: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");

  const isFrozen = campaignStatus === "FROZEN";
  const isApproved = campaignStatus === "APPROVED";
  const expectedConfirm = `SEND ${frozenCount || recipientCount}`;
  const isReady = isApproved && confirmText.trim() === expectedConfirm && (frozenCount || recipientCount) > 0;

  const statusBadge = () => {
    if (isApproved) return <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200"><CheckCircle2 className="w-3 h-3" />Approved</span>;
    if (isFrozen)   return <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-blue-50 text-blue-700 border border-blue-200"><Lock className="w-3 h-3" />Frozen</span>;
    if (campaignId) return <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-200"><Clock className="w-3 h-3" />Draft saved</span>;
    return <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-gray-100 text-gray-500 border border-gray-200"><Unlock className="w-3 h-3" />Not saved</span>;
  };

  const checks = [
    { label: "Audience built",        status: recipientCount > 0 ? "passed" : "pending" },
    { label: "Test SMS sent",         status: testSent ? "passed" : "pending" },
    { label: "Quiet hours protected",  status: "passed", note: "9am–8pm local" },
    { label: "Opt-outs excluded",     status: "passed", note: `${stopOptOut} excluded` },
    { label: "Audience frozen",       status: isFrozen || isApproved ? "passed" : "pending", note: isFrozen || isApproved ? `${frozenCount} locked` : "Freeze required" },
    { label: "Admin approved",        status: isApproved ? "passed" : "pending" },
    { label: "Type confirmation",     status: confirmText === expectedConfirm ? "passed" : "required", note: `Type: ${expectedConfirm}` },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-900 text-base flex items-center gap-2">
          <Send className="w-4 h-4 text-gray-600" />
          Final Approval
        </h2>
        {statusBadge()}
      </div>

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
              <td className="py-2.5 text-sm text-gray-700">{c.label}</td>
              <td className="py-2.5">
                {c.status === "passed" ? <span className="flex items-center gap-1 text-emerald-600 text-sm font-semibold"><CheckCircle2 className="w-3.5 h-3.5" />Passed</span>
                  : c.status === "pending" ? <span className="flex items-center gap-1 text-amber-500 text-sm font-semibold"><Clock className="w-3.5 h-3.5" />Pending</span>
                  : <span className="text-sm font-semibold text-gray-500">Required: <strong className="text-gray-900">{c.note}</strong></span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Hint when draft saved but not yet frozen */}
      {!isFrozen && !isApproved && campaignId && (
        <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-700">
          <strong>Next:</strong> Click “Freeze Audience” (top of page) to lock the recipient list.
        </div>
      )}

      {/* Confirm input — only shown after approval */}
      {isApproved && (
        <div className="mb-5">
          <div className="text-xs font-bold text-gray-500 mb-1.5">Type <span className="font-black text-gray-900">{expectedConfirm}</span> to unlock sending</div>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Type "${expectedConfirm}" here`}
            className={["rounded-xl font-mono", confirmText === expectedConfirm ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-gray-300"].join(" ")}
          />
        </div>
      )}

      {/* Review button (visible in FROZEN state) + Send button */}
      <div className="flex flex-wrap justify-end items-center gap-2">
        {isFrozen && (
          <Button
            variant="outline"
            onClick={onOpenReview}
            className="rounded-xl font-bold border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Review {frozenCount} Recipients</span>
          </Button>
        )}
        {isApproved && (
          <Button
            variant="outline"
            onClick={onOpenReview}
            className="rounded-xl font-bold border-gray-300"
          >
            <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />View {frozenCount} Recipients</span>
          </Button>
        )}
        <Button
          onClick={() => {
            if (!isReady) { toast.error("Complete all checks first"); return; }
            toast.success("Campaign send queued! (coming in Stage 5)");
          }}
          disabled={!isReady}
          className={["rounded-xl font-bold px-6", isReady ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"].join(" ")}
        >
          <Zap className="w-4 h-4 mr-1.5" />
          {isApproved ? "Send Campaign" : "Send locked"}
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
  const [campaignName, setCampaignName] = useState("");
  const [testSent, setTestSent] = useState(false);
  const [rules, setRules] = useState<ActiveRule[]>([]);
  const [selectedPresets, setSelectedPresets] = useState<Set<AudiencePresetId>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null);
  // Stage 4: campaign lifecycle state
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [campaignStatus, setCampaignStatus] = useState<string | null>(null);
  const [frozenCount, setFrozenCount] = useState(0);
  const [nameLocked, setNameLocked] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'editor'>('campaigns');

  // Build the AudienceDefinition for the planner query
  // We use a stable supported set — starts empty, gets populated from first planner response
  const [supportedFields, setSupportedFields] = useState<Set<RuleField>>(new Set([
    // Optimistic defaults so rules show correct badges before first query
    "lastBookingDays", "bookingCount", "recurringStatus", "serviceType",
    "bedrooms", "bathrooms", "lifetimeRevenue", "avgTicket", "lastBookingPrice",
    "reviewScore", "hasComplaint", "lastSmsDays", "stopStatus",
  ] as RuleField[]));

  // Translate rules to server format for the query input
  const serverRules = useMemo(() => {
    return rules
      .filter((r) => supportedFields.has(r.field) && SERVER_OPERATORS.has(r.operator) && r.value !== "")
      .map((r) => {
        const def = getRuleDef(r.field);
        const isNumeric = def?.valueType === "number" || def?.valueType === "days";
        return {
          field: r.field,
          op: r.operator as string,
          value: isNumeric ? Number(r.value) : r.operator === "is_true" ? true : r.operator === "is_false" ? false : r.value,
        };
      });
  }, [rules, supportedFields]);

  const audienceDefinition = useMemo(() => ({
    presets: [...selectedPresets] as string[],
    includeRules: serverRules,
    excludeRules: [],
    geography: null,
  }), [selectedPresets, serverRules]);

  // Debounce the query input 800ms
  const debouncedDef = useDebounce(audienceDefinition, 800);

  // ── Stage 4 & 5: campaign lifecycle mutations (lifted to top level so buttons are visible in header) ──
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sendConfirmOpen, setSendConfirmOpen] = useState(false);
  const [sendConfirmText, setSendConfirmText] = useState("");

  const saveDraftMutation = trpc.smsCampaign.saveDraft.useMutation({
    onSuccess: (data) => {
      setCampaignId(data.campaignId);
      setNameLocked(true);
      toast.success("Draft saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const freezeAudienceMutation = trpc.smsCampaign.freezeAudience.useMutation({
    onSuccess: (result) => {
      setCampaignStatus("FROZEN");
      setFrozenCount(result.frozenCount);
      toast.success(`Audience frozen — ${result.frozenCount} recipients locked in`);
      setReviewOpen(true);
    },
    onError: (err) => toast.error(err.message),
  });

  const approveCampaignMutation = trpc.smsCampaign.approveCampaign.useMutation({
    onSuccess: () => {
      setCampaignStatus("APPROVED");
      setReviewOpen(false);
      toast.success("Campaign approved — ready to send");
    },
    onError: (err) => toast.error(err.message),
  });

  const unfreezeCampaignMutation = trpc.smsCampaign.unfreezeCampaign.useMutation({
    onSuccess: () => {
      setCampaignStatus("DRAFT");
      setFrozenCount(0);
      setReviewOpen(false);
      toast.success("Campaign unfrozen — back to Draft. You can edit the audience and re-freeze.");
    },
    onError: (err) => toast.error(err.message),
  });

  const sendCampaignMutation = trpc.smsCampaign.sendCampaign.useMutation({
    onSuccess: (result) => {
      setCampaignStatus("COMPLETED");
      setSendConfirmOpen(false);
      setSendConfirmText("");
      toast.success(`Campaign sent — ${result.sentCount} messages delivered${result.failedCount > 0 ? `, ${result.failedCount} failed` : ""}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleSend = () => {
    if (!campaignId) return;
    const expected = `SEND ${frozenCount}`;
    if (sendConfirmText.trim() !== expected) {
      toast.error(`Type exactly: ${expected}`);
      return;
    }
    sendCampaignMutation.mutate({ campaignId });
  };

  const handleSaveDraft = () => {
    saveDraftMutation.mutate({
      ...(campaignId ? { campaignId } : {}),
      name: campaignName || "Untitled Campaign",
      audienceDefinition: audienceDefinition as Parameters<typeof saveDraftMutation.mutate>[0]["audienceDefinition"],
      messageTemplate: message,
    });
  };

  const handleFreeze = () => {
    if (!campaignId) { toast.error("Save the draft first before freezing"); return; }
    const count = plannerResult?.summary.matchedCustomers ?? 0;
    if (count === 0) { toast.error("Audience is empty — add rules or select a preset"); return; }
    freezeAudienceMutation.mutate({ campaignId });
  };

  const hasAudience = selectedPresets.size > 0 || rules.length > 0;

  const plannerQuery = trpc.smsCampaign.planAudience.useQuery(
    debouncedDef as Parameters<typeof trpc.smsCampaign.planAudience.useQuery>[0],
    {
      enabled: hasAudience && !!debouncedDef,
      placeholderData: (prev) => prev,  // RQ v5 replacement for keepPreviousData
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }
  );
  const plannerResult = plannerQuery.data ?? null;

  useEffect(() => {
    if (plannerQuery.data) {
      if (plannerQuery.data.supportedRuleFields) {
        setSupportedFields(new Set(plannerQuery.data.supportedRuleFields as RuleField[]));
      }
      setUpdatedAt(Date.now());
    }
  }, [plannerQuery.data]);

  useEffect(() => {
    if (plannerQuery.isError) {
      console.error('[planAudience] error:', plannerQuery.error);
    }
  }, [plannerQuery.isError, plannerQuery.error]);

  // "Updated N seconds ago" timer
  useEffect(() => {
    if (!updatedAt) return;
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - updatedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [updatedAt]);

  const plannerVersion = plannerResult?.ruleHash ? plannerResult.ruleHash.slice(0, 4) : null;
  const ruleCount = rules.length + selectedPresets.size;
  const sampleNames = plannerResult?.sampleIncluded?.map((s) => s.displayName) ?? [];

  // Campaign history
  const campaignsQuery = trpc.smsCampaign.listCampaigns.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  // ── Resume a campaign from history ────────────────────────────────────────
  const [resumingId, setResumingId] = useState<number | null>(null);
  const getCampaignQuery = trpc.smsCampaign.getCampaign.useQuery(
    { campaignId: resumingId! },
    {
      enabled: resumingId !== null,
      staleTime: 0,
    }
  );

  useEffect(() => {
    if (!getCampaignQuery.data || resumingId === null) return;
    const c = getCampaignQuery.data;
    // Hydrate editor state from saved campaign
    setCampaignId(c.id);
    setCampaignName(c.name ?? "");
    setNameLocked(true);
    setCampaignStatus(c.status ?? null);
    setFrozenCount(c.frozenRecipientCount ?? 0);
    if (c.messageTemplate) setMessage(c.messageTemplate);
    // Restore audience definition if available
    if (c.audienceDefinition) {
      try {
        const def = typeof c.audienceDefinition === "string"
          ? JSON.parse(c.audienceDefinition)
          : c.audienceDefinition;
        if (Array.isArray(def.presets)) {
          setSelectedPresets(new Set(def.presets as AudiencePresetId[]));
        }
        if (Array.isArray(def.includeRules)) {
          setRules(def.includeRules.map((r: { field: RuleField; op: string; value: unknown }) => ({
            uid: crypto.randomUUID(),
            field: r.field,
            operator: r.op as RuleOperator,
            value: String(r.value ?? ""),
          })));
        }
      } catch { /* ignore parse errors */ }
    }
    // Open review screen if already frozen/approved
    if (c.status === "FROZEN" || c.status === "APPROVED") {
      setReviewOpen(true);
    }
    // Switch to editor tab and scroll to top
    setActiveTab('editor');
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.success(`Loaded "${c.name}"`);
    setResumingId(null);
  }, [getCampaignQuery.data, resumingId]);

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-black text-gray-900" style={{ letterSpacing: "-0.03em" }}>SMS Campaign Command Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Build the safest possible audience before anyone can send anything.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-4">
        <button
          onClick={() => setActiveTab('campaigns')}
          className={[
            "flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors -mb-px",
            activeTab === 'campaigns'
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          ].join(" ")}
        >
          <History className="w-4 h-4" />
          Campaigns
          {campaignsQuery.data && campaignsQuery.data.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-gray-100 text-gray-500">
              {campaignsQuery.data.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          className={[
            "flex items-center gap-2 px-4 py-2.5 text-sm font-bold border-b-2 transition-colors -mb-px",
            activeTab === 'editor'
              ? "border-indigo-600 text-indigo-700"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          ].join(" ")}
        >
          <Megaphone className="w-4 h-4" />
          {campaignId ? campaignName || "Editing Campaign" : "New Campaign"}
          {campaignId && (
            <span className={[
              "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-black border",
              campaignStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              campaignStatus === 'FROZEN'   ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                              'bg-amber-50 text-amber-700 border-amber-200'
            ].join(" ")}>
              {campaignStatus === 'APPROVED' ? 'APPROVED' :
               campaignStatus === 'FROZEN'   ? 'FROZEN' : 'DRAFT'}
            </span>
          )}
        </button>
        {/* New campaign button */}
        {activeTab === 'campaigns' && (
          <button
            onClick={() => {
              setCampaignId(null);
              setCampaignName("");
              setCampaignStatus(null);
              setFrozenCount(0);
              setNameLocked(false);
              setMessage(DEFAULT_MESSAGE);
              setRules([]);
              setSelectedPresets(new Set());
              setActiveTab('editor');
            }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Campaign
          </button>
        )}
      </div>

      {/* ── CAMPAIGNS TAB ─────────────────────────────────────────────── */}
      {activeTab === 'campaigns' && (
        <div>
          {campaignsQuery.isLoading && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading campaigns…
            </div>
          )}
          {campaignsQuery.data && campaignsQuery.data.length === 0 && (
            <div className="py-16 text-center">
              <Megaphone className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-gray-500">No campaigns yet</p>
              <p className="text-xs text-gray-400 mt-1">Click "New Campaign" to get started</p>
            </div>
          )}
          {campaignsQuery.data && campaignsQuery.data.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {campaignsQuery.data.map((c) => {
                const sent = c.sentCount ?? 0;
                const replied = c.repliedCount ?? 0;
                const booked = c.bookedCount ?? 0;
                const convRate = sent > 0 ? ((booked / sent) * 100).toFixed(1) : null;
                const isCompleted = c.status === 'COMPLETED';
                const isSending = c.status === 'SENDING';
                const isFrozenOrApproved = c.status === 'FROZEN' || c.status === 'APPROVED';
                const statusColor = isCompleted ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                  : isSending ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : isFrozenOrApproved ? 'bg-blue-100 text-blue-700 border-blue-200'
                  : 'bg-gray-100 text-gray-500 border-gray-200';
                return (
                  <div key={c.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all">
                    {/* Card header */}
                    <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-gray-900 truncate">{c.name}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {c.createdByName} · {new Date(c.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black border ${statusColor}`}>
                          {c.status}
                        </span>
                      </div>
                    </div>
                    {/* Card action button */}
                    <div className="px-4 pt-2 pb-3">
                      <button
                        onClick={() => setResumingId(c.id)}
                        disabled={resumingId === c.id && getCampaignQuery.isFetching}
                        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-bold transition-colors border
                          bg-gray-50 text-gray-600 border-gray-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200
                          disabled:opacity-50 disabled:cursor-wait"
                      >
                        {resumingId === c.id && getCampaignQuery.isFetching ? (
                          <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                        ) : isCompleted ? (
                          <><RotateCcw className="w-3 h-3" /> View Results</>
                        ) : isFrozenOrApproved ? (
                          <><ShieldCheck className="w-3 h-3" /> Review Audience</>
                        ) : (
                          <><Pencil className="w-3 h-3" /> Resume Editing</>
                        )}
                      </button>
                    </div>
                    {/* Funnel cascade */}
                    <div className="px-4 pb-3 space-y-0">
                      <FunnelStep
                        label={isCompleted || isSending ? `${sent.toLocaleString()} sent` : `${(c.frozenRecipientCount ?? 0).toLocaleString()} frozen`}
                        sublabel={isCompleted || isSending ? "Delivered" : "Recipients"}
                        color="indigo"
                        isFirst
                      />
                      {isCompleted && (
                        <>
                          <FunnelArrow />
                          <FunnelStep label={`${replied.toLocaleString()} replied`} sublabel={sent > 0 ? `${((replied/sent)*100).toFixed(1)}% reply rate` : ""} color="blue" />
                          <FunnelArrow />
                          <FunnelStep label={`${booked.toLocaleString()} booked`} sublabel={convRate ? `${convRate}% conversion` : ""} color="emerald" />
                          {(c.estimatedRevenue ?? 0) > 0 && (
                            <><FunnelArrow /><FunnelStep label={`$${(c.estimatedRevenue ?? 0).toLocaleString()} revenue`} sublabel="Estimated" color="green" /></>
                          )}
                        </>
                      )}
                      {!isCompleted && isFrozenOrApproved && (
                        <>
                          <FunnelArrow faded />
                          <FunnelStep label={`~${(c.estimatedReplies ?? 0).toLocaleString()} replies`} sublabel="Estimated" color="gray" faded />
                          <FunnelArrow faded />
                          <FunnelStep label={`~${(c.estimatedBookings ?? 0).toLocaleString()} bookings`} sublabel="Estimated" color="gray" faded />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EDITOR TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'editor' && (
      <div>
      {/* Campaign name + action bar */}
      <div className="flex items-center gap-3 mt-0 mb-1 flex-wrap">
        {nameLocked ? (
          /* Locked: looks like a saved chip — no input affordance */
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 rounded-xl">
              <Megaphone className="w-3.5 h-3.5 text-indigo-200 flex-shrink-0" />
              <span className="text-sm font-black text-white truncate max-w-[200px]">{campaignName}</span>
              {campaignId && <span className="text-xs text-indigo-300 font-mono">#{campaignId}</span>}
            </div>
            <button
              onClick={() => setNameLocked(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="Rename campaign"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          /* Editing: clear input card with focus ring */
          <div className="flex items-center gap-2 px-3 py-2 bg-white border-2 border-indigo-400 rounded-xl shadow-sm ring-2 ring-indigo-100 min-w-[240px]">
            <Megaphone className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 leading-none mb-0.5">Campaign Name</span>
              <input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                onBlur={() => { if (campaignName.trim()) setNameLocked(true); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && campaignName.trim()) setNameLocked(true); }}
                placeholder="e.g. July Win-Back"
                className="text-sm font-black text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300 w-full leading-tight"
                autoFocus
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {/* Save Draft */}
          {!campaignStatus && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={saveDraftMutation.isPending}
              className="rounded-xl font-bold h-9"
            >
              {saveDraftMutation.isPending
                ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</span>
                : <span className="flex items-center gap-1.5"><Save className="w-3.5 h-3.5" />Save Draft</span>}
            </Button>
          )}
          {/* Freeze Audience */}
          {campaignId && campaignStatus !== 'APPROVED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={campaignStatus === 'FROZEN' ? () => setReviewOpen(true) : handleFreeze}
              disabled={freezeAudienceMutation.isPending}
              className={["rounded-xl font-bold h-9",
                campaignStatus === 'FROZEN' ? "border-blue-300 text-blue-700 hover:bg-blue-50" : "border-gray-300"
              ].join(' ')}
            >
              {freezeAudienceMutation.isPending
                ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Freezing…</span>
                : campaignStatus === 'FROZEN'
                ? <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Review {frozenCount} Recipients</span>
                : <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />Freeze Audience</span>}
            </Button>
          )}
          {/* Send Campaign — shown when APPROVED */}
          {campaignStatus === 'APPROVED' && (
            <Button
              size="sm"
              onClick={() => setSendConfirmOpen(true)}
              disabled={sendCampaignMutation.isPending}
              className="rounded-xl font-bold h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {sendCampaignMutation.isPending
                ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Sending…</span>
                : <span className="flex items-center gap-1.5"><Send className="w-3.5 h-3.5" />Send {frozenCount} Messages</span>}
            </Button>
          )}
        </div>
      </div>

      <WorkflowBar step={step} onStep={setStep} />

      <div className="grid grid-cols-1 lg:grid-cols-[440px_1fr] gap-4 mt-2">
        {/* LEFT */}
        <div>
          <HeroCard
            plannerResult={plannerResult}
            isFetching={plannerQuery.isFetching}
            isLoading={plannerQuery.isLoading}
            isError={plannerQuery.isError}
            errorMessage={plannerQuery.error ? String((plannerQuery.error as any)?.message ?? plannerQuery.error) : null}
            ruleCount={ruleCount}
            plannerVersion={plannerVersion}
            updatedSecondsAgo={secondsAgo}
          />
          {plannerResult?.stats && (
            <AudienceStatsRow stats={plannerResult.stats} />
          )}
          <AudienceSentence selectedPresets={selectedPresets} rules={rules} />
          <SavedAudiencePicker
            selectedPresets={selectedPresets}
            setSelectedPresets={setSelectedPresets}
            liveCount={selectedPresets.size === 1 ? (plannerResult?.summary.matchedCustomers ?? null) : null}
            isFetching={plannerQuery.isFetching}
          />
          <AudienceRuleBuilder rules={rules} setRules={setRules} supportedFields={supportedFields} />
        </div>

        {/* RIGHT */}
        <div>
          <SafetySummary breakdown={plannerResult?.exclusionBreakdown ?? null} />
          <LiveAudiencePreview sampleIncluded={plannerResult?.sampleIncluded ?? null} />
          <MessageEditor message={message} setMessage={setMessage} />
          <PersonalizedPreviews message={message} sampleNames={sampleNames} />
          <StepTest message={message} onTestSent={() => setTestSent(true)} />
          <StepFinalApproval
            recipientCount={plannerResult?.summary.matchedCustomers ?? 0}
            testSent={testSent}
            stopOptOut={plannerResult?.exclusionBreakdown?.stopOptOut ?? 0}
            campaignId={campaignId}
            campaignStatus={campaignStatus}
            frozenCount={frozenCount}
            isApprovingCampaign={approveCampaignMutation.isPending}
            onApprove={() => approveCampaignMutation.mutate({ campaignId: campaignId! })}
            onOpenReview={() => setReviewOpen(true)}
          />
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
      </div>
      )}

      {/* CampaignReviewScreen — full-screen Stage 5.5 review experience */}
      <CampaignReviewScreen
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        campaignId={campaignId}
        campaignName={campaignName || "Untitled Campaign"}
        campaignStatus={campaignStatus}
        frozenCount={frozenCount}
        messageTemplate={message}
        plannerResult={plannerResult as any}
        onApprove={() => approveCampaignMutation.mutate({ campaignId: campaignId! })}
        isApproving={approveCampaignMutation.isPending}
        onUnfreeze={() => unfreezeCampaignMutation.mutate({ campaignId: campaignId! })}
        isUnfreezing={unfreezeCampaignMutation.isPending}
        onCountChange={setFrozenCount}
        onMessageChange={(newMsg) => {
          setMessage(newMsg);
          // Auto-save message back to draft if campaign exists
          if (campaignId) {
            saveDraftMutation.mutate({
              campaignId,
              name: campaignName || "Untitled Campaign",
              audienceDefinition: audienceDefinition as Parameters<typeof saveDraftMutation.mutate>[0]["audienceDefinition"],
              messageTemplate: newMsg,
            });
          }
        }}
      />

      {/* Send Confirmation dialog — Stage 5 */}
      <Dialog open={sendConfirmOpen} onOpenChange={(o) => { setSendConfirmOpen(o); if (!o) setSendConfirmText(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Send className="w-5 h-5" /> Send {frozenCount} Real Messages?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              You are about to send <strong>{frozenCount} SMS messages</strong> to real customers.
              This cannot be undone.
            </p>
            <p className="text-sm text-gray-500">
              Type <span className="font-mono font-bold text-gray-800">SEND {frozenCount}</span> to confirm:
            </p>
            <Input
              value={sendConfirmText}
              onChange={(e) => setSendConfirmText(e.target.value)}
              placeholder={`SEND ${frozenCount}`}
              className="font-mono"
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSendConfirmOpen(false); setSendConfirmText(""); }}>Cancel</Button>
            <Button
              onClick={handleSend}
              disabled={sendCampaignMutation.isPending || sendConfirmText.trim() !== `SEND ${frozenCount}`}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {sendCampaignMutation.isPending
                ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Sending…</span>
                : "Confirm Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
