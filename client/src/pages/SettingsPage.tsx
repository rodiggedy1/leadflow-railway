/**
 * SettingsPage — /admin/settings
 *
 * Admin-only page for managing configurable business settings.
 * Organized into three top-level tabs:
 *   1. Form SMS — flow selector + templates for the quote form (Madison / Jade)
 *   2. Widget SMS — flow selector + templates for the chat widget (Madison / Jade)
 *   3. General — Google Review URL, tracker SMS, business info, etc.
 *
 * Key design: `localEdits` is lifted to the page level so the conversation
 * preview and the textarea fields always read from the same source — edits
 * in the textarea update the preview in real-time before saving.
 */

import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Settings, Link, MessageSquare, Star, Phone, Building2,
  Save, Loader2, CheckCircle2, ToggleLeft, ToggleRight, Bell,
  FlaskConical, User, Sparkles, Shuffle, MessageCircle, FileText, Mail,
  PhoneCall, RefreshCw, DollarSign, TrendingUp, TrendingDown, AlertTriangle, Camera, Zap,
  Plus, Pencil, Trash2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MessageFlowPanel from "@/components/MessageFlowPanel";
import { PhoneCall as PhoneCallIcon } from "lucide-react";

// ── Known service types that can be silenced ──────────────────────────────────
const KNOWN_SERVICE_TYPES = [
  "Window Cleaning",
  "Carpet Cleaning",
  "Junk Removal",
  "Office Cleaning",
  "Post-Construction Cleaning",
  "Move-In / Move-Out Cleaning",
  "Deep Cleaning",
  "Standard Cleaning",
];

