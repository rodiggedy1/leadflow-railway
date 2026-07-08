/**
 * SmsCampaigns — /admin/sms-campaigns
 *
 * SMS Campaign Command Center: 5-step wizard for building a safe audience,
 * composing a personalized message, and sending a bulk SMS campaign.
 *
 * UI-only for now — logic will be wired in a subsequent phase.
 */
import { useState } from "react";
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
  MapPin,
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
  Star,
  DollarSign,
  RefreshCw,
  CalendarClock,
  ThumbsUp,
  Timer,
  ChevronDown,
  ChevronUp,
  Layers,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5;

interface AudiencePreset {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  estimatedCount: number;
  color: string; // tailwind bg class for icon bg
  iconColor: string; // tailwind text class
}

interface AdvancedFilters {
  radiusEnabled: boolean;
  location: string;
  radius: "3mi" | "5mi" | "10mi" | "15mi";
  minSpend: string;
  minRating: string;
  notContactedDays: string;
  lastBookingDays: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    id: "last-minute",
    label: "Last-minute openings",
    description: "Customers likely to book on short notice",
    icon: <Timer className="w-4 h-4" />,
    estimatedCount: 94,
    color: "bg-orange-50",
    iconColor: "text-orange-500",
  },
  {
    id: "win-back",
    label: "Win back inactive",
    description: "Haven't booked in 90+ days",
    icon: <RefreshCw className="w-4 h-4" />,
    estimatedCount: 211,
    color: "bg-blue-50",
    iconColor: "text-blue-500",
  },
  {
    id: "former-recurring",
    label: "Former recurring",
    description: "Used to have a recurring plan, now lapsed",
    icon: <CalendarClock className="w-4 h-4" />,
    estimatedCount: 138,
    color: "bg-purple-50",
    iconColor: "text-purple-500",
  },
  {
    id: "nearby",
    label: "Customers within X miles",
    description: "Based on service address proximity",
    icon: <MapPin className="w-4 h-4" />,
    estimatedCount: 184,
    color: "bg-emerald-50",
    iconColor: "text-emerald-500",
  },
  {
    id: "due-recurring",
    label: "Due for recurring clean",
    description: "Recurring customers whose next clean is overdue",
    icon: <CalendarClock className="w-4 h-4" />,
    estimatedCount: 47,
    color: "bg-amber-50",
    iconColor: "text-amber-500",
  },
  {
    id: "five-star",
    label: "5★ reviewers",
    description: "Customers who left a 5-star review",
    icon: <Star className="w-4 h-4" />,
    estimatedCount: 73,
    color: "bg-yellow-50",
    iconColor: "text-yellow-500",
  },
  {
    id: "no-complaints",
    label: "No complaints",
    description: "Zero open issues or complaint history",
    icon: <ThumbsUp className="w-4 h-4" />,
    estimatedCount: 302,
    color: "bg-teal-50",
    iconColor: "text-teal-500",
  },
  {
    id: "high-spend",
    label: "Spent over $500",
    description: "High-value customers by lifetime spend",
    icon: <DollarSign className="w-4 h-4" />,
    estimatedCount: 89,
    color: "bg-green-50",
    iconColor: "text-green-600",
  },
  {
    id: "not-contacted",
    label: "Not contacted in 30 days",
    description: "No outbound SMS in the past month",
    icon: <MessageSquare className="w-4 h-4" />,
    estimatedCount: 256,
    color: "bg-slate-50",
    iconColor: "text-slate-500",
  },
];

const DEFAULT_MESSAGE =
  "Hi {{first_name}}, this is Madison from Maid in Black 😊 We have a few openings near {{area}} this week and wanted to see if you'd like help with a cleaning. Want me to send available times?";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5 text-amber-400 text-sm">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ opacity: i <= rating ? 1 : 0.25 }}>★</span>
      ))}
    </div>
  );
}

function computeRecipientCount(
  selectedPresets: Set<string>,
  filters: AdvancedFilters
): number {
  if (selectedPresets.size === 0) return 0;
  // Simulated: sum preset counts with overlap reduction
  let total = 0;
  for (const id of selectedPresets) {
    const p = AUDIENCE_PRESETS.find((x) => x.id === id);
    if (p) total += p.estimatedCount;
  }
  // Simulate overlap reduction for multiple selections
  if (selectedPresets.size > 1) total = Math.round(total * 0.72);
  // Simulate filter narrowing
  if (filters.radiusEnabled) total = Math.round(total * 0.65);
  if (filters.minSpend) total = Math.round(total * 0.6);
  if (filters.minRating) total = Math.round(total * 0.7);
  if (filters.notContactedDays) total = Math.round(total * 0.8);
  if (filters.lastBookingDays) total = Math.round(total * 0.75);
  return Math.max(total, 0);
}

