/**
 * SettingsPage — /admin/settings
 *
 * Admin-only page for managing configurable business settings.
 * Organized into three top-level tabs:
 *   1. Form SMS — flow selector + templates for the quote form (Madison / Jade)
 *   2. Widget SMS — flow selector + templates for the chat widget (Madison / Jade)
 *   3. General — Google Review URL, tracker SMS, business info, etc.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Settings, Link, MessageSquare, Star, Phone, Building2,
  Save, Loader2, CheckCircle2, ToggleLeft, ToggleRight, Bell,
  FlaskConical, User, Sparkles, Shuffle, MessageCircle, FileText,
} from "lucide-react";

// ── Section config — groups settings visually ────────────────────────────────

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

// ── SMS Flow Selector ─────────────────────────────────────────────────────────

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
    description: "Widget leads get Jade. Asks for bedrooms/bathrooms, then greets and asks for day — price is revealed only after the lead replies with a day.",
    color: "coral",
  },
  {
    value: "split",
    label: "A/B Test (50/50)",
    icon: <Shuffle className="w-4 h-4" />,
    description: "Each widget lead is randomly assigned Flow A or Flow B. Use this to compare conversion rates between the two scripts.",
    color: "purple",
  },
];

// Sample data substitution for preview
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
    .replace(/\{extrasLine\}/g, " (including clean inside oven)");
}

// Full conversation thread definitions per flow
type ConvoItem = { type: 'bot'; label: string; templateKey: string } | { type: 'lead'; text: string };

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

// Widget conversation threads — start with sizing question, then continue like form flows
const WIDGET_FLOW_B_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'widgetFlowB_sms1' },
  { type: 'lead', text: '3 bed / 2 bath' },
  // After sizing, Jade asks for day (AVAILABILITY stage — uses flowB_sms1 logic but via LLM)
  { type: 'bot', label: 'Day ask', templateKey: 'flowB_sms1' },
  { type: 'lead', text: 'Thursday works!' },
  { type: 'bot', label: 'Price reveal', templateKey: 'flowB_sms2' },
  { type: 'lead', text: '9am please' },
  { type: 'bot', label: 'Address ask', templateKey: 'flowB_sms3' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'Lock-in', templateKey: 'flowB_sms4' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'Confirmed', templateKey: 'flowB_sms5' },
];

const WIDGET_FLOW_A_CONVO: ConvoItem[] = [
  { type: 'bot', label: 'SMS 1', templateKey: 'widgetFlowA_sms1' },
  { type: 'lead', text: '3 bed / 2 bath' },
  // After sizing, Madison sends price + availability (via LLM using flowA templates)
  { type: 'bot', label: 'Price + avail', templateKey: 'flowA_sms1' },
  { type: 'bot', label: 'Slot offer', templateKey: 'flowA_sms2' },
  { type: 'lead', text: 'Thursday works for me!' },
  { type: 'bot', label: 'Time pref', templateKey: 'flowA_sms3' },
  { type: 'lead', text: 'Morning please' },
  { type: 'bot', label: 'Address ask', templateKey: 'flowA_sms4' },
  { type: 'lead', text: '123 Main St, DC 20001' },
  { type: 'bot', label: 'Confirmation', templateKey: 'flowA_sms5' },
  { type: 'lead', text: 'Call me now!' },
  { type: 'bot', label: 'Confirmed', templateKey: 'flowA_sms6' },
];

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
};

function SmsFlowSelector({
  currentValue,
  onSave,
  settingsByKey,
  flowOptions,
  flowAConvo,
  flowBConvo,
  settingKey,
  label,
  description,
}: {
  currentValue: string;
  onSave: (value: string) => Promise<void>;
  settingsByKey: Record<string, { key: string; value: string; label: string; description: string | null; fieldType: string }>;
  flowOptions: typeof FLOW_OPTIONS;
  flowAConvo: ConvoItem[];
  flowBConvo: ConvoItem[];
  settingKey: string;
  label: string;
  description: string;
}) {
  const [selected, setSelected] = useState(currentValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isDirty = selected !== currentValue;

  const handleSelect = (value: string) => {
    setSelected(value);
  };

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

  // Pick the right conversation thread based on selected flow
  const convoThread: ConvoItem[] | null =
    selected === "A" ? flowAConvo :
    selected === "B" ? flowBConvo :
    null; // split — show both

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
              onClick={() => handleSelect(option.value)}
              className={`relative text-left rounded-xl border-2 p-4 transition-all cursor-pointer
                ${isActive
                  ? `${colors.bg} ${colors.border} shadow-sm`
                  : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
            >
              {/* Active indicator */}
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

      {/* Full conversation thread preview */}
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
              const templateValue = settingsByKey[item.templateKey]?.value ?? "";
              const previewText = applyPreviewVars(templateValue);
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

      {/* Save button */}
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
          <span className="text-xs text-gray-400">Changes apply to new leads only — active conversations keep their assigned flow.</span>
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