// ── Silenced Services Card ────────────────────────────────────────────────────
function SilencedServicesCard({
  currentValue,
  onSave,
}: {
  currentValue: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const silenced = currentValue.split(",").map(s => s.trim()).filter(Boolean);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = async (service: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...silenced, service]))
      : silenced.filter(s => s !== service);
    setSaving(true);
    try {
      await onSave("silenced_services", next.join(","));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <span className="text-[#E8735A]"><Settings className="w-4 h-4" /></span>
          Silenced Service Types
          {saved && (
            <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium ml-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
          {saving && <Loader2 className="w-3 h-3 animate-spin text-gray-400 ml-1" />}
        </CardTitle>
        <CardDescription className="text-xs text-gray-500">
          Checked service types are completely suppressed — no lead saved, no SMS sent, no alert fired.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {KNOWN_SERVICE_TYPES.map(service => (
            <label
              key={service}
              className="flex items-center gap-2 cursor-pointer select-none group"
            >
              <input
                type="checkbox"
                checked={silenced.includes(service)}
                onChange={(e) => toggle(service, e.target.checked)}
                disabled={saving}
                className="w-4 h-4 rounded accent-[#E8735A] cursor-pointer disabled:cursor-not-allowed"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{service}</span>
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── OpenPhone Sync Card ───────────────────────────────────────────────────

function OpenPhoneSyncCard() {
  const syncMutation = trpc.opsChat.syncOpenPhoneUsers.useMutation();
  const setIdMutation = trpc.opsChat.setAgentOpenPhoneUserId.useMutation();
  const [result, setResult] = useState<{
    matched: Array<{ agentId: number; agentName: string; opUserId: string; opName: string }>;
    unmatched: Array<{ opUserId: string; opName: string; opEmail: string }>;
    agentRows: Array<{ id: number; name: string }>;
  } | null>(null);
  const [manualSelections, setManualSelections] = useState<Record<string, number>>({});

  const handleSync = async () => {
    try {
      const res = await syncMutation.mutateAsync();
      setResult(res);
      if (res.matched.length > 0) {
        toast.success(`Matched ${res.matched.length} agent${res.matched.length !== 1 ? "s" : ""} automatically`);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Sync failed");
    }
  };

  const handleManualAssign = async (opUserId: string, agentId: number) => {
    try {
      await setIdMutation.mutateAsync({ agentId, openPhoneUserId: opUserId });
      toast.success("Assigned successfully");
      // Remove from unmatched list
      setResult(prev => prev ? {
        ...prev,
        unmatched: prev.unmatched.filter(u => u.opUserId !== opUserId),
        matched: [...prev.matched, {
          agentId,
          agentName: prev.agentRows.find(a => a.id === agentId)?.name ?? "",
          opUserId,
          opName: prev.unmatched.find(u => u.opUserId === opUserId)?.opName ?? "",
        }],
      } : prev);
    } catch (e: any) {
      toast.error(e.message ?? "Assignment failed");
    }
  };

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <PhoneCallIcon className="w-4 h-4 text-[#E8735A]" />
          OpenPhone Agent Mapping
        </CardTitle>
        <CardDescription className="text-xs text-gray-500">
          Fetch your OpenPhone team members and link them to agents so the on-call badge works automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={handleSync}
          disabled={syncMutation.isPending}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          {syncMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncMutation.isPending ? "Syncing…" : "Sync from OpenPhone"}
        </Button>

        {result && (
          <div className="space-y-4">
            {/* Matched agents */}
            {result.matched.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Matched ({result.matched.length})</p>
                <div className="space-y-1">
                  {result.matched.map(m => (
                    <div key={m.opUserId} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      <span className="font-medium text-gray-800">{m.agentName}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-gray-500">{m.opName}</span>
                      <span className="text-xs text-gray-400 font-mono ml-auto">{m.opUserId}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unmatched OpenPhone users */}
            {result.unmatched.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Unmatched — assign manually ({result.unmatched.length})</p>
                <div className="space-y-2">
                  {result.unmatched.map(u => (
                    <div key={u.opUserId} className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="text-sm text-gray-700 w-32 shrink-0">{u.opName || u.opEmail}</span>
                      <Select
                        value={manualSelections[u.opUserId] ? String(manualSelections[u.opUserId]) : ""}
                        onValueChange={val => setManualSelections(prev => ({ ...prev, [u.opUserId]: Number(val) }))}
                      >
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select agent…" />
                        </SelectTrigger>
                        <SelectContent>
                          {result.agentRows.map(a => (
                            <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs px-3"
                        disabled={!manualSelections[u.opUserId] || setIdMutation.isPending}
                        onClick={() => handleManualAssign(u.opUserId, manualSelections[u.opUserId])}
                      >
                        Assign
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.unmatched.length === 0 && result.matched.length > 0 && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> All OpenPhone users matched. On-call badges are active.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── App Version Card ─────────────────────────────────────────────────────────
function AppVersionCard() {
  const [healthData, setHealthData] = useState<{ commit?: string; time?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json())
      .then(d => { setHealthData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const shortCommit = healthData?.commit && healthData.commit !== "unknown"
    ? healthData.commit.slice(0, 7)
    : healthData?.commit ?? "unknown";

  const deployedAt = healthData?.time
    ? new Date(healthData.time).toLocaleString()
    : null;

  return (
    <Card className="border border-dashed border-gray-200 bg-gray-50/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-gray-600 flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#E8735A]" />
          Deployment Info
        </CardTitle>
        <CardDescription className="text-xs text-gray-400">
          Current Railway deployment details. Use this to verify that the latest code is running.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Checking deployment...
          </div>
        ) : (
          <div className="space-y-1 font-mono text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 w-20">Commit:</span>
              <span className="text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{shortCommit}</span>
              {healthData?.commit && healthData.commit !== "unknown" && (
                <a
                  href={`https://github.com/rodiggedy1/leadflow-railway/commit/${healthData.commit}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#E8735A] hover:underline text-xs"
                >
                  view on GitHub
                </a>
              )}
            </div>
            {deployedAt && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-20">Server time:</span>
                <span className="text-gray-600">{deployedAt}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section config ────────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, React.ReactNode> = {
  googleReviewUrl: <Link className="w-4 h-4" />,
  trackerSmsTemplate: <MessageSquare className="w-4 h-4" />,
  autoGoogleReviewOnFiveStar: <Star className="w-4 h-4" />,
  trackerSmsEnabled: <Bell className="w-4 h-4" />,
  businessPhone: <Phone className="w-4 h-4" />,
  businessName: <Building2 className="w-4 h-4" />,
};

const SECTIONS = [
  {
    title: "Customer Tracker",
    description: "Settings for the real-time job tracker page sent to customers.",
    keys: ["trackerSmsEnabled", "trackerSmsTemplate"],
  },
  {
    title: "Reviews & Ratings",
    description: "Control how 5-star ratings flow into Google Reviews.",
    keys: ["googleReviewUrl", "autoGoogleReviewOnFiveStar"],
  },
  {
    title: "Business Info",
    description: "Displayed on the customer tracker page and in SMS messages.",
    keys: ["businessName", "businessPhone"],
  },
];

// ── Flow options ──────────────────────────────────────────────────────────────

const FLOW_OPTIONS = [
  {
    value: "A",
    label: "Flow A — Madison",
    icon: <User className="w-4 h-4" />,
    description: "All new leads get Flow A. Price upfront in SMS 1 with Madison's photo, followed immediately by an availability question.",
    color: "blue",
  },
  {
    value: "B",
    label: "Flow B — Jade",
    icon: <Sparkles className="w-4 h-4" />,
    description: "All new leads get Flow B. Friendly greeting + day ask first — price is revealed only after the lead replies with a day.",
    color: "coral",
  },
  {
    value: "split",
    label: "A/B Test (50/50)",
    icon: <Shuffle className="w-4 h-4" />,
    description: "Each new lead is randomly assigned Flow A or Flow B. Use this to compare conversion rates between the two scripts. Each lead's flow is locked in at creation.",
    color: "purple",
  },
];

const WIDGET_FLOW_OPTIONS = [
  {
    value: "A",
    label: "Flow A — Madison",
    icon: <User className="w-4 h-4" />,
    description: "Widget leads get Madison. Asks for bedrooms/bathrooms, then sends price upfront with Madison's photo, followed by an availability question.",
    color: "blue",
  },
  {
    value: "B",
    label: "Flow B — Jade",
    icon: <Sparkles className="w-4 h-4" />,
    description: "Widget leads get Jade. Asks for bedrooms/bathrooms, then asks for day — price is revealed only after the lead replies with a day.",
    color: "coral",
  },
  {
    value: "C",
    label: "Flow C — Jade (Enriched Quote)",
    icon: <Sparkles className="w-4 h-4" />,
    description: "Widget leads get Jade. Asks for bedrooms/bathrooms first, then collects add-ons and preferred date before sending a personalized quote link. No price in SMS.",
    color: "green",
  },
  {
    value: "split",
    label: "A/B Test (50/50)",
    icon: <Shuffle className="w-4 h-4" />,
    description: "Each widget lead is randomly assigned Flow A or Flow B. Use this to compare conversion rates between the two scripts.",
    color: "purple",
  },
];

// ── Preview variable substitution ────────────────────────────────────────────

function applyPreviewVars(template: string): string {
  return template
    .replace(/\{firstName\}/g, "Sarah")
    .replace(/\{bedrooms\}/g, "3 bed")
    .replace(/\{bathrooms\}/g, "2 bath")
    .replace(/\{serviceType\}/g, "Standard Cleaning")
    .replace(/\{price\}/g, "180")
    .replace(/\{day\}/g, "Thursday")
    .replace(/\{slot\}/g, "Thursday at 9am")
    .replace(/\{slot1\}/g, "Thursday afternoon")
    .replace(/\{slot2\}/g, "Saturday morning")
    .replace(/\{timePref\}/g, "Morning")
    .replace(/\{address\}/g, "123 Main St, DC 20001")
    .replace(/\{extrasLine\}/g, " (including clean inside oven)")
    .replace(/\{quoteLink\}/g, "maidsquotes.../quote/sarah-ab12");
}

// ── Conversation thread definitions ──────────────────────────────────────────

type ConvoItem = { type: 'bot'; label: string; templateKey: string } | { type: 'lead'; text: string };

// Email leads: SMS 1 is the email-specific intro, then uses shared Flow A scripts
const EMAIL_LEAD_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'emailFlowA_sms1' },
  { type: 'bot', label: 'SMS 2', templateKey: 'flowA_sms2' },
  { type: 'lead', text: 'Thursday works for me!' },
  { type: 'bot', label: 'SMS 3', templateKey: 'flowA_sms3' },
  { type: 'lead', text: 'Morning please' },
  { type: 'bot', label: 'SMS 4', templateKey: 'flowA_sms4' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'SMS 5', templateKey: 'flowA_sms5' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'SMS 6', templateKey: 'flowA_sms6' },
];

const FLOW_B_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'flowB_sms1' },
  { type: 'lead', text: 'Thursday works!' },
  { type: 'bot', label: 'SMS 2', templateKey: 'flowB_sms2' },
  { type: 'lead', text: '9am please' },
  { type: 'bot', label: 'SMS 3', templateKey: 'flowB_sms3' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'SMS 4', templateKey: 'flowB_sms4' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'SMS 5', templateKey: 'flowB_sms5' },
];

const FLOW_A_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'flowA_sms1' },
  { type: 'bot', label: 'SMS 2', templateKey: 'flowA_sms2' },
  { type: 'lead', text: 'Thursday works for me!' },
  { type: 'bot', label: 'SMS 3', templateKey: 'flowA_sms3' },
  { type: 'lead', text: 'Morning please' },
  { type: 'bot', label: 'SMS 4', templateKey: 'flowA_sms4' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'SMS 5', templateKey: 'flowA_sms5' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'SMS 6', templateKey: 'flowA_sms6' },
];

// Widget Flow C: starts with sizing question (like Flow B), then enriched quote flow
const WIDGET_FLOW_C_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1 — Sizing', templateKey: 'widgetFlowC_sms1' },
  { type: 'lead', text: '3 bed / 2 bath' },
  { type: 'bot', label: 'SMS 2 — Add-ons', templateKey: 'widgetFlowC_sms2' },
  { type: 'lead', text: 'Inside oven and inside fridge please' },
  { type: 'bot', label: 'SMS 3 — Date', templateKey: 'widgetFlowC_sms3' },
  { type: 'lead', text: 'Thursday or Friday works for me' },
  { type: 'bot', label: 'SMS 4 — Quote Link', templateKey: 'widgetFlowC_sms4' },
];

// Widget: starts with persona-specific sizing SMS, then continues with shared flow scripts
const WIDGET_FLOW_B_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'widgetFlowB_sms1' },
  { type: 'lead', text: '3 bed / 2 bath' },
  { type: 'bot', label: 'SMS 2', templateKey: 'flowB_sms1' },
  { type: 'lead', text: 'Thursday works!' },
  { type: 'bot', label: 'SMS 3', templateKey: 'flowB_sms2' },
  { type: 'lead', text: '9am please' },
  { type: 'bot', label: 'SMS 4', templateKey: 'flowB_sms3' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'SMS 5', templateKey: 'flowB_sms4' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'SMS 6', templateKey: 'flowB_sms5' },
];

const WIDGET_FLOW_A_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'widgetFlowA_sms1' },
  { type: 'lead', text: '3 bed / 2 bath' },
  { type: 'bot', label: 'SMS 2', templateKey: 'flowA_sms1' },
  { type: 'bot', label: 'SMS 3', templateKey: 'flowA_sms2' },
  { type: 'lead', text: 'Thursday works for me!' },
  { type: 'bot', label: 'SMS 4', templateKey: 'flowA_sms3' },
  { type: 'lead', text: 'Morning please' },
  { type: 'bot', label: 'SMS 5', templateKey: 'flowA_sms4' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'SMS 6', templateKey: 'flowA_sms5' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'SMS 7', templateKey: 'flowA_sms6' },
];

// ── Color map ─────────────────────────────────────────────────────────────────

const FLOW_COLOR_MAP: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  blue: {
    bg: "bg-blue-50",
    border: "border-blue-300",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
  },
  coral: {
    bg: "bg-[#E8735A]/5",
    border: "border-[#E8735A]",
    text: "text-[#E8735A]",
    badge: "bg-[#E8735A]/10 text-[#E8735A]",
  },
  purple: {
    bg: "bg-purple-50",
    border: "border-purple-300",
    text: "text-purple-700",
    badge: "bg-purple-100 text-purple-700",
  },
  green: {
    bg: "bg-emerald-50",
    border: "border-emerald-400",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
  },
};

// ── SMS Flow Selector ─────────────────────────────────────────────────────────
// Reads from `effectiveValues` (merged server + local edits) so the preview
// always matches what's in the textarea below.

function SmsFlowSelector({
  currentValue,
  onSave,
  effectiveValues,
  flowOptions,
  flowAConvo,
  flowBConvo,
}: {
  currentValue: string;
  onSave: (value: string) => Promise<void>;
  effectiveValues: Record<string, string>;
  flowOptions: typeof FLOW_OPTIONS;
  flowAConvo: ConvoItem[];
  flowBConvo: ConvoItem[];
}) {
  const [selected, setSelected] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isDirty = selected !== currentValue;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const convoThread: ConvoItem[] | null =
    selected === "A" ? flowAConvo :
    selected === "B" ? flowBConvo :
    selected === "C" && (flowOptions as typeof WIDGET_FLOW_OPTIONS).find(o => o.value === "C") ? WIDGET_FLOW_C_CONVO :
    null;

  return (
    <div className="space-y-4">
      {/* Flow option cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {flowOptions.map((option) => {
          const colors = FLOW_COLOR_MAP[option.color];
          const isActive = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`relative text-left rounded-xl border-2 p-4 transition-all cursor-pointer
                ${isActive
                  ? `${colors.bg} ${colors.border} shadow-sm`
                  : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
            >
              {isActive && (
                <span className={`absolute top-2 right-2 text-xs font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
                  Active
                </span>
              )}
              <div className={`flex items-center gap-2 mb-2 ${isActive ? colors.text : "text-gray-600"}`}>
                {option.icon}
                <span className="text-sm font-semibold">{option.label}</span>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{option.description}</p>
            </button>
          );
        })}
      </div>

      {/* Conversation preview */}
      {convoThread ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Full Conversation Preview</p>
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {convoThread.map((item, idx) => {
              if (item.type === 'lead') {
                return (
                  <div key={idx} className="flex justify-end">
                    <div className="bg-[#E8735A]/10 border border-[#E8735A]/20 rounded-2xl rounded-tr-sm px-3 py-2 text-xs text-gray-700 leading-relaxed max-w-[75%] whitespace-pre-line">
                      {item.text}
                    </div>
                  </div>
                );
              }
              const rawValue = effectiveValues[item.templateKey] ?? "";
              const previewText = applyPreviewVars(rawValue);
              return (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 w-16 shrink-0 pt-1.5">{item.label}</span>
                  <div className="bg-white rounded-2xl rounded-tl-sm border border-gray-200 px-3 py-2 text-xs text-gray-700 leading-relaxed max-w-[75%] whitespace-pre-line">
                    {previewText || <span className="text-gray-400 italic">Loading...</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400">Preview with sample data (Sarah, 3 bed / 2 bath, $180, Thursday). Edits to the scripts below update this preview instantly.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Full Conversation Preview</p>
          <p className="text-xs text-gray-500">In A/B Test mode, each lead is randomly assigned Flow A or Flow B. Select Flow A or Flow B above to preview that script.</p>
        </div>
      )}

      {isDirty && (
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="bg-[#E8735A] hover:bg-[#d4614a] text-white"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
            Save Flow Setting
          </Button>
          <span className="text-xs text-gray-400">Changes apply to new leads only.</span>
        </div>
      )}
      {saved && (
        <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
          <CheckCircle2 className="w-3 h-3" /> Flow setting saved
        </span>
      )}
    </div>
  );
}

// ── Toggle field ──────────────────────────────────────────────────────────────

function ToggleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const isOn = value === "true";
  return (
    <button
      type="button"
      onClick={() => onChange(isOn ? "false" : "true")}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all
        ${isOn
          ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
          : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
        }`}
    >
      {isOn ? (
        <ToggleRight className="w-5 h-5 text-emerald-600" />
      ) : (
        <ToggleLeft className="w-5 h-5 text-gray-400" />
      )}
      {isOn ? "Enabled" : "Disabled"}
    </button>
  );
}

// ── Single setting field ──────────────────────────────────────────────────────
// Calls onLocalChange on every keystroke so the preview stays in sync.

function SettingField({
  settingKey,
  savedValue,
  localValue,
  label,
  description,
  fieldType,
  onLocalChange,
  onSave,
}: {
  settingKey: string;
  savedValue: string;
  localValue: string;
  label: string;
  description: string | null;
  fieldType: string;
  onLocalChange: (key: string, value: string) => void;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isDirty = localValue !== savedValue;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(settingKey, localValue);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleChange = async (v: string) => {
    onLocalChange(settingKey, v);
    setSaving(true);
    try {
      await onSave(settingKey, v);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[#E8735A]">{SECTION_ICONS[settingKey]}</span>
        <label className="text-sm font-semibold text-gray-800">{label}</label>
        {saved && (
          <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
            <CheckCircle2 className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
      {description && (
        <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
      )}
      {fieldType === "toggle" ? (
        <ToggleField value={localValue} onChange={handleToggleChange} />
      ) : fieldType === "textarea" ? (
        <div className="space-y-2">
          <Textarea
            value={localValue}
            onChange={(e) => onLocalChange(settingKey, e.target.value)}
            rows={3}
            className="text-sm font-mono resize-none"
            placeholder={label}
          />
          {isDirty && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-[#E8735A] hover:bg-[#d4614a] text-white"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
              Save
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={localValue}
            onChange={(e) => onLocalChange(settingKey, e.target.value)}
            className="text-sm"
            placeholder={label}
            type={fieldType === "url" ? "url" : "text"}
          />
          {isDirty && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-[#E8735A] hover:bg-[#d4614a] text-white shrink-0"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── SMS Template Card ─────────────────────────────────────────────────────────

function SmsTemplateCard({
  title,
  description,
  icon,
  templateKeys,
  serverSettings,
  localEdits,
  onLocalChange,
  onSave,
}: {
  title: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  templateKeys: string[];
  serverSettings: Record<string, { key: string; value: string; label: string; description: string | null; fieldType: string }>;
  localEdits: Record<string, string>;
  onLocalChange: (key: string, value: string) => void;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="text-xs text-gray-500">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 divide-y divide-gray-100">
        {templateKeys.map((key, idx) => {
          const setting = serverSettings[key];
          if (!setting) return null;
          const localValue = localEdits[key] ?? setting.value;
          return (
            <div key={key} className={idx > 0 ? "pt-5" : ""}>
              <SettingField
                settingKey={key}
                savedValue={setting.value}
                localValue={localValue}
                label={setting.label}
                description={setting.description}
                fieldType={setting.fieldType}
                onLocalChange={onLocalChange}
                onSave={onSave}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Response Templates Tab ───────────────────────────────────────────────────
function ResponseTemplatesTab() {
  const utils = trpc.useUtils();
  const { data: templates = [], isLoading } = trpc.responseTemplates.list.useQuery();
  const createMutation = trpc.responseTemplates.create.useMutation({ onSuccess: () => { utils.responseTemplates.list.invalidate(); setEditModal(null); toast.success("Template created"); } });
  const updateMutation = trpc.responseTemplates.update.useMutation({ onSuccess: () => { utils.responseTemplates.list.invalidate(); setEditModal(null); toast.success("Template saved"); } });
  const deleteMutation = trpc.responseTemplates.delete.useMutation({ onSuccess: () => { utils.responseTemplates.list.invalidate(); toast.success("Template deleted"); } });

  type EditState = { id?: number; title: string; category: string; description: string; message: string; sortOrder: number };
  const [editModal, setEditModal] = useState<EditState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const categories = Array.from(new Set(templates.map((t) => t.category))).sort();

  function openNew() {
    setEditModal({ title: "", category: "", description: "", message: "", sortOrder: 0 });
  }
  function openEdit(t: typeof templates[0]) {
    setEditModal({ id: t.id, title: t.title, category: t.category, description: t.description, message: t.message, sortOrder: t.sortOrder });
  }
  function handleSave() {
    if (!editModal) return;
    if (editModal.id) {
      updateMutation.mutate({ id: editModal.id, title: editModal.title, category: editModal.category, description: editModal.description, message: editModal.message, sortOrder: editModal.sortOrder });
    } else {
      createMutation.mutate({ title: editModal.title, category: editModal.category, description: editModal.description, message: editModal.message, sortOrder: editModal.sortOrder });
    }
  }

  const grouped = categories.reduce<Record<string, typeof templates>>((acc, cat) => {
    acc[cat] = templates.filter((t) => t.category === cat);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card className="border border-gray-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                Response Templates
              </CardTitle>
              <CardDescription className="text-xs text-gray-500 mt-1">
                Shared templates used in both the Lead Chat and CS Inbox composers. Admins only.
              </CardDescription>
            </div>
            <Button size="sm" onClick={openNew} className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No templates yet. Click "New Template" to add one.</div>
          ) : (
            <div className="space-y-6">
              {categories.map((cat) => (
                <div key={cat}>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{cat}</div>
                  <div className="space-y-2">
                    {grouped[cat].map((t) => (
                      <div key={t.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-white hover:bg-slate-50 transition">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-900">{t.title}</div>
                          {t.description && <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>}
                          <div className="text-xs text-slate-400 mt-1 line-clamp-2">{t.message}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-600" onClick={() => setDeleteConfirm(t.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit / Create Modal */}
      <Dialog open={!!editModal} onOpenChange={(o) => { if (!o) setEditModal(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editModal?.id ? "Edit Template" : "New Template"}</DialogTitle></DialogHeader>
          {editModal && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold mb-1 block">Title</Label>
                  <Input value={editModal.title} onChange={(e) => setEditModal({ ...editModal, title: e.target.value })} placeholder="e.g. Booking Confirmation" />
                </div>
                <div>
                  <Label className="text-xs font-semibold mb-1 block">Category</Label>
                  <Input value={editModal.category} onChange={(e) => setEditModal({ ...editModal, category: e.target.value })} placeholder="e.g. Scheduling" list="category-suggestions" />
                  <datalist id="category-suggestions">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Description <span className="font-normal text-slate-400">(short subtitle)</span></Label>
                <Input value={editModal.description} onChange={(e) => setEditModal({ ...editModal, description: e.target.value })} placeholder="e.g. Confirm the appointment" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Message</Label>
                <Textarea value={editModal.message} onChange={(e) => setEditModal({ ...editModal, message: e.target.value })} rows={6} placeholder="Use {first_name} for the customer's first name" className="font-mono text-sm" />
                <p className="text-xs text-slate-400 mt-1">Use <code className="bg-slate-100 px-1 rounded">{'{first_name}'}</code> as a placeholder — it's replaced with the customer's name when inserted.</p>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1 block">Sort Order</Label>
                <Input type="number" value={editModal.sortOrder} onChange={(e) => setEditModal({ ...editModal, sortOrder: parseInt(e.target.value) || 0 })} className="w-24" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(o) => { if (!o) setDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Template?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (deleteConfirm !== null) { deleteMutation.mutate({ id: deleteConfirm }); setDeleteConfirm(null); } }} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type SettingsTab = "form" | "widget" | "email" | "reactivation" | "general" | "pay" | "responses";

export default function SettingsPage() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const { data: settings, isLoading, refetch } = trpc.settings.getAll.useQuery();
  const updateSetting = trpc.settings.update.useMutation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("form");

  // ── Pay Rules state ─────────────────────────────────────────────────────────
  const { data: payRulesData, isLoading: payRulesLoading, refetch: refetchPayRules } = trpc.settings.getPayRules.useQuery();
  const updatePayRules = trpc.settings.updatePayRules.useMutation();
  const [payEdits, setPayEdits] = useState<Record<string, string>>({});
  const [payRulesSaving, setPayRulesSaving] = useState(false);

  const handlePayFieldChange = useCallback((key: string, value: string) => {
    setPayEdits(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSavePayRules = async () => {
    if (!payRulesData) return;
    const merged = {
      fiveStarBonus:      parseFloat(payEdits.fiveStarBonus      ?? String(payRulesData.fiveStarBonus)),
      lowRatingDeduction: parseFloat(payEdits.lowRatingDeduction ?? String(payRulesData.lowRatingDeduction)),
      photoBonus:         parseFloat(payEdits.photoBonus         ?? String(payRulesData.photoBonus)),
      noPhotoPenalty:     parseFloat(payEdits.noPhotoPenalty     ?? String(payRulesData.noPhotoPenalty)),
      streakBonus:        parseFloat(payEdits.streakBonus        ?? String(payRulesData.streakBonus)),
      streakTarget:       parseInt(payEdits.streakTarget         ?? String(payRulesData.streakTarget), 10),
      recleanPenalty:     parseFloat(payEdits.recleanPenalty     ?? String(payRulesData.recleanPenalty)),
    };
    if (Object.values(merged).some(v => isNaN(v) || v < 0)) {
      toast.error("All values must be positive numbers");
      return;
    }
    if (merged.streakTarget < 1) {
      toast.error("Streak target must be at least 1 job");
      return;
    }
    setPayRulesSaving(true);
    try {
      await updatePayRules.mutateAsync(merged);
      await refetchPayRules();
      setPayEdits({});
      toast.success("Pay rules saved — changes take effect on the next rated job");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save pay rules");
    } finally {
      setPayRulesSaving(false);
    }
  };

  // ── Custom Pay Rules state ────────────────────────────────────────────────
  const { data: customRules, refetch: refetchCustomRules } = trpc.settings.listCustomPayRules.useQuery();
  const createCustomRule = trpc.settings.createCustomPayRule.useMutation();
  const updateCustomRule = trpc.settings.updateCustomPayRule.useMutation();
  const deleteCustomRule = trpc.settings.deleteCustomPayRule.useMutation();
  const [showRuleDialog, setShowRuleDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<{ id?: number; label: string; type: "bonus" | "deduction"; amount: string; description: string } | null>(null);
  const [ruleDialogSaving, setRuleDialogSaving] = useState(false);

  const openNewRuleDialog = () => {
    setEditingRule({ label: "", type: "bonus", amount: "", description: "" });
    setShowRuleDialog(true);
  };
  const openEditRuleDialog = (rule: { id: number; label: string; type: string; amount: string; description: string | null }) => {
    setEditingRule({ id: rule.id, label: rule.label, type: rule.type as "bonus" | "deduction", amount: String(parseFloat(rule.amount)), description: rule.description ?? "" });
    setShowRuleDialog(true);
  };
  const handleSaveRule = async () => {
    if (!editingRule) return;
    if (!editingRule.label.trim()) { toast.error("Rule name is required"); return; }
    const amount = parseFloat(editingRule.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Amount must be a positive number"); return; }
    setRuleDialogSaving(true);
    try {
      if (editingRule.id) {
        await updateCustomRule.mutateAsync({ id: editingRule.id, label: editingRule.label.trim(), type: editingRule.type, amount, description: editingRule.description || undefined });
        toast.success("Rule updated");
      } else {
        await createCustomRule.mutateAsync({ label: editingRule.label.trim(), type: editingRule.type, amount, description: editingRule.description || undefined });
        toast.success("Rule added");
      }
      await refetchCustomRules();
      setShowRuleDialog(false);
      setEditingRule(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setRuleDialogSaving(false);
    }
  };
  const handleDeleteRule = async (id: number) => {
    if (!window.confirm("Delete this rule? This cannot be undone.")) return;
    try {
      await deleteCustomRule.mutateAsync({ id });
      await refetchCustomRules();
      toast.success("Rule deleted");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete rule");
    }
  };

  // Lifted local edits — keyed by setting key, updated on every keystroke.
  // The preview reads from effectiveValues which merges server + local edits.
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

  const handleLocalChange = useCallback((key: string, value: string) => {
    setLocalEdits((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = async (key: string, value: string) => {
    await updateSetting.mutateAsync({ key, value });
    await refetch();
    // After saving, remove the local edit so the saved server value is used
    setLocalEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    toast.success("Setting saved");
  };

  // serverSettings: keyed by setting key
  const serverSettings = Object.fromEntries(
    (settings ?? []).map((s) => [s.key, s])
  );

  // effectiveValues: local edit wins over server value — used by the preview
  const effectiveValues: Record<string, string> = {};
  for (const [key, s] of Object.entries(serverSettings)) {
    effectiveValues[key] = localEdits[key] ?? s.value;
  }

  const currentFormFlow = effectiveValues["formSmsFlow"] ?? effectiveValues["smsFlow"] ?? "B";
  const currentWidgetFlow = effectiveValues["widgetSmsFlow"] ?? "B";

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "form", label: "Form SMS", icon: <FileText className="w-4 h-4" /> },
    { id: "widget", label: "Widget SMS", icon: <MessageCircle className="w-4 h-4" /> },
    { id: "email", label: "Email Leads", icon: <Mail className="w-4 h-4" /> },
    { id: "reactivation", label: "Reactivation", icon: <RefreshCw className="w-4 h-4" /> },
    { id: "general", label: "General", icon: <Settings className="w-4 h-4" /> },
    { id: "pay", label: "Pay Rules", icon: <DollarSign className="w-4 h-4" /> },
    { id: "responses", label: "Responses", icon: <Sparkles className="w-4 h-4" /> },
  ];

  return (
    <AdminPageGuard pageId="settings">
    <div className="min-h-screen bg-[#faf9f7]">
      <AdminHeader activeTab="settings" pagePermissions={pagePermissions} isAdmin={isAdmin} />

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E8735A]/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-[#E8735A]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500">Manage business configuration and SMS conversation flows</p>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto w-full">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
                ${activeTab === tab.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
                }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[#E8735A]" />
          </div>
        ) : (
          <>
            {/* ── Form SMS Tab ─────────────────────────────────────────────── */}
            {activeTab === "form" && (
              <div className="space-y-6">
                <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    <strong>Form SMS</strong> — these scripts are sent to leads who submit the quote form at <code className="bg-blue-100 px-1 rounded">quote.maidinblack.com</code>. The form collects bedrooms, bathrooms, and service type upfront, so SMS 1 can include the price immediately.
                  </p>
                </div>

                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <FlaskConical className="w-4 h-4 text-[#E8735A]" />
                      Form SMS Conversation Flow
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Choose which opening SMS script is sent to new quote form leads. Changes apply to new leads only.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SmsFlowSelector
                      currentValue={currentFormFlow}
                      onSave={(value) => handleSave("formSmsFlow", value)}
                      effectiveValues={effectiveValues}
                      flowOptions={WIDGET_FLOW_OPTIONS}
                      flowAConvo={FLOW_A_CONVO}
                      flowBConvo={FLOW_B_CONVO}
                    />
                  </CardContent>
                </Card>

                <SmsTemplateCard
                  title="Flow C — Jade Enriched Quote Scripts"
                  description={
                    <>
                      Edit the 4-step enriched quote flow. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{bedrooms}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{bathrooms}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code> — they are replaced automatically. Place <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code> in SMS 4 to send the personalized quote page URL.
                    </>
                  }
                  icon={<Sparkles className="w-4 h-4 text-purple-500" />}
                  templateKeys={["flowC_sms1", "flowC_sms2", "flowC_sms3", "flowC_sms4"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />

                <SmsTemplateCard
                  title="Flow B — Jade SMS Scripts"
                  description={
                    <>
                      Edit the messages sent in each step of the Jade flow. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{recurringprice}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{day}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code> — they are replaced automatically. Use <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code> in SMS 2 to insert the personalized quote page URL.
                    </>
                  }
                  icon={<Sparkles className="w-4 h-4 text-[#E8735A]" />}
                  templateKeys={["flowB_sms1", "flowB_sms2", "flowB_sms3", "flowB_sms4", "flowB_sms5", "flowB_sms5_later"]}

                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />

                <SmsTemplateCard
                  title="Flow A — Madison SMS Scripts"
                  description={
                    <>
                      Edit the messages sent in each step of the Madison flow. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{address}'}</code> — they are replaced automatically.
                    </>
                  }
                  icon={<User className="w-4 h-4 text-blue-500" />}
                  templateKeys={["flowA_sms1", "flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />
              </div>
            )}

            {/* ── Widget SMS Tab ────────────────────────────────────────────── */}
            {activeTab === "widget" && (
              <div className="space-y-6">
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <strong>Widget SMS</strong> — these scripts are sent to leads who submit their name and phone via the floating chat widget on <code className="bg-emerald-100 px-1 rounded">maidsinblack.com</code>. The widget does <strong>not</strong> collect bedrooms/bathrooms upfront — SMS 1 asks for home size, and the AI handles the rest of the conversation.
                  </p>
                </div>

                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <FlaskConical className="w-4 h-4 text-[#E8735A]" />
                      Widget SMS Conversation Flow
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Choose which persona greets widget leads. Changes apply to new widget leads only.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SmsFlowSelector
                      currentValue={currentWidgetFlow}
                      onSave={(value) => handleSave("widgetSmsFlow", value)}
                      effectiveValues={effectiveValues}
                      flowOptions={WIDGET_FLOW_OPTIONS}
                      flowAConvo={WIDGET_FLOW_A_CONVO}
                      flowBConvo={WIDGET_FLOW_B_CONVO}
                    />
                  </CardContent>
                </Card>

                <SmsTemplateCard
                  title="Widget Flow C — Jade Enriched Quote Scripts"
                  description={
                    <>
                      Edit the 4-step enriched quote flow for widget leads. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{bedrooms}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{bathrooms}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code> — they are replaced automatically. Place <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code> in SMS 4 to send the personalized quote page URL.
                    </>
                  }
                  icon={<Sparkles className="w-4 h-4 text-purple-500" />}
                  templateKeys={["flowC_sms1", "flowC_sms2", "flowC_sms3", "flowC_sms4"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />

                <SmsTemplateCard
                  title="Widget SMS 1 — Sizing Question"
                  description={
                    <>
                      The very first SMS sent to widget leads asking for their home size. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code> for the lead's first name. The rest of the conversation uses the shared Flow A or Flow B scripts below.
                    </>
                  }
                  icon={<MessageCircle className="w-4 h-4 text-emerald-600" />}
                  templateKeys={["widgetFlowB_sms1", "widgetFlowA_sms1"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />

                <SmsTemplateCard
                  title="Widget Flow B — Jade Scripts (after sizing)"
                  description={
                    <>
                      After the lead replies with their home size, the Jade widget flow uses these same scripts as the form Jade flow. Edits here also update the Form SMS tab. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{recurringprice}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{day}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{quoteLink}'}</code>.
                    </>
                  }
                  icon={<Sparkles className="w-4 h-4 text-[#E8735A]" />}
                  templateKeys={["flowB_sms1", "flowB_sms2", "flowB_sms3", "flowB_sms4", "flowB_sms5", "flowB_sms5_later"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />

                <SmsTemplateCard
                  title="Widget Flow A — Madison Scripts (after sizing)"
                  description={
                    <>
                      After the lead replies with their home size, the Madison widget flow uses these same scripts as the form Madison flow. Edits here also update the Form SMS tab. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{address}'}</code>.
                    </>
                  }
                  icon={<User className="w-4 h-4 text-blue-500" />}
                  templateKeys={["flowA_sms1", "flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />
              </div>
            )}

                {/* ── Email Leads Tab ───────────────────────────────────── */}
            {activeTab === "email" && (
              <div className="space-y-6">
                <div className="rounded-xl bg-violet-50 border border-violet-100 px-4 py-3">
                  <p className="text-xs text-violet-700 leading-relaxed">
                    <strong>Email Leads</strong> — these scripts are sent to leads that arrive via email (forwarded through Mailgun from <code className="bg-violet-100 px-1 rounded">support@maidsinblacksupport.com</code>). The email already contains the service type, bedrooms, and bathrooms, so SMS 1 can include the price immediately — just like the quote form.
                  </p>
                </div>

                {/* Conversation preview */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <Mail className="w-4 h-4 text-violet-500" />
                      Email Lead Conversation Flow
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Email leads always use the Madison (Flow A) script — price + availability upfront. The conversation continues with the shared Flow A scripts.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Full Conversation Preview</p>
                      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                        {EMAIL_LEAD_CONVO.map((item, idx) => {
                          if (item.type === 'lead') {
                            return (
                              <div key={idx} className="flex justify-end">
                                <div className="bg-[#E8735A]/10 border border-[#E8735A]/20 rounded-2xl rounded-tr-sm px-3 py-2 text-xs text-gray-700 leading-relaxed max-w-[75%] whitespace-pre-line">
                                  {item.text}
                                </div>
                              </div>
                            );
                          }
                          const rawValue = effectiveValues[item.templateKey] ?? "";
                          const previewText = applyPreviewVars(rawValue);
                          return (
                            <div key={idx} className="flex items-start gap-2">
                              <span className="text-xs text-gray-400 w-16 shrink-0 pt-1.5">{item.label}</span>
                              <div className="bg-white rounded-2xl rounded-tl-sm border border-gray-200 px-3 py-2 text-xs text-gray-700 leading-relaxed max-w-[75%] whitespace-pre-line">
                                {previewText || <span className="text-gray-400 italic">Loading...</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-400">Preview with sample data (Sarah, Bi-Weekly, 2 bed / 1 bath, $180, Thursday). Edits to the scripts below update this preview instantly.</p>
                    </div>
                  </CardContent>
                </Card>

                <SmsTemplateCard
                  title="Email Lead SMS 1 — Opening Message"
                  description={
                    <>
                      The first SMS sent when an email lead arrives. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{serviceType}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{bedrooms}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{bathrooms}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{frequency}'}</code> — they are replaced automatically.
                    </>
                  }
                  icon={<Mail className="w-4 h-4 text-violet-500" />}
                  templateKeys={["emailFlowA_sms1"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />

                <SmsTemplateCard
                  title="Flow A — Madison Scripts (SMS 2 onward)"
                  description={
                    <>
                      After SMS 1, email leads continue with the shared Madison flow. Edits here also update the Form SMS and Widget SMS tabs. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{address}'}</code>.
                    </>
                  }
                  icon={<User className="w-4 h-4 text-blue-500" />}
                  templateKeys={["flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later"]}
                  serverSettings={serverSettings}
                  localEdits={localEdits}
                  onLocalChange={handleLocalChange}
                  onSave={handleSave}
                />
              </div>
            )}

            {/* ── Reactivation Tab ──────────────────────────────────────────── */}
            {activeTab === "reactivation" && (
              <div className="space-y-6">
                {/* Info banner */}
                <div className="rounded-xl bg-orange-50 border border-orange-100 px-4 py-3">
                  <p className="text-xs text-orange-700 leading-relaxed">
                    <strong>Reactivation SMS</strong> — these scripts are sent to past customers who receive a reactivation campaign. The flow is fully scripted (no AI) so every reply follows the exact path shown below. Edits apply to all future replies immediately.
                  </p>
                </div>

                {/* Flow diagram */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4 text-[#E8735A]" />
                      Reactivation Conversation Flow
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Every inbound reply from a reactivation lead follows this scripted path. No AI is involved — what you see here is exactly what the customer receives.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* Flow diagram */}
                    <div className="flex flex-col items-start gap-0 mb-6">
                      {/* Step 1: Initial outbound */}
                      <div className="flex items-start gap-3 w-full">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-[#E8735A] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">1</div>
                          <div className="w-0.5 h-8 bg-gray-200 mt-1" />
                        </div>
                        <div className="pb-4">
                          <p className="text-xs font-semibold text-gray-700">Campaign fires → Initial SMS sent</p>
                          <p className="text-xs text-gray-500 mt-0.5">Template: <code className="bg-gray-100 px-1 rounded">reactivation_initial</code></p>
                        </div>
                      </div>
                      {/* Step 2: Customer replies */}
                      <div className="flex items-start gap-3 w-full">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">2</div>
                          <div className="w-0.5 h-8 bg-gray-200 mt-1" />
                        </div>
                        <div className="pb-4">
                          <p className="text-xs font-semibold text-gray-700">Customer replies</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">YES / positive</span>
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Price question</span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Any other reply</span>
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">STOP</span>
                          </div>
                        </div>
                      </div>
                      {/* Step 3: Bot responds */}
                      <div className="flex items-start gap-3 w-full">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-[#E8735A] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">3</div>
                          <div className="w-0.5 h-8 bg-gray-200 mt-1" />
                        </div>
                        <div className="pb-4">
                          <p className="text-xs font-semibold text-gray-700">Bot sends scripted reply</p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">YES → yes_reply template → asks for time</span>
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Price → price_question + time_ask</span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Other → time_ask template</span>
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">STOP → opt_out template → DONE</span>
                          </div>
                        </div>
                      </div>
                      {/* Step 4: Customer gives time */}
                      <div className="flex items-start gap-3 w-full">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">4</div>
                          <div className="w-0.5 h-8 bg-gray-200 mt-1" />
                        </div>
                        <div className="pb-4">
                          <p className="text-xs font-semibold text-gray-700">Customer gives preferred time window</p>
                          <p className="text-xs text-gray-500 mt-0.5">e.g. “Mornings work best”, “Weekend afternoon”</p>
                        </div>
                      </div>
                      {/* Step 5: Closing */}
                      <div className="flex items-start gap-3 w-full">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">✓</div>
                        </div>
                        <div className="pb-4">
                          <p className="text-xs font-semibold text-gray-700">Bot sends closing confirmation → DONE</p>
                          <p className="text-xs text-gray-500 mt-0.5">Template: <code className="bg-gray-100 px-1 rounded">reactivation_closing</code></p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Template editor */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#E8735A]" />
                      Reactivation Message Templates
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Click the pencil icon on any message to edit it. Changes are saved immediately and apply to all future replies. Use <code className="bg-gray-100 px-1 rounded">[Name]</code>, <code className="bg-gray-100 px-1 rounded">[LastPrice]</code>, <code className="bg-gray-100 px-1 rounded">[Discount]</code>, <code className="bg-gray-100 px-1 rounded">[DiscountedPrice]</code> as variables.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <MessageFlowPanel
                      flowType="reactivation"
                      sampleVars={{
                        "[Name]": "Sarah",
                        "[LastPrice]": "150",
                        "[Discount]": "10",
                        "[DiscountedPrice]": "135",
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Pay Rules Tab ──────────────────────────────────────────────── */}
            {activeTab === "pay" && (
              <div className="space-y-6">
                {/* Intro card */}
                <Card className="border border-[#E8735A]/20 bg-[#E8735A]/5">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[#E8735A]/15 flex items-center justify-center shrink-0">
                        <DollarSign className="w-4.5 h-4.5 text-[#E8735A]" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">Cleaner Pay Rules</p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                          These amounts are applied automatically when a job is rated. Changes take effect on the next rated job — they do not retroactively update past pay records.
                          Cleaners can see these rules in their portal so they always know how their pay is calculated.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {payRulesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-[#E8735A]" />
                  </div>
                ) : payRulesData ? (
                  <>
                    {/* Bonuses */}
                    <Card className="border border-gray-200 shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-emerald-600" />
                          Bonuses
                        </CardTitle>
                        <CardDescription className="text-xs text-gray-500">
                          Amounts added to cleaner pay when they meet these criteria.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5 divide-y divide-gray-100">
                        {/* 5-star bonus */}
                        <div>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Star className="w-3.5 h-3.5 text-amber-500" />
                                <p className="text-sm font-medium text-gray-800">5-Star Rating Bonus</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Added to pay when a customer leaves a 5-star rating.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm text-gray-500">+$</span>
                              <Input
                                type="number" min="0" step="0.50"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.fiveStarBonus ?? String(payRulesData.fiveStarBonus)}
                                onChange={e => handlePayFieldChange("fiveStarBonus", e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                        {/* Photo bonus */}
                        <div className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Camera className="w-3.5 h-3.5 text-blue-500" />
                                <p className="text-sm font-medium text-gray-800">Completion Photo Bonus</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Added to pay when the cleaner uploads a completion photo.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm text-gray-500">+$</span>
                              <Input
                                type="number" min="0" step="0.50"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.photoBonus ?? String(payRulesData.photoBonus)}
                                onChange={e => handlePayFieldChange("photoBonus", e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                        {/* Streak bonus */}
                        <div className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-purple-500" />
                                <p className="text-sm font-medium text-gray-800">Streak Bonus</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Paid when a cleaner completes the streak target with no issues.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm text-gray-500">+$</span>
                              <Input
                                type="number" min="0" step="1"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.streakBonus ?? String(payRulesData.streakBonus)}
                                onChange={e => handlePayFieldChange("streakBonus", e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                        {/* Streak target */}
                        <div className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-purple-400" />
                                <p className="text-sm font-medium text-gray-800">Streak Target (jobs)</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Number of consecutive clean jobs needed to earn the streak bonus. Resets on any complaint or low rating.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Input
                                type="number" min="1" step="1"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.streakTarget ?? String(payRulesData.streakTarget)}
                                onChange={e => handlePayFieldChange("streakTarget", e.target.value)}
                              />
                              <span className="text-sm text-gray-500">jobs</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Deductions */}
                    <Card className="border border-gray-200 shadow-sm">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                          <TrendingDown className="w-4 h-4 text-red-500" />
                          Deductions
                        </CardTitle>
                        <CardDescription className="text-xs text-gray-500">
                          Amounts subtracted from cleaner pay when these issues occur.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5 divide-y divide-gray-100">
                        {/* Low rating deduction */}
                        <div>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                <p className="text-sm font-medium text-gray-800">Low Rating Deduction (≤3 stars)</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Deducted when a customer leaves 3 stars or fewer, or reports a complaint.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm text-gray-500">-$</span>
                              <Input
                                type="number" min="0" step="0.50"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.lowRatingDeduction ?? String(payRulesData.lowRatingDeduction)}
                                onChange={e => handlePayFieldChange("lowRatingDeduction", e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                        {/* No photo penalty */}
                        <div className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Camera className="w-3.5 h-3.5 text-gray-400" />
                                <p className="text-sm font-medium text-gray-800">No Photo Penalty</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Deducted when the cleaner does not upload a completion photo.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm text-gray-500">-$</span>
                              <Input
                                type="number" min="0" step="0.50"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.noPhotoPenalty ?? String(payRulesData.noPhotoPenalty)}
                                onChange={e => handlePayFieldChange("noPhotoPenalty", e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                        {/* Reclean penalty */}
                        <div className="pt-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                                <p className="text-sm font-medium text-gray-800">Reclean / Poor Service Penalty</p>
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">Deducted when a job requires a reclean due to poor service. Applied manually by an admin.</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-sm text-gray-500">-$</span>
                              <Input
                                type="number" min="0" step="0.50"
                                className="w-24 text-right h-8 text-sm"
                                value={payEdits.recleanPenalty ?? String(payRulesData.recleanPenalty)}
                                onChange={e => handlePayFieldChange("recleanPenalty", e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Preview card */}
                    <Card className="border border-dashed border-gray-300 bg-gray-50/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-gray-600">Live Preview — What Cleaners See</CardTitle>
                        <CardDescription className="text-xs text-gray-400">This is how the rules appear in the cleaner portal right now.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm">
                          {([
                            { icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />, label: "5-Star Rating", value: `+$${payEdits.fiveStarBonus ?? payRulesData.fiveStarBonus}`, color: "text-emerald-600" },
                            { icon: <Camera className="w-3.5 h-3.5 text-emerald-500" />, label: "Completion Photo", value: `+$${payEdits.photoBonus ?? payRulesData.photoBonus}`, color: "text-emerald-600" },
                            { icon: <Zap className="w-3.5 h-3.5 text-emerald-500" />, label: `Streak Bonus (every ${payEdits.streakTarget ?? payRulesData.streakTarget} jobs)`, value: `+$${payEdits.streakBonus ?? payRulesData.streakBonus}`, color: "text-emerald-600" },
                            { icon: <TrendingDown className="w-3.5 h-3.5 text-red-500" />, label: "Low Rating (≤3 stars)", value: `-$${payEdits.lowRatingDeduction ?? payRulesData.lowRatingDeduction}`, color: "text-red-600" },
                            { icon: <Camera className="w-3.5 h-3.5 text-red-500" />, label: "No Photo", value: `-$${payEdits.noPhotoPenalty ?? payRulesData.noPhotoPenalty}`, color: "text-red-600" },
                            { icon: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />, label: "Reclean / Poor Service", value: `-$${payEdits.recleanPenalty ?? payRulesData.recleanPenalty}`, color: "text-red-600" },
                          ] as const).map(row => (
                            <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                              <div className="flex items-center gap-2 text-gray-600">{row.icon}{row.label}</div>
                              <span className={`font-semibold ${row.color}`}>{row.value}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Save button */}
                    <div className="flex justify-end">
                      <Button
                        onClick={handleSavePayRules}
                        disabled={payRulesSaving || Object.keys(payEdits).length === 0}
                        className="gap-2 bg-[#E8735A] hover:bg-[#d4614a] text-white"
                      >
                        {payRulesSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {payRulesSaving ? "Saving..." : "Save Pay Rules"}
                      </Button>
                    </div>

                    {/* ── Custom Bonuses & Deductions ─────────────────────────── */}
                    <Card className="border border-gray-200 shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-base font-semibold text-gray-900">Custom Bonuses &amp; Deductions</CardTitle>
                            <CardDescription className="text-xs text-gray-500 mt-0.5">
                              Add any additional rules beyond the system defaults — e.g. Google Review bonus, no-show penalty.
                            </CardDescription>
                          </div>
                          <Button size="sm" onClick={openNewRuleDialog} className="gap-1.5 bg-[#E8735A] hover:bg-[#d4614a] text-white shrink-0">
                            <Plus className="w-3.5 h-3.5" />
                            Add Rule
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {!customRules || customRules.length === 0 ? (
                          <div className="py-8 text-center">
                            <DollarSign className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">No custom rules yet.</p>
                            <p className="text-xs text-gray-400 mt-0.5">Click &quot;Add Rule&quot; to create your first bonus or deduction.</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {customRules.map((rule) => (
                              <div key={rule.id} className={`flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg border transition-colors ${ rule.isActive ? "border-gray-100 bg-gray-50/50 hover:bg-gray-50" : "border-gray-100 bg-gray-50/20 opacity-60" }`}>
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {rule.type === "bonus" ? (
                                    <TrendingUp className={`w-4 h-4 shrink-0 ${ rule.isActive ? "text-emerald-500" : "text-gray-400" }`} />
                                  ) : (
                                    <TrendingDown className={`w-4 h-4 shrink-0 ${ rule.isActive ? "text-red-500" : "text-gray-400" }`} />
                                  )}
                                  <div className="min-w-0">
                                    <p className={`text-sm font-medium truncate ${ rule.isActive ? "text-gray-800" : "text-gray-400 line-through" }`}>{rule.label}</p>
                                    {rule.description && <p className="text-xs text-gray-400 truncate">{rule.description}</p>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className={`text-sm font-semibold ${ rule.isActive ? (rule.type === "bonus" ? "text-emerald-600" : "text-red-600") : "text-gray-400" }`}>
                                    {rule.type === "bonus" ? "+" : "-"}${parseFloat(rule.amount).toFixed(2)}
                                  </span>
                                  {/* Active/Inactive toggle */}
                                  <button
                                    onClick={async () => {
                                      try {
                                        await updateCustomRule.mutateAsync({ id: rule.id, isActive: !rule.isActive });
                                        await refetchCustomRules();
                                        toast.success(rule.isActive ? "Rule deactivated" : "Rule activated");
                                      } catch { toast.error("Failed to update rule"); }
                                    }}
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${ rule.isActive ? "bg-emerald-500" : "bg-gray-300" }`}
                                    title={rule.isActive ? "Click to deactivate" : "Click to activate"}
                                  >
                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${ rule.isActive ? "translate-x-4.5" : "translate-x-0.5" }`} />
                                  </button>
                                  <button
                                    onClick={() => openEditRuleDialog(rule as { id: number; label: string; type: string; amount: string; description: string | null })}
                                    className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors"
                                    title="Edit rule"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteRule(rule.id)}
                                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                                    title="Delete rule"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                ) : null}
              </div>
            )}

            {/* ── Add/Edit Custom Rule Dialog ─────────────────────────────────── */}
            <Dialog open={showRuleDialog} onOpenChange={(open) => { if (!open) { setShowRuleDialog(false); setEditingRule(null); } }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingRule?.id ? "Edit Rule" : "Add Custom Rule"}</DialogTitle>
                </DialogHeader>
                {editingRule && (
                  <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="rule-label" className="text-sm font-medium">Rule Name</Label>
                      <Input
                        id="rule-label"
                        placeholder="e.g. Google Review Bonus"
                        value={editingRule.label}
                        onChange={e => setEditingRule(r => r ? { ...r, label: e.target.value } : r)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-sm font-medium">Type</Label>
                        <Select
                          value={editingRule.type}
                          onValueChange={(v) => setEditingRule(r => r ? { ...r, type: v as "bonus" | "deduction" } : r)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bonus">Bonus (+)</SelectItem>
                            <SelectItem value="deduction">Deduction (-)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="rule-amount" className="text-sm font-medium">Amount ($)</Label>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-medium ${ editingRule.type === "bonus" ? "text-emerald-600" : "text-red-600" }`}>
                            {editingRule.type === "bonus" ? "+" : "-"}$
                          </span>
                          <Input
                            id="rule-amount"
                            type="number" min="0.01" step="0.50"
                            placeholder="0.00"
                            value={editingRule.amount}
                            onChange={e => setEditingRule(r => r ? { ...r, amount: e.target.value } : r)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rule-desc" className="text-sm font-medium">Description <span className="text-gray-400 font-normal">(optional — shown to cleaners)</span></Label>
                      <Input
                        id="rule-desc"
                        placeholder="e.g. Awarded when a cleaner gets a Google review"
                        value={editingRule.description}
                        onChange={e => setEditingRule(r => r ? { ...r, description: e.target.value } : r)}
                      />
                    </div>
                  </div>
                )}
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => { setShowRuleDialog(false); setEditingRule(null); }}>Cancel</Button>
                  <Button onClick={handleSaveRule} disabled={ruleDialogSaving} className="bg-[#E8735A] hover:bg-[#d4614a] text-white gap-2">
                    {ruleDialogSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {ruleDialogSaving ? "Saving..." : "Save Rule"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ── General Tab ────────────────────────────────────────────────── */}
            {activeTab === "general" && (
              <div className="space-y-6">
                {SECTIONS.map((section) => (
                  <Card key={section.title} className="border border-gray-200 shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold text-gray-900">
                        {section.title}
                      </CardTitle>
                      <CardDescription className="text-xs text-gray-500">
                        {section.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5 divide-y divide-gray-100">
                      {section.keys.map((key, idx) => {
                        const setting = serverSettings[key];
                        if (!setting) return null;
                        const localValue = localEdits[key] ?? setting.value;
                        return (
                          <div key={key} className={idx > 0 ? "pt-5" : ""}>
                            <SettingField
                              settingKey={key}
                              savedValue={setting.value}
                              localValue={localValue}
                              label={setting.label}
                              description={setting.description}
                              fieldType={setting.fieldType}
                              onLocalChange={handleLocalChange}
                              onSave={handleSave}
                            />
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}

                {/* ── Call Notification Card ──────────────────────────── */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <PhoneCall className="w-4 h-4 text-[#E8735A]" />
                      Call Notifications
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      When enabled, an automated call is placed to the alert number every time a new lead arrives (7am–7pm ET only). The call uses the Sarah voice and reads a short script with the lead's name.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5 divide-y divide-gray-100">
                    {["callAlertEnabled", "callAlertPhone"].map((key, idx) => {
                      const setting = serverSettings[key];
                      if (!setting) return null;
                      const localValue = localEdits[key] ?? setting.value;
                      return (
                        <div key={key} className={idx > 0 ? "pt-5" : ""}>
                          <SettingField
                            settingKey={key}
                            savedValue={setting.value}
                            localValue={localValue}
                            label={setting.label}
                            description={setting.description}
                            fieldType={setting.fieldType}
                            onLocalChange={handleLocalChange}
                            onSave={handleSave}
                          />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {serverSettings["trackerSmsTemplate"] && (
                  <Card className="border border-dashed border-gray-300 bg-gray-50/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-gray-600 flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        SMS Preview
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="bg-white rounded-xl border border-gray-200 p-4 max-w-xs">
                        <div className="flex items-start gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#E8735A]/10 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-xs">🧹</span>
                          </div>
                          <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-gray-700 leading-relaxed">
                            {(localEdits["trackerSmsTemplate"] ?? serverSettings["trackerSmsTemplate"].value)
                              .replace("{firstName}", "Sarah")
                              .replace("{trackerLink}", "quote.maidinblack.com/track/abc123")}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 mt-2">
                        Preview with sample data — actual messages use real customer names and tokens.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Silenced Services */}
                {serverSettings["silenced_services"] && (
                  <SilencedServicesCard
                    currentValue={localEdits["silenced_services"] ?? serverSettings["silenced_services"].value}
                    onSave={handleSave}
                  />
                )}
                {/* OpenPhone Agent Mapping */}
                <OpenPhoneSyncCard />
                {/* App Version / Deployment Info */}
                <AppVersionCard />
              </div>
            )}
          {/* ── Responses Tab ────────────────────────────────────────────── */}
            {activeTab === "responses" && <ResponseTemplatesTab />}
          </>
        )}
      </div>
    </div>
    </AdminPageGuard>
  );
}
