/**
 * SettingsPage — /admin/settings
 *
 * Admin-only page for managing configurable business settings:
 * - SMS Conversation Flow (A/B/Split selector)
 * - Google Review URL
 * - Tracker SMS template
 * - Auto-send Google Review on 5-star toggle
 * - Business name & phone
 * - Tracker SMS enable/disable toggle
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
  FlaskConical, User, Sparkles, Shuffle,
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
    description: "Price upfront in SMS 1 with Madison's photo. Availability question sent immediately after.",
    sms1Preview: `Hi Sarah! Madison here, thanks for reaching out to Maids in Black. Your Standard Cleaning quote for a 3 bed / 2 bath home is $180 — our fully insured team handles everything.`,
    sms2Preview: `Are you available Thursday afternoon or Saturday morning? We'd love to get you scheduled! 🗓️`,
    color: "blue",
  },
  {
    value: "B",
    label: "Flow B — Jade",
    icon: <Sparkles className="w-4 h-4" />,
    description: "Friendly greeting + day ask first. Price revealed after lead replies with a day.",
    sms1Preview: `Hey Sarah! Jade here from Maids in Black 😊 Got your request — we'd love to help. What day were you thinking?`,
    sms2Preview: `Perfect. We handle a lot of 3 bed / 2 bath homes — no problem at all.\n\nFor a home like yours, most clients land around $180. That covers everything, no hidden fees.\nI've got Thursday at 9am or 1pm — which one should I lock in?`,
    color: "coral",
  },
  {
    value: "split",
    label: "50/50 Split",
    icon: <Shuffle className="w-4 h-4" />,
    description: "Randomly assign Flow A or Flow B to each new lead for A/B testing. Each lead's flow is locked in at creation.",
    sms1Preview: null,
    sms2Preview: null,
    color: "purple",
  },
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
}: {
  currentValue: string;
  onSave: (value: string) => Promise<void>;
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

  const selectedOption = FLOW_OPTIONS.find(o => o.value === selected);

  return (
    <div className="space-y-4">
      {/* Flow option cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FLOW_OPTIONS.map((option) => {
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

      {/* SMS Preview for selected flow */}
      {selectedOption && selectedOption.sms1Preview && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SMS Preview</p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-xs text-gray-400 w-12 shrink-0 pt-1">SMS 1</span>
              <div className="bg-white rounded-2xl rounded-tl-sm border border-gray-200 px-3 py-2 text-xs text-gray-700 leading-relaxed max-w-xs whitespace-pre-line">
                {selectedOption.sms1Preview}
              </div>
            </div>
            {selectedOption.sms2Preview && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-400 w-12 shrink-0 pt-1">SMS 2</span>
                <div className="bg-white rounded-2xl rounded-tl-sm border border-gray-200 px-3 py-2 text-xs text-gray-700 leading-relaxed max-w-xs whitespace-pre-line">
                  {selectedOption.sms2Preview}
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">Preview with sample data (Sarah, 3 bed / 2 bath, $180).</p>
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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: settings, isLoading, refetch } = trpc.settings.getAll.useQuery();
  const updateSetting = trpc.settings.update.useMutation();

  const handleSave = async (key: string, value: string) => {
    await updateSetting.mutateAsync({ key, value });
    await refetch();
    toast.success("Setting saved");
  };

  const settingsByKey = Object.fromEntries(
    (settings ?? []).map((s) => [s.key, s])
  );

  const currentFlow = settingsByKey["smsFlow"]?.value ?? "B";

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
            <p className="text-sm text-gray-500">Manage business configuration and feature toggles</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[#E8735A]" />
          </div>
        ) : (
          <>
            {/* SMS Conversation Flow A/B selector */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-[#E8735A]" />
                  SMS Conversation Flow
                </CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  Choose which opening SMS script is sent to new quote leads. Changes apply to new leads only — active conversations keep their assigned flow.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SmsFlowSelector
                  currentValue={currentFlow}
                  onSave={(value) => handleSave("smsFlow", value)}
                />
              </CardContent>
            </Card>

            {/* Other settings sections */}
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
          </>
        )}

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
    </div>
  );
}