// ── Toggle component ─────────────────────────────────────────────────────────

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

// ── Single setting field ─────────────────────────────────────────────────────

function SettingField({
  setting,
  onSave,
}: {
  setting: { key: string; value: string; label: string; description: string | null; fieldType: string };
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [localValue, setLocalValue] = useState(setting.value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isDirty = localValue !== setting.value;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(setting.key, localValue);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  // Auto-save toggles immediately
  const handleToggleChange = async (v: string) => {
    setLocalValue(v);
    setSaving(true);
    try {
      await onSave(setting.key, v);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[#E8735A]">{SECTION_ICONS[setting.key]}</span>
        <label className="text-sm font-semibold text-gray-800">{setting.label}</label>
        {saved && (
          <span className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
            <CheckCircle2 className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
      {setting.description && (
        <p className="text-xs text-gray-500 leading-relaxed">{setting.description}</p>
      )}
      {setting.fieldType === "toggle" ? (
        <ToggleField value={localValue} onChange={handleToggleChange} />
      ) : setting.fieldType === "textarea" ? (
        <div className="space-y-2">
          <Textarea
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            rows={3}
            className="text-sm font-mono resize-none"
            placeholder={setting.label}
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
            onChange={(e) => setLocalValue(e.target.value)}
            className="text-sm"
            placeholder={setting.label}
            type={setting.fieldType === "url" ? "url" : "text"}
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
  settingsByKey,
  onSave,
}: {
  title: string;
  description: React.ReactNode;
  icon: React.ReactNode;
  templateKeys: string[];
  settingsByKey: Record<string, { key: string; value: string; label: string; description: string | null; fieldType: string }>;
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
          const setting = settingsByKey[key];
          if (!setting) return null;
          return (
            <div key={key} className={idx > 0 ? "pt-5" : ""}>
              <SettingField setting={setting} onSave={onSave} />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

type SettingsTab = "form" | "widget" | "general";

export default function SettingsPage() {
  const { data: settings, isLoading, refetch } = trpc.settings.getAll.useQuery();
  const updateSetting = trpc.settings.update.useMutation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("form");

  const handleSave = async (key: string, value: string) => {
    await updateSetting.mutateAsync({ key, value });
    await refetch();
    toast.success("Setting saved");
  };

  const settingsByKey = Object.fromEntries(
    (settings ?? []).map((s) => [s.key, s])
  );

  const currentFormFlow = settingsByKey["smsFlow"]?.value ?? "B";
  const currentWidgetFlow = settingsByKey["widgetSmsFlow"]?.value ?? "B";

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: "form", label: "Form SMS", icon: <FileText className="w-4 h-4" /> },
    { id: "widget", label: "Widget SMS", icon: <MessageCircle className="w-4 h-4" /> },
    { id: "general", label: "General", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#faf9f7]">
      <AdminHeader activeTab="settings" />

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
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
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
            {/* ── Form SMS Tab ───────────────────────────────────────────────── */}
            {activeTab === "form" && (
              <div className="space-y-6">
                <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    <strong>Form SMS</strong> — these scripts are sent to leads who submit the quote form at <code className="bg-blue-100 px-1 rounded">quote.maidinblack.com</code>. The form collects bedrooms, bathrooms, and service type upfront, so SMS 1 can include the price immediately.
                  </p>
                </div>

                {/* Form Flow Selector */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <FlaskConical className="w-4 h-4 text-[#E8735A]" />
                      Form SMS Conversation Flow
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Choose which opening SMS script is sent to new quote form leads. Changes apply to new leads only — active conversations keep their assigned flow.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SmsFlowSelector
                      currentValue={currentFormFlow}
                      onSave={(value) => handleSave("smsFlow", value)}
                      settingsByKey={settingsByKey}
                      flowOptions={FLOW_OPTIONS}
                      flowAConvo={FLOW_A_CONVO}
                      flowBConvo={FLOW_B_CONVO}
                      settingKey="smsFlow"
                      label="Form SMS Flow"
                      description="Controls which flow new form leads receive."
                    />
                  </CardContent>
                </Card>

                {/* Flow B SMS Templates */}
                <SmsTemplateCard
                  title="Flow B — Jade SMS Scripts"
                  description={
                    <>
                      Edit the messages sent in each step of the Jade flow. Use placeholders like <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{day}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code> — they are replaced automatically.
                    </>
                  }
                  icon={<Sparkles className="w-4 h-4 text-[#E8735A]" />}
                  templateKeys={["flowB_sms1", "flowB_sms2", "flowB_sms3", "flowB_sms4", "flowB_sms5", "flowB_sms5_later"]}
                  settingsByKey={settingsByKey}
                  onSave={handleSave}
                />

                {/* Flow A SMS Templates */}
                <SmsTemplateCard
                  title="Flow A — Madison SMS Scripts"
                  description={
                    <>
                      Edit the messages sent in each step of the Madison flow. Use placeholders like <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{address}'}</code> — they are replaced automatically.
                    </>
                  }
                  icon={<User className="w-4 h-4 text-blue-500" />}
                  templateKeys={["flowA_sms1", "flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later"]}
                  settingsByKey={settingsByKey}
                  onSave={handleSave}
                />
              </div>
            )}

            {/* ── Widget SMS Tab ─────────────────────────────────────────────── */}
            {activeTab === "widget" && (
              <div className="space-y-6">
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                  <p className="text-xs text-emerald-700 leading-relaxed">
                    <strong>Widget SMS</strong> — these scripts are sent to leads who submit their name and phone via the floating chat widget on <code className="bg-emerald-100 px-1 rounded">maidsinblack.com</code>. The widget does <strong>not</strong> collect bedrooms/bathrooms upfront — SMS 1 asks for home size, and the AI handles the rest of the conversation.
                  </p>
                </div>

                {/* Widget Flow Selector */}
                <Card className="border border-gray-200 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                      <FlaskConical className="w-4 h-4 text-[#E8735A]" />
                      Widget SMS Conversation Flow
                    </CardTitle>
                    <CardDescription className="text-xs text-gray-500">
                      Choose which persona greets widget leads. Changes apply to new widget leads only — active conversations keep their assigned flow.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SmsFlowSelector
                      currentValue={currentWidgetFlow}
                      onSave={(value) => handleSave("widgetSmsFlow", value)}
                      settingsByKey={settingsByKey}
                      flowOptions={WIDGET_FLOW_OPTIONS}
                      flowAConvo={WIDGET_FLOW_A_CONVO}
                      flowBConvo={WIDGET_FLOW_B_CONVO}
                      settingKey="widgetSmsFlow"
                      label="Widget SMS Flow"
                      description="Controls which flow new widget leads receive."
                    />
                  </CardContent>
                </Card>

                {/* Widget Sizing SMS Templates */}
                <SmsTemplateCard
                  title="Widget SMS 1 — Sizing Question"
                  description={
                    <>
                      The very first SMS sent to widget leads asking for their home size. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code> for the lead's first name. The rest of the conversation (price reveal, scheduling, etc.) uses the shared Flow A or Flow B scripts below.
                    </>
                  }
                  icon={<MessageCircle className="w-4 h-4 text-emerald-600" />}
                  templateKeys={["widgetFlowB_sms1", "widgetFlowA_sms1"]}
                  settingsByKey={settingsByKey}
                  onSave={handleSave}
                />

                {/* Shared Flow B templates (used after sizing in widget Jade flow) */}
                <SmsTemplateCard
                  title="Widget Flow B — Jade Scripts (after sizing)"
                  description={
                    <>
                      After the lead replies with their home size, the Jade widget flow uses these same scripts as the form Jade flow. Edit them here or in the Form SMS tab — they are shared. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{day}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>.
                    </>
                  }
                  icon={<Sparkles className="w-4 h-4 text-[#E8735A]" />}
                  templateKeys={["flowB_sms1", "flowB_sms2", "flowB_sms3", "flowB_sms4", "flowB_sms5", "flowB_sms5_later"]}
                  settingsByKey={settingsByKey}
                  onSave={handleSave}
                />

                {/* Shared Flow A templates (used after sizing in widget Madison flow) */}
                <SmsTemplateCard
                  title="Widget Flow A — Madison Scripts (after sizing)"
                  description={
                    <>
                      After the lead replies with their home size, the Madison widget flow uses these same scripts as the form Madison flow. Edit them here or in the Form SMS tab — they are shared. Use <code className="bg-gray-100 px-1 rounded">{'{firstName}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{price}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{slot}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{address}'}</code>.
                    </>
                  }
                  icon={<User className="w-4 h-4 text-blue-500" />}
                  templateKeys={["flowA_sms1", "flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later"]}
                  settingsByKey={settingsByKey}
                  onSave={handleSave}
                />
              </div>
            )}

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
                        const setting = settingsByKey[key];
                        if (!setting) return null;
                        return (
                          <div key={key} className={idx > 0 ? "pt-5" : ""}>
                            <SettingField setting={setting} onSave={handleSave} />
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ))}

                {/* Tracker SMS placeholder preview */}
                {settingsByKey["trackerSmsTemplate"] && (
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
                            {settingsByKey["trackerSmsTemplate"].value
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
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
