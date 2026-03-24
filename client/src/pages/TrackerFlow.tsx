/**
 * TrackerFlow — Admin page showing the full post-job customer journey.
 *
 * Displays:
 *   1. A visual mockup of the customer-facing tracker page
 *   2. The complete SMS sequence in order, with timing and trigger explanations
 *   3. Editable message templates for each SMS in the flow
 *   4. Toggle controls for enabling/disabling the tracker SMS
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  MapPin,
  MessageSquare,
  Phone,
  Save,
  Smartphone,
  Star,
  Truck,
  X,
  Zap,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmsStep {
  id: string;
  settingKey: string | null; // null = not editable (handled by tracker page interaction)
  timing: string;
  trigger: string;
  triggerIcon: React.ReactNode;
  label: string;
  description: string;
  defaultMessage: string;
  badgeColor: string;
  badgeLabel: string;
  branches?: {
    condition: string;
    conditionIcon: React.ReactNode;
    color: string;
    steps: Omit<SmsStep, "branches">[];
  }[];
}

// ─── Tracker Page Mockup ──────────────────────────────────────────────────────

function TrackerPageMockup() {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="relative mx-auto" style={{ maxWidth: 320 }}>
      {/* Phone frame */}
      <div className="rounded-[2.5rem] border-[6px] border-gray-800 bg-gray-900 shadow-2xl overflow-hidden">
        {/* Status bar */}
        <div className="bg-gray-900 px-6 pt-3 pb-1 flex items-center justify-between">
          <span className="text-white text-xs font-medium">9:41</span>
          <div className="flex items-center gap-1">
            <div className="w-4 h-2 border border-white/60 rounded-sm relative">
              <div className="absolute inset-0.5 right-1 bg-white/60 rounded-sm" />
            </div>
          </div>
        </div>

        {/* App content */}
        <div className="bg-gray-950 min-h-[580px] text-white">
          {/* Header */}
          <div className="px-5 pt-5 pb-4 border-b border-gray-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0">
                <span className="text-gray-900 font-black text-xs">MIB</span>
              </div>
              <div>
                <p className="text-white font-bold text-sm">Maids in Black</p>
                <p className="text-gray-400 text-xs">(202) 888-5362</p>
              </div>
            </div>
          </div>

          {/* Status card */}
          <div className="px-5 pt-5">
            <div className="rounded-2xl bg-gray-900 border border-gray-800 p-4 text-center mb-4">
              <div className="text-3xl mb-2">🚗</div>
              <p className="text-amber-400 font-bold text-sm">Sarah, your team is on the way!</p>
              <p className="text-gray-400 text-xs mt-1">They're heading to you now</p>
            </div>

            {/* Progress steps */}
            <div className="flex items-center justify-between mb-5 px-1">
              {["📋", "🚗", "🏠", "🧹", "✅"].map((emoji, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm border-2 ${
                    i <= 1 ? "border-amber-400 bg-amber-400/20" : "border-gray-700 bg-gray-800"
                  }`}>
                    {emoji}
                  </div>
                  {i < 4 && (
                    <div className={`h-0.5 w-6 -mt-5 -mr-6 ${i < 1 ? "bg-amber-400" : "bg-gray-700"}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Job details */}
            <div className="space-y-2 mb-5">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>1234 Oak Street NW, Washington DC</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Clock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>Today at 10:00 AM · Standard Clean</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Phone className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>(202) 888-5362 · Tap to call</span>
              </div>
            </div>

            {/* Rating section */}
            {!submitted ? (
              <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 text-center">
                <p className="text-white text-xs font-semibold mb-3">How's the clean going?</p>
                <div className="flex justify-center gap-2 mb-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onMouseEnter={() => setHovered(star)}
                      onMouseLeave={() => setHovered(0)}
                      onClick={() => { setRating(star); setSubmitted(true); }}
                      className="transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-7 h-7 transition-colors ${
                          star <= (hovered || rating) ? "text-amber-400 fill-amber-400" : "text-gray-600"
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <p className="text-gray-500 text-[10px]">Your feedback helps us improve</p>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-900/30 border border-emerald-700/50 p-4 text-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                <p className="text-emerald-400 text-xs font-semibold">
                  {rating >= 4 ? "Thank you! 🌟" : "Thank you for your feedback"}
                </p>
                <p className="text-gray-400 text-[10px] mt-1">
                  {rating === 5 ? "Check your texts for a Google review link!" : "Our team will follow up shortly."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Label */}
      <p className="text-center text-xs text-gray-400 mt-3">
        Interactive mockup · <button onClick={() => { setRating(0); setSubmitted(false); }} className="text-violet-500 hover:underline">Reset</button>
      </p>
    </div>
  );
}

// ─── SMS Bubble ───────────────────────────────────────────────────────────────

function SmsBubble({ message, side = "left" }: { message: string; side?: "left" | "right" }) {
  return (
    <div className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
        side === "right"
          ? "bg-blue-500 text-white rounded-br-sm"
          : "bg-gray-100 text-gray-900 rounded-bl-sm"
      }`}>
        {message}
      </div>
    </div>
  );
}

// ─── Editable SMS Card ────────────────────────────────────────────────────────

function SmsCard({
  step,
  value,
  enabled,
  onSave,
  onToggle,
}: {
  step: SmsStep;
  value: string;
  enabled?: boolean;
  onSave: (key: string, value: string) => void;
  onToggle?: (key: string, value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleSave = () => {
    if (step.settingKey) {
      onSave(step.settingKey, draft);
    }
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="mt-0.5 shrink-0 text-gray-500">{step.triggerIcon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">{step.label}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${step.badgeColor}`}>
              {step.badgeLabel}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{step.timing}</p>
        </div>
        {step.settingKey && onToggle === undefined && (
          <button
            onClick={() => { setEditing(true); setDraft(value); }}
            className="shrink-0 p-1.5 rounded-lg hover:bg-gray-200 transition-colors text-gray-400 hover:text-gray-700"
            title="Edit message"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
        {onToggle && step.settingKey && (
          <Switch
            checked={enabled}
            onCheckedChange={(v) => onToggle(step.settingKey!, v)}
            className="shrink-0"
          />
        )}
      </div>

      {/* Description */}
      <div className="px-4 py-2.5 border-b border-gray-100">
        <p className="text-xs text-gray-500 leading-relaxed">{step.description}</p>
      </div>

      {/* SMS preview */}
      <div className="px-4 py-3 space-y-2">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="text-sm min-h-[80px] resize-none"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={handleCancel} className="h-7 text-xs gap-1">
                <X className="w-3 h-3" /> Cancel
              </Button>
              <Button size="sm" onClick={handleSave} className="h-7 text-xs gap-1">
                <Save className="w-3 h-3" /> Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <SmsBubble message={value} side="left" />
            {step.settingKey && (
              <button
                onClick={() => { setEditing(true); setDraft(value); }}
                className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 font-medium mt-1"
              >
                <Edit3 className="w-3 h-3" /> Edit message
              </button>
            )}
          </div>
        )}
      </div>

      {/* Branches */}
      {step.branches && step.branches.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Customer replies</p>
          {step.branches.map((branch, i) => (
            <div key={i} className={`rounded-lg border p-3 space-y-2 ${branch.color}`}>
              <div className="flex items-center gap-1.5">
                {branch.conditionIcon}
                <span className="text-xs font-semibold">{branch.condition}</span>
              </div>
              {branch.steps.map((bs, j) => (
                <div key={j} className="ml-4 space-y-1">
                  <p className="text-[10px] text-gray-500">{bs.timing}</p>
                  <SmsBubble message={bs.defaultMessage} side="right" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrackerFlow() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const settingsQuery = trpc.settings.getAll.useQuery();
  const updateMutation = trpc.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Message saved");
      settingsQuery.refetch();
    },
    onError: (err) => toast.error(err.message || "Failed to save"),
  });

  const settings = settingsQuery.data ?? {};
  const getValue = (key: string, fallback: string) => (settings as Record<string, string>)[key] ?? fallback;

  const handleSave = (key: string, value: string) => {
    updateMutation.mutate({ key, value });
  };

  const handleToggle = (key: string, value: boolean) => {
    updateMutation.mutate({ key, value: value ? "true" : "false" });
  };

  // ── Flow steps definition ─────────────────────────────────────────────────

  const FLOW_STEPS: SmsStep[] = [
    {
      id: "tracker-link",
      settingKey: "trackerSmsTemplate",
      timing: "Day of job · 8:00 AM ET",
      trigger: "Sent automatically to every customer with a job today",
      triggerIcon: <Clock className="w-4 h-4" />,
      label: "Tracker Link SMS",
      description: "Sent the morning of the job. Includes a personalized link to the live tracker page where the customer can follow their team's progress and rate the service.",
      defaultMessage: getValue(
        "trackerSmsTemplate",
        "Hi {firstName}! Your Maids in Black team is on the way today. Track your clean in real time here: {trackerLink} 🧹"
      ),
      badgeColor: "bg-blue-100 text-blue-700",
      badgeLabel: "Auto · 8 AM",
    },
    {
      id: "rating-response",
      settingKey: null,
      timing: "Immediately after customer rates on tracker page",
      trigger: "Customer taps a star rating on the tracker page",
      triggerIcon: <Star className="w-4 h-4" />,
      label: "Star Rating Response",
      description: "When a customer taps a star rating on the tracker page, the system responds based on the score. 5 stars triggers the Google review request. 1–3 stars alerts the owner immediately for service recovery.",
      defaultMessage: "— Customer taps stars on the tracker page —",
      badgeColor: "bg-amber-100 text-amber-700",
      badgeLabel: "Triggered by rating",
      branches: [
        {
          condition: "5 stars ⭐⭐⭐⭐⭐ — Delighted",
          conditionIcon: <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />,
          color: "bg-amber-50 border-amber-200",
          steps: [
            {
              id: "five-star-review",
              settingKey: "googleReviewSmsTemplate",
              timing: "Immediately",
              trigger: "5-star rating",
              triggerIcon: <Star className="w-4 h-4" />,
              label: "Google Review SMS",
              description: "Sent immediately after a 5-star rating. Asks the customer to share their experience on Google.",
              defaultMessage: getValue(
                "googleReviewSmsTemplate",
                "Hi {firstName}! 🌟 Thank you so much for the 5-star rating! We'd love it if you could share your experience on Google — it helps us a ton: {reviewLink}"
              ),
              badgeColor: "bg-amber-100 text-amber-700",
              badgeLabel: "Immediate",
            },
          ],
        },
        {
          condition: "4 stars ⭐⭐⭐⭐ — Happy",
          conditionIcon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
          color: "bg-emerald-50 border-emerald-200",
          steps: [
            {
              id: "four-star-recurring",
              settingKey: null,
              timing: "Next morning",
              trigger: "4-star rating",
              triggerIcon: <RefreshCw className="w-4 h-4" />,
              label: "Recurring Booking Pitch",
              description: "Coming soon — will send the next morning to offer a recurring booking slot.",
              defaultMessage: "Hi {firstName}! Glad you loved your clean 😊 Want to lock in your next one for [2 weeks from now]? Just reply YES and I'll hold the slot!",
              badgeColor: "bg-gray-100 text-gray-500",
              badgeLabel: "Coming soon",
            },
          ],
        },
        {
          condition: "1–3 stars ⭐ — Unhappy",
          conditionIcon: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
          color: "bg-red-50 border-red-200",
          steps: [
            {
              id: "low-rating-alert",
              settingKey: null,
              timing: "Immediately",
              trigger: "1–3 star rating",
              triggerIcon: <AlertTriangle className="w-4 h-4" />,
              label: "Owner Alert",
              description: "Owner receives an immediate SMS and dashboard notification with the rating, job address, and customer phone number. No automated reply is sent to the customer — this goes to manual handling.",
              defaultMessage: "⚠️ Low rating alert: Sarah left 2 stars ★★☆☆☆\nJob: Jan 15 — 1234 Oak St NW\nPhone: (202) 555-1234",
              badgeColor: "bg-red-100 text-red-700",
              badgeLabel: "Owner alert",
            },
          ],
        },
      ],
    },
    {
      id: "no-interaction",
      settingKey: null,
      timing: "48 hours after job date",
      trigger: "Customer never clicked the tracker link",
      triggerIcon: <Smartphone className="w-4 h-4" />,
      label: "No-Interaction Follow-up",
      description: "Coming soon — if the customer never opened the tracker link and never rated, Jade sends a gentle recurring booking pitch 48 hours after the job.",
      defaultMessage: "Hi {firstName}! Hope the home is still feeling fresh 😊 Want to lock in your next cleaning for [date]? Just reply YES and I'll hold the slot!",
      badgeColor: "bg-gray-100 text-gray-500",
      badgeLabel: "Coming soon",
    },
  ];

  const trackerEnabled = getValue("trackerSmsEnabled", "false") === "true";

  return (
    <AdminPageGuard pageId="tracker-flow">
    <div className="hj-theme min-h-screen bg-gray-50">
      <AdminHeader activeTab="tracker-flow" pagePermissions={pagePermissions} isAdmin={isAdmin} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <Smartphone className="w-5 h-5 text-gray-700" />
            <h1 className="text-xl font-bold text-gray-900">Tracker Flow</h1>
            <Badge variant="outline" className="text-xs font-medium">
              Post-Job Customer Journey
            </Badge>
          </div>
          <p className="text-sm text-gray-500 ml-8">
            Everything that happens after a job is confirmed — from the morning tracker link to the post-clean rating and follow-up.
          </p>
        </div>

        {/* Enable toggle banner */}
        <div className={`rounded-xl border px-5 py-4 mb-8 flex items-center justify-between gap-4 ${
          trackerEnabled ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"
        }`}>
          <div className="flex items-center gap-3">
            <Zap className={`w-4 h-4 shrink-0 ${trackerEnabled ? "text-emerald-600" : "text-amber-600"}`} />
            <div>
              <p className={`text-sm font-semibold ${trackerEnabled ? "text-emerald-800" : "text-amber-800"}`}>
                {trackerEnabled ? "Tracker SMS is live — sending automatically at 8 AM daily" : "Tracker SMS is currently disabled"}
              </p>
              <p className={`text-xs mt-0.5 ${trackerEnabled ? "text-emerald-600" : "text-amber-600"}`}>
                {trackerEnabled
                  ? "Customers with a job today will receive the tracker link at 8 AM ET."
                  : "Enable to automatically send tracker links to customers on job day."}
              </p>
            </div>
          </div>
          <Switch
            checked={trackerEnabled}
            onCheckedChange={(v) => handleToggle("trackerSmsEnabled", v)}
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start">
          {/* Left: SMS flow */}
          <div className="space-y-4">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> SMS Sequence
            </h2>

            {FLOW_STEPS.map((step, i) => (
              <div key={step.id} className="relative">
                {/* Connector line */}
                {i < FLOW_STEPS.length - 1 && (
                  <div className="absolute left-[1.35rem] top-full w-0.5 h-4 bg-gray-200 z-10" />
                )}
                <SmsCard
                  step={step}
                  value={step.defaultMessage}
                  onSave={handleSave}
                />
              </div>
            ))}

            {/* Future: recurring booking */}
            <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white px-5 py-4 text-center">
              <RefreshCw className="w-5 h-5 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-400">Recurring Booking Automation</p>
              <p className="text-xs text-gray-400 mt-1">
                Coming next — Jade will automatically offer to lock in the next clean after a positive rating or 48h post-job.
              </p>
            </div>
          </div>

          {/* Right: Tracker page mockup */}
          <div className="space-y-4 lg:sticky lg:top-6">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
              <Smartphone className="w-4 h-4" /> Customer Tracker Page
            </h2>
            <TrackerPageMockup />
            <a
              href="/track/demo"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open live tracker page
            </a>
          </div>
        </div>
      </div>
    </div>
    </AdminPageGuard>
  );
}