// ── WorkflowBar ───────────────────────────────────────────────────────────────

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
                active
                  ? "bg-gray-900 text-white shadow-md"
                  : done
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
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

// ── HeroCard ──────────────────────────────────────────────────────────────────

function HeroCard({
  count,
  selectedCount,
  excluded,
  expectedReplies,
}: {
  count: number;
  selectedCount: number;
  excluded: number;
  expectedReplies: number;
}) {
  return (
    <div
      className="rounded-3xl p-7 text-center text-white mb-4"
      style={{ background: "linear-gradient(180deg,#111827 0%,#1f2937 100%)" }}
    >
      <div className="text-xs font-black uppercase tracking-widest text-gray-400 mb-1">
        Recipients
      </div>
      <div
        className="font-black text-white leading-none mb-1 tabular-nums transition-all duration-300"
        style={{ fontSize: 72 }}
      >
        {count}
      </div>
      <div className="text-sm text-gray-300 mb-1">eligible customers</div>
      {selectedCount > 0 && (
        <div className="text-xs text-gray-500 mb-4">
          across {selectedCount} audience{selectedCount > 1 ? "s" : ""}
        </div>
      )}
      {selectedCount === 0 && (
        <div className="text-xs text-gray-500 mb-4">
          Select an audience to get started
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div
          className="rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div className="text-xl font-black">{excluded}</div>
          <div className="text-xs text-gray-400 mt-0.5">excluded</div>
        </div>
        <div
          className="rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div className="text-xl font-black">{expectedReplies}</div>
          <div className="text-xs text-gray-400 mt-0.5">expected replies</div>
        </div>
      </div>
    </div>
  );
}

// ── AudienceBuilder ───────────────────────────────────────────────────────────

function AudienceBuilder({
  selectedPresets,
  setSelectedPresets,
  filters,
  setFilters,
}: {
  selectedPresets: Set<string>;
  setSelectedPresets: React.Dispatch<React.SetStateAction<Set<string>>>;
  filters: AdvancedFilters;
  setFilters: React.Dispatch<React.SetStateAction<AdvancedFilters>>;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const togglePreset = (id: string) => {
    setSelectedPresets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const radiusOptions: { value: AdvancedFilters["radius"]; label: string }[] = [
    { value: "3mi",  label: "3 mi" },
    { value: "5mi",  label: "5 mi" },
    { value: "10mi", label: "10 mi" },
    { value: "15mi", label: "15 mi" },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm">
      {/* Header */}
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
        Select one or more audiences to combine. Overlap is automatically deduplicated.
      </p>

      {/* Preset cards */}
      <div className="flex flex-col gap-2">
        {AUDIENCE_PRESETS.map((preset) => {
          const active = selectedPresets.has(preset.id);
          return (
            <button
              key={preset.id}
              onClick={() => togglePreset(preset.id)}
              className={[
                "flex items-center gap-3 p-3 rounded-2xl border text-left transition-all",
                active
                  ? "border-gray-900 bg-gray-900 shadow-sm"
                  : "border-gray-100 bg-gray-50 hover:border-gray-300 hover:bg-white",
              ].join(" ")}
            >
              {/* Icon */}
              <div
                className={[
                  "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
                  active ? "bg-white/15" : preset.color,
                ].join(" ")}
              >
                <span className={active ? "text-white" : preset.iconColor}>
                  {preset.icon}
                </span>
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div
                  className={[
                    "text-sm font-bold leading-tight",
                    active ? "text-white" : "text-gray-900",
                  ].join(" ")}
                >
                  {preset.label}
                </div>
                <div
                  className={[
                    "text-xs mt-0.5 truncate",
                    active ? "text-gray-300" : "text-gray-400",
                  ].join(" ")}
                >
                  {preset.description}
                </div>
              </div>

              {/* Count badge */}
              <div
                className={[
                  "text-xs font-black rounded-full px-2 py-0.5 flex-shrink-0",
                  active
                    ? "bg-white/20 text-white"
                    : "bg-white text-gray-500 border border-gray-200",
                ].join(" ")}
              >
                ~{preset.estimatedCount}
              </div>

              {/* Checkmark */}
              {active && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Advanced Filters toggle */}
      <button
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-5 w-full flex items-center justify-between px-4 py-3 rounded-2xl border border-dashed border-gray-300 text-sm font-bold text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          Advanced Filters
        </span>
        {showAdvanced ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {/* Advanced Filters panel */}
      {showAdvanced && (
        <div className="mt-3 space-y-4 p-4 bg-gray-50 rounded-2xl border border-gray-100">

          {/* Radius */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">
                Target radius
              </label>
              <button
                onClick={() => setFilters((f) => ({ ...f, radiusEnabled: !f.radiusEnabled }))}
                className={[
                  "text-xs font-bold px-2 py-0.5 rounded-full border transition-colors",
                  filters.radiusEnabled
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-400 border-gray-200",
                ].join(" ")}
              >
                {filters.radiusEnabled ? "On" : "Off"}
              </button>
            </div>
            {filters.radiusEnabled && (
              <>
                <Input
                  value={filters.location}
                  onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. Arlington, VA 22201"
                  className="mb-2 rounded-xl border-gray-300 text-sm"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {radiusOptions.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setFilters((f) => ({ ...f, radius: o.value }))}
                      className={[
                        "px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                        filters.radius === o.value
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-500",
                      ].join(" ")}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Min spend */}
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-400 block mb-2">
              Minimum lifetime spend
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                value={filters.minSpend}
                onChange={(e) => setFilters((f) => ({ ...f, minSpend: e.target.value }))}
                placeholder="e.g. 500"
                className="pl-8 rounded-xl border-gray-300 text-sm"
                type="number"
                min="0"
              />
            </div>
          </div>

          {/* Min rating */}
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-400 block mb-2">
              Minimum star rating
            </label>
            <div className="flex gap-1.5">
              {[3, 4, 5].map((r) => (
                <button
                  key={r}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      minRating: f.minRating === String(r) ? "" : String(r),
                    }))
                  }
                  className={[
                    "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                    filters.minRating === String(r)
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-500",
                  ].join(" ")}
                >
                  <Star className="w-3 h-3" />
                  {r}+
                </button>
              ))}
            </div>
          </div>

          {/* Not contacted in N days */}
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-400 block mb-2">
              Not texted in (days)
            </label>
            <Input
              value={filters.notContactedDays}
              onChange={(e) => setFilters((f) => ({ ...f, notContactedDays: e.target.value }))}
              placeholder="e.g. 30"
              className="rounded-xl border-gray-300 text-sm"
              type="number"
              min="0"
            />
          </div>

          {/* Last booking within N days */}
          <div>
            <label className="text-xs font-black uppercase tracking-widest text-gray-400 block mb-2">
              Last booking within (days)
            </label>
            <Input
              value={filters.lastBookingDays}
              onChange={(e) => setFilters((f) => ({ ...f, lastBookingDays: e.target.value }))}
              placeholder="e.g. 180"
              className="rounded-xl border-gray-300 text-sm"
              type="number"
              min="0"
            />
          </div>

          {/* Clear filters */}
          {(filters.radiusEnabled || filters.minSpend || filters.minRating || filters.notContactedDays || filters.lastBookingDays) && (
            <button
              onClick={() =>
                setFilters({
                  radiusEnabled: false,
                  location: "Arlington, VA 22201",
                  radius: "5mi",
                  minSpend: "",
                  minRating: "",
                  notContactedDays: "",
                  lastBookingDays: "",
                })
              }
              className="text-xs text-red-500 font-bold hover:text-red-700 transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── SafetySummary ─────────────────────────────────────────────────────────────

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

// ── LiveAudiencePreview ───────────────────────────────────────────────────────

const PREVIEW_PEOPLE = [
  { name: "Jennifer Smith", rating: 5, lastClean: "42 days ago",  distance: "3.1 miles", type: "Former recurring" },
  { name: "Alex Grant",     rating: 5, lastClean: "8 months ago", distance: "2.4 miles", type: "One-time" },
  { name: "Nina Lee",       rating: 4, lastClean: "92 days ago",  distance: "4.4 miles", type: "Former recurring" },
];

function LiveAudiencePreview({ selectedCount }: { selectedCount: number }) {
  if (selectedCount === 0) return null;
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
              Last clean: {p.lastClean}
              <br />
              {p.distance} · {p.type}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MessageEditor ─────────────────────────────────────────────────────────────

function MessageEditor({
  message,
  setMessage,
}: {
  message: string;
  setMessage: (m: string) => void;
}) {
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
        <button
          onClick={() => insertVar("{{first_name}}")}
          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
        >
          + first_name
        </button>
        <button
          onClick={() => insertVar("{{area}}")}
          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors"
        >
          + area
        </button>
      </div>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="min-h-[110px] rounded-xl border-gray-300 text-sm leading-relaxed resize-none"
        placeholder="Write your message…"
      />
      <div className="flex justify-between items-center mt-2 text-xs text-gray-400">
        <span>{charCount} chars</span>
        <span>{smsCount} SMS segment{smsCount > 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

// ── PersonalizedPreviews ──────────────────────────────────────────────────────

function PersonalizedPreviews({ message }: { message: string }) {
  const previews = [
    { name: "Jennifer", firstName: "Jennifer", area: "Arlington" },
    { name: "Alex",     firstName: "Alex",     area: "Arlington" },
    { name: "Nina",     firstName: "Nina",     area: "Arlington" },
  ];
  const personalize = (tpl: string, firstName: string, area: string) =>
    tpl.replace(/\{\{first_name\}\}/g, firstName).replace(/\{\{area\}\}/g, area);

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
        <Phone className="w-4 h-4 text-gray-600" />
        Personalized Previews
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {previews.map((p) => (
          <div
            key={p.name}
            className="rounded-3xl p-4 min-h-[200px]"
            style={{ background: "#101828" }}
          >
            <div className="text-white font-bold text-sm mb-1">{p.name}</div>
            <div
              className="text-white text-xs leading-relaxed mt-3 p-3"
              style={{ background: "#2563eb", borderRadius: "18px 18px 4px 18px" }}
            >
              {personalize(message, p.firstName, p.area)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── StepTest ──────────────────────────────────────────────────────────────────

function StepTest({ message, onTestSent }: { message: string; onTestSent: () => void }) {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!phone.trim()) { toast.error("Enter a phone number"); return; }
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setSent(true);
      onTestSent();
      toast.success("Test SMS sent! (UI-only — logic not wired yet)");
    }, 1200);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-3xl p-5 shadow-sm mt-4">
      <h2 className="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-gray-600" />
        Send Test SMS
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Send yourself a preview before the real campaign goes out.
      </p>
      <div className="flex gap-2">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 (555) 000-0000"
          className="rounded-xl border-gray-300"
        />
        <Button
          onClick={handleSend}
          disabled={sending || sent}
          className={[
            "rounded-xl font-bold px-5 flex-shrink-0",
            sent ? "bg-emerald-600 hover:bg-emerald-600" : "bg-gray-900 hover:bg-gray-800",
          ].join(" ")}
        >
          {sending ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Sending…
            </span>
          ) : sent ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> Sent!
            </span>
          ) : (
            "Send Test"
          )}
        </Button>
      </div>
      {sent && (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          <CheckCircle2 className="w-4 h-4" />
          Test SMS sent — check your phone and verify the message looks right.
        </div>
      )}
    </div>
  );
}

// ── StepFinalApproval ─────────────────────────────────────────────────────────

function StepFinalApproval({
  recipientCount,
  testSent,
}: {
  recipientCount: number;
  testSent: boolean;
  message: string;
}) {
  const [confirmText, setConfirmText] = useState("");
  const expectedConfirm = `SEND ${recipientCount}`;
  const isReady = testSent && confirmText.trim() === expectedConfirm;

  const checks = [
    { label: "Audience selected",   status: recipientCount > 0 ? "passed" : "pending", note: "" },
    { label: "Test SMS sent",        status: testSent ? "passed" : "pending",           note: "" },
    { label: "Quiet hours protected", status: "passed",                                  note: "9am–8pm local time" },
    { label: "Opt-outs excluded",    status: "passed",                                  note: "8 contacts excluded" },
    {
      label: "Type confirmation",
      status: confirmText === expectedConfirm ? "passed" : "required",
      note: `Type: ${expectedConfirm}`,
    },
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
                {c.status === "passed" ? (
                  <span className="flex items-center gap-1 text-emerald-600 text-sm font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                  </span>
                ) : c.status === "pending" ? (
                  <span className="flex items-center gap-1 text-amber-500 text-sm font-semibold">
                    <Clock className="w-3.5 h-3.5" /> Pending
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-gray-500">
                    Required: <strong className="text-gray-900">{c.note}</strong>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mb-5">
        <div className="text-xs font-bold text-gray-500 mb-1.5">
          Type <span className="font-black text-gray-900">{expectedConfirm}</span> to unlock sending
        </div>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`Type "${expectedConfirm}" here`}
          className={[
            "rounded-xl font-mono",
            confirmText === expectedConfirm
              ? "border-emerald-400 bg-emerald-50 text-emerald-800"
              : "border-gray-300",
          ].join(" ")}
        />
      </div>
      <div className="flex justify-between items-center gap-3">
        <Button
          variant="outline"
          className="rounded-xl font-bold border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={() => toast.info("Draft saved (UI-only)")}
        >
          Save Draft
        </Button>
        <Button
          onClick={() => {
            if (!isReady) { toast.error("Complete all checks first"); return; }
            toast.success("Campaign scheduled! (UI-only — logic not wired yet)");
          }}
          disabled={!isReady}
          className={[
            "rounded-xl font-bold px-6",
            isReady
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-gray-100 text-gray-400 cursor-not-allowed",
          ].join(" ")}
        >
          <Zap className="w-4 h-4 mr-1.5" />
          Schedule Campaign
        </Button>
      </div>
    </div>
  );
}

// ── Main content ──────────────────────────────────────────────────────────────

function SmsCampaignsContent() {
  const [step, setStep] = useState<Step>(1);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [testSent, setTestSent] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<AdvancedFilters>({
    radiusEnabled: false,
    location: "Arlington, VA 22201",
    radius: "5mi",
    minSpend: "",
    minRating: "",
    notContactedDays: "",
    lastBookingDays: "",
  });

  const recipientCount = computeRecipientCount(selectedPresets, filters);
  const excluded = selectedPresets.size > 0 ? Math.round(recipientCount * 0.18) : 0;
  const expectedReplies = Math.round(recipientCount * 0.13);

  const goNext = () => setStep((s) => Math.min(s + 1, 5) as Step);
  const goPrev = () => setStep((s) => Math.max(s - 1, 1) as Step);

  return (
    <>
      {/* Page header */}
      <div className="flex items-start justify-between mb-1 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900" style={{ letterSpacing: "-0.03em" }}>
            SMS Campaign Command Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Build the safest possible audience before anyone can send anything.
          </p>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200 flex-shrink-0 mt-1">
          <ShieldCheck className="w-3.5 h-3.5" />
          Draft · Send locked
        </span>
      </div>

      {/* Workflow progress bar */}
      <WorkflowBar step={step} onStep={setStep} />

      {/* 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4 mt-2">
        {/* LEFT: Hero + Audience Builder */}
        <div>
          <HeroCard
            count={recipientCount}
            selectedCount={selectedPresets.size}
            excluded={excluded}
            expectedReplies={expectedReplies}
          />
          <AudienceBuilder
            selectedPresets={selectedPresets}
            setSelectedPresets={setSelectedPresets}
            filters={filters}
            setFilters={setFilters}
          />
        </div>

        {/* RIGHT: All other panels */}
        <div>
          <SafetySummary />
          <LiveAudiencePreview selectedCount={selectedPresets.size} />
          <MessageEditor message={message} setMessage={setMessage} />
          <PersonalizedPreviews message={message} />
          <StepTest message={message} onTestSent={() => setTestSent(true)} />
          <StepFinalApproval
            recipientCount={recipientCount}
            testSent={testSent}
            message={message}
          />
        </div>
      </div>

      {/* Bottom step navigation */}
      <div className="flex justify-between items-center mt-6 pb-8">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={step === 1}
          className="rounded-xl font-bold gap-1.5"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </Button>
        <span className="text-xs text-gray-400 font-medium">Step {step} of 5</span>
        <Button
          onClick={goNext}
          disabled={step === 5}
          className="bg-gray-900 hover:bg-gray-800 text-white rounded-xl font-bold gap-1.5"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  );
}

// ── Page export ───────────────────────────────────────────────────────────────

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
